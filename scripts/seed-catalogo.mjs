#!/usr/bin/env node
/**
 * seed-catalogo.mjs
 * Carga el catálogo oficial de Polar Breeze E.I.R.L. en config/puntos
 * y los datos de empresa en config/empresa.
 * Uso: node scripts/seed-catalogo.mjs
 */

const API_KEY    = "AIzaSyDff-CX-65-ruH8YIUeJ08dE0B6Ad8AcCk";
const PROJECT_ID = "polar-breeze";
const AUTH_URL   = "https://identitytoolkit.googleapis.com/v1/accounts";
const FS_URL     = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents`;

// ─── Catálogo oficial ─────────────────────────────────────────────────────────

const PRODUCTOS = [
  { nombre: "PALETA CHOCO MANI 32/1",               puntos: 12 },
  { nombre: "PALETA CHOCO CREMA 32/1",              puntos: 12 },
  { nombre: "PALETA CHOCO CHOCO 32/1",              puntos: 12 },
  { nombre: "PALETA DE FRAMBUESA 36/1",             puntos:  4 },
  { nombre: "PALETA DE UVA 36/1",                   puntos:  4 },
  { nombre: "PALETA NATURAL DE COCO 24/1",          puntos: 10 },
  { nombre: "PALETA NATURAL DE FRESA 24/1",         puntos: 10 },
  { nombre: "PALETA NATURAL DE CHINOLA 24/1",       puntos: 10 },
  { nombre: "PALETA FUDGE BIZCOCHO 24/1",           puntos:  6 },
  { nombre: "PALETA FUDGE CHOCOLATE 24/1",          puntos:  6 },
  { nombre: "COPA FRESA 16/1",                      puntos: 18 },
  { nombre: "PALETA CHINOLA CREMA 24/1",            puntos: 10 },
  { nombre: "PALETA FRESA CREMA 24/1",              puntos: 10 },
  { nombre: "LENGUILETTA FRUTOS ROJOS 24/1",        puntos:  6 },
  { nombre: "HELADO FRESA C-3.5 ONZ CAJA 24/1",    puntos: 10 },
  { nombre: "HELADO CHOCOLATE C-3.5 ONZ CAJA 24/1",puntos: 10 },
  { nombre: "HELADO VAINILLA C-3.5 ONZ CAJA 24/1", puntos: 10 },
  { nombre: "MORDISKO CLASICO 24/1",                puntos: 15 },
  { nombre: "SANDWICH BON VAINILLA 24/1",           puntos: 13 },
  { nombre: "MAGNUM ALMENDRAS 25/1",                puntos: 27 },
  { nombre: "MAGNUM CLASICO 25/1",                  puntos: 27 },
  { nombre: "HELADO DE CHOCOLATE 1 PINTA 6/1",      puntos: 35 },
  { nombre: "HELADO DE BIZCOCHO 1 PINTA 6/1",       puntos: 35 },
  { nombre: "HELADO DE FRESA 1 PINTA 6/1",          puntos: 35 },
  { nombre: "HELADO DE VAINILLA 1 PINTA 6/1",       puntos: 35 },
  { nombre: "HELADO DE RON PASA 1 PINTA 6/1",       puntos: 35 },
  { nombre: "PALETA DE AGUA MANZANA 36/1",           puntos:  4 },
  { nombre: "PALETA DE AGUA CHERRY 36/1",            puntos:  4 },
  { nombre: "MAGNUM BLANCA ALMENDRA 25/1",           puntos: 27 },
  { nombre: "PALETA CHOCO CREMA DON ALFONSO 32/1",   puntos: 15 },
  { nombre: "HELADO DON ALFONSO 1 PINTA 6/1",        puntos: 47 },
];

// ─── Datos de la empresa ──────────────────────────────────────────────────────

const EMPRESA = {
  nombre:    "Polar Breeze E.I.R.L.",
  rnc:       "1-31-64946-7",
  direccion: "Calle #6, Esq. #2, Altos de Rafey, Santiago",
  telefono:  "829-696-8086",
};

// ─── Helpers REST ─────────────────────────────────────────────────────────────

async function signIn(email, password) {
  const res = await fetch(`${AUTH_URL}:signInWithPassword?key=${API_KEY}`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password, returnSecureToken: true }),
  });
  return res.json();
}

const str  = (s) => ({ stringValue: s });
const int  = (n) => ({ integerValue: String(n) });

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

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log("\n🧊 Polar Breeze E.I.R.L. — Cargando catálogo y empresa\n");

  // Autenticar como admin
  process.stdout.write("  🔑 Autenticando … ");
  const auth = await signIn("admin@polarbreeze.com", "polar2024");
  if (auth.error) { console.log(`❌  ${auth.error.message}`); process.exit(1); }
  console.log("✅");
  const { idToken } = auth;

  // ── config/puntos ─────────────────────────────────────────────────────────
  process.stdout.write(`  📦 config/puntos (${PRODUCTOS.length} productos) … `);
  await patchDoc("config/puntos", {
    productos: {
      arrayValue: {
        values: PRODUCTOS.map(p => ({
          mapValue: {
            fields: {
              nombre: str(p.nombre),
              puntos: int(p.puntos),
            },
          },
        })),
      },
    },
    meta: int(100),
  }, idToken);
  console.log("✅");

  // ── config/empresa ────────────────────────────────────────────────────────
  process.stdout.write("  🏢 config/empresa … ");
  await patchDoc("config/empresa", {
    nombre:    str(EMPRESA.nombre),
    rnc:       str(EMPRESA.rnc),
    direccion: str(EMPRESA.direccion),
    telefono:  str(EMPRESA.telefono),
  }, idToken);
  console.log("✅");

  console.log(`
────────────────────────────────────────────
✔  Catálogo: ${PRODUCTOS.length} productos cargados
✔  Empresa:  ${EMPRESA.nombre}
✔  RNC:      ${EMPRESA.rnc}
✔  Tel:      ${EMPRESA.telefono}
────────────────────────────────────────────
`);
}

main().catch((e) => { console.error("❌", e.message); process.exit(1); });
