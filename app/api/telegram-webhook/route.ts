/**
 * POST /api/telegram-webhook
 *
 * Receptor de actualizaciones del Bot de Telegram.
 * Comandos: /estado, /choferes, /alertas, /resumen_hoy, /puntos, /ayuda
 *
 * Registrar webhook: GET /api/telegram-webhook?setup=1
 */

import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

// ─── Tipos Telegram (mínimos necesarios) ────────────────────────────────────

interface TgUser  { id: number; first_name: string; username?: string }
interface TgChat  { id: number; type: string }
interface TgMsg   { message_id: number; from?: TgUser; chat: TgChat; text?: string; date: number }
interface TgUpdate { update_id: number; message?: TgMsg; callback_query?: unknown }

// ─── Firestore REST helper ───────────────────────────────────────────────────

const PROJECT = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID ?? "";
const API_KEY = process.env.NEXT_PUBLIC_FIREBASE_API_KEY ?? "";
const FS_BASE = `https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)/documents`;

async function fsGet(path: string): Promise<Record<string, unknown> | null> {
  const res = await fetch(`${FS_BASE}/${path}?key=${API_KEY}`, {
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) return null;
  return res.json() as Promise<Record<string, unknown>>;
}

async function fsQuery(collection: string, opts?: { pageSize?: number }): Promise<unknown[]> {
  const ps = opts?.pageSize ?? 20;
  const res = await fetch(`${FS_BASE}/${collection}?key=${API_KEY}&pageSize=${ps}`, {
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) return [];
  const data = await res.json() as { documents?: unknown[] };
  return data.documents ?? [];
}

// ─── Enviar mensaje a Telegram ───────────────────────────────────────────────

async function send(chatId: number, text: string, parseMode = "Markdown") {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) return;
  await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id:    chatId,
      text:       text.slice(0, 4096),
      parse_mode: parseMode,
    }),
  });
}

// ─── Helpers Firestore ───────────────────────────────────────────────────────

function fv(field: Record<string, unknown> | unknown): string {
  if (!field || typeof field !== "object") return "—";
  const f = field as Record<string, unknown>;
  if ("stringValue"  in f) return String(f.stringValue);
  if ("integerValue" in f) return String(f.integerValue);
  if ("doubleValue"  in f) return String(f.doubleValue);
  if ("booleanValue" in f) return (f.booleanValue as boolean) ? "✅ Sí" : "❌ No";
  if ("timestampValue" in f) {
    const d = new Date(f.timestampValue as string);
    return d.toLocaleString("es-DO", { timeZone: "America/Santo_Domingo" });
  }
  return "—";
}

function fvNum(field: unknown): number {
  if (!field || typeof field !== "object") return 0;
  const f = field as Record<string, unknown>;
  const s = "doubleValue" in f ? String(f.doubleValue)
          : "integerValue" in f ? String(f.integerValue) : "0";
  return isNaN(Number(s)) ? 0 : Number(s);
}

async function fsRunQuery(body: Record<string, unknown>): Promise<Record<string, unknown>[]> {
  try {
    const res = await fetch(`${FS_BASE}:runQuery?key=${API_KEY}`, {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify(body),
      signal:  AbortSignal.timeout(15000),
    });
    if (!res.ok) return [];
    const rows = await res.json() as { document?: Record<string, unknown> }[];
    return rows.filter((r) => r.document).map((r) => r.document!);
  } catch { return []; }
}

// ─── Comandos ────────────────────────────────────────────────────────────────

/** /estado — resumen rápido del sistema */
async function cmdEstado(chatId: number) {
  await send(chatId, "⏳ Consultando estado del sistema…");
  try {
    const url  = `https://polar-breeze-hub.vercel.app/api/status`;
    const res  = await fetch(url, { signal: AbortSignal.timeout(15000) });
    const data = await res.json() as {
      firebase: { status: string; message: string; ms?: number };
      anthropic: { status: string; message: string };
      telegram: { status: string; message: string };
      vercel: { status: string; message: string; detail?: string };
    };

    const icon = (s: string) => s === "ok" ? "✅" : s === "warning" ? "⚠️" : s === "error" ? "❌" : "❓";

    const lines = [
      "🖥️ *Estado del Sistema — Polar Breeze Hub*",
      "",
      `${icon(data.firebase.status)}  Firebase: \`${data.firebase.message}\`${data.firebase.ms ? ` (${data.firebase.ms}ms)` : ""}`,
      `${icon(data.anthropic.status)} Anthropic: \`${data.anthropic.message}\``,
      `${icon(data.telegram.status)}  Telegram: \`${data.telegram.message}\``,
      `${icon(data.vercel.status)}  Vercel: \`${data.vercel.message}\``,
      data.vercel.detail ? `    _${data.vercel.detail}_` : "",
    ].filter(Boolean);

    await send(chatId, lines.join("\n"));
  } catch (e) {
    await send(chatId, `❌ Error al consultar estado: \`${String(e)}\``);
  }
}

/** /choferes — lista choferes y estado del día */
async function cmdChoferes(chatId: number) {
  await send(chatId, "⏳ Cargando choferes…");
  try {
    const hoy   = new Date().toISOString().slice(0, 10);
    const docs  = await fsQuery("usuarios");

    interface UserDoc {
      fields?: {
        role?:   Record<string, unknown>;
        nombre?: Record<string, unknown>;
        ficha?:  Record<string, unknown>;
        activo?: Record<string, unknown>;
      };
    }

    const choferes = (docs as UserDoc[]).filter((d) =>
      d.fields?.role && fv(d.fields.role).includes("chofer")
    );

    if (choferes.length === 0) {
      await send(chatId, "ℹ️ No hay choferes registrados en Firestore aún.");
      return;
    }

    const lines = [
      `👥 *Choferes — ${hoy}*`,
      `Total: ${choferes.length} choferes activos`,
      "",
    ];

    for (const ch of choferes) {
      const nombre = ch.fields?.nombre ? fv(ch.fields.nombre) : "Sin nombre";
      const ficha  = ch.fields?.ficha  ? fv(ch.fields.ficha)  : "—";
      lines.push(`• [${ficha}] ${nombre}`);
    }

    lines.push("", "_Usa /resumen\\_hoy para ver quién reportó hoy._");
    await send(chatId, lines.join("\n"));
  } catch (e) {
    await send(chatId, `❌ Error: \`${String(e)}\``);
  }
}

/** /alertas — anomalías recientes sin leer */
async function cmdAlertas(chatId: number) {
  await send(chatId, "⏳ Cargando alertas…");
  try {
    const docs = await fsQuery("alertas", { pageSize: 10 });

    interface AlertaDoc {
      fields?: {
        tipo?:      Record<string, unknown>;
        severidad?: Record<string, unknown>;
        mensaje?:   Record<string, unknown>;
        leida?:     Record<string, unknown>;
        creadaEn?:  Record<string, unknown>;
      };
    }

    const alertas = (docs as AlertaDoc[]).filter(
      (d) => d.fields?.leida && fv(d.fields.leida) === "❌ No"
    );

    if (alertas.length === 0) {
      await send(chatId, "✅ Sin alertas pendientes. Todo en orden.");
      return;
    }

    const lines = [`🚨 *Alertas sin leer (${alertas.length})*`, ""];
    for (const a of alertas) {
      const sev  = a.fields?.severidad ? fv(a.fields.severidad) : "info";
      const tipo = a.fields?.tipo      ? fv(a.fields.tipo)      : "—";
      const msg  = a.fields?.mensaje   ? fv(a.fields.mensaje)   : "—";
      const icn  = sev === "critica" ? "🔴" : sev === "alta" ? "🟠" : "🟡";
      lines.push(`${icn} *${tipo}*`);
      lines.push(`   ${msg.slice(0, 120)}`);
    }
    lines.push("", "_Revisa el Hub Admin para más detalles._");
    await send(chatId, lines.join("\n"));
  } catch (e) {
    await send(chatId, `❌ Error: \`${String(e)}\``);
  }
}

/** /resumen_hoy — resumen operativo del día con datos reales */
async function cmdResumenHoy(chatId: number) {
  await send(chatId, "⏳ Preparando resumen del día…");
  try {
    const ahora   = new Date();
    const fechaRD = ahora.toLocaleDateString("en-CA", { timeZone: "America/Santo_Domingo" });
    const hora    = ahora.toLocaleTimeString("es-DO", {
      timeZone: "America/Santo_Domingo", hour: "2-digit", minute: "2-digit",
    });
    const fechaLabel = ahora.toLocaleDateString("es-DO", {
      timeZone: "America/Santo_Domingo", weekday: "long", day: "2-digit", month: "long",
    });

    // Lotes del día
    const lotes = await fsQuery("lotes_loker", { pageSize: 100 });

    // Imbentario del día — structured query
    const inicioDia = new Date(`${fechaRD}T00:00:00-04:00`).toISOString();
    const imbDocs   = await fsRunQuery({
      structuredQuery: {
        from:  [{ collectionId: "imbentario" }],
        where: {
          fieldFilter: {
            field: { fieldPath: "timestamp" },
            op:    "GREATER_THAN_OR_EQUAL",
            value: { timestampValue: inicioDia },
          },
        },
        limit: 300,
      },
    });

    let totalUds   = 0;
    let totalMonto = 0;
    const porChofer: Record<string, { nombre: string; uds: number }> = {};
    for (const doc of imbDocs) {
      const f       = doc.fields as Record<string, unknown> | undefined;
      const cId     = fv(f?.choferId);
      const cNombre = fv(f?.choferNombre);
      const uds     = fvNum(f?.cantidadEntregada);
      const monto   = fvNum(f?.monto);
      totalUds   += uds;
      totalMonto += monto;
      if (!porChofer[cId]) porChofer[cId] = { nombre: cNombre, uds: 0 };
      porChofer[cId].uds += uds;
    }

    const ranking = Object.values(porChofer)
      .sort((a, b) => b.uds - a.uds)
      .slice(0, 5);

    const lines = [
      `📊 *Resumen del día — Polar Breeze*`,
      `📅 ${fechaLabel} · 🕐 ${hora}`,
      "",
      `📦 *Lotes recibidos hoy:* ${lotes.length}`,
      `🚚 *Registros de despacho:* ${imbDocs.length}`,
      `🔢 *Unidades entregadas:* ${totalUds.toLocaleString("es-DO")}`,
      totalMonto > 0
        ? `💰 *Facturado:* RD$${totalMonto.toLocaleString("es-DO", { maximumFractionDigits: 0 })}`
        : "",
    ].filter(Boolean);

    if (ranking.length > 0) {
      lines.push("", "🏆 *Top choferes hoy:*");
      ranking.forEach((c, i) => {
        lines.push(`  ${i + 1}. ${c.nombre} — ${c.uds} uds`);
      });
    }

    if (imbDocs.length === 0) {
      lines.push("", "_Sin registros de despacho hoy todavía._");
    }

    lines.push("", "_Para detalles completos, abre el Hub Admin._");
    await send(chatId, lines.join("\n"));
  } catch (e) {
    await send(chatId, `❌ Error: \`${String(e)}\``);
  }
}

/** /puntos — puntos acumulados de la quincena actual por chofer */
async function cmdPuntos(chatId: number) {
  await send(chatId, "⏳ Calculando puntos de la quincena…");
  try {
    const ahora = new Date();
    const dia   = Number(ahora.toLocaleDateString("en-CA", { timeZone: "America/Santo_Domingo" }).split("-")[2]);
    const esSegunda = dia >= 16;

    const mesAnio    = ahora.toLocaleDateString("es-DO", {
      timeZone: "America/Santo_Domingo", month: "long", year: "numeric",
    });
    const qLabel = `${esSegunda ? "2ª" : "1ª"} quincena ${mesAnio}`;

    // Rango de la quincena
    const anio = ahora.getFullYear();
    const mes  = ahora.getMonth();
    const inicioQ = esSegunda
      ? new Date(anio, mes, 16, 0, 0, 0)
      : new Date(anio, mes, 1,  0, 0, 0);

    const imbDocs = await fsRunQuery({
      structuredQuery: {
        from:  [{ collectionId: "imbentario" }],
        where: {
          fieldFilter: {
            field: { fieldPath: "timestamp" },
            op:    "GREATER_THAN_OR_EQUAL",
            value: { timestampValue: inicioQ.toISOString() },
          },
        },
        limit: 1000,
      },
    });

    // Config puntos
    const cfgDoc    = await fsGet("config/puntos");
    const metaVal   = fvNum((cfgDoc?.fields as Record<string, unknown> | undefined)?.metaPuntos);
    const puntosMap: Record<string, number> = {};
    const prodArr   = ((cfgDoc?.fields as Record<string, unknown> | undefined)?.productos as Record<string, unknown> | undefined)
      ?.arrayValue as Record<string, unknown> | undefined;
    if (prodArr?.values && Array.isArray(prodArr.values)) {
      (prodArr.values as Record<string, unknown>[]).forEach((item) => {
        const mv  = (item as Record<string, unknown>).mapValue as Record<string, unknown> | undefined;
        const ff  = mv?.fields as Record<string, Record<string, unknown>> | undefined;
        if (ff?.nombre && ff?.puntos) {
          puntosMap[fv(ff.nombre).toLowerCase().trim()] = fvNum(ff.puntos);
        }
      });
    }

    // Agregar por chofer
    const porChofer: Record<string, { nombre: string; pts: number; uds: number }> = {};
    for (const doc of imbDocs) {
      const f       = doc.fields as Record<string, unknown> | undefined;
      const cId     = fv(f?.choferId);
      const cNombre = fv(f?.choferNombre);
      const prod    = fv(f?.producto).toLowerCase().trim();
      const uds     = fvNum(f?.cantidadEntregada);
      const pts     = (puntosMap[prod] ?? 0) * uds;
      if (!porChofer[cId]) porChofer[cId] = { nombre: cNombre, pts: 0, uds: 0 };
      porChofer[cId].pts += pts;
      porChofer[cId].uds += uds;
    }

    const ranking = Object.values(porChofer).sort((a, b) => b.pts - a.pts);

    if (ranking.length === 0) {
      await send(chatId, `📊 Sin datos de puntos para la ${qLabel}.`);
      return;
    }

    const lines = [
      `⭐ *Puntos — ${qLabel}*`,
      metaVal > 0 ? `Meta: ${metaVal} pts` : "",
      "",
    ].filter(Boolean);

    ranking.forEach((c, i) => {
      const icon = i === 0 ? "🥇" : i === 1 ? "🥈" : i === 2 ? "🥉" : `${i + 1}.`;
      const cumple = metaVal > 0 ? (c.pts >= metaVal ? " ✅" : " ⚠️") : "";
      lines.push(`${icon} ${c.nombre}${cumple}`);
      lines.push(`   ${c.pts} pts · ${c.uds} uds`);
    });

    lines.push("", "_Datos en tiempo real desde Firebase._");
    await send(chatId, lines.join("\n"));
  } catch (e) {
    await send(chatId, `❌ Error calculando puntos: \`${String(e)}\``);
  }
}

/** /ayuda — lista de comandos */
async function cmdAyuda(chatId: number) {
  const texto = [
    "🧊 *Polar Breeze Hub Bot*",
    "",
    "Comandos disponibles:",
    "  /estado — Estado de todos los servicios",
    "  /choferes — Lista choferes activos",
    "  /alertas — Alertas pendientes sin leer",
    "  /resumen\\_hoy — Resumen operativo del día",
    "  /puntos — Puntos de la quincena actual",
    "  /ayuda — Esta ayuda",
    "",
    "_Administrador: Oliver · Hub: polar\\-breeze\\-hub.vercel.app_",
  ].join("\n");
  await send(chatId, texto);
}

// ─── Autorización de chat IDs ────────────────────────────────────────────────

function esAutorizado(chatId: number): boolean {
  const authorized = (process.env.TELEGRAM_CHAT_IDS ?? process.env.TELEGRAM_CHAT_ID ?? "")
    .split(",").map((s) => s.trim()).filter(Boolean).map(Number);
  // Si no hay IDs configurados, rechazar todo
  if (authorized.length === 0) return false;
  return authorized.includes(chatId);
}

// ─── Handler principal ───────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  try {
    const body   = await req.json() as TgUpdate;
    const msg    = body.message;
    if (!msg?.text || !msg.chat) return NextResponse.json({ ok: true });

    const chatId = msg.chat.id;
    const text   = msg.text.trim();

    // Verificar autorización
    if (!esAutorizado(chatId)) {
      await send(chatId, "🔒 No autorizado. Contacta al administrador.");
      return NextResponse.json({ ok: true });
    }

    // Enrutador de comandos
    const cmd = text.split(" ")[0].toLowerCase().replace(/@\w+$/, "");
    switch (cmd) {
      case "/estado":        await cmdEstado(chatId);      break;
      case "/choferes":      await cmdChoferes(chatId);    break;
      case "/alertas":       await cmdAlertas(chatId);     break;
      case "/resumen_hoy":   await cmdResumenHoy(chatId);  break;
      case "/puntos":        await cmdPuntos(chatId);      break;
      case "/ayuda":
      case "/start":
      case "/help":          await cmdAyuda(chatId);       break;
      default:
        await send(chatId, `❓ Comando desconocido: \`${cmd}\`\nUsa /ayuda para ver los comandos disponibles.`);
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    // Telegram necesita siempre 200 — no reintentará si recibe 200
    console.error("[telegram-webhook]", err);
    return NextResponse.json({ ok: true });
  }
}

// ─── GET — registrar webhook en Telegram ────────────────────────────────────

export async function GET(req: NextRequest) {
  const setup = req.nextUrl.searchParams.get("setup");
  if (setup !== "1") {
    return NextResponse.json({ info: "Telegram Webhook. Añade ?setup=1 para registrar el webhook." });
  }

  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) {
    return NextResponse.json({ error: "TELEGRAM_BOT_TOKEN no configurado" }, { status: 500 });
  }

  const host    = req.nextUrl.origin;
  const hookUrl = `${host}/api/telegram-webhook`;
  const res     = await fetch(`https://api.telegram.org/bot${token}/setWebhook`, {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    body:    JSON.stringify({ url: hookUrl, allowed_updates: ["message"] }),
  });
  const data = await res.json();
  return NextResponse.json({ hookUrl, telegram: data });
}
