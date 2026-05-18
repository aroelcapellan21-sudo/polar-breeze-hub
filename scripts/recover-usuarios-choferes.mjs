#!/usr/bin/env node
/**
 * recover-usuarios-choferes.mjs
 * Restaura los documentos usuarios/{uid} de los 13 choferes que quedaron
 * sobreescritos por seed-inventario-base.mjs (PATCH sin updateMask).
 *
 * Estrategia:
 *  1. Lista todos los docs de `usuarios` — los que no tienen "role" fueron sobreescritos.
 *  2. Para cada uno, busca su doc en `drivers` (mismo UID como document ID) → obtiene nombre y ficha.
 *  3. Restaura el doc de `usuarios` con todos los campos correctos + conserva inventario_base.
 *
 * Uso: node scripts/recover-usuarios-choferes.mjs
 */

const API_KEY    = "AIzaSyDff-CX-65-ruH8YIUeJ08dE0B6Ad8AcCk";
const PROJECT_ID = "polar-breeze";
const AUTH_URL   = "https://identitytoolkit.googleapis.com/v1/accounts";
const FS_URL     = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents`;

// ─── Helpers ──────────────────────────────────────────────────────────────────

const str  = (s) => ({ stringValue: s });
const bool = (b) => ({ booleanValue: b });
const ts   = (d) => ({ timestampValue: d });

async function signIn(email, password) {
  const r = await fetch(`${AUTH_URL}:signInWithPassword?key=${API_KEY}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password, returnSecureToken: true }),
  });
  return r.json();
}

async function runQuery(structuredQuery, idToken) {
  const r = await fetch(`${FS_URL}:runQuery`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${idToken}` },
    body: JSON.stringify({ structuredQuery }),
  });
  return r.json();
}

async function getDoc(path, idToken) {
  const r = await fetch(`${FS_URL}/${path}`, {
    headers: { Authorization: `Bearer ${idToken}` },
  });
  return r.json();
}

async function patchDoc(path, fields, idToken) {
  const r = await fetch(`${FS_URL}/${path}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${idToken}` },
    body: JSON.stringify({ fields }),
  });
  const json = await r.json();
  if (json.error) throw new Error(json.error.message);
  return json;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log("\n🧊 Polar Breeze — Recuperación de usuarios/choferes\n");

  process.stdout.write("  🔑 Autenticando … ");
  const auth = await signIn("admin@polarbreeze.com", "polar2024");
  if (auth.error) { console.log(`❌  ${auth.error.message}`); process.exit(1); }
  console.log("✅");
  const { idToken } = auth;

  // 1. Listar todos los docs de `usuarios`
  process.stdout.write("  📋 Listando colección usuarios … ");
  const usuariosRes = await runQuery({
    from: [{ collectionId: "usuarios" }],
  }, idToken);

  const docs = Array.isArray(usuariosRes) ? usuariosRes.filter((r) => r.document) : [];
  console.log(`${docs.length} documentos encontrados`);

  let restaurados = 0;
  let saltados    = 0;
  let errores     = 0;

  for (const item of docs) {
    const docName = item.document.name;
    const uid     = docName.split("/").pop();
    const fields  = item.document.fields ?? {};

    // Si ya tiene "role", no fue sobreescrito — saltar
    if (fields.role?.stringValue) {
      saltados++;
      continue;
    }

    process.stdout.write(`\n  🔄 UID ${uid.slice(0, 8)}… sin role — buscando en drivers … `);

    // 2. Leer doc en `drivers` (mismo UID como document ID)
    const driverDoc = await getDoc(`drivers/${uid}`, idToken);
    if (driverDoc.error) {
      console.log(`⚠️  No encontrado en drivers`);
      errores++;
      continue;
    }

    const df    = driverDoc.fields ?? {};
    const ficha = df.ficha?.stringValue;
    const nombre = df.nombre?.stringValue;

    if (!ficha || !nombre) {
      console.log(`⚠️  Sin ficha/nombre en drivers — saltando`);
      errores++;
      continue;
    }

    const email = `${ficha}@chofer.polarbreeze.com`;

    // 3. Restaurar doc en `usuarios` con todos los campos
    //    Conservar inventario_base e inventarioBaseDate si existen
    const restoredFields = {
      uid:       str(uid),
      email:     str(email),
      nombre:    str(nombre),
      ficha:     str(ficha),
      role:      str("chofer"),
      activo:    bool(true),
      createdAt: ts("2026-01-01T00:00:00.000Z"),  // fecha de referencia
    };

    if (fields.inventario_base)    restoredFields.inventario_base    = fields.inventario_base;
    if (fields.inventarioBaseDate) restoredFields.inventarioBaseDate = fields.inventarioBaseDate;

    await patchDoc(`usuarios/${uid}`, restoredFields, idToken);
    console.log(`✅  [${ficha}] ${nombre}`);
    restaurados++;
  }

  console.log(`
────────────────────────────────────────────────────
✔  ${restaurados} documentos restaurados con role="chofer"
✔  ${saltados}  documentos ya correctos (no tocados)
${errores > 0 ? `⚠️  ${errores}  documentos con error` : "✔  Sin errores"}
────────────────────────────────────────────────────
`);
}

main().catch((e) => { console.error("❌", e.message); process.exit(1); });
