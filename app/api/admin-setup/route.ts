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

async function getUidByEmail(email: string, idToken: string): Promise<string | null> {
  const r = await fetch(`${AUTH_URL}:lookup?key=${API_KEY}`, {
    method: "POST",
    headers: {
      "Content-Type":  "application/json",
      "Authorization": `Bearer ${idToken}`,
    },
    body: JSON.stringify({ email }),
  });
  const data = await r.json() as { users?: { localId: string }[] };
  return data.users?.[0]?.localId ?? null;
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

export async function POST(req: NextRequest) {
  // Verificar token de autorización
  const token = req.headers.get("x-setup-token");
  if (!token || token !== process.env.SETUP_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: { email?: string; role?: string; nombre?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
  }

  const { email, role, nombre } = body;
  if (!email || !role) {
    return NextResponse.json({ error: "Se requieren email y role" }, { status: 400 });
  }
  const validRoles = ["admin", "despachador", "encargado", "chofer"];
  if (!validRoles.includes(role)) {
    return NextResponse.json({ error: `Role inválido. Válidos: ${validRoles.join(", ")}` }, { status: 400 });
  }

  try {
    const idToken = await getAdminToken();
    if (!idToken) {
      return NextResponse.json({
        error: "No se pudo autenticar admin@polarbreeze.com. Verifica ADMIN_PASSWORD en Vercel.",
      }, { status: 500 });
    }

    const uid = await getUidByEmail(email, idToken);
    if (!uid) {
      return NextResponse.json({
        error: `Usuario ${email} no encontrado en Firebase Auth. Créalo primero en GestionUsuarios o Firebase Console.`,
      }, { status: 404 });
    }

    const err = await upsertFirestoreDoc(uid, email, role, nombre ?? email.split("@")[0], idToken);
    if (err) {
      return NextResponse.json({
        error: "Error al escribir en Firestore. Revisa las reglas de seguridad.",
        detail: err,
      }, { status: 500 });
    }

    return NextResponse.json({
      ok:    true,
      uid,
      email,
      role,
      msg:   `✅ Documento de ${email} actualizado a role="${role}". El usuario puede iniciar sesión ahora.`,
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Error interno" },
      { status: 500 },
    );
  }
}
