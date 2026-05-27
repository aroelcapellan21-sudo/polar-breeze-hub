/**
 * GET /api/cron-nocturno
 *
 * Automatización nocturna — corre todos los días a las 23:00 hora Santo Domingo
 * vía Vercel Cron Jobs (vercel.json → schedule: "0 3 * * *", UTC 03:00 = RD 23:00).
 *
 * Tareas:
 *  1. Detectar choferes sin reporte → notificar por Telegram
 *  2. Generar resumen del día → enviar a Oliver por Telegram
 *  3. Calcular puntos acumulados de la quincena para cada chofer
 *  4. Registrar log de ejecución en Firestore
 */

import { NextRequest, NextResponse } from "next/server";

export const dynamic    = "force-dynamic";
export const maxDuration = 60;

// ─── Firestore REST helpers ───────────────────────────────────────────────────

const PROJECT = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID ?? "";
const API_KEY = process.env.NEXT_PUBLIC_FIREBASE_API_KEY    ?? "";
const FS_BASE = `https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)/documents`;

async function fsGet(path: string): Promise<Record<string, unknown> | null> {
  try {
    const res = await fetch(`${FS_BASE}/${path}?key=${API_KEY}`, {
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return null;
    return res.json() as Promise<Record<string, unknown>>;
  } catch { return null; }
}

async function fsListar(coleccion: string, pageSize = 50): Promise<Record<string, unknown>[]> {
  try {
    const res = await fetch(`${FS_BASE}/${coleccion}?key=${API_KEY}&pageSize=${pageSize}`, {
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) return [];
    const data = await res.json() as { documents?: Record<string, unknown>[] };
    return data.documents ?? [];
  } catch { return []; }
}

/** Firestore structured query (POST :runQuery) */
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

async function fsPatch(path: string, fields: Record<string, unknown>): Promise<boolean> {
  try {
    const fieldMask = Object.keys(fields).join(",");
    const res = await fetch(
      `${FS_BASE}/${path}?key=${API_KEY}&updateMask.fieldPaths=${encodeURIComponent(fieldMask)}`,
      {
        method:  "PATCH",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ fields }),
        signal:  AbortSignal.timeout(8000),
      }
    );
    return res.ok;
  } catch { return false; }
}

/** Extrae el valor de un campo Firestore */
function fv(field: unknown): string {
  if (!field || typeof field !== "object") return "";
  const f = field as Record<string, unknown>;
  if ("stringValue"   in f) return String(f.stringValue);
  if ("integerValue"  in f) return String(f.integerValue);
  if ("doubleValue"   in f) return String(f.doubleValue);
  if ("booleanValue"  in f) return String(f.booleanValue);
  if ("timestampValue" in f) return String(f.timestampValue);
  return "";
}

function fvNum(field: unknown): number {
  const s = fv(field);
  return isNaN(Number(s)) ? 0 : Number(s);
}

// ─── Telegram helper ──────────────────────────────────────────────────────────

async function enviarTelegram(tipo: string, datos: Record<string, unknown>): Promise<void> {
  try {
    const host = process.env.VERCEL_URL
      ? `https://${process.env.VERCEL_URL}`
      : "https://polar-breeze-hub.vercel.app";
    await fetch(`${host}/api/telegram`, {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ tipo, ...datos }),
      signal:  AbortSignal.timeout(10000),
    });
  } catch (e) {
    console.error("[cron-nocturno] Telegram error:", e);
  }
}

// ─── Tipos ────────────────────────────────────────────────────────────────────

interface Tarea {
  nombre: string;
  status: "ok" | "error" | "skip";
  detalle?: string;
}

// ─── Tarea 1: choferes sin reporte ───────────────────────────────────────────

async function detectarSinReporte(fecha: string): Promise<{
  tareas: Tarea[];
  pendientes: string[];
  completados: number;
  total: number;
}> {
  const tareas: Tarea[] = [];
  const pendientes: string[] = [];

  try {
    const usuarios  = await fsListar("usuarios", 50);
    const choferes  = usuarios.filter((u) => {
      const f = u.fields as Record<string, unknown> | undefined;
      return f?.role && fv(f.role) === "chofer";
    });

    let completados = 0;
    for (const ch of choferes) {
      const f      = ch.fields as Record<string, Record<string, unknown>> | undefined;
      const nombre = f?.nombre ? fv(f.nombre) : "Sin nombre";
      const uid    = (ch.name as string | undefined)?.split("/").pop() ?? "";
      const ficha  = f?.ficha ? fv(f.ficha) : undefined;
      const activo = f?.activo ? fv(f.activo) : "true";
      if (activo === "false") continue;

      const invDoc = await fsGet(`inventarios/${fecha}/choferes/${uid}`);
      if (invDoc?.fields) {
        completados++;
      } else {
        pendientes.push(nombre);
        await enviarTelegram("chofer_sin_reporte", {
          nombre, ficha,
          hora: new Date().toLocaleTimeString("es-DO", { timeZone: "America/Santo_Domingo" }),
        });
      }
    }

    tareas.push({
      nombre: "Detectar choferes sin reporte",
      status: "ok",
      detalle: `${completados}/${choferes.length} reportaron`,
    });
    return { tareas, pendientes, completados, total: choferes.length };
  } catch (e) {
    tareas.push({ nombre: "Detectar choferes sin reporte", status: "error", detalle: String(e) });
    return { tareas, pendientes, completados: 0, total: 0 };
  }
}

// ─── Tarea 2: resumen del día ────────────────────────────────────────────────

async function enviarResumenDia(
  fecha: string,
  completados: number,
  total: number,
  pendientes: string[],
): Promise<Tarea> {
  try {
    // Lotes del día
    const lotes = await fsListar("lotes_loker", 100);

    // Unidades del día: query estructurada sobre imbentario donde timestamp >= inicio del día
    const inicioDia = new Date(`${fecha}T00:00:00-04:00`).toISOString();
    const docs = await fsRunQuery({
      structuredQuery: {
        from:  [{ collectionId: "imbentario" }],
        where: {
          fieldFilter: {
            field: { fieldPath: "timestamp" },
            op:    "GREATER_THAN_OR_EQUAL",
            value: { timestampValue: inicioDia },
          },
        },
        limit: 200,
      },
    });

    let totalUnidades = 0;
    let totalMonto    = 0;
    for (const doc of docs) {
      const f = doc.fields as Record<string, unknown> | undefined;
      totalUnidades += fvNum(f?.cantidadEntregada);
      totalMonto    += fvNum(f?.monto);
    }

    await enviarTelegram("reporte_dia", {
      fecha,
      totalChoferes: total,
      completados,
      pendientes,
      totalLotes:    lotes.length,
      totalUnidades,
      notas:         totalMonto > 0
        ? `RD$${totalMonto.toLocaleString("es-DO", { maximumFractionDigits: 0 })} facturados`
        : undefined,
    });

    return {
      nombre: "Enviar resumen del día",
      status: "ok",
      detalle: `${totalUnidades} uds · RD$${totalMonto.toLocaleString("es-DO", { maximumFractionDigits: 0 })}`,
    };
  } catch (e) {
    return { nombre: "Enviar resumen del día", status: "error", detalle: String(e) };
  }
}

// ─── Tarea 3: calcular puntos de la quincena ──────────────────────────────────

async function calcularPuntosQuincena(fecha: string): Promise<Tarea> {
  try {
    const hoy = new Date(fecha + "T12:00:00-04:00");
    const dia = hoy.getDate();

    // Solo ejecutar el día 15 y el último día del mes
    const ultimoDiaMes = new Date(hoy.getFullYear(), hoy.getMonth() + 1, 0).getDate();
    const esDia15      = dia === 15;
    const esUltimoDia  = dia === ultimoDiaMes;

    if (!esDia15 && !esUltimoDia) {
      return { nombre: "Calcular puntos quincena", status: "skip", detalle: "No es fin de quincena" };
    }

    // Rango de la quincena
    const esSegunda = dia >= 16;
    const inicioQ   = esSegunda
      ? new Date(hoy.getFullYear(), hoy.getMonth(), 16, 0, 0, 0)
      : new Date(hoy.getFullYear(), hoy.getMonth(), 1,  0, 0, 0);

    const inicioTs = inicioQ.toISOString();
    const finTs    = hoy.toISOString();

    // Config de puntos
    const cfgDoc = await fsGet("config/puntos");
    const productos = (cfgDoc?.fields as Record<string, unknown> | undefined)?.productos;

    interface PtoProd { nombre: string; puntos: number }
    const puntosMap: Record<string, number> = {};
    if (productos && typeof productos === "object" && "arrayValue" in (productos as object)) {
      const arr = ((productos as Record<string, unknown>).arrayValue as Record<string, unknown>)?.values;
      if (Array.isArray(arr)) {
        (arr as Record<string, unknown>[]).forEach((item) => {
          const mv = (item as Record<string, unknown>).mapValue as Record<string, unknown> | undefined;
          const ff = mv?.fields as Record<string, Record<string, unknown>> | undefined;
          if (ff?.nombre && ff?.puntos) {
            const p: PtoProd = { nombre: fv(ff.nombre).toLowerCase().trim(), puntos: fvNum(ff.puntos) };
            puntosMap[p.nombre] = p.puntos;
          }
        });
      }
    }

    // Registros de imbentario en el período
    const docs = await fsRunQuery({
      structuredQuery: {
        from:  [{ collectionId: "imbentario" }],
        where: {
          compositeFilter: {
            op: "AND",
            filters: [
              { fieldFilter: { field: { fieldPath: "timestamp" }, op: "GREATER_THAN_OR_EQUAL", value: { timestampValue: inicioTs } } },
              { fieldFilter: { field: { fieldPath: "timestamp" }, op: "LESS_THAN_OR_EQUAL",    value: { timestampValue: finTs    } } },
            ],
          },
        },
        limit: 1000,
      },
    });

    // Agregar por chofer
    const porChofer: Record<string, { nombre: string; pts: number; uds: number }> = {};
    for (const doc of docs) {
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

    // Guardar resultado en Firestore: puntos_quincena/{year-mes-Q}
    const qKey = `${hoy.getFullYear()}-${String(hoy.getMonth() + 1).padStart(2, "0")}-Q${esSegunda ? 2 : 1}`;
    const resumen = Object.entries(porChofer)
      .map(([uid, d]) => `${d.nombre}: ${d.pts} pts (${d.uds} uds)`)
      .join(", ");

    await fsPatch(`puntos_quincena/${qKey}`, {
      calculado_en: { timestampValue: new Date().toISOString() },
      quincena:     { stringValue: qKey },
      choferes:     { stringValue: JSON.stringify(porChofer) },
      resumen:      { stringValue: resumen.slice(0, 1000) },
    });

    return {
      nombre: "Calcular puntos quincena",
      status: "ok",
      detalle: `Q${esSegunda ? 2 : 1} — ${Object.keys(porChofer).length} choferes procesados`,
    };
  } catch (e) {
    return { nombre: "Calcular puntos quincena", status: "error", detalle: String(e) };
  }
}

// ─── Tarea 4: registrar log ──────────────────────────────────────────────────

async function registrarLog(fecha: string, tareas: Tarea[]): Promise<Tarea> {
  try {
    const ok     = tareas.filter((t) => t.status === "ok").length;
    const errors = tareas.filter((t) => t.status === "error").length;
    const skips  = tareas.filter((t) => t.status === "skip").length;

    // path: cron_logs/{fecha}  — 2 segmentos = colección/documento ✓
    await fsPatch(`cron_logs/${fecha}`, {
      fecha:       { stringValue: fecha },
      ejecutadoEn: { timestampValue: new Date().toISOString() },
      tareasOk:    { integerValue: String(ok) },
      tareasError: { integerValue: String(errors) },
      tareasSkip:  { integerValue: String(skips) },
      resumen:     { stringValue: `${ok} ok · ${errors} errores · ${skips} omitidas` },
    });
    return { nombre: "Registrar log", status: "ok" };
  } catch (e) {
    return { nombre: "Registrar log", status: "error", detalle: String(e) };
  }
}

// ─── Tarea 4: sincronizar Google Sheets ──────────────────────────────────────

async function sincronizarSheets(): Promise<Tarea> {
  if (!process.env.GOOGLE_SHEETS_ID) {
    return { nombre: "Sincronizar Google Sheets", status: "skip", detalle: "GOOGLE_SHEETS_ID no configurado" };
  }
  try {
    const host = process.env.VERCEL_URL
      ? `https://${process.env.VERCEL_URL}`
      : "https://polar-breeze-hub.vercel.app";
    const res  = await fetch(`${host}/api/sync-sheets`, {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      signal:  AbortSignal.timeout(40000),
    });
    const data = await res.json() as {
      ok: boolean; error?: string;
      resumen?: { codigos: number; lotes: number; movimientos: number };
      ms?: number;
    };
    if (!data.ok) {
      return { nombre: "Sincronizar Google Sheets", status: "error", detalle: data.error ?? "error desconocido" };
    }
    const r = data.resumen;
    return {
      nombre:  "Sincronizar Google Sheets",
      status:  "ok",
      detalle: r ? `${r.codigos} códigos · ${r.lotes} lotes · ${r.movimientos} movs — ${data.ms ?? 0}ms` : "ok",
    };
  } catch (e) {
    return { nombre: "Sincronizar Google Sheets", status: "error", detalle: String(e) };
  }
}

// ─── Handler principal ───────────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  const auth   = req.headers.get("authorization") ?? "";
  const secret = process.env.CRON_SECRET;
  if (secret && auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }

  const inicio = Date.now();
  const fecha  = new Date().toLocaleDateString("en-CA", { timeZone: "America/Santo_Domingo" });
  const tareas: Tarea[] = [];

  console.log(`[cron-nocturno] Iniciando para fecha ${fecha}`);

  const { tareas: t1, pendientes, completados, total } = await detectarSinReporte(fecha);
  tareas.push(...t1);

  const t2 = await enviarResumenDia(fecha, completados, total, pendientes);
  tareas.push(t2);

  const t3 = await calcularPuntosQuincena(fecha);
  tareas.push(t3);

  // Tarea 4: Sincronizar Google Sheets (si está configurado)
  const t4 = await sincronizarSheets();
  tareas.push(t4);

  const t5 = await registrarLog(fecha, tareas);
  tareas.push(t5);

  const ms = Date.now() - inicio;
  console.log(`[cron-nocturno] Completado en ${ms}ms`);

  return NextResponse.json({ ok: true, fecha, ms, tareas });
}
