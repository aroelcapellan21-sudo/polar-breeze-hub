/**
 * /api/admin-setup  — Bootstrap de roles de usuario
 *
 * Usa el mismo patrón JWT de sync-sheets (crypto.subtle, ya probado en prod)
 * con scope datastore para escribir en Firestore via REST y bypassar sus reglas.
 *
 * GET  → crea/actualiza documento de admin@polarbreeze.com con role="admin"
 * POST → actualiza role de cualquier usuario por email (busca en Firestore) o uid
 *
 * Requiere: GOOGLE_SERVICE_ACCOUNT_EMAIL + GOOGLE_PRIVATE_KEY + SETUP_SECRET en Vercel
 *
 * Ejemplos:
 *   curl https://polar-breeze-hub.vercel.app/api/admin-setup \
 *     -H "x-setup-token: <SETUP_SECRET>"
 *
 *   curl -X POST https://polar-breeze-hub.vercel.app/api/admin-setup \
 *     -H "Content-Type: application/json" \
 *     -H "x-setup-token: <SETUP_SECRET>" \
 *     -d '{"email":"oliver@example.com","role":"admin","nombre":"Oliver"}'
 */

import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

const FS_URL   = "https://firestore.googleapis.com/v1/projects/polar-breeze/databases/(default)/documents";
const AUTH_URL = "https://identitytoolkit.googleapis.com/v1/accounts";
const API_KEY  = process.env.NEXT_PUBLIC_FIREBASE_API_KEY!;

// ─── JWT RS256 via Web Crypto (mismo patrón que sync-sheets — probado en prod) ──

function b64url(buf: ArrayBuffer): string {
  return Buffer.from(buf).toString("base64")
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function b64urlStr(s: string): string {
  return Buffer.from(s).toString("base64")
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
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
    iss:   email,
    scope: "https://www.googleapis.com/auth/datastore",
    aud:   "https://oauth2.googleapis.com/token",
    iat:   now,
    exp:   now + 3600,
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

// ─── Firebase Auth (para obtener UID de admin@polarbreeze.com) ───────────────

async function getAdminIdToken(): Promise<string | null> {
  const r = await fetch(`${AUTH_URL}:signInWithPassword?key=${API_KEY}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: "admin@polarbreeze.com", password: process.env.ADMIN_PASSWORD ?? "polar2024", returnSecureToken: true }),
  });
  const d = await r.json() as { idToken?: string };
  return d.idToken ?? null;
}

function uidFromJwt(jwt: string): string | null {
  try {
    const p = JSON.parse(Buffer.from(jwt.split(".")[1], "base64url").toString()) as { user_id?: string; sub?: string };
    return p.user_id ?? p.sub ?? null;
  } catch { return null; }
}

// ─── Firestore REST ──────────────────────────────────────────────────────────

async function fsSet(token: string, docPath: string, fields: Record<string, unknown>) {
  const toFsField = (v: unknown): unknown => {
    if (typeof v === "string")  return { stringValue: v };
    if (typeof v === "boolean") return { booleanValue: v };
    if (typeof v === "number")  return { integerValue: String(v) };
    return { stringValue: String(v) };
  };
  const fsFields: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(fields)) fsFields[k] = toFsField(v);

  const r = await fetch(`${FS_URL}/${docPath}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ fields: fsFields }),
  });
  return r.ok ? null : await r.text();
}

async function fsQuery(token: string, collection: string, field: string, value: string): Promise<string | null> {
  const r = await fetch(`${FS_URL}:runQuery`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      structuredQuery: {
        from: [{ collectionId: collection }],
        where: { fieldFilter: { field: { fieldPath: field }, op: "EQUAL", value: { stringValue: value } } },
        limit: 1,
      },
    }),
  });
  const rows = await r.json() as Array<{ document?: { name: string } }>;
  const name = rows[0]?.document?.name;
  return name ? name.split("/").pop()! : null;
}

// ─── Auth helper ─────────────────────────────────────────────────────────────

function authOk(req: NextRequest): boolean {
  return req.headers.get("x-setup-token") === process.env.SETUP_SECRET;
}

// ─── GET — diagnóstico + crea doc admin@polarbreeze.com con role="admin" ─────

export async function GET(req: NextRequest) {
  if (!authOk(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const diag: Record<string, unknown> = {};

  // Diagnóstico de la clave
  const pemRaw = process.env.GOOGLE_PRIVATE_KEY ?? "";
  const pemNorm = pemRaw.replace(/\\n/g, "\n").replace(/^"|"$/g, "");
  diag.keyLength     = pemRaw.length;
  diag.keyNormLength = pemNorm.length;
  diag.keyHasBegin   = pemNorm.includes("-----BEGIN");
  diag.keyHasEnd     = pemNorm.includes("-----END");
  diag.keyFirstChars = pemNorm.slice(0, 27);
  diag.serviceEmail  = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL ? "configurado" : "FALTA";
  diag.adminPassword = process.env.ADMIN_PASSWORD ? "configurado" : "FALTA";

  try {
    const saToken = await getServiceAccountToken();
    diag.saToken = saToken ? "ok" : "falló";
    if (!saToken) return NextResponse.json({ error: "Sin service account token.", diag }, { status: 500 });

    const idToken = await getAdminIdToken();
    diag.adminIdToken = idToken ? "ok" : "falló";
    if (!idToken) return NextResponse.json({ error: "No se pudo autenticar admin@polarbreeze.com.", diag }, { status: 500 });

    const uid = uidFromJwt(idToken);
    diag.adminUid = uid ?? "no extraído";
    if (!uid) return NextResponse.json({ error: "No se pudo extraer UID del JWT", diag }, { status: 500 });

    const err = await fsSet(saToken, `usuarios/${uid}`, { uid, email: "admin@polarbreeze.com", nombre: "Admin", role: "admin", activo: true });
    if (err) return NextResponse.json({ error: "Error Firestore.", detail: err, diag }, { status: 500 });

    return NextResponse.json({ ok: true, uid, diag, msg: "✅ Documento admin@polarbreeze.com actualizado con role=admin." });
  } catch (e) {
    diag.exception = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: diag.exception, diag }, { status: 500 });
  }
}

// ─── POST — actualiza role de cualquier usuario por email o uid ───────────────

export async function POST(req: NextRequest) {
  if (!authOk(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: { email?: string; uid?: string; role?: string; nombre?: string };
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: "JSON inválido" }, { status: 400 }); }

  const { email, uid: uidDirect, role, nombre } = body;
  if ((!email && !uidDirect) || !role) return NextResponse.json({ error: "Se requieren (email o uid) y role" }, { status: 400 });
  const validRoles = ["admin", "despachador", "encargado", "chofer"];
  if (!validRoles.includes(role)) return NextResponse.json({ error: `Role inválido. Válidos: ${validRoles.join(", ")}` }, { status: 400 });

  try {
    const saToken = await getServiceAccountToken();
    if (!saToken) return NextResponse.json({ error: "Sin service account token." }, { status: 500 });

    let uid = uidDirect ?? null;
    if (!uid && email) {
      uid = await fsQuery(saToken, "usuarios", "email", email);
      if (!uid) return NextResponse.json({ error: `No se encontró usuario con email="${email}" en Firestore. Usa uid directamente.` }, { status: 404 });
    }

    const fields: Record<string, unknown> = { role, activo: true };
    if (email)  fields.email  = email;
    if (uid)    fields.uid    = uid;
    if (nombre) fields.nombre = nombre;

    const err = await fsSet(saToken, `usuarios/${uid!}`, fields);
    if (err) return NextResponse.json({ error: "Error Firestore.", detail: err }, { status: 500 });

    return NextResponse.json({ ok: true, uid, role, msg: `✅ role="${role}" aplicado a uid ${uid}.` });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Error" }, { status: 500 });
  }
}
