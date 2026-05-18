#!/usr/bin/env node
/**
 * seed-data-real.mjs
 * Actualiza datos reales de la empresa, carga 13 choferes y agrega 6 productos.
 * Uso: node scripts/seed-data-real.mjs
 */

const API_KEY    = "AIzaSyDff-CX-65-ruH8YIUeJ08dE0B6Ad8AcCk";
const PROJECT_ID = "polar-breeze";
const AUTH_URL   = "https://identitytoolkit.googleapis.com/v1/accounts";
const FS_URL     = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents`;

// ─── Datos de empresa actualizados ────────────────────────────────────────────

const EMPRESA = {
  nombre:    "POLAR BREEZE, S.R.L.",
  rnc:       "1-31-64946-7",
  direccion: "Calle 2 Esq. 6 No. 11, Altos de Rafey, Santiago, Rep. Dom.",
  telefono:  "809-923-9010",
};

// ─── 6 productos nuevos ────────────────────────────────────────────────────────

const NUEVOS_PRODUCTOS = [
  { nombre: "PALETA CHOCO C. DULCE DE LECHE 24/1",   puntos: 15 },
  { nombre: "PALETAS BONICE 24/1",                    puntos:  8 },
  { nombre: "COPA BON DE FRESA 16/1",                 puntos: 18 },
  { nombre: "COPA BON CHIPS DE CHOCOLATE 16/1",       puntos: 18 },
  { nombre: "HELADO MERENGUE DE QUISQUEYA",            puntos: 35 },
  { nombre: "MAGNUM COOKIE REMIX 25/1",               puntos: 27 },
];

// ─── 13 choferes reales ────────────────────────────────────────────────────────

const CHOFERES = [
  { ficha: "103", nombre: "Willie Agustín Báez Germosén" },
  { ficha: "104", nombre: "Rafael Aníbal Martínez Ortiz" },
  { ficha: "105", nombre: "Eduardo Ventura Medrano" },
  { ficha: "106", nombre: "Richard Jordan de la Cruz Toribio" },
  { ficha: "107", nombre: "Eriberto Rafael Torres Collado" },
  { ficha: "108", nombre: "Eddy Javier" },
  { ficha: "109", nombre: "Juan Evangelista Mejía del Rosario" },
  { ficha: "110", nombre: "Marco Elías Gerónimo Almánzar" },
  { ficha: "112", nombre: "José Alberto Martínez Rosario" },
  { ficha: "113", nombre: "Raylin Robles Cruz" },
  { ficha: "118", nombre: "Rafael Martínez Durán" },
  { ficha: "119", nombre: "Francisco de Jesús Franco Pimentel" },
  { ficha: "120", nombre: "Braimen Alexander Alcántara de la Cruz" },
];

// ─── Helpers REST ─────────────────────────────────────────────────────────────

async function signIn(email, password) {
  const res = await fetch(`${AUTH_URL}:signInWithPassword?key=${API_KEY}`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password, returnSecureToken: true }),
  });
  return res.json();
}

async function signUp(email, password) {
  const res = await fetch(`${AUTH_URL}:signUp?key=${API_KEY}`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password, returnSecureToken: true }),
  });
  return res.json();
}

const str  = (s) => ({ stringValue: s });
const int  = (n) => ({ integerValue: String(n) });
const bool = (b) => ({ booleanValue: b });
const tsv  = (d) => ({ timestampValue: d.toISOString() });

async function patchDoc(path, fields, idToken) {
  const res = await fetch(`${FS_URL}/${path}`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${idToken}`,
    },
    body: JSON.stringify({ fields }),
  });
  const json = await res.json();
  if (json.error) throw new Error(json.error.message);
  return json;
}

async function getDoc(path, idToken) {
  const res = await fetch(`${FS_URL}/${path}`, {
    headers: { "Authorization": `Bearer ${idToken}` },
  });
  return res.json();
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log("\n🧊 Polar Breeze — Cargando datos reales\n");

  // Autenticar como admin (para empresa y productos)
  process.stdout.write("  🔑 Autenticando como admin … ");
  const adminAuth = await signIn("admin@polarbreeze.com", "polar2024");
  if (adminAuth.error) { console.log(`❌  ${adminAuth.error.message}`); process.exit(1); }
  console.log("✅");
  const adminToken = adminAuth.idToken;

  // ── 1. Actualizar config/empresa ─────────────────────────────────────────
  process.stdout.write("  🏢 Actualizando config/empresa … ");
  await patchDoc("config/empresa", {
    nombre:    str(EMPRESA.nombre),
    rnc:       str(EMPRESA.rnc),
    direccion: str(EMPRESA.direccion),
    telefono:  str(EMPRESA.telefono),
  }, adminToken);
  console.log("✅");

  // ── 2. Agregar 6 productos nuevos al catálogo ─────────────────────────────
  process.stdout.write("  📦 Obteniendo catálogo actual … ");
  const puntosDoc = await getDoc("config/puntos", adminToken);
  const existentes = puntosDoc.fields?.productos?.arrayValue?.values ?? [];
  const nombresExistentes = new Set(
    existentes.map((v) => v.mapValue?.fields?.nombre?.stringValue ?? "")
  );
  const sinDuplicar = NUEVOS_PRODUCTOS.filter((p) => !nombresExistentes.has(p.nombre));
  console.log(`✅ (${existentes.length} existentes, ${sinDuplicar.length} nuevos a agregar)`);

  if (sinDuplicar.length > 0) {
    process.stdout.write(`  📦 Guardando catálogo ampliado … `);
    const todosLosProductos = [
      ...existentes,
      ...sinDuplicar.map((p) => ({
        mapValue: {
          fields: { nombre: str(p.nombre), puntos: int(p.puntos) },
        },
      })),
    ];
    await patchDoc("config/puntos", {
      productos: { arrayValue: { values: todosLosProductos } },
      meta: int(100),
    }, adminToken);
    console.log(`✅ (total ${todosLosProductos.length} productos)`);
  }

  // ── 3. Crear 13 choferes ──────────────────────────────────────────────────
  console.log(`\n  👥 Cargando ${CHOFERES.length} choferes reales:\n`);
  let creados = 0; let yaExistian = 0; let errores = 0;

  for (const ch of CHOFERES) {
    const email    = `${ch.ficha}@chofer.polarbreeze.com`;
    const password = ch.ficha.padStart(6, "0");
    process.stdout.write(`     [${ch.ficha}] ${ch.nombre.padEnd(40)} … `);
    try {
      let data = await signUp(email, password);
      let nuevo = true;
      if (data.error?.message === "EMAIL_EXISTS") {
        data  = await signIn(email, password);
        nuevo = false;
      }
      if (data.error) throw new Error(data.error.message);
      const { localId: uid, idToken: choferToken } = data;

      await patchDoc(`usuarios/${uid}`, {
        uid:       str(uid),
        email:     str(email),
        nombre:    str(ch.nombre),
        role:      str("chofer"),
        ficha:     str(ch.ficha),
        activo:    bool(true),
        createdAt: tsv(new Date()),
      }, choferToken);

      if (nuevo) { console.log("✅ creado"); creados++; }
      else       { console.log("✅ ya existía"); yaExistian++; }
    } catch (e) {
      console.log(`❌  ${e.message}`);
      errores++;
    }
  }

  console.log(`
────────────────────────────────────────────────────────
✔  Empresa:   ${EMPRESA.nombre}
✔  RNC:       ${EMPRESA.rnc}
✔  Dirección: ${EMPRESA.direccion}
✔  Teléfono:  ${EMPRESA.telefono}

✔  Productos nuevos: ${sinDuplicar.length} agregados
✔  Choferes creados: ${creados} nuevos · ${yaExistian} ya existían · ${errores} errores
────────────────────────────────────────────────────────

🔑 Contraseñas de choferes (ficha con padding de 6 dígitos):
${CHOFERES.map((c) => `   Ficha ${c.ficha} → ${c.ficha.padStart(6, "0")}`).join("\n")}
────────────────────────────────────────────────────────
`);
}

main().catch((e) => { console.error("❌", e.message); process.exit(1); });
