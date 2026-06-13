/**
 * /api/diag-stock — Diagnóstico de SOLO LECTURA del Stock del Loker
 *
 * Verifica directamente contra Firestore (producción) por qué el Hub Admin
 * recibe 0 movimientos:
 *   1. ¿Existen documentos en movimientos_loker? (cuenta vía service account)
 *   2. ¿Qué role tiene el admin en usuarios/{uid}? (campo exacto)
 *   3. ¿Las reglas DESPLEGADAS permiten al admin leer movimientos_loker?
 *      → se prueba con el ID token real de admin@polarbreeze.com (respeta reglas).
 *
 * Seguridad: requiere header  x-setup-token: <SETUP_SECRET>
 * No escribe nada. Eliminar tras diagnosticar.
 *
 * Uso:
 *   curl https://polar-breeze-hub.vercel.app/api/diag-stock \
 *     -H "x-setup-token: <SETUP_SECRET>"
 */

import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

const FS_URL   = "https://firestore.googleapis.com/v1/projects/polar-breeze/databases/(default)/documents";
const AUTH_URL = "https://identitytoolkit.googleapis.com/v1/accounts";
const API_KEY  = process.env.NEXT_PUBLIC_FIREBASE_API_KEY!;

function b64url(buf: ArrayBuffer): string {
  return Buffer.from(buf).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function b64urlStr(s: string): string {
  return Buffer.from(s).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function importPrivateKey(pem: string): Promise<CryptoKey> {
  const b64 = pem
    .replace(/\\n/g, "\n")
    .replace(/-----BEGIN PRIVATE KEY-----/g, "")
    .replace(/-----END PRIVATE KEY-----/g, "")
    .replace(/\s+/g, "");
  const der = Buffer.from(b64, "base64");
  return crypto.subtle.importKey("pkcs8", der, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]);
}

async function getServiceAccountToken(): Promise<string | null> {
  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const pem   = process.env.GOOGLE_PRIVATE_KEY;
  if (!email || !pem) return null;
  const now     = Math.floor(Date.now() / 1000);
  const header  = b64urlStr(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const payload = b64urlStr(JSON.stringify({
    iss: email, scope: "https://www.googleapis.com/auth/datastore",
    aud: "https://oauth2.googleapis.com/token", iat: now, exp: now + 3600,
  }));
  const key    = await importPrivateKey(pem);
  const sigBuf = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, Buffer.from(`${header}.${payload}`));
  const jwt    = `${header}.${payload}.${b64url(sigBuf)}`;
  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: jwt }),
  });
  const d = await r.json() as { access_token?: string };
  return d.access_token ?? null;
}

async function getAdminIdToken(): Promise<{ idToken: string | null; uid: string | null; error?: string }> {
  const r = await fetch(`${AUTH_URL}:signInWithPassword?key=${API_KEY}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: "admin@polarbreeze.com", password: process.env.ADMIN_PASSWORD ?? "", returnSecureToken: true }),
  });
  const d = await r.json() as { idToken?: string; localId?: string; error?: { message?: string } };
  return { idToken: d.idToken ?? null, uid: d.localId ?? null, error: d.error?.message };
}

/** Cuenta documentos de una colección vía service account (bypassa reglas). */
async function countCollection(token: string, collection: string): Promise<number | string> {
  const r = await fetch(`${FS_URL}:runAggregationQuery`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      structuredAggregationQuery: {
        structuredQuery: { from: [{ collectionId: collection }] },
        aggregations: [{ alias: "c", count: {} }],
      },
    }),
  });
  if (!r.ok) return `error ${r.status}: ${(await r.text()).slice(0, 200)}`;
  const rows = await r.json() as Array<{ result?: { aggregateFields?: { c?: { integerValue?: string } } } }>;
  return Number(rows[0]?.result?.aggregateFields?.c?.integerValue ?? 0);
}

/** Lee el role del usuario admin (service account, bypassa reglas). */
async function getRole(token: string, uid: string): Promise<string | { error: string }> {
  const r = await fetch(`${FS_URL}/usuarios/${uid}`, { headers: { Authorization: `Bearer ${token}` } });
  if (!r.ok) return { error: `${r.status}: ${(await r.text()).slice(0, 200)}` };
  const d = await r.json() as { fields?: { role?: { stringValue?: string } } };
  return d.fields?.role?.stringValue ?? "(sin campo role)";
}

/** Prueba RESPETANDO reglas: ¿el admin puede leer movimientos_loker? */
async function adminCanRead(idToken: string): Promise<{ ok: boolean; status: number; detail?: string }> {
  const r = await fetch(`${FS_URL}:runQuery`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${idToken}` },
    body: JSON.stringify({ structuredQuery: { from: [{ collectionId: "movimientos_loker" }], limit: 1 } }),
  });
  if (r.ok) return { ok: true, status: 200 };
  return { ok: false, status: r.status, detail: (await r.text()).slice(0, 300) };
}

export async function GET(req: NextRequest) {
  if (req.headers.get("x-setup-token") !== process.env.SETUP_SECRET) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }

  const saToken = await getServiceAccountToken();
  if (!saToken) {
    return NextResponse.json({ error: "Sin token de service account (faltan GOOGLE_SERVICE_ACCOUNT_EMAIL / GOOGLE_PRIVATE_KEY)" }, { status: 500 });
  }

  const movimientosCount = await countCollection(saToken, "movimientos_loker");

  const admin = await getAdminIdToken();
  const adminRole = admin.uid ? await getRole(saToken, admin.uid) : "(no se pudo iniciar sesión admin)";
  const lecturaAdmin = admin.idToken
    ? await adminCanRead(admin.idToken)
    : { ok: false, status: 0, detail: admin.error ?? "sin ADMIN_PASSWORD / login admin falló" };

  return NextResponse.json({
    movimientos_loker: {
      documentos: movimientosCount,
      interpretacion: typeof movimientosCount === "number"
        ? (movimientosCount > 0 ? "Hay datos en la colección." : "La colección está VACÍA — no es un problema de permisos.")
        : "No se pudo contar (ver error).",
    },
    admin_account: {
      email: "admin@polarbreeze.com",
      uid: admin.uid ?? null,
      role_en_firestore: adminRole,
      role_es_admin: adminRole === "admin",
    },
    permiso_lectura_movimientos_loker: {
      reglas_permiten_al_admin: lecturaAdmin.ok,
      http_status: lecturaAdmin.status,
      detalle: lecturaAdmin.ok ? "Las reglas DESPLEGADAS permiten al admin leer movimientos_loker." : lecturaAdmin.detail,
    },
    diagnostico: typeof movimientosCount === "number" && movimientosCount === 0
      ? "La colección está vacía → registra/verifica movimientos."
      : lecturaAdmin.ok
        ? "Reglas OK y hay datos → si el Hub sigue en 0, falta el rebuild de Vercel con el código nuevo."
        : adminRole !== "admin"
          ? "El role del admin NO es 'admin' → corrígelo con /api/admin-setup."
          : "Reglas desplegadas NO permiten al admin leer movimientos_loker → re-despliega firestore.rules (versión con esAdmin()).",
  });
}
