/**
 * POST /api/telegram
 *
 * Envía mensajes de Polar Breeze Hub al canal de Telegram configurado.
 *
 * Soporta múltiples tipos de mensaje:
 *   - "error" / "warning" / "info" — log genérico del sistema
 *   - "alerta" — alerta de anomalía con datos estructurados
 *   - "reporte_dia" — resumen operativo del día
 *   - "chofer_sin_reporte" — aviso de chofer que no reportó
 */

import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

// Soporta TELEGRAM_CHAT_IDS (coma-separados) o el legacy TELEGRAM_CHAT_ID
function getChatIds(): string[] {
  const multi  = process.env.TELEGRAM_CHAT_IDS ?? "";
  const single = process.env.TELEGRAM_CHAT_ID  ?? "";
  const raw    = multi || single;
  return raw.split(",").map((s) => s.trim()).filter(Boolean);
}

async function enviarMensaje(chatId: string, text: string, token: string) {
  return fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    body:    JSON.stringify({
      chat_id:    chatId,
      text:       text.slice(0, 4096),
      parse_mode: "Markdown",
    }),
  });
}

// ─── Formateadores por tipo de mensaje ───────────────────────────────────────

function formatearGenerico(payload: {
  message: string;
  level?: "info" | "warning" | "error";
  window?: string;
  fn?: string;
}): string {
  const emoji = payload.level === "error" ? "🚨" : payload.level === "warning" ? "⚠️" : "ℹ️";
  const lines = [
    `${emoji} *Polar Breeze Hub*`,
    `Nivel: \`${(payload.level ?? "info").toUpperCase()}\``,
  ];
  if (payload.window) lines.push(`Ventana: \`${payload.window}\``);
  if (payload.fn)     lines.push(`Función: \`${payload.fn}\``);
  lines.push(`\`\`\`\n${payload.message.slice(0, 3000)}\n\`\`\``);
  lines.push(`_${new Date().toLocaleString("es-DO", { timeZone: "America/Santo_Domingo" })}_`);
  return lines.join("\n");
}

function formatearAlerta(payload: {
  tipo:       string;
  severidad?: "baja" | "media" | "alta" | "critica";
  mensaje:    string;
  chofer?:    string;
  ficha?:     string;
  detalle?:   string;
}): string {
  const iconSev: Record<string, string> = {
    critica: "🔴", alta: "🟠", media: "🟡", baja: "🟢",
  };
  const icon = iconSev[payload.severidad ?? "media"] ?? "⚠️";
  const lines = [
    `${icon} *ALERTA — ${payload.tipo}*`,
    `Severidad: \`${(payload.severidad ?? "media").toUpperCase()}\``,
  ];
  if (payload.chofer) lines.push(`Chofer: ${payload.chofer}${payload.ficha ? ` (ficha ${payload.ficha})` : ""}`);
  lines.push(``, payload.mensaje);
  if (payload.detalle) lines.push(``, `_Detalle: ${payload.detalle}_`);
  lines.push(``, `_${new Date().toLocaleString("es-DO", { timeZone: "America/Santo_Domingo" })}_`);
  lines.push(`_Revisa el Hub Admin → Anomalías para más info._`);
  return lines.join("\n");
}

function formatearReporteDia(payload: {
  fecha:         string;
  totalChoferes: number;
  completados:   number;
  pendientes:    string[];
  totalLotes:    number;
  totalUnidades: number;
  notas?:        string;
}): string {
  const pendList = payload.pendientes.length > 0
    ? payload.pendientes.map((n) => `  • ${n}`).join("\n")
    : "  ✅ Todos completaron";

  return [
    `📊 *Reporte del Día — Polar Breeze*`,
    `📅 ${payload.fecha}`,
    ``,
    `👥 *Choferes:* ${payload.completados}/${payload.totalChoferes} reportaron`,
    pendList,
    ``,
    `📦 *Lotes recibidos:* ${payload.totalLotes}`,
    `🔢 *Unidades procesadas:* ${payload.totalUnidades.toLocaleString("es-DO")}`,
    payload.notas ? `\n📝 ${payload.notas}` : "",
    ``,
    `_Polar Breeze Hub · ${new Date().toLocaleTimeString("es-DO", { timeZone: "America/Santo_Domingo" })}_`,
  ].filter((l) => l !== undefined).join("\n");
}

function formatearChoferSinReporte(payload: {
  nombre: string;
  ficha?: string;
  hora:   string;
}): string {
  return [
    `🚨 *Chofer sin reporte*`,
    ``,
    `Nombre: *${payload.nombre}*${payload.ficha ? ` · Ficha ${payload.ficha}` : ""}`,
    `Sin reportar hasta las: *${payload.hora}*`,
    ``,
    `_Por favor contactarlo directamente o registrar el reporte manualmente._`,
  ].join("\n");
}

// ─── Handler ─────────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as {
      tipo?:    "alerta" | "reporte_dia" | "chofer_sin_reporte";
      // genérico (legacy)
      message?: string;
      level?:   "info" | "warning" | "error";
      window?:  string;
      fn?:      string;
      // alerta
      tipo_alerta?: string;
      severidad?: "baja" | "media" | "alta" | "critica";
      mensaje?:   string;
      chofer?:    string;
      ficha?:     string;
      detalle?:   string;
      // reporte_dia
      fecha?:         string;
      totalChoferes?: number;
      completados?:   number;
      pendientes?:    string[];
      totalLotes?:    number;
      totalUnidades?: number;
      notas?:         string;
      // chofer_sin_reporte
      nombre?: string;
      hora?:   string;
    };

    const token   = process.env.TELEGRAM_BOT_TOKEN;
    const chatIds = getChatIds();

    if (!token || chatIds.length === 0) {
      return NextResponse.json({ ok: false, error: "Telegram no configurado" }, { status: 200 });
    }

    let texto: string;

    switch (body.tipo) {
      case "alerta":
        texto = formatearAlerta({
          tipo:      body.tipo_alerta ?? "Anomalía detectada",
          severidad: body.severidad,
          mensaje:   body.mensaje ?? "",
          chofer:    body.chofer,
          ficha:     body.ficha,
          detalle:   body.detalle,
        });
        break;

      case "reporte_dia":
        texto = formatearReporteDia({
          fecha:         body.fecha         ?? new Date().toLocaleDateString("es-DO"),
          totalChoferes: body.totalChoferes ?? 0,
          completados:   body.completados   ?? 0,
          pendientes:    body.pendientes    ?? [],
          totalLotes:    body.totalLotes    ?? 0,
          totalUnidades: body.totalUnidades ?? 0,
          notas:         body.notas,
        });
        break;

      case "chofer_sin_reporte":
        texto = formatearChoferSinReporte({
          nombre: body.nombre ?? "Chofer desconocido",
          ficha:  body.ficha,
          hora:   body.hora   ?? "hora desconocida",
        });
        break;

      default:
        // Formato genérico legacy
        texto = formatearGenerico({
          message: body.message ?? "",
          level:   body.level,
          window:  body.window,
          fn:      body.fn,
        });
    }

    const results = await Promise.allSettled(
      chatIds.map((chatId) => enviarMensaje(chatId, texto, token))
    );

    const sent = results.filter((r) => r.status === "fulfilled").length;
    return NextResponse.json({ ok: true, sent, total: chatIds.length });
  } catch (err) {
    return NextResponse.json({ ok: false, error: String(err) }, { status: 500 });
  }
}
