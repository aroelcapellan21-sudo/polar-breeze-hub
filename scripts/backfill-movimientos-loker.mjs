#!/usr/bin/env node
/**
 * backfill-movimientos-loker.mjs
 * Reconstruye los movimientos de stock que faltan en `movimientos_loker` a
 * partir de los lotes ya guardados en `lotes_loker`.
 *
 * Contexto: la escritura doble (lote + movimiento) se agregó a
 * `RegistroLote.tsx` después de que se registraran algunos lotes de prueba,
 * por lo que existen documentos en `lotes_loker` sin su `entrada_interior`
 * correspondiente en `movimientos_loker`. Sin esos movimientos el Stock del
 * Encargado y el Hub Admin (ambos calculan saldo desde `movimientos_loker`)
 * aparecen vacíos.
 *
 * Por cada lote crea un movimiento por producto, idéntico al que escribe
 * `RegistroLote.tsx` al guardar:
 *   { tipo: "entrada_interior", producto_id, nombre, cantidad: total,
 *     responsable, timestamp, notas: "Lote #NNN — proveedor",
 *     loteNumero, loteId, backfill: true }
 *
 * Idempotente: antes de escribir, consulta si ya existen movimientos con ese
 * `loteId` y omite los lotes ya reconstruidos. Re-ejecutarlo es seguro.
 *
 * Uso: node scripts/backfill-movimientos-loker.mjs
 */

const API_KEY    = "AIzaSyDff-CX-65-ruH8YIUeJ08dE0B6Ad8AcCk";
const PROJECT_ID = "polar-breeze";
const AUTH_URL   = "https://identitytoolkit.googleapis.com/v1/accounts";
const FS_URL     = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents`;

// ─── Helpers de escritura ──────────────────────────────────────────────────────

const str  = (s) => ({ stringValue: s });
const bool = (b) => ({ booleanValue: b });
const ts   = (d) => ({ timestampValue: d });
const num  = (n) => (Number.isInteger(n) ? { integerValue: String(n) } : { doubleValue: n });

// ─── Helpers de lectura (formato REST de Firestore) ────────────────────────────

function readVal(v) {
  if (!v) return undefined;
  if (v.stringValue    !== undefined) return v.stringValue;
  if (v.integerValue   !== undefined) return Number(v.integerValue);
  if (v.doubleValue    !== undefined) return v.doubleValue;
  if (v.booleanValue   !== undefined) return v.booleanValue;
  if (v.timestampValue !== undefined) return v.timestampValue;
  return undefined;
}

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

/** ¿Ya existe al menos un movimiento con este loteId? (idempotencia) */
async function yaTieneMovimientos(loteId, idToken) {
  const res = await runQuery({
    from: [{ collectionId: "movimientos_loker" }],
    where: {
      fieldFilter: { field: { fieldPath: "loteId" }, op: "EQUAL", value: str(loteId) },
    },
    limit: 1,
  }, idToken);
  return Array.isArray(res) && res.some((row) => row.document);
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log("\n🧊 Polar Breeze — Backfill de movimientos_loker desde lotes_loker\n");

  process.stdout.write("  🔑 Autenticando como admin … ");
  const auth = await signIn("admin@polarbreeze.com", "polar2024");
  if (auth.error) { console.log(`❌  ${auth.error.message}`); process.exit(1); }
  console.log("✅");
  const { idToken } = auth;

  // Leer todos los lotes
  process.stdout.write("  📦 Leyendo lotes_loker … ");
  const lotesRes = await runQuery({ from: [{ collectionId: "lotes_loker" }] }, idToken);
  if (lotesRes.error) { console.log(`❌  ${lotesRes.error.message}`); process.exit(1); }
  const lotes = (Array.isArray(lotesRes) ? lotesRes : [])
    .filter((row) => row.document)
    .map((row) => ({ id: row.document.name.split("/").pop(), fields: row.document.fields ?? {} }));
  console.log(`✅  ${lotes.length} lote(s)`);

  if (lotes.length === 0) {
    console.log("\n  Nada que reconstruir — no hay lotes.\n");
    return;
  }

  let creados = 0, omitidos = 0, lotesProcesados = 0;

  for (const lote of lotes) {
    const f          = lote.fields;
    const numero     = readVal(f.numero)        ?? `#${lote.id.slice(0, 4)}`;
    const proveedor  = readVal(f.proveedor)     ?? "";
    const responsable = readVal(f.registradoPor) ?? "Encargado";
    const timestamp  = readVal(f.timestamp);    // ISO string del timestampValue
    const productos  = f.productos?.arrayValue?.values ?? [];

    process.stdout.write(`\n  📦 Lote ${numero} (${productos.length} producto/s) … `);

    if (await yaTieneMovimientos(lote.id, idToken)) {
      console.log("⏭️  ya tiene movimientos — omitido");
      omitidos++;
      continue;
    }

    for (const p of productos) {
      const pf       = p.mapValue?.fields ?? {};
      const nombre   = readVal(pf.nombre)      ?? "(sin nombre)";
      const prodId   = readVal(pf.producto_id) ?? "";
      const total    = readVal(pf.total)       ?? 0;

      const fields = {
        tipo:        str("entrada_interior"),
        producto_id: str(prodId),
        nombre:      str(nombre),
        cantidad:    num(total),
        responsable: str(responsable),
        timestamp:   ts(timestamp ?? new Date().toISOString()),
        notas:       str(`Lote ${numero}${proveedor ? ` — ${proveedor}` : ""}`),
        loteNumero:  str(numero),
        loteId:      str(lote.id),
        backfill:    bool(true),
      };
      await postDoc("movimientos_loker", fields, idToken);
      creados++;
    }

    lotesProcesados++;
    console.log(`✅  ${productos.length} movimiento(s) creado(s)`);
  }

  console.log(`
────────────────────────────────────────────────────
✔  ${creados} movimiento(s) creado(s) (entrada_interior)
✔  ${lotesProcesados} lote(s) reconstruido(s)
⏭️  ${omitidos} lote(s) ya tenían movimientos
────────────────────────────────────────────────────
`);
}

main().catch((e) => { console.error("\n❌ Error:", e.message); process.exit(1); });
