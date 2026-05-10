#!/usr/bin/env node
/**
 * seed-users.mjs
 * Crea o verifica los usuarios del sistema en Firebase Auth + Firestore.
 * Uso: node scripts/seed-users.mjs
 */

const API_KEY    = "AIzaSyDff-CX-65-ruH8YIUeJ08dE0B6Ad8AcCk";
const PROJECT_ID = "polar-breeze";
const AUTH_URL   = "https://identitytoolkit.googleapis.com/v1/accounts";
const FS_URL     = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents`;

const USERS = [
  { email: "admin@polarbreeze.com",       password: "polar2024",    nombre: "Administrador",       role: "admin" },
  { email: "despachador@polarbreeze.com", password: "despacho2024", nombre: "Despachador Principal", role: "despachador" },
];

async function signUp(email, password) {
  const res  = await fetch(`${AUTH_URL}:signUp?key=${API_KEY}`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password, returnSecureToken: true }),
  });
  return res.json();
}

async function signIn(email, password) {
  const res  = await fetch(`${AUTH_URL}:signInWithPassword?key=${API_KEY}`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password, returnSecureToken: true }),
  });
  return res.json();
}

function toFields(obj) {
  const f = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v instanceof Date)       f[k] = { timestampValue: v.toISOString() };
    else if (typeof v === "string")   f[k] = { stringValue: v };
  }
  return f;
}

async function upsertFirestore(uid, idToken, data) {
  const res = await fetch(`${FS_URL}/usuarios/${uid}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", "Authorization": `Bearer ${idToken}` },
    body: JSON.stringify({ fields: toFields(data) }),
  });
  return res.json();
}

console.log("\n🚀 Polar Breeze Hub — Verificando usuarios\n");

for (const u of USERS) {
  process.stdout.write(`  ${u.role.padEnd(13)} ${u.email} … `);
  try {
    // Intentar crear; si ya existe, hacer sign-in
    let data = await signUp(u.email, u.password);
    let isNew = true;

    if (data.error?.message === "EMAIL_EXISTS") {
      data = await signIn(u.email, u.password);
      isNew = false;
    }

    if (data.error) throw new Error(data.error.message);

    const { localId: uid, idToken } = data;

    // Asegurar documento en Firestore
    await upsertFirestore(uid, idToken, {
      uid, email: u.email, nombre: u.nombre, role: u.role, createdAt: new Date(),
    });

    console.log(isNew ? "✅ creado" : "✅ ya existía");
  } catch (e) {
    console.log(`❌  ${e.message}`);
  }
}

console.log(`
────────────────────────────────────
✔ Credenciales listas:

   👑  Admin        →  polar2024
   🚛  Despachador  →  despacho2024
   📦  Chofer       →  número de ficha
────────────────────────────────────
`);
