/**
 * /api/admin-setup  — Bootstrap de roles de usuario
 *
 * Permite crear o corregir el documento Firestore de cualquier usuario
 * sin necesitar acceso al Hub Admin (rompe el círculo vicioso cuando el
 * admin tiene role="encargado" y no puede llegar a GestionUsuarios).
 *
 * Uso:
 *   curl -X POST https://polar-breeze-hub.vercel.app/api/admin-setup \
 *     -H "Content-Type: application/json" \
 *     -H "x-setup-token: <SETUP_SECRET>" \
 *     -d '{"email":"admin@polarbreeze.com","role":"admin","nombre":"Oliver"}'
 *
 * Variables de entorno requeridas:
 *   SETUP_SECRET       — token secreto para autorizar el endpoint
 *   ADMIN_PASSWORD     — contraseña de admin@polarbreeze.com (ya existe)
 *   NEXT_PUBLIC_FIREBASE_API_KEY — ya configurada en Vercel
 */

import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";

const FS_URL   = "https://firestore.googleapis.com/v1/projects/polar-breeze/databases/(default)/documents";
const AUTH_URL = "https://identitytoolkit.googleapis.com/v1/accounts";
const API_KEY  = process.env.NEXT_PUBLIC_FIREBASE_API_KEY!;

async function getAdminToken(): Promise<string | null> {
  const r = await fetch(`${AUTH_URL}:signInWithPassword?key=${API_KEY}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      email:             "admin@polarbreeze.com",
      password:          process.env.ADMIN_PASSWORD ?? "polar2024",
      returnSecureToken: true,
    }),
  });
  const data = await r.json();
  return (data as { idToken?: string }).idToken ?? null;
}

// Obtiene un access token de Google usando el service account (bypass reglas Firestore)
async function getServiceAccountToken(): Promise<string | null> {
  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  let   key   = process.env.GOOGLE_PRIVATE_KEY;
  if (!email || !key) return null;

  // Normalizar la clave: reemplazar \\n literales y asegurar headers PEM
  key = key.replace(/\\n/g, "\n").replace(/^"|"$/g, "");
  if (!key.includes("-----BEGIN")) {
    key = `-----BEGIN PRIVATE KEY-----\n${key}\n-----END PRIVATE KEY-----`;
  }

  const now = Math.floor(Date.now() / 1000);
  const header  = Buffer.from(JSON.stringify({ alg: "RS256", typ: "JWT" })).toString("base64url");
  const payload = Buffer.from(JSON.stringify({
    iss:   email,
    scope: "https://www.googleapis.com/auth/datastore",
    aud:   "https://oauth2.googleapis.com/token",
    iat:   now,
    exp:   now + 3600,
  })).toString("base64url");

  const signer = crypto.createSign("SHA256");
  signer.update(`${header}.${payload}`);
  const sig = signer.sign({ key, padding: crypto.constants.RSA_PKCS1_PADDING }, "base64url");
  const jwt    = `${header}.${payload}.${sig}`;

  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion:  jwt,
    }),
  });
  const data = await r.json() as { access_token?: string; error?: string };
  if (data.error) return null;
  return data.access_token ?? null;
}

// Busca el UID consultando Firestore por campo email (no requiere Admin SDK)
async function getUidByEmail(email: string, idToken: string): Promise<string | null> {
  const r = await fetch(`${FS_URL}:runQuery`, {
    method: "POST",
    headers: {
      "Content-Type":  "application/json",
      "Authorization": `Bearer ${idToken}`,
    },
    body: JSON.stringify({
      structuredQuery: {
        from:  [{ collectionId: "usuarios" }],
        where: {
          fieldFilter: {
            field: { fieldPath: "email" },
            op:    "EQUAL",
            value: { stringValue: email },
          },
        },
        limit: 1,
      },
    }),
  });
  const rows = await r.json() as Array<{ document?: { name: string } }>;
  const name = rows[0]?.document?.name;
  if (!name) return null;
  return name.split("/").pop() ?? null;
}

async function upsertFirestoreDoc(uid: string, email: string, role: string, nombre: string, idToken: string) {
  const body = {
    fields: {
      uid:       { stringValue: uid },
      email:     { stringValue: email },
      nombre:    { stringValue: nombre },
      role:      { stringValue: role },
      activo:    { booleanValue: true },
      createdAt: { timestampValue: new Date().toISOString() },
    },
  };
  const r = await fetch(`${FS_URL}/usuarios/${uid}`, {
    method:  "PATCH",
    headers: {
      "Content-Type":  "application/json",
      "Authorization": `Bearer ${idToken}`,
    },
    body: JSON.stringify(body),
  });
  return r.ok ? null : await r.text();
}

function authHeader(req: NextRequest): boolean {
  const token = req.headers.get("x-setup-token");
  return token === process.env.SETUP_SECRET;
}

// Extrae el UID del payload de un Firebase JWT (base64 sin verificar — solo para bootstrap)
function uidFromJwt(idToken: string): string | null {
  try {
    const payload = idToken.split(".")[1];
    const decoded = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as { user_id?: string; sub?: string };
    return decoded.user_id ?? decoded.sub ?? null;
  } catch { return null; }
}

// GET — crea documento de admin@polarbreeze.com con role="admin" usando service account
export async function GET(req: NextRequest) {
  if (!authHeader(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    // Preferir service account (bypass reglas); fallback a idToken propio
    const saToken  = await getServiceAccountToken();
    const idToken  = saToken ?? await getAdminToken();
    if (!idToken) {
      return NextResponse.json({
        error: "Sin credenciales: configura GOOGLE_PRIVATE_KEY + GOOGLE_SERVICE_ACCOUNT_EMAIL o ADMIN_PASSWORD.",
      }, { status: 500 });
    }

    // Si usamos idToken de admin@polarbreeze.com, extraer su UID del JWT
    const uid = saToken ? null : uidFromJwt(idToken);

    if (saToken) {
      // Con service account podemos escribir cualquier documento — usamos el de admin
      const adminIdToken = await getAdminToken();
      const adminUid = adminIdToken ? uidFromJwt(adminIdToken) : null;
      if (!adminUid) {
        return NextResponse.json({ error: "No se pudo obtener UID de admin@polarbreeze.com" }, { status: 500 });
      }
      const err = await upsertFirestoreDoc(adminUid, "admin@polarbreeze.com", "admin", "Admin", saToken);
      if (err) return NextResponse.json({ error: "Error Firestore.", detail: err }, { status: 500 });
      return NextResponse.json({
        ok: true, uid: adminUid, email: "admin@polarbreeze.com", role: "admin",
        msg: "✅ Documento admin creado/actualizado. Inicia sesión con admin@polarbreeze.com y ADMIN_PASSWORD.",
      });
    }

    if (!uid) return NextResponse.json({ error: "No se pudo extraer UID del token" }, { status: 500 });
    const err = await upsertFirestoreDoc(uid, "admin@polarbreeze.com", "admin", "Admin", idToken);
    if (err) return NextResponse.json({ error: "Error Firestore.", detail: err }, { status: 500 });
    return NextResponse.json({
      ok: true, uid, email: "admin@polarbreeze.com", role: "admin",
      msg: "✅ Documento admin creado/actualizado. Inicia sesión con admin@polarbreeze.com y ADMIN_PASSWORD.",
    });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Error" }, { status: 500 });
  }
}

// POST — actualizar rol de un usuario (por uid directo o por email en Firestore)
export async function POST(req: NextRequest) {
  if (!authHeader(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: { email?: string; uid?: string; role?: string; nombre?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
  }

  const { email, uid: uidDirecto, role, nombre } = body;
  if ((!email && !uidDirecto) || !role) {
    return NextResponse.json({ error: "Se requieren (email o uid) y role" }, { status: 400 });
  }
  const validRoles = ["admin", "despachador", "encargado", "chofer"];
  if (!validRoles.includes(role)) {
    return NextResponse.json({ error: `Role inválido. Válidos: ${validRoles.join(", ")}` }, { status: 400 });
  }

  try {
    const idToken = await getAdminToken();
    if (!idToken) {
      return NextResponse.json({ error: "Admin auth failed. Verifica ADMIN_PASSWORD en Vercel." }, { status: 500 });
    }

    // Resolver UID: usar el directo si fue proporcionado, si no buscar por email en Firestore
    let uid = uidDirecto ?? null;
    if (!uid && email) {
      uid = await getUidByEmail(email, idToken);
      if (!uid) {
        return NextResponse.json({
          error: `No se encontró documento en Firestore con email="${email}". Usa GET /api/admin-setup para listar usuarios y obtener el uid correcto, o pasa uid directamente.`,
        }, { status: 404 });
      }
    }

    const emailFinal = email ?? `${uid}@unknown`;
    const err = await upsertFirestoreDoc(uid!, emailFinal, role, nombre ?? emailFinal.split("@")[0], idToken);
    if (err) {
      return NextResponse.json({ error: "Error al escribir en Firestore.", detail: err }, { status: 500 });
    }

    return NextResponse.json({
      ok:   true,
      uid,
      role,
      msg:  `✅ role="${role}" aplicado al uid ${uid}. El usuario puede iniciar sesión ahora.`,
    });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Error interno" }, { status: 500 });
  }
}
