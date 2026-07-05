/**
 * /api/admin-reset-user-password — Permite al Admin cambiar la contraseña de
 * OTRA cuenta (Encargado o Chofer) sin conocer su contraseña actual.
 *
 * A diferencia de "Cambiar contraseña Admin/Despachador" (que reautentica con
 * la clave actual del propio usuario), Encargado y Chofer son cuentas
 * individuales — el Admin nunca tiene esa clave. Por eso esto se resuelve
 * server-side con el service account (mismo patrón JWT+REST que
 * /api/verify-reset-password y /api/sync-sheets, sin firebase-admin):
 *   1. Se verifica el idToken de quien llama (Identity Toolkit lookup).
 *   2. Se confirma en Firestore que ese uid es realmente role=admin.
 *   3. Recién ahí se usa el token del service account para forzar la nueva
 *      contraseña del uid destino (accounts:update por localId, sin idToken
 *      del destino — igual que hace Firebase Admin SDK por dentro).
 */
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

// ─── Rate limiter (in-memory, best-effort en serverless) — mismo patrón que los demás endpoints ───
const _attempts = new Map<string, { count: number; resetAt: number }>();
const RATE_LIMIT  = 5;
const RATE_WINDOW = 60_000;

function checkRate(ip: string): boolean {
  const now = Date.now();
  const e   = _attempts.get(ip);
  if (!e || now > e.resetAt) { _attempts.set(ip, { count: 1, resetAt: now + RATE_WINDOW }); return true; }
  if (e.count >= RATE_LIMIT) return false;
  e.count++;
  return true;
}

const FS_URL   = "https://firestore.googleapis.com/v1/projects/polar-breeze/databases/(default)/documents";
const AUTH_URL = "https://identitytoolkit.googleapis.com/v1/accounts";
const API_KEY  = process.env.NEXT_PUBLIC_FIREBASE_API_KEY!;

// ─── JWT RS256 via Web Crypto (mismo patrón que admin-setup/sync-sheets/verify-reset-password) ─────
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
  return crypto.subtle.importKey(
    "pkcs8", der,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false, ["sign"],
  );
}

/** Token del service account con scopes de Firestore + Identity Toolkit (admin de usuarios). */
async function getServiceAccountToken(): Promise<string | null> {
  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const pem   = process.env.GOOGLE_PRIVATE_KEY;
  if (!email || !pem) return null;

  const now     = Math.floor(Date.now() / 1000);
  const header  = b64urlStr(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const payload = b64urlStr(JSON.stringify({
    iss: email,
    scope: "https://www.googleapis.com/auth/datastore https://www.googleapis.com/auth/identitytoolkit",
    aud: "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600,
  }));
  const key    = await importPrivateKey(pem);
  const sigBuf = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, Buffer.from(`${header}.${payload}`));
  const jwt    = `${header}.${payload}.${b64url(sigBuf)}`;

  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: jwt }),
  });
  const d = await r.json() as { access_token?: string; error?: string };
  return d.access_token ?? null;
}

/** Resuelve el uid del idToken de quien llama (sin admin, endpoint público de Identity Toolkit). */
async function lookupUidFromIdToken(idToken: string): Promise<string | null> {
  const r = await fetch(`${AUTH_URL}:lookup?key=${API_KEY}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ idToken }),
  });
  if (!r.ok) return null;
  const d = await r.json() as { users?: { localId?: string }[] };
  return d.users?.[0]?.localId ?? null;
}

/** Confirma en Firestore (service account, bypassa reglas) que el uid es role=admin. */
async function esAdminReal(uid: string, saToken: string): Promise<boolean> {
  const r = await fetch(`${FS_URL}/usuarios/${uid}`, { headers: { Authorization: `Bearer ${saToken}` } });
  if (!r.ok) return false;
  const d = await r.json() as { fields?: { role?: { stringValue?: string } } };
  return d.fields?.role?.stringValue === "admin";
}

export async function POST(req: NextRequest) {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  if (!checkRate(ip)) {
    return NextResponse.json({ error: "Demasiados intentos. Intenta más tarde." }, { status: 429 });
  }

  const body = await req.json().catch(() => null) as
    { idToken?: string; targetUid?: string; newPassword?: string } | null;
  const { idToken, targetUid, newPassword } = body ?? {};

  if (!idToken || !targetUid || !newPassword || newPassword.length < 6) {
    return NextResponse.json({ error: "Faltan datos o la contraseña es muy corta (mín. 6)." }, { status: 400 });
  }

  const callerUid = await lookupUidFromIdToken(idToken);
  if (!callerUid) {
    return NextResponse.json({ error: "Sesión inválida." }, { status: 401 });
  }

  const saToken = await getServiceAccountToken();
  if (!saToken) {
    return NextResponse.json({ error: "Config del servidor incompleta." }, { status: 500 });
  }

  const esAdmin = await esAdminReal(callerUid, saToken);
  if (!esAdmin) {
    return NextResponse.json({ error: "Solo el Admin puede hacer esto." }, { status: 403 });
  }

  const upd = await fetch(`${AUTH_URL}:update`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${saToken}` },
    body: JSON.stringify({ localId: targetUid, password: newPassword }),
  });
  const updData = await upd.json().catch(() => ({})) as { error?: { message?: string } };
  if (!upd.ok) {
    return NextResponse.json({ error: updData.error?.message ?? "No se pudo actualizar la contraseña." }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
