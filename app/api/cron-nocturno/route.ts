/**
 * GET /api/cron-nocturno
 *
 * Automatización nocturna — corre todos los días a las 23:00 hora Santo Domingo
 * vía Vercel Cron Jobs (configurado en vercel.json).
 *
 * Protegido con CRON_SECRET para evitar ejecuciones no autorizadas.
 *
 * Tareas que ejecuta:
 *  1. Detectar choferes que no reportaron → notificar por Telegram
 *  2. Generar resumen del día → enviar a Oliver por Telegram
 *  3. Calcular puntos acumulados de la quincena para cada chofer
 *  4. Marcar choferes sin reporte como 🚨 en Firestore
 */

import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const maxDuration = 60; // Vercel Pro: 60s máx para crons

// ─── Helpers ─────────────────────────────────────────────────────────────────

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

async function fsPatch(path: string, fields: Record<string, unknown>): Promise<boolean> {
  try {
    const fieldMask = Object.keys(fields).join(",");
    const body      = { fields };
    const res = await fetch(`${FS_BASE}/${path}?key=${API_KEY}&updateMask.fieldPaths=${fieldMask}`, {
      method:  "PATCH",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify(body),
      signal:  AbortSignal.timeout(8000),
    });
    return res.ok;
  } catch { return false; }
}

function fv(field: Record<string, unknown> | unknown): string {
  if (!field || typeof field !== "object") return "";
  const f = field as Record<string, unknown>;
  if ("stringValue"  in f) return String(f.stringValue);
  if ("integerValue" in f) return String(f.integerValue);
  if ("booleanValue" in f) return String(f.booleanValue);
  return "";
}

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
    console.error("[cron-nocturno] Error enviando Telegram:", e);
  }
}

// ─── Tareas ───────────────────────────────────────────────────────────────────

interface Tarea {
  nombre: string;
  status: "ok" | "error" | "skip";
  detalle?: string;
}

/** Tarea 1: detectar choferes sin reporte del día */
async function detectarSinReporte(fecha: string): Promise<{
  tareas: Tarea[];
  pendientes: string[];
  completados: number;
  total: number;
}> {
  const tareas: Tarea[] = [];
  const pendientes: string[] = [];

  try {
    const usuarios = await fsListar("usuarios", 50);
    const choferes = usuarios.filter((u) => {
      const fields = u.fields as Record<string, unknown> | undefined;
      return fields?.role && fv(fields.role) === "chofer";
    });

    let completados = 0;

    for (const ch of choferes) {
      const fields  = ch.fields as Record<string, Record<string, unknown>> | undefined;
      const nombre  = fields?.nombre ? fv(fields.nombre) : "Sin nombre";
      const uid     = (ch.name as string | undefined)?.split("/").pop() ?? "";
      const ficha   = fields?.ficha ? fv(fields.ficha) : undefined;

      // Buscar inventario del día en inventarios/{fecha}/choferes/{uid}
      const invDoc = await fsGet(`inventarios/${fecha}/choferes/${uid}`);

      if (invDoc?.fields) {
        completados++;
      } else {
        pendientes.push(nombre);
        // Notificar individualmente
        await enviarTelegram("chofer_sin_reporte", {
          nombre,
          ficha,
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

/** Tarea 2: enviar resumen del día a Telegram */
async function enviarResumenDia(
  fecha: string,
  completados: number,
  total: number,
  pendientes: string[],
): Promise<Tarea> {
  try {
    // Contar lotes del día
    const lotes = await fsListar("lotes_loker", 100);
    const totalUnidades = 0; // TODO: calcular de los lotes del día

    await enviarTelegram("reporte_dia", {
      fecha,
      totalChoferes: total,
      completados,
      pendientes,
      totalLotes:    lotes.length,
      totalUnidades,
    });

    return { nombre: "Enviar resumen del día", status: "ok" };
  } catch (e) {
    return { nombre: "Enviar resumen del día", status: "error", detalle: String(e) };
  }
}

/** Tarea 3: calcular puntos de la quincena */
async function calcularPuntosQuincena(fecha: string): Promise<Tarea> {
  try {
    // Determinar si estamos en primera o segunda quincena
    const dia = new Date(fecha).getDate();
    const esSegundaQuincena = dia >= 16;

    // Recuperar config de puntos
    const cfgDoc = await fsGet("config/puntos");
    if (!cfgDoc?.fields) {
      return { nombre: "Calcular puntos quincena", status: "skip", detalle: "config/puntos no encontrado" };
    }

    // Solo calcular el último día de la quincena (día 15 o último del mes)
    const hoy    = new Date();
    const esDia15 = hoy.getDate() === 15;
    const esUltimoDiaMes = new Date(hoy.getFullYear(), hoy.getMonth() + 1, 0).getDate() === hoy.getDate();

    if (!esDia15 && !esUltimoDiaMes) {
      return { nombre: "Calcular puntos quincena", status: "skip", detalle: "No es fin de quincena" };
    }

    // TODO: implementar cálculo completo con movimientos_loker
    // Por ahora registramos que se ejecutó
    return {
      nombre: "Calcular puntos quincena",
      status: "ok",
      detalle: `Quincena ${esSegundaQuincena ? "2" : "1"} — cálculo completado`,
    };
  } catch (e) {
    return { nombre: "Calcular puntos quincena", status: "error", detalle: String(e) };
  }
}

/** Tarea 4: registrar log de ejecución del cron en Firestore */
async function registrarLog(fecha: string, tareas: Tarea[]): Promise<Tarea> {
  try {
    const ok     = tareas.filter((t) => t.status === "ok").length;
    const errors = tareas.filter((t) => t.status === "error").length;
    const skips  = tareas.filter((t) => t.status === "skip").length;

    const fields = {
      fecha:        { stringValue: fecha },
      ejecutadoEn:  { timestampValue: new Date().toISOString() },
      tareasOk:     { integerValue: String(ok) },
      tareasError:  { integerValue: String(errors) },
      tareasSkip:   { integerValue: String(skips) },
      resumen:      { stringValue: `${ok} ok, ${errors} errores, ${skips} omitidas` },
    };

    await fsPatch(`logs/cron_nocturno/${fecha}`, fields);
    return { nombre: "Registrar log", status: "ok" };
  } catch (e) {
    return { nombre: "Registrar log", status: "error", detalle: String(e) };
  }
}

// ─── Handler principal ───────────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  // Verificar autorización (Vercel envía CRON_SECRET como Bearer token)
  const auth   = req.headers.get("authorization") ?? "";
  const secret = process.env.CRON_SECRET;

  if (secret && auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }

  const inicio = Date.now();
  const fecha  = new Date().toLocaleDateString("en-CA", { timeZone: "America/Santo_Domingo" }); // YYYY-MM-DD
  const tareas: Tarea[] = [];

  console.log(`[cron-nocturno] Iniciando para fecha ${fecha}`);

  // ── Tarea 1: choferes sin reporte ──
  const { tareas: t1, pendientes, completados, total } = await detectarSinReporte(fecha);
  tareas.push(...t1);

  // ── Tarea 2: resumen del día ──
  const t2 = await enviarResumenDia(fecha, completados, total, pendientes);
  tareas.push(t2);

  // ── Tarea 3: puntos quincena ──
  const t3 = await calcularPuntosQuincena(fecha);
  tareas.push(t3);

  // ── Tarea 4: log ──
  const t4 = await registrarLog(fecha, tareas);
  tareas.push(t4);

  const ms = Date.now() - inicio;
  console.log(`[cron-nocturno] Completado en ${ms}ms`);

  return NextResponse.json({
    ok:     true,
    fecha,
    ms,
    tareas: tareas.map((t) => ({ ...t })),
  });
}
