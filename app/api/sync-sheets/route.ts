/**
 * POST /api/sync-sheets
 *
 * Sincroniza tres colecciones de Firestore → Google Sheets:
 *   · Tab "Códigos"      — codigos_cajas    (catálogo de productos)
 *   · Tab "Lotes Weight" — lotes_weight     (recepciones de mercancía)
 *   · Tab "Movimientos"  — movimientos_loker (entradas/salidas del loker)
 *
 * Autenticación: JWT RS256 con Google Cloud service account.
 *
 * Variables de entorno requeridas en Vercel:
 *   GOOGLE_SHEETS_ID               — ID del spreadsheet
 *   GOOGLE_SERVICE_ACCOUNT_EMAIL   — email del service account
 *   GOOGLE_PRIVATE_KEY             — clave privada PEM (con \n reales o literales)
 *
 * Si alguna falta devuelve 404 y un JSON con las claves faltantes.
 */

import { NextResponse } from "next/server";

export const dynamic     = "force-dynamic";
export const maxDuration = 45;

// ─── Firestore REST ────────────────────────────────────────────────────────────

const PROJECT = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID ?? "";
const API_KEY = process.env.NEXT_PUBLIC_FIREBASE_API_KEY    ?? "";
const FS_BASE = `https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)/documents`;

async function fsListar(col: string, ps = 500): Promise<Record<string, unknown>[]> {
  const res = await fetch(`${FS_BASE}/${col}?key=${API_KEY}&pageSize=${ps}`, {
    signal: AbortSignal.timeout(12000),
  });
  if (!res.ok) return [];
  const data = await res.json() as { documents?: Record<string, unknown>[] };
  return data.documents ?? [];
}

async function fsRunQuery(body: Record<string, unknown>): Promise<Record<string, unknown>[]> {
  const res = await fetch(`${FS_BASE}:runQuery?key=${API_KEY}`, {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    body:    JSON.stringify(body),
    signal:  AbortSignal.timeout(15000),
  });
  if (!res.ok) return [];
  const rows = await res.json() as { document?: Record<string, unknown> }[];
  return rows.filter((r) => r.document).map((r) => r.document!);
}

function fv(f: unknown): string {
  if (!f || typeof f !== "object") return "";
  const o = f as Record<string, unknown>;
  if ("stringValue"    in o) return String(o.stringValue);
  if ("integerValue"   in o) return String(o.integerValue);
  if ("doubleValue"    in o) return String(o.doubleValue);
  if ("booleanValue"   in o) return String(o.booleanValue);
  if ("timestampValue" in o) {
    return new Date(String(o.timestampValue))
      .toLocaleString("es-DO", { timeZone: "America/Santo_Domingo" });
  }
  return "";
}

// ─── Google JWT RS256 (sin dependencias externas) ─────────────────────────────

function b64url(buf: ArrayBuffer): string {
  return Buffer.from(buf).toString("base64")
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function b64urlStr(s: string): string {
  return Buffer.from(s).toString("base64")
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function importPrivateKey(pem: string): Promise<CryptoKey> {
  // Vercel serializa las nuevas líneas como literal \\n — normalizar ambos
  const b64 = pem
    .replace(/\\n/g, "\n")
    .replace(/-----BEGIN PRIVATE KEY-----/g, "")
    .replace(/-----END PRIVATE KEY-----/g, "")
    .replace(/\s+/g, "");
  const der = Buffer.from(b64, "base64");
  return crypto.subtle.importKey(
    "pkcs8",
    der,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );
}

async function getAccessToken(email: string, pem: string): Promise<string> {
  const now     = Math.floor(Date.now() / 1000);
  const header  = b64urlStr(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const payload = b64urlStr(JSON.stringify({
    iss:   email,
    scope: "https://www.googleapis.com/auth/spreadsheets",
    aud:   "https://oauth2.googleapis.com/token",
    iat:   now,
    exp:   now + 3600,
  }));
  const key    = await importPrivateKey(pem);
  const sigBuf = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5", key,
    Buffer.from(`${header}.${payload}`),
  );
  const jwt = `${header}.${payload}.${b64url(sigBuf)}`;

  const res  = await fetch("https://oauth2.googleapis.com/token", {
    method:  "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body:    new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion:  jwt,
    }),
    signal: AbortSignal.timeout(10000),
  });
  const data = await res.json() as { access_token?: string; error?: string };
  if (!data.access_token) throw new Error(`Google auth: ${data.error ?? "no access_token"}`);
  return data.access_token;
}

// ─── Google Sheets API v4 ──────────────────────────────────────────────────────

async function sheetsWrite(
  token: string,
  sheetsId: string,
  updates: { range: string; values: (string | number)[][] }[],
): Promise<void> {
  // Limpiar tabs primero
  await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${sheetsId}/values:batchClear`, {
    method:  "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body:    JSON.stringify({ ranges: updates.map((u) => u.range.split("!")[0] + "!A:Z") }),
    signal:  AbortSignal.timeout(10000),
  });
  // Escribir datos
  const res = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${sheetsId}/values:batchUpdate`,
    {
      method:  "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body:    JSON.stringify({
        valueInputOption: "USER_ENTERED",
        data: updates.map((u) => ({
          range:          u.range,
          majorDimension: "ROWS",
          values:         u.values,
        })),
      }),
      signal: AbortSignal.timeout(15000),
    },
  );
  if (!res.ok) {
    const err = await res.text().catch(() => `HTTP ${res.status}`);
    throw new Error(`Sheets write error: ${err.slice(0, 200)}`);
  }
}

// ─── Construcción de filas ────────────────────────────────────────────────────

async function buildCodigos(): Promise<(string | number)[][]> {
  const docs = await fsListar("codigos_cajas", 500);
  const filas: (string | number)[][] = [[
    "Código", "Producto", "Uds/Caja", "Peso Ref. (kg)", "Creado Por", "Fecha Creación",
  ]];
  for (const d of docs) {
    const f = d.fields as Record<string, unknown> | undefined;
    filas.push([
      fv(f?.codigo)         || "",
      fv(f?.producto)       || "",
      fv(f?.unidadesPorCaja) || "1",
      fv(f?.pesoCajaKg)     || "",
      fv(f?.creadoPor)      || "",
      fv(f?.creadoEn)       || "",
    ]);
  }
  return filas;
}

async function buildLotesWeight(): Promise<(string | number)[][]> {
  const docs = await fsRunQuery({
    structuredQuery: {
      from:    [{ collectionId: "lotes_weight" }],
      orderBy: [{ field: { fieldPath: "timestamp" }, direction: "DESCENDING" }],
      limit:   100,
    },
  });
  const filas: (string | number)[][] = [[
    "Lote", "Fecha", "Proveedor", "Total Uds", "Total Peso (kg)", "Encargado", "Notas",
  ]];
  for (const d of docs) {
    const f = d.fields as Record<string, unknown> | undefined;
    filas.push([
      fv(f?.numero)          || "",
      fv(f?.timestamp)       || "",
      fv(f?.proveedor)       || "",
      fv(f?.totalUnidades)   || "0",
      fv(f?.totalPesoKg)     || "",
      fv(f?.encargadoNombre) || "",
      fv(f?.notas)           || "",
    ]);
  }
  return filas;
}

async function buildMovimientos(): Promise<(string | number)[][]> {
  const docs = await fsRunQuery({
    structuredQuery: {
      from:    [{ collectionId: "movimientos_loker" }],
      orderBy: [{ field: { fieldPath: "timestamp" }, direction: "DESCENDING" }],
      limit:   200,
    },
  });
  const filas: (string | number)[][] = [[
    "Tipo", "Producto", "Cantidad", "Fecha", "Responsable", "Notas", "Lote",
  ]];
  for (const d of docs) {
    const f = d.fields as Record<string, unknown> | undefined;
    filas.push([
      fv(f?.tipo)         || "",
      fv(f?.nombre)       || fv(f?.producto_id) || "",
      fv(f?.cantidad)     || "0",
      fv(f?.timestamp)    || "",
      fv(f?.responsable)  || "",
      fv(f?.notas)        || "",
      fv(f?.loteNumero)   || "",
    ]);
  }
  return filas;
}

// ─── Handler ───────────────────────────────────────────────────────────────────

export async function POST() {
  const sheetsId = process.env.GOOGLE_SHEETS_ID;
  const email    = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const pem      = process.env.GOOGLE_PRIVATE_KEY;

  if (!sheetsId || !email || !pem) {
    return NextResponse.json(
      {
        ok:      false,
        error:   "no_configurado",
        missing: [
          !sheetsId ? "GOOGLE_SHEETS_ID"             : null,
          !email    ? "GOOGLE_SERVICE_ACCOUNT_EMAIL"  : null,
          !pem      ? "GOOGLE_PRIVATE_KEY"            : null,
        ].filter(Boolean),
      },
      { status: 404 },
    );
  }

  const inicio = Date.now();
  try {
    const token = await getAccessToken(email, pem);

    const [codigos, lotes, movs] = await Promise.all([
      buildCodigos(),
      buildLotesWeight(),
      buildMovimientos(),
    ]);

    await sheetsWrite(token, sheetsId, [
      { range: "Códigos!A1",      values: codigos },
      { range: "Lotes Weight!A1", values: lotes   },
      { range: "Movimientos!A1",  values: movs    },
    ]);

    return NextResponse.json({
      ok:       true,
      syncedAt: new Date().toISOString(),
      ms:       Date.now() - inicio,
      resumen: {
        codigos:     codigos.length    - 1,
        lotes:       lotes.length      - 1,
        movimientos: movs.length       - 1,
      },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[sync-sheets]", msg);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
