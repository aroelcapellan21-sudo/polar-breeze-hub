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

// GET — lista todos los usuarios en Firestore (diagnóstico)
export async function GET(req: NextRequest) {
  if (!authHeader(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const idToken = await getAdminToken();
    if (!idToken) return NextResponse.json({ error: "Admin auth failed" }, { status: 500 });

    const r = await fetch(`${FS_URL}/usuarios`, {
      headers: { Authorization: `Bearer ${idToken}` },
    });
    const data = await r.json() as { documents?: Array<{ name: string; fields: Record<string, { stringValue?: string; booleanValue?: boolean }> }> };
    const users = (data.documents ?? []).map(d => ({
      uid:    d.name.split("/").pop(),
      email:  d.fields.email?.stringValue,
      nombre: d.fields.nombre?.stringValue,
      role:   d.fields.role?.stringValue,
      activo: d.fields.activo?.booleanValue,
    }));
    return NextResponse.json({ count: users.length, users });
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
