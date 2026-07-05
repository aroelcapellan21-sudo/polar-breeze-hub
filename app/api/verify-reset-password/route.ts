/**
 * /api/verify-reset-password — Verifica la clave del botón "Reset día" del
 * Despachador SIN exponer la clave real al navegador.
 *
 * Fix de seguridad (S1, 2026-07-05): antes, el Despachador leía
 * config/main.resetPassword directo de Firestore y comparaba en el cliente.
 * Con la regla de Firestore de entonces (cualquier autenticado puede leer
 * config/*), CUALQUIER chofer logueado podía leer esa clave (y otros secretos
 * que vivían en el mismo doc) sin pasar por la UI. Ahora:
 *   - resetPassword vive en config/secrets (solo-admin en las reglas).
 *   - La comparación ocurre AQUÍ, server-side, con el service account
 *     (bypassa las reglas). El cliente solo recibe { ok: true|false }.
 *
 * Mismo patrón JWT + REST de Firestore que /api/admin-setup y /api/sync-sheets
 * (crypto.subtle, ya probado en prod) — no se introduce firebase-admin.
 */
import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";

export const runtime = "nodejs";

// ─── Rate limiter (in-memory, best-effort en serverless) — mismo patrón que admin-setup ───
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

const FS_URL = "https://firestore.googleapis.com/v1/projects/polar-breeze/databases/(default)/documents";

// ─── JWT RS256 via Web Crypto (mismo patrón que admin-setup/sync-sheets) ─────
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

async function getServiceAccountToken(): Promise<string | null> {
  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const pem   = process.env.GOOGLE_PRIVATE_KEY;
  if (!email || !pem) return null;

  const now     = Math.floor(Date.now() / 1000);
  const header  = b64urlStr(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const payload = b64urlStr(JSON.stringify({
    iss: email,
    scope: "https://www.googleapis.com/auth/datastore",
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

/** Lee config/secrets.resetPassword (service account, bypassa reglas). */
async function getStoredResetPassword(token: string): Promise<string | null> {
  const r = await fetch(`${FS_URL}/config/secrets`, { headers: { Authorization: `Bearer ${token}` } });
  if (!r.ok) return null;
  const d = await r.json() as { fields?: { resetPassword?: { stringValue?: string } } };
  return d.fields?.resetPassword?.stringValue ?? null;
}

/** Compara en tiempo constante para no filtrar la longitud/contenido por timing. */
function safeCompare(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) {
    // Igual se hace un compare de longitud fija para no salir "rápido" en este caso.
    timingSafeEqual(Buffer.alloc(32), Buffer.alloc(32));
    return false;
  }
  return timingSafeEqual(bufA, bufB);
}

export async function POST(req: NextRequest) {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  if (!checkRate(ip)) {
    return NextResponse.json({ error: "Demasiados intentos. Intenta más tarde." }, { status: 429 });
  }

  const body = await req.json().catch(() => null) as { password?: string } | null;
  const password = body?.password;
  if (!password || typeof password !== "string") {
    return NextResponse.json({ error: "Falta la clave." }, { status: 400 });
  }

  const token = await getServiceAccountToken();
  if (!token) {
    return NextResponse.json({ error: "Config del servidor incompleta." }, { status: 500 });
  }

  const stored = await getStoredResetPassword(token);
  if (!stored) {
    return NextResponse.json({ ok: false });
  }

  return NextResponse.json({ ok: safeCompare(password, stored) });
}
