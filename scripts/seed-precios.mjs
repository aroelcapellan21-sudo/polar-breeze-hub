#!/usr/bin/env node
/**
 * seed-precios.mjs
 * Carga la lista de precios de venta reales en config/precios.
 * Uso: node scripts/seed-precios.mjs
 */

const API_KEY    = "AIzaSyDff-CX-65-ruH8YIUeJ08dE0B6Ad8AcCk";
const PROJECT_ID = "polar-breeze";
const AUTH_URL   = "https://identitytoolkit.googleapis.com/v1/accounts";
const FS_URL     = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents`;

// ─── Lista de precios oficial ─────────────────────────────────────────────────

const PRECIOS = [
  { codigo:  1, nombre: "PALETA CHOCO MANI 32/1",                 precio: 90  },
  { codigo:  2, nombre: "PALETA CHOCO CREMA 32/1",                precio: 90  },
  { codigo:  3, nombre: "PALETA CHOCO CHOCO 32/1",                precio: 90  },
  { codigo:  4, nombre: "PALETA DE FRAMBUESA 36/1",               precio: 35  },
  { codigo:  6, nombre: "PALETA DE UVA 36/1",                     precio: 35  },
  { codigo:  7, nombre: "PALETA NATURAL DE COCO 24/1",            precio: 85  },
  { codigo:  8, nombre: "PALETA NATURAL DE FRESA 24/1",           precio: 85  },
  { codigo:  9, nombre: "PALETA NATURAL DE CHINOLA 24/1",         precio: 85  },
  { codigo: 10, nombre: "PALETA FUDGE BIZCOCHO 24/1",             precio: 55  },
  { codigo: 11, nombre: "PALETA FUDGE CHOCOLATE 24/1",            precio: 55  },
  { codigo: 12, nombre: "COPA BON DE FRESA 16/1",                 precio: 130 },
  { codigo: 13, nombre: "PALETA CHINOLA CREMA 24/1",              precio: 85  },
  { codigo: 14, nombre: "PALETA FRESA CREMA 24/1",                precio: 85  },
  { codigo: 16, nombre: "PALETA CHOCO C. DULCE DE LECHE 24/1",   precio: 90  },
  { codigo: 17, nombre: "PALETAS BONICE 24/1",                    precio: 50  },
  { codigo: 18, nombre: "HELADO FRESA C-3.5 ONZ CAJA 24/1",      precio: 80  },
  { codigo: 19, nombre: "HELADO CHOCOLATE C-3.5 ONZ CAJA 24/1",  precio: 80  },
  { codigo: 20, nombre: "HELADO VAINILLA C-3.5 ONZ CAJA 24/1",   precio: 80  },
  { codigo: 22, nombre: "COPA BON CHIPS DE CHOCOLATE 16/1",       precio: 130 },
  { codigo: 24, nombre: "MORDISKO CLASICO 24/1",                  precio: 110 },
  { codigo: 25, nombre: "SANDWICH BON VAINILLA 24/1",             precio: 110 },
  { codigo: 26, nombre: "MAGNUM ALMENDRAS 25/1",                  precio: 175 },
  { codigo: 27, nombre: "MAGNUM CLASICO 25/1",                    precio: 175 },
  { codigo: 31, nombre: "HELADO DE BIZCOCHO 1 PINTA 6/1",        precio: 270 },
  { codigo: 32, nombre: "HELADO DE FRESA 1 PINTA 6/1",           precio: 270 },
  { codigo: 34, nombre: "HELADO DE VAINILLA 1 PINTA 6/1",        precio: 270 },
  { codigo: 35, nombre: "HELADO DE RON PASA 1 PINTA 6/1",        precio: 270 },
  { codigo: 42, nombre: "HELADO MERENGUE DE QUISQUEYA",           precio: 380 },
  { codigo: 53, nombre: "PALETA DE AGUA MANZANA 36/1",           precio: 35  },
  { codigo: 54, nombre: "PALETA DE AGUA CHERRY 36/1",            precio: 35  },
  { codigo: 66, nombre: "PALETA CHOCO CREMA DON ALFONSO 32/1",   precio: 100 },
  { codigo: 67, nombre: "HELADO DON ALFONSO 1 PINTA 6/1",        precio: 380 },
  { codigo: 76, nombre: "MAGNUM COOKIE REMIX 25/1",              precio: 175 },
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

function toProductoId(nombre) {
  return nombre.trim().toLowerCase().replace(/\s+/g, "_").replace(/[^a-z0-9_áéíóúñü]/g, "");
}

async function signIn(email, password) {
  const res = await fetch(`${AUTH_URL}:signInWithPassword?key=${API_KEY}`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password, returnSecureToken: true }),
  });
  return res.json();
}

const str = (s) => ({ stringValue: s });
const int = (n) => ({ integerValue: String(n) });
const ts  = (d) => ({ timestampValue: d.toISOString() });

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
  console.log("\n🧊 Polar Breeze — Cargando precios de venta\n");

  process.stdout.write("  🔑 Autenticando … ");
  const auth = await signIn("admin@polarbreeze.com", "polar2024");
  if (auth.error) { console.log(`❌  ${auth.error.message}`); process.exit(1); }
  console.log("✅");
  const { idToken } = auth;

  process.stdout.write(`  💰 Guardando ${PRECIOS.length} precios en config/precios … `);

  await patchDoc("config/precios", {
    productos: {
      arrayValue: {
        values: PRECIOS.map((p) => ({
          mapValue: {
            fields: {
              codigo:      int(p.codigo),
              nombre:      str(p.nombre),
              producto_id: str(toProductoId(p.nombre)),
              precio:      int(p.precio),
              moneda:      str("RD$"),
            },
          },
        })),
      },
    },
    moneda:        str("RD$"),
    actualizadoEl: ts(new Date()),
  }, idToken);

  console.log("✅");

  console.log(`
────────────────────────────────────────────────────
✔  ${PRECIOS.length} precios cargados en config/precios
✔  Moneda: RD$
✔  Rango: RD$${Math.min(...PRECIOS.map(p => p.precio))} – RD$${Math.max(...PRECIOS.map(p => p.precio))}

   Códigos incluidos: ${PRECIOS.map(p => p.codigo).join(", ")}
────────────────────────────────────────────────────

  Muestra:
${PRECIOS.slice(0, 5).map(p => `   [${String(p.codigo).padStart(2)}] ${p.nombre.padEnd(42)} RD$${p.precio}`).join("\n")}
     …y ${PRECIOS.length - 5} más
────────────────────────────────────────────────────
`);
}

main().catch((e) => { console.error("❌", e.message); process.exit(1); });
