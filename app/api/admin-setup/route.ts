/**
 * /api/admin-setup  — Bootstrap de roles de usuario
 *
 * Usa Firebase Admin SDK (bypass total de reglas Firestore).
 * Requiere: GOOGLE_SERVICE_ACCOUNT_EMAIL + GOOGLE_PRIVATE_KEY + SETUP_SECRET en Vercel.
 *
 * GET  → crea/actualiza documento de admin@polarbreeze.com con role="admin"
 * POST → actualiza role de cualquier usuario por email o uid
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
import * as admin from "firebase-admin";

// Inicializar Admin SDK una sola vez (singleton)
function getAdminApp(): admin.app.App {
  if (admin.apps.length > 0) return admin.apps[0]!;

  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL!;
  const key   = process.env.GOOGLE_PRIVATE_KEY!.replace(/\\n/g, "\n");

  return admin.initializeApp({
    credential: admin.credential.cert({ clientEmail: email, privateKey: key, projectId: "polar-breeze" }),
    projectId:  "polar-breeze",
  });
}

const AUTH_URL = "https://identitytoolkit.googleapis.com/v1/accounts";
const API_KEY  = process.env.NEXT_PUBLIC_FIREBASE_API_KEY!;

async function getAdminIdToken(): Promise<string | null> {
  const r = await fetch(`${AUTH_URL}:signInWithPassword?key=${API_KEY}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      email: "admin@polarbreeze.com",
      password: process.env.ADMIN_PASSWORD ?? "polar2024",
      returnSecureToken: true,
    }),
  });
  const d = await r.json() as { idToken?: string };
  return d.idToken ?? null;
}

function uidFromJwt(jwt: string): string | null {
  try {
    const payload = JSON.parse(Buffer.from(jwt.split(".")[1], "base64url").toString()) as { user_id?: string; sub?: string };
    return payload.user_id ?? payload.sub ?? null;
  } catch { return null; }
}

function authOk(req: NextRequest): boolean {
  return req.headers.get("x-setup-token") === process.env.SETUP_SECRET;
}

// GET — crea/actualiza documento admin@polarbreeze.com con role="admin"
export async function GET(req: NextRequest) {
  if (!authOk(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const app = getAdminApp();
    const db  = admin.firestore(app);

    const idToken = await getAdminIdToken();
    if (!idToken) {
      return NextResponse.json({
        error: "No se pudo autenticar admin@polarbreeze.com. Verifica ADMIN_PASSWORD en Vercel.",
      }, { status: 500 });
    }

    const uid = uidFromJwt(idToken);
    if (!uid) return NextResponse.json({ error: "No se pudo extraer UID del JWT" }, { status: 500 });

    await db.collection("usuarios").doc(uid).set({
      uid,
      email:     "admin@polarbreeze.com",
      nombre:    "Admin",
      role:      "admin",
      activo:    true,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });

    return NextResponse.json({
      ok: true, uid,
      msg: "✅ Documento admin@polarbreeze.com actualizado a role=admin. Inicia sesión con esa cuenta y ADMIN_PASSWORD.",
    });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Error" }, { status: 500 });
  }
}

// POST — actualiza role de un usuario por email (busca en Firestore) o por uid directo
export async function POST(req: NextRequest) {
  if (!authOk(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: { email?: string; uid?: string; role?: string; nombre?: string };
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: "JSON inválido" }, { status: 400 }); }

  const { email, uid: uidDirect, role, nombre } = body;
  if ((!email && !uidDirect) || !role) {
    return NextResponse.json({ error: "Se requieren (email o uid) y role" }, { status: 400 });
  }
  const validRoles = ["admin", "despachador", "encargado", "chofer"];
  if (!validRoles.includes(role)) {
    return NextResponse.json({ error: `Role inválido. Válidos: ${validRoles.join(", ")}` }, { status: 400 });
  }

  try {
    const app = getAdminApp();
    const db  = admin.firestore(app);

    let uid = uidDirect ?? null;

    if (!uid && email) {
      // Buscar por email en Firestore
      const snap = await db.collection("usuarios").where("email", "==", email).limit(1).get();
      if (!snap.empty) {
        uid = snap.docs[0].id;
      } else {
        // Intentar buscar via Firebase Auth Admin
        try {
          const userRecord = await admin.auth(app).getUserByEmail(email);
          uid = userRecord.uid;
        } catch {
          return NextResponse.json({
            error: `Usuario ${email} no encontrado en Firestore ni en Firebase Auth.`,
          }, { status: 404 });
        }
      }
    }

    await db.collection("usuarios").doc(uid!).set({
      ...(email ? { email, uid: uid! } : {}),
      ...(nombre ? { nombre } : {}),
      role,
      activo: true,
    }, { merge: true });

    return NextResponse.json({
      ok: true, uid, role,
      msg: `✅ role="${role}" aplicado al uid ${uid}. El usuario puede iniciar sesión ahora.`,
    });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Error" }, { status: 500 });
  }
}
