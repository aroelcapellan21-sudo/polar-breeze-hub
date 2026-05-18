#!/usr/bin/env node
/**
 * seed-consignaciones-demo.mjs
 * Carga consignaciones reales del 13/05/2026 para 9 choferes como
 * movimientos_loker (salida_despacho) y actualiza la colección drivers.
 *
 * Uso: node scripts/seed-consignaciones-demo.mjs
 */

const API_KEY    = "AIzaSyDff-CX-65-ruH8YIUeJ08dE0B6Ad8AcCk";
const PROJECT_ID = "polar-breeze";
const AUTH_URL   = "https://identitytoolkit.googleapis.com/v1/accounts";
const FS_URL     = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents`;

const TIMESTAMP  = "2026-05-13T08:00:00.000Z";

// ─── Helpers Firestore ────────────────────────────────────────────────────────

function toProductoId(nombre) {
  return nombre.trim().toLowerCase().replace(/\s+/g, "_").replace(/[^a-z0-9_áéíóúñü]/g, "");
}

const str  = (s) => ({ stringValue: s });
const int  = (n) => ({ integerValue: String(n) });
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

async function postDoc(collection, fields, idToken) {
  const r = await fetch(`${FS_URL}/${collection}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${idToken}` },
    body: JSON.stringify({ fields }),
  });
  const json = await r.json();
  if (json.error) throw new Error(json.error.message);
  return json;
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

// ─── Datos de consignación verificados ───────────────────────────────────────

const DESPACHOS = [
  {
    ficha: "103",
    nombre: "Willie",
    totalRD: 10660,
    productos: [
      { nombre: "PALETA CHOCO MANI 32/1",             cantidad: 30, precio: 90  },
      { nombre: "PALETA CHOCO CREMA 32/1",             cantidad: 25, precio: 90  },
      { nombre: "PALETA CHOCO CHOCO 32/1",             cantidad: 23, precio: 90  },
      { nombre: "PALETA NATURAL DE FRESA 24/1",        cantidad: 15, precio: 85  },
      { nombre: "PALETA NATURAL DE COCO 24/1",         cantidad: 13, precio: 85  },
      { nombre: "PALETA FUDGE BIZCOCHO 24/1",          cantidad: 12, precio: 55  },
      { nombre: "PALETA FUDGE CHOCOLATE 24/1",         cantidad: 10, precio: 55  },
      { nombre: "PALETAS BONICE 24/1",                 cantidad:  1, precio: 50  },
    ],
  },
  {
    ficha: "104",
    nombre: "Junior Rafael",
    totalRD: 8245,
    productos: [
      { nombre: "PALETA CHOCO MANI 32/1",             cantidad: 28, precio: 90  },
      { nombre: "PALETA CHOCO CREMA 32/1",             cantidad: 27, precio: 90  },
      { nombre: "PALETA NATURAL DE FRESA 24/1",        cantidad: 10, precio: 85  },
      { nombre: "PALETA CHINOLA CREMA 24/1",           cantidad: 10, precio: 85  },
      { nombre: "PALETA FUDGE BIZCOCHO 24/1",          cantidad: 15, precio: 55  },
      { nombre: "PALETA FUDGE CHOCOLATE 24/1",         cantidad: 14, precio: 55  },
    ],
  },
  {
    ficha: "106",
    nombre: "Richar",
    totalRD: 15000,
    productos: [
      { nombre: "PALETA CHOCO MANI 32/1",             cantidad: 30, precio: 90  },
      { nombre: "PALETA CHOCO CREMA 32/1",             cantidad: 30, precio: 90  },
      { nombre: "PALETA CHOCO CHOCO 32/1",             cantidad: 20, precio: 90  },
      { nombre: "PALETA CHOCO C. DULCE DE LECHE 24/1", cantidad:  5, precio: 90  },
      { nombre: "PALETA NATURAL DE FRESA 24/1",        cantidad: 20, precio: 85  },
      { nombre: "PALETA NATURAL DE COCO 24/1",         cantidad: 20, precio: 85  },
      { nombre: "MORDISKO CLASICO 24/1",               cantidad: 10, precio: 110 },
      { nombre: "SANDWICH BON VAINILLA 24/1",          cantidad: 10, precio: 110 },
      { nombre: "PALETA FUDGE BIZCOCHO 24/1",          cantidad: 13, precio: 55  },
      { nombre: "PALETA DE FRAMBUESA 36/1",            cantidad: 11, precio: 35  },
      { nombre: "HELADO DE FRESA 1 PINTA 6/1",         cantidad:  1, precio: 270 },
      { nombre: "HELADO MERENGUE DE QUISQUEYA",        cantidad:  1, precio: 380 },
    ],
  },
  {
    ficha: "108",
    nombre: "Edy",
    totalRD: 8905,
    productos: [
      { nombre: "PALETA CHOCO MANI 32/1",             cantidad: 25, precio: 90  },
      { nombre: "PALETA CHOCO CREMA 32/1",             cantidad: 25, precio: 90  },
      { nombre: "PALETA NATURAL DE FRESA 24/1",        cantidad: 15, precio: 85  },
      { nombre: "PALETA FRESA CREMA 24/1",             cantidad: 10, precio: 85  },
      { nombre: "MORDISKO CLASICO 24/1",               cantidad:  8, precio: 110 },
      { nombre: "SANDWICH BON VAINILLA 24/1",          cantidad:  7, precio: 110 },
      { nombre: "PALETA FUDGE BIZCOCHO 24/1",          cantidad:  5, precio: 55  },
      { nombre: "PALETA FUDGE CHOCOLATE 24/1",         cantidad:  5, precio: 55  },
      { nombre: "HELADO CHOCOLATE C-3.5 ONZ CAJA 24/1", cantidad: 1, precio: 80  },
    ],
  },
  {
    ficha: "112",
    nombre: "José Alberto",
    totalRD: 7345,
    productos: [
      { nombre: "PALETA CHOCO MANI 32/1",             cantidad: 20, precio: 90  },
      { nombre: "PALETA CHOCO CREMA 32/1",             cantidad: 20, precio: 90  },
      { nombre: "PALETA NATURAL DE FRESA 24/1",        cantidad: 15, precio: 85  },
      { nombre: "PALETA FRESA CREMA 24/1",             cantidad: 10, precio: 85  },
      { nombre: "MORDISKO CLASICO 24/1",               cantidad:  5, precio: 110 },
      { nombre: "SANDWICH BON VAINILLA 24/1",          cantidad:  5, precio: 110 },
      { nombre: "PALETA FUDGE BIZCOCHO 24/1",          cantidad:  3, precio: 55  },
      { nombre: "PALETA FUDGE CHOCOLATE 24/1",         cantidad:  2, precio: 55  },
      { nombre: "PALETA DE FRAMBUESA 36/1",            cantidad:  4, precio: 35  },
      { nombre: "PALETA DE UVA 36/1",                  cantidad:  3, precio: 35  },
    ],
  },
  {
    ficha: "113",
    nombre: "Raylin",
    totalRD: 10290,
    productos: [
      { nombre: "PALETA CHOCO MANI 32/1",             cantidad: 25, precio: 90  },
      { nombre: "PALETA CHOCO CREMA 32/1",             cantidad: 20, precio: 90  },
      { nombre: "PALETA CHOCO CHOCO 32/1",             cantidad: 15, precio: 90  },
      { nombre: "PALETA NATURAL DE FRESA 24/1",        cantidad: 15, precio: 85  },
      { nombre: "PALETA NATURAL DE CHINOLA 24/1",      cantidad: 15, precio: 85  },
      { nombre: "MORDISKO CLASICO 24/1",               cantidad: 10, precio: 110 },
      { nombre: "SANDWICH BON VAINILLA 24/1",          cantidad:  8, precio: 110 },
      { nombre: "PALETA DE FRAMBUESA 36/1",            cantidad:  4, precio: 35  },
      { nombre: "PALETA DE UVA 36/1",                  cantidad:  4, precio: 35  },
      { nombre: "HELADO FRESA C-3.5 ONZ CAJA 24/1",   cantidad:  1, precio: 80  },
    ],
  },
  {
    ficha: "118",
    nombre: "Durán",
    totalRD: 8385,
    productos: [
      { nombre: "PALETA CHOCO MANI 32/1",             cantidad: 25, precio: 90  },
      { nombre: "PALETA CHOCO CREMA 32/1",             cantidad: 25, precio: 90  },
      { nombre: "PALETA NATURAL DE FRESA 24/1",        cantidad: 15, precio: 85  },
      { nombre: "PALETA NATURAL DE COCO 24/1",         cantidad: 10, precio: 85  },
      { nombre: "PALETA FUDGE BIZCOCHO 24/1",          cantidad: 17, precio: 55  },
      { nombre: "PALETA FUDGE CHOCOLATE 24/1",         cantidad: 15, precio: 55  },
    ],
  },
  {
    ficha: "119",
    nombre: "Francisco",
    totalRD: 7180,
    productos: [
      { nombre: "PALETA CHOCO MANI 32/1",             cantidad: 18, precio: 90  },
      { nombre: "PALETA CHOCO CREMA 32/1",             cantidad: 18, precio: 90  },
      { nombre: "PALETA NATURAL DE CHINOLA 24/1",      cantidad: 15, precio: 85  },
      { nombre: "PALETA FRESA CREMA 24/1",             cantidad: 10, precio: 85  },
      { nombre: "PALETA FUDGE BIZCOCHO 24/1",          cantidad: 18, precio: 55  },
      { nombre: "PALETA FUDGE CHOCOLATE 24/1",         cantidad: 15, precio: 55  },
    ],
  },
  {
    ficha: "120",
    nombre: "Braymen",
    totalRD: 10390,
    productos: [
      { nombre: "PALETA CHOCO MANI 32/1",             cantidad: 25, precio: 90  },
      { nombre: "PALETA CHOCO CREMA 32/1",             cantidad: 25, precio: 90  },
      { nombre: "PALETA CHOCO CHOCO 32/1",             cantidad: 20, precio: 90  },
      { nombre: "PALETA NATURAL DE FRESA 24/1",        cantidad: 16, precio: 85  },
      { nombre: "PALETA NATURAL DE CHINOLA 24/1",      cantidad: 14, precio: 85  },
      { nombre: "PALETA FUDGE BIZCOCHO 24/1",          cantidad: 15, precio: 55  },
      { nombre: "PALETA FUDGE CHOCOLATE 24/1",         cantidad: 13, precio: 55  },
    ],
  },
];

// ─── Verificación de totales ──────────────────────────────────────────────────

function verificar() {
  let ok = true;
  for (const d of DESPACHOS) {
    const suma = d.productos.reduce((s, p) => s + p.cantidad * p.precio, 0);
    const match = suma === d.totalRD;
    if (!match) {
      console.error(`  ❌  Ficha ${d.ficha} ${d.nombre}: calculado RD$${suma} ≠ esperado RD$${d.totalRD}`);
      ok = false;
    }
  }
  return ok;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log("\n🧊 Polar Breeze — Semilla de consignaciones 13/05/2026\n");

  // Verificar totales antes de tocar Firebase
  process.stdout.write("  🔢 Verificando totales … ");
  if (!verificar()) {
    console.log("❌  Abortar — totales incorrectos");
    process.exit(1);
  }
  console.log("✅  Todos los totales cuadran");

  // Autenticar como admin
  process.stdout.write("  🔑 Autenticando … ");
  const auth = await signIn("admin@polarbreeze.com", "polar2024");
  if (auth.error) { console.log(`❌  ${auth.error.message}`); process.exit(1); }
  console.log("✅");
  const { idToken } = auth;

  let totalMovimientos = 0;
  let totalDrivers = 0;

  for (const despacho of DESPACHOS) {
    process.stdout.write(`\n  👤 Ficha ${despacho.ficha} — ${despacho.nombre} (RD$${despacho.totalRD.toLocaleString()}) … `);

    // Buscar UID del chofer en colección usuarios
    const queryRes = await runQuery({
      from: [{ collectionId: "usuarios" }],
      where: {
        fieldFilter: {
          field: { fieldPath: "ficha" },
          op: "EQUAL",
          value: str(despacho.ficha),
        },
      },
      limit: 1,
    }, idToken);

    let choferId = null;
    if (Array.isArray(queryRes) && queryRes[0]?.document) {
      const docName = queryRes[0].document.name;
      choferId = docName.split("/").pop();
    }

    if (!choferId) {
      console.log(`⚠️  No encontrado en usuarios — usando ficha como ID`);
      choferId = `ficha_${despacho.ficha}`;
    } else {
      process.stdout.write(`UID: ${choferId.slice(0, 8)}… `);
    }

    // Crear movimientos_loker — uno por producto
    for (const prod of despacho.productos) {
      const fields = {
        tipo:          str("salida_despacho"),
        categoria:     str("retiro_despacho"),
        generaPuntos:  bool(false),
        producto_id:   str(toProductoId(prod.nombre)),
        nombre:        str(prod.nombre),
        cantidad:      int(-prod.cantidad),        // negativo = salida
        responsable:   str("Demo Despachador"),
        choferId:      str(choferId),
        choferNombre:  str(despacho.nombre),
        timestamp:     ts(TIMESTAMP),
        notas:         str("Despacho 13/05/2026 — datos demo"),
      };
      await postDoc("movimientos_loker", fields, idToken);
      totalMovimientos++;
    }

    // Crear / actualizar drivers/{choferId}
    const totalUnidades = despacho.productos.reduce((s, p) => s + p.cantidad, 0);

    const entregasValues = despacho.productos.map((p) => ({
      mapValue: {
        fields: {
          nombre:   str(p.nombre),
          cantidad: int(p.cantidad),
          precio:   int(p.precio),
        },
      },
    }));

    await patchDoc(`drivers/${choferId}`, {
      nombre:         str(despacho.nombre),
      ficha:          str(despacho.ficha),
      activo:         bool(true),
      entregas:       { arrayValue: { values: entregasValues } },
      totalEntregado: int(totalUnidades),
      totalMonto:     int(despacho.totalRD),
      updatedAt:      ts(TIMESTAMP),
    }, idToken);

    totalDrivers++;
    console.log(`✅  ${despacho.productos.length} movimientos + driver OK`);
  }

  console.log(`
────────────────────────────────────────────────────
✔  ${totalMovimientos} movimientos_loker creados (salida_despacho)
✔  ${totalDrivers} documentos drivers actualizados
✔  Fecha: ${TIMESTAMP}
✔  Total cargado: RD$${DESPACHOS.reduce((s, d) => s + d.totalRD, 0).toLocaleString()}

   Choferes incluidos:
${DESPACHOS.map(d => `   [${d.ficha}] ${d.nombre.padEnd(16)} RD$${d.totalRD.toLocaleString()}`).join("\n")}
────────────────────────────────────────────────────
`);
}

main().catch((e) => { console.error("❌", e.message); process.exit(1); });
