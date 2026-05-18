#!/usr/bin/env node
/**
 * seed-inventario-base.mjs
 * Carga el inventario base asignado del 18/05/2026 para 13 choferes como:
 *  1. movimientos_loker  tipo: "entrada_consignacion_inicial" (cantidad positiva)
 *  2. inventario_base[]  en usuarios/{uid}  y  drivers/{uid}
 *
 * Uso: node scripts/seed-inventario-base.mjs
 */

const API_KEY    = "AIzaSyDff-CX-65-ruH8YIUeJ08dE0B6Ad8AcCk";
const PROJECT_ID = "polar-breeze";
const AUTH_URL   = "https://identitytoolkit.googleapis.com/v1/accounts";
const FS_URL     = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents`;

const TIMESTAMP  = "2026-05-18T07:00:00.000Z";

// ─── Helpers ──────────────────────────────────────────────────────────────────

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

async function patchDoc(path, fields, idToken, mask = null) {
  // Con updateMask solo se actualizan los campos indicados (no reemplaza el documento entero)
  const maskQuery = mask
    ? "?" + mask.map((f) => `updateMask.fieldPaths=${encodeURIComponent(f)}`).join("&")
    : "";
  const r = await fetch(`${FS_URL}/${path}${maskQuery}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${idToken}` },
    body: JSON.stringify({ fields }),
  });
  const json = await r.json();
  if (json.error) throw new Error(json.error.message);
  return json;
}

// ─── Inventario base por chofer ───────────────────────────────────────────────

const INVENTARIOS = [
  {
    ficha: "103",
    nombre: "Willie Agustín Báez Germosén",
    productos: [
      { nombre: "PALETA CHOCO MANI 32/1",                 cantidad: 16 },
      { nombre: "PALETA FUDGE BIZCOCHO 24/1",              cantidad: 24 },
      { nombre: "PALETA FUDGE CHOCOLATE 24/1",             cantidad: 24 },
      { nombre: "PALETA CHINOLA CREMA 24/1",               cantidad:  6 },
      { nombre: "PALETA FRESA CREMA 24/1",                 cantidad:  6 },
      { nombre: "PALETA CHOCO C. DULCE DE LECHE 24/1",     cantidad: 10 },
      { nombre: "PALETAS BONICE 24/1",                     cantidad: 24 },
      { nombre: "HELADO FRESA C-3.5 ONZ CAJA 24/1",        cantidad:  5 },
      { nombre: "PALETA CHOCO CREMA 32/1",                 cantidad: 32 },
      { nombre: "HELADO VAINILLA C-3.5 ONZ CAJA 24/1",     cantidad:  5 },
      { nombre: "SANDWICH BON VAINILLA 24/1",              cantidad: 15 },
      { nombre: "PALETA CHOCO CHOCO 32/1",                 cantidad: 16 },
      { nombre: "PALETA CHOCO CREMA DON ALFONSO 32/1",     cantidad:  6 },
      { nombre: "PALETA NATURAL DE COCO 24/1",             cantidad: 12 },
      { nombre: "PALETA NATURAL DE FRESA 24/1",            cantidad: 12 },
      { nombre: "PALETA NATURAL DE CHINOLA 24/1",          cantidad: 12 },
    ],
  },
  {
    ficha: "104",
    nombre: "Rafael Aníbal Martínez Ortiz",
    productos: [
      { nombre: "PALETA CHOCO MANI 32/1",                 cantidad: 15 },
      { nombre: "PALETA FUDGE BIZCOCHO 24/1",              cantidad: 24 },
      { nombre: "PALETA FUDGE CHOCOLATE 24/1",             cantidad: 24 },
      { nombre: "COPA BON DE FRESA 16/1",                  cantidad:  2 },
      { nombre: "PALETA CHINOLA CREMA 24/1",               cantidad:  6 },
      { nombre: "PALETA FRESA CREMA 24/1",                 cantidad:  6 },
      { nombre: "PALETA CHOCO C. DULCE DE LECHE 24/1",     cantidad:  5 },
      { nombre: "PALETAS BONICE 24/1",                     cantidad: 24 },
      { nombre: "HELADO FRESA C-3.5 ONZ CAJA 24/1",        cantidad:  5 },
      { nombre: "HELADO CHOCOLATE C-3.5 ONZ CAJA 24/1",    cantidad:  5 },
      { nombre: "PALETA CHOCO CREMA 32/1",                 cantidad: 30 },
      { nombre: "HELADO VAINILLA C-3.5 ONZ CAJA 24/1",     cantidad:  5 },
      { nombre: "COPA BON CHIPS DE CHOCOLATE 16/1",        cantidad:  4 },
      { nombre: "MORDISKO CLASICO 24/1",                   cantidad:  2 },
      { nombre: "SANDWICH BON VAINILLA 24/1",              cantidad: 15 },
      { nombre: "MAGNUM ALMENDRAS 25/1",                   cantidad:  3 },
      { nombre: "MAGNUM CLASICO 25/1",                     cantidad:  1 },
      { nombre: "PALETA CHOCO CHOCO 32/1",                 cantidad: 15 },
      { nombre: "HELADO DE BIZCOCHO 1 PINTA 6/1",          cantidad:  1 },
      { nombre: "HELADO DE FRESA 1 PINTA 6/1",             cantidad:  1 },
      { nombre: "HELADO DE RON PASA 1 PINTA 6/1",          cantidad:  1 },
      { nombre: "PALETA DE FRAMBUESA 36/1",                cantidad: 10 },
      { nombre: "PALETA DE AGUA MANZANA 36/1",             cantidad: 10 },
      { nombre: "PALETA DE AGUA CHERRY 36/1",              cantidad: 10 },
      { nombre: "PALETA DE UVA 36/1",                      cantidad:  8 },
      { nombre: "PALETA CHOCO CREMA DON ALFONSO 32/1",     cantidad:  5 },
      { nombre: "PALETA NATURAL DE COCO 24/1",             cantidad: 12 },
      { nombre: "MAGNUM COOKIE REMIX 25/1",                cantidad:  1 },
      { nombre: "PALETA NATURAL DE FRESA 24/1",            cantidad: 14 },
      { nombre: "PALETA NATURAL DE CHINOLA 24/1",          cantidad: 10 },
    ],
  },
  {
    ficha: "105",
    nombre: "Eduardo Ventura Medrano",
    productos: [
      { nombre: "PALETA CHOCO MANI 32/1",                 cantidad: 16 },
      { nombre: "PALETA FUDGE BIZCOCHO 24/1",              cantidad: 24 },
      { nombre: "PALETA FUDGE CHOCOLATE 24/1",             cantidad: 24 },
      { nombre: "PALETA CHINOLA CREMA 24/1",               cantidad:  6 },
      { nombre: "PALETA FRESA CREMA 24/1",                 cantidad:  6 },
      { nombre: "PALETA CHOCO C. DULCE DE LECHE 24/1",     cantidad: 10 },
      { nombre: "PALETAS BONICE 24/1",                     cantidad: 24 },
      { nombre: "HELADO FRESA C-3.5 ONZ CAJA 24/1",        cantidad:  5 },
      { nombre: "HELADO CHOCOLATE C-3.5 ONZ CAJA 24/1",    cantidad:  5 },
      { nombre: "PALETA CHOCO CREMA 32/1",                 cantidad: 32 },
      { nombre: "HELADO VAINILLA C-3.5 ONZ CAJA 24/1",     cantidad:  5 },
      { nombre: "SANDWICH BON VAINILLA 24/1",              cantidad: 15 },
      { nombre: "PALETA CHOCO CHOCO 32/1",                 cantidad: 16 },
      { nombre: "PALETA CHOCO CREMA DON ALFONSO 32/1",     cantidad:  6 },
      { nombre: "PALETA NATURAL DE COCO 24/1",             cantidad: 12 },
      { nombre: "PALETA NATURAL DE FRESA 24/1",            cantidad: 12 },
      { nombre: "PALETA NATURAL DE CHINOLA 24/1",          cantidad: 12 },
    ],
  },
  {
    ficha: "106",
    nombre: "Richard Jordan de la Cruz Toribio",
    productos: [
      { nombre: "PALETA CHOCO MANI 32/1",                 cantidad: 17 },
      { nombre: "PALETA FUDGE BIZCOCHO 24/1",              cantidad: 24 },
      { nombre: "PALETA FUDGE CHOCOLATE 24/1",             cantidad: 24 },
      { nombre: "PALETA CHINOLA CREMA 24/1",               cantidad:  5 },
      { nombre: "PALETA FRESA CREMA 24/1",                 cantidad:  5 },
      { nombre: "PALETA CHOCO C. DULCE DE LECHE 24/1",     cantidad:  5 },
      { nombre: "PALETAS BONICE 24/1",                     cantidad: 34 },
      { nombre: "HELADO FRESA C-3.5 ONZ CAJA 24/1",        cantidad:  5 },
      { nombre: "HELADO CHOCOLATE C-3.5 ONZ CAJA 24/1",    cantidad:  4 },
      { nombre: "PALETA CHOCO CREMA 32/1",                 cantidad: 42 },
      { nombre: "HELADO VAINILLA C-3.5 ONZ CAJA 24/1",     cantidad:  5 },
      { nombre: "SANDWICH BON VAINILLA 24/1",              cantidad: 18 },
      { nombre: "MAGNUM ALMENDRAS 25/1",                   cantidad:  1 },
      { nombre: "PALETA CHOCO CHOCO 32/1",                 cantidad: 17 },
      { nombre: "HELADO DE BIZCOCHO 1 PINTA 6/1",          cantidad:  1 },
      { nombre: "HELADO DE RON PASA 1 PINTA 6/1",          cantidad:  1 },
      { nombre: "PALETA CHOCO CREMA DON ALFONSO 32/1",     cantidad: 10 },
      { nombre: "PALETA NATURAL DE COCO 24/1",             cantidad: 24 },
      { nombre: "PALETA NATURAL DE FRESA 24/1",            cantidad: 24 },
      { nombre: "PALETA NATURAL DE CHINOLA 24/1",          cantidad: 10 },
    ],
  },
  {
    ficha: "107",
    nombre: "Eriberto Rafael Torres Collado",
    productos: [
      { nombre: "PALETA CHOCO MANI 32/1",                 cantidad: 16 },
      { nombre: "PALETA FUDGE BIZCOCHO 24/1",              cantidad: 24 },
      { nombre: "PALETA FUDGE CHOCOLATE 24/1",             cantidad: 24 },
      { nombre: "PALETA CHINOLA CREMA 24/1",               cantidad:  6 },
      { nombre: "PALETA FRESA CREMA 24/1",                 cantidad:  6 },
      { nombre: "PALETA CHOCO C. DULCE DE LECHE 24/1",     cantidad: 10 },
      { nombre: "PALETAS BONICE 24/1",                     cantidad: 24 },
      { nombre: "HELADO FRESA C-3.5 ONZ CAJA 24/1",        cantidad:  5 },
      { nombre: "HELADO CHOCOLATE C-3.5 ONZ CAJA 24/1",    cantidad:  1 },
      { nombre: "PALETA CHOCO CREMA 32/1",                 cantidad: 32 },
      { nombre: "HELADO VAINILLA C-3.5 ONZ CAJA 24/1",     cantidad:  5 },
      { nombre: "SANDWICH BON VAINILLA 24/1",              cantidad: 15 },
      { nombre: "PALETA CHOCO CHOCO 32/1",                 cantidad: 16 },
      { nombre: "PALETA CHOCO CREMA DON ALFONSO 32/1",     cantidad:  5 },
      { nombre: "PALETA NATURAL DE COCO 24/1",             cantidad: 12 },
      { nombre: "PALETA NATURAL DE FRESA 24/1",            cantidad: 12 },
      { nombre: "PALETA NATURAL DE CHINOLA 24/1",          cantidad: 10 },
    ],
  },
  {
    ficha: "108",
    nombre: "Eddy Javier",
    productos: [
      { nombre: "PALETA CHOCO MANI 32/1",                 cantidad: 18 },
      { nombre: "PALETA FUDGE BIZCOCHO 24/1",              cantidad: 21 },
      { nombre: "PALETA FUDGE CHOCOLATE 24/1",             cantidad: 19 },
      { nombre: "COPA BON DE FRESA 16/1",                  cantidad:  1 },
      { nombre: "PALETA CHINOLA CREMA 24/1",               cantidad:  6 },
      { nombre: "PALETA FRESA CREMA 24/1",                 cantidad:  6 },
      { nombre: "PALETA CHOCO C. DULCE DE LECHE 24/1",     cantidad:  6 },
      { nombre: "PALETAS BONICE 24/1",                     cantidad: 19 },
      { nombre: "HELADO FRESA C-3.5 ONZ CAJA 24/1",        cantidad:  5 },
      { nombre: "HELADO CHOCOLATE C-3.5 ONZ CAJA 24/1",    cantidad:  4 },
      { nombre: "PALETA CHOCO CREMA 32/1",                 cantidad: 32 },
      { nombre: "HELADO VAINILLA C-3.5 ONZ CAJA 24/1",     cantidad:  4 },
      { nombre: "COPA BON CHIPS DE CHOCOLATE 16/1",        cantidad:  2 },
      { nombre: "MORDISKO CLASICO 24/1",                   cantidad:  2 },
      { nombre: "SANDWICH BON VAINILLA 24/1",              cantidad: 12 },
      { nombre: "MAGNUM ALMENDRAS 25/1",                   cantidad:  3 },
      { nombre: "PALETA CHOCO CHOCO 32/1",                 cantidad: 17 },
      { nombre: "HELADO DE FRESA 1 PINTA 6/1",             cantidad:  1 },
      { nombre: "HELADO DE VAINILLA 1 PINTA 6/1",          cantidad:  1 },
      { nombre: "PALETA DE FRAMBUESA 36/1",                cantidad:  8 },
      { nombre: "PALETA DE AGUA MANZANA 36/1",             cantidad:  8 },
      { nombre: "PALETA DE AGUA CHERRY 36/1",              cantidad:  8 },
      { nombre: "PALETA DE UVA 36/1",                      cantidad:  8 },
      { nombre: "PALETA CHOCO CREMA DON ALFONSO 32/1",     cantidad:  2 },
      { nombre: "PALETA NATURAL DE COCO 24/1",             cantidad: 22 },
      { nombre: "PALETA NATURAL DE FRESA 24/1",            cantidad: 24 },
      { nombre: "PALETA NATURAL DE CHINOLA 24/1",          cantidad: 10 },
    ],
  },
  {
    ficha: "109",
    nombre: "Juan Evangelista Mejía del Rosario",
    productos: [
      { nombre: "PALETA CHOCO MANI 32/1",                 cantidad: 12 },
      { nombre: "PALETA FUDGE BIZCOCHO 24/1",              cantidad: 24 },
      { nombre: "PALETA FUDGE CHOCOLATE 24/1",             cantidad: 32 },
      { nombre: "COPA BON DE FRESA 16/1",                  cantidad:  1 },
      { nombre: "PALETA CHINOLA CREMA 24/1",               cantidad: 10 },
      { nombre: "PALETA FRESA CREMA 24/1",                 cantidad: 10 },
      { nombre: "PALETA CHOCO C. DULCE DE LECHE 24/1",     cantidad:  5 },
      { nombre: "PALETAS BONICE 24/1",                     cantidad: 32 },
      { nombre: "HELADO FRESA C-3.5 ONZ CAJA 24/1",        cantidad:  5 },
      { nombre: "HELADO CHOCOLATE C-3.5 ONZ CAJA 24/1",    cantidad:  5 },
      { nombre: "PALETA CHOCO CREMA 32/1",                 cantidad: 32 },
      { nombre: "HELADO VAINILLA C-3.5 ONZ CAJA 24/1",     cantidad:  5 },
      { nombre: "COPA BON CHIPS DE CHOCOLATE 16/1",        cantidad:  2 },
      { nombre: "MORDISKO CLASICO 24/1",                   cantidad:  2 },
      { nombre: "SANDWICH BON VAINILLA 24/1",              cantidad: 12 },
      { nombre: "MAGNUM ALMENDRAS 25/1",                   cantidad:  2 },
      { nombre: "MAGNUM CLASICO 25/1",                     cantidad:  1 },
      { nombre: "PALETA CHOCO CHOCO 32/1",                 cantidad: 17 },
      { nombre: "HELADO DE BIZCOCHO 1 PINTA 6/1",          cantidad:  1 },
      { nombre: "HELADO DE VAINILLA 1 PINTA 6/1",          cantidad:  1 },
      { nombre: "PALETA DE FRAMBUESA 36/1",                cantidad:  5 },
      { nombre: "PALETA DE AGUA MANZANA 36/1",             cantidad:  5 },
      { nombre: "PALETA DE AGUA CHERRY 36/1",              cantidad:  5 },
      { nombre: "PALETA DE UVA 36/1",                      cantidad:  5 },
      { nombre: "PALETA CHOCO CREMA DON ALFONSO 32/1",     cantidad:  2 },
      { nombre: "PALETA NATURAL DE COCO 24/1",             cantidad: 16 },
      { nombre: "PALETA NATURAL DE FRESA 24/1",            cantidad: 17 },
      { nombre: "PALETA NATURAL DE CHINOLA 24/1",          cantidad: 10 },
    ],
  },
  {
    ficha: "110",
    nombre: "Marco Elías Gerónimo Almánzar",
    productos: [
      { nombre: "PALETA CHOCO MANI 32/1",                 cantidad: 20 },
      { nombre: "PALETA FUDGE BIZCOCHO 24/1",              cantidad: 24 },
      { nombre: "PALETA FUDGE CHOCOLATE 24/1",             cantidad: 17 },
      { nombre: "PALETA CHINOLA CREMA 24/1",               cantidad: 10 },
      { nombre: "PALETA FRESA CREMA 24/1",                 cantidad:  5 },
      { nombre: "PALETA CHOCO C. DULCE DE LECHE 24/1",     cantidad:  6 },
      { nombre: "PALETAS BONICE 24/1",                     cantidad: 29 },
      { nombre: "HELADO FRESA C-3.5 ONZ CAJA 24/1",        cantidad:  6 },
      { nombre: "PALETA CHOCO CREMA 32/1",                 cantidad: 32 },
      { nombre: "HELADO VAINILLA C-3.5 ONZ CAJA 24/1",     cantidad:  3 },
      { nombre: "SANDWICH BON VAINILLA 24/1",              cantidad: 12 },
      { nombre: "PALETA CHOCO CHOCO 32/1",                 cantidad: 10 },
      { nombre: "PALETA CHOCO CREMA DON ALFONSO 32/1",     cantidad:  1 },
      { nombre: "PALETA NATURAL DE COCO 24/1",             cantidad: 12 },
      { nombre: "PALETA NATURAL DE FRESA 24/1",            cantidad: 20 },
      { nombre: "PALETA NATURAL DE CHINOLA 24/1",          cantidad:  4 },
    ],
  },
  {
    ficha: "112",
    nombre: "José Alberto Martínez Rosario",
    productos: [
      { nombre: "PALETA CHOCO MANI 32/1",                 cantidad: 18 },
      { nombre: "PALETA FUDGE BIZCOCHO 24/1",              cantidad: 36 },
      { nombre: "PALETA FUDGE CHOCOLATE 24/1",             cantidad: 36 },
      { nombre: "COPA BON DE FRESA 16/1",                  cantidad:  1 },
      { nombre: "PALETA CHINOLA CREMA 24/1",               cantidad:  8 },
      { nombre: "PALETA FRESA CREMA 24/1",                 cantidad:  7 },
      { nombre: "PALETA CHOCO C. DULCE DE LECHE 24/1",     cantidad: 10 },
      { nombre: "PALETAS BONICE 24/1",                     cantidad: 41 },
      { nombre: "HELADO FRESA C-3.5 ONZ CAJA 24/1",        cantidad: 10 },
      { nombre: "HELADO CHOCOLATE C-3.5 ONZ CAJA 24/1",    cantidad:  1 },
      { nombre: "PALETA CHOCO CREMA 32/1",                 cantidad: 32 },
      { nombre: "HELADO VAINILLA C-3.5 ONZ CAJA 24/1",     cantidad: 10 },
      { nombre: "COPA BON CHIPS DE CHOCOLATE 16/1",        cantidad:  2 },
      { nombre: "MORDISKO CLASICO 24/1",                   cantidad:  2 },
      { nombre: "SANDWICH BON VAINILLA 24/1",              cantidad: 14 },
      { nombre: "MAGNUM ALMENDRAS 25/1",                   cantidad:  2 },
      { nombre: "MAGNUM CLASICO 25/1",                     cantidad:  1 },
      { nombre: "PALETA CHOCO CHOCO 32/1",                 cantidad: 14 },
      { nombre: "HELADO DE RON PASA 1 PINTA 6/1",          cantidad:  1 },
      { nombre: "PALETA DE FRAMBUESA 36/1",                cantidad:  8 },
      { nombre: "PALETA DE AGUA MANZANA 36/1",             cantidad:  3 },
      { nombre: "PALETA DE AGUA CHERRY 36/1",              cantidad:  3 },
      { nombre: "PALETA DE UVA 36/1",                      cantidad:  3 },
      { nombre: "PALETA CHOCO CREMA DON ALFONSO 32/1",     cantidad:  2 },
      { nombre: "PALETA NATURAL DE COCO 24/1",             cantidad: 17 },
      { nombre: "PALETA NATURAL DE FRESA 24/1",            cantidad: 20 },
      { nombre: "PALETA NATURAL DE CHINOLA 24/1",          cantidad:  6 },
    ],
  },
  {
    ficha: "113",
    nombre: "Raylin Robles Cruz",
    productos: [
      { nombre: "PALETA CHOCO MANI 32/1",                 cantidad: 16 },
      { nombre: "PALETA FUDGE BIZCOCHO 24/1",              cantidad: 24 },
      { nombre: "PALETA FUDGE CHOCOLATE 24/1",             cantidad: 24 },
      { nombre: "PALETA CHINOLA CREMA 24/1",               cantidad: 10 },
      { nombre: "PALETA FRESA CREMA 24/1",                 cantidad: 10 },
      { nombre: "PALETA CHOCO C. DULCE DE LECHE 24/1",     cantidad:  5 },
      { nombre: "PALETAS BONICE 24/1",                     cantidad: 24 },
      { nombre: "HELADO FRESA C-3.5 ONZ CAJA 24/1",        cantidad:  5 },
      { nombre: "HELADO CHOCOLATE C-3.5 ONZ CAJA 24/1",    cantidad:  5 },
      { nombre: "PALETA CHOCO CREMA 32/1",                 cantidad: 32 },
      { nombre: "HELADO VAINILLA C-3.5 ONZ CAJA 24/1",     cantidad:  5 },
      { nombre: "SANDWICH BON VAINILLA 24/1",              cantidad: 12 },
      { nombre: "PALETA CHOCO CHOCO 32/1",                 cantidad: 16 },
      { nombre: "PALETA CHOCO CREMA DON ALFONSO 32/1",     cantidad:  5 },
      { nombre: "PALETA NATURAL DE COCO 24/1",             cantidad: 12 },
      { nombre: "PALETA NATURAL DE FRESA 24/1",            cantidad: 12 },
      { nombre: "PALETA NATURAL DE CHINOLA 24/1",          cantidad: 10 },
    ],
  },
  {
    ficha: "118",
    nombre: "Rafael Martínez Durán",
    productos: [
      { nombre: "PALETA CHOCO MANI 32/1",                 cantidad: 17 },
      { nombre: "PALETA FUDGE BIZCOCHO 24/1",              cantidad: 24 },
      { nombre: "PALETA FUDGE CHOCOLATE 24/1",             cantidad: 23 },
      { nombre: "COPA BON DE FRESA 16/1",                  cantidad:  2 },
      { nombre: "PALETA CHINOLA CREMA 24/1",               cantidad:  8 },
      { nombre: "PALETA FRESA CREMA 24/1",                 cantidad:  9 },
      { nombre: "PALETA CHOCO C. DULCE DE LECHE 24/1",     cantidad:  5 },
      { nombre: "PALETAS BONICE 24/1",                     cantidad: 24 },
      { nombre: "HELADO FRESA C-3.5 ONZ CAJA 24/1",        cantidad:  5 },
      { nombre: "HELADO CHOCOLATE C-3.5 ONZ CAJA 24/1",    cantidad:  4 },
      { nombre: "PALETA CHOCO CREMA 32/1",                 cantidad: 32 },
      { nombre: "HELADO VAINILLA C-3.5 ONZ CAJA 24/1",     cantidad:  4 },
      { nombre: "COPA BON CHIPS DE CHOCOLATE 16/1",        cantidad:  1 },
      { nombre: "MORDISKO CLASICO 24/1",                   cantidad:  2 },
      { nombre: "SANDWICH BON VAINILLA 24/1",              cantidad:  9 },
      { nombre: "MAGNUM ALMENDRAS 25/1",                   cantidad:  2 },
      { nombre: "MAGNUM CLASICO 25/1",                     cantidad:  1 },
      { nombre: "PALETA CHOCO CHOCO 32/1",                 cantidad: 13 },
      { nombre: "HELADO DE VAINILLA 1 PINTA 6/1",          cantidad:  1 },
      { nombre: "PALETA DE FRAMBUESA 36/1",                cantidad: 10 },
      { nombre: "HELADO MERENGUE DE QUISQUEYA",            cantidad:  1 },
      { nombre: "PALETA DE AGUA MANZANA 36/1",             cantidad: 10 },
      { nombre: "PALETA DE AGUA CHERRY 36/1",              cantidad: 10 },
      { nombre: "PALETA DE UVA 36/1",                      cantidad: 10 },
      { nombre: "PALETA CHOCO CREMA DON ALFONSO 32/1",     cantidad:  4 },
      { nombre: "HELADO DON ALFONSO 1 PINTA 6/1",          cantidad:  1 },
      { nombre: "PALETA NATURAL DE COCO 24/1",             cantidad: 24 },
      { nombre: "PALETA NATURAL DE FRESA 24/1",            cantidad: 18 },
      { nombre: "PALETA NATURAL DE CHINOLA 24/1",          cantidad:  7 },
    ],
  },
  {
    ficha: "119",
    nombre: "Francisco de Jesús Franco Pimentel",
    productos: [
      { nombre: "HELADO FRESA C-3.5 ONZ CAJA 24/1",        cantidad:  1 },
      { nombre: "PALETA CHOCO MANI 32/1",                  cantidad: 30 },
      { nombre: "PALETA FUDGE BIZCOCHO 24/1",              cantidad: 24 },
      { nombre: "PALETA FUDGE CHOCOLATE 24/1",             cantidad: 24 },
      { nombre: "COPA BON DE FRESA 16/1",                  cantidad:  1 },
      { nombre: "PALETA CHINOLA CREMA 24/1",               cantidad: 10 },
      { nombre: "PALETA FRESA CREMA 24/1",                 cantidad: 10 },
      { nombre: "PALETA CHOCO C. DULCE DE LECHE 24/1",     cantidad:  4 },
      { nombre: "PALETAS BONICE 24/1",                     cantidad: 40 },
      { nombre: "HELADO CHOCOLATE C-3.5 ONZ CAJA 24/1",    cantidad:  3 },
      { nombre: "PALETA CHOCO CREMA 32/1",                 cantidad: 32 },
      { nombre: "HELADO VAINILLA C-3.5 ONZ CAJA 24/1",     cantidad:  5 },
      { nombre: "COPA BON CHIPS DE CHOCOLATE 16/1",        cantidad:  2 },
      { nombre: "MORDISKO CLASICO 24/1",                   cantidad:  2 },
      { nombre: "SANDWICH BON VAINILLA 24/1",              cantidad: 12 },
      { nombre: "MAGNUM ALMENDRAS 25/1",                   cantidad:  3 },
      { nombre: "PALETA CHOCO CHOCO 32/1",                 cantidad: 20 },
      { nombre: "HELADO DE VAINILLA 1 PINTA 6/1",          cantidad:  1 },
      { nombre: "HELADO DE RON PASA 1 PINTA 6/1",          cantidad:  1 },
      { nombre: "PALETA DE FRAMBUESA 36/1",                cantidad:  4 },
      { nombre: "PALETA DE AGUA MANZANA 36/1",             cantidad:  3 },
      { nombre: "PALETA DE AGUA CHERRY 36/1",              cantidad:  3 },
      { nombre: "PALETA DE UVA 36/1",                      cantidad:  3 },
      { nombre: "PALETA CHOCO CREMA DON ALFONSO 32/1",     cantidad:  2 },
      { nombre: "PALETA NATURAL DE COCO 24/1",             cantidad: 12 },
      { nombre: "PALETA NATURAL DE FRESA 24/1",            cantidad: 10 },
      { nombre: "PALETA NATURAL DE CHINOLA 24/1",          cantidad: 10 },
    ],
  },
  {
    ficha: "120",
    nombre: "Braimen Alexander Alcántara de la Cruz",
    productos: [
      { nombre: "PALETA CHOCO MANI 32/1",                 cantidad: 26 },
      { nombre: "PALETA FUDGE BIZCOCHO 24/1",              cantidad: 34 },
      { nombre: "PALETA CHINOLA CREMA 24/1",               cantidad:  6 },
      { nombre: "PALETA FRESA CREMA 24/1",                 cantidad:  6 },
      { nombre: "PALETA CHOCO C. DULCE DE LECHE 24/1",     cantidad: 55 },
      { nombre: "PALETAS BONICE 24/1",                     cantidad: 75 },
      { nombre: "HELADO FRESA C-3.5 ONZ CAJA 24/1",        cantidad:  4 },
      { nombre: "PALETA CHOCO CREMA 32/1",                 cantidad: 42 },
      { nombre: "HELADO VAINILLA C-3.5 ONZ CAJA 24/1",     cantidad:  5 },
      { nombre: "SANDWICH BON VAINILLA 24/1",              cantidad: 24 },
      { nombre: "PALETA CHOCO CHOCO 32/1",                 cantidad: 20 },
      { nombre: "PALETA CHOCO CREMA DON ALFONSO 32/1",     cantidad:  7 },
      { nombre: "PALETA NATURAL DE COCO 24/1",             cantidad: 30 },
      { nombre: "PALETA NATURAL DE FRESA 24/1",            cantidad: 15 },
      { nombre: "PALETA NATURAL DE CHINOLA 24/1",          cantidad: 10 },
    ],
  },
];

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log("\n🧊 Polar Breeze — Inventario base 18/05/2026\n");

  process.stdout.write("  🔑 Autenticando … ");
  const auth = await signIn("admin@polarbreeze.com", "polar2024");
  if (auth.error) { console.log(`❌  ${auth.error.message}`); process.exit(1); }
  console.log("✅");
  const { idToken } = auth;

  let totalMovimientos = 0;
  let sinUID = [];

  for (const chofer of INVENTARIOS) {
    const totalUnidades = chofer.productos.reduce((s, p) => s + p.cantidad, 0);
    process.stdout.write(`\n  👤 Ficha ${chofer.ficha} — ${chofer.nombre} (${totalUnidades} uds) … `);

    // Buscar UID en colección usuarios
    const queryRes = await runQuery({
      from: [{ collectionId: "usuarios" }],
      where: {
        fieldFilter: {
          field: { fieldPath: "ficha" },
          op: "EQUAL",
          value: str(chofer.ficha),
        },
      },
      limit: 1,
    }, idToken);

    let choferId = null;
    if (Array.isArray(queryRes) && queryRes[0]?.document) {
      choferId = queryRes[0].document.name.split("/").pop();
    }

    if (!choferId) {
      console.log(`⚠️  No encontrado — usando ficha_${chofer.ficha} como ID`);
      choferId = `ficha_${chofer.ficha}`;
      sinUID.push(chofer.ficha);
    } else {
      process.stdout.write(`UID: ${choferId.slice(0, 8)}… `);
    }

    // 1. Crear movimientos_loker — uno por producto
    for (const prod of chofer.productos) {
      await postDoc("movimientos_loker", {
        tipo:          str("entrada_consignacion_inicial"),
        producto_id:   str(toProductoId(prod.nombre)),
        nombre:        str(prod.nombre),
        cantidad:      int(prod.cantidad),   // positivo = entrada
        responsable:   str("Sistema (inventario base)"),
        choferId:      str(choferId),
        choferNombre:  str(chofer.nombre),
        timestamp:     ts(TIMESTAMP),
        notas:         str("Inventario base inicial — 18/05/2026"),
      }, idToken);
      totalMovimientos++;
    }

    // 2. Campo inventario_base en usuarios/{uid}
    const baseValues = chofer.productos.map((p) => ({
      mapValue: {
        fields: {
          nombre:      str(p.nombre),
          producto_id: str(toProductoId(p.nombre)),
          cantidad:    int(p.cantidad),
        },
      },
    }));

    const inventarioBaseField = { arrayValue: { values: baseValues } };

    // updateMask: solo toca estos dos campos — no sobreescribe role ni ningún otro campo
    await patchDoc(`usuarios/${choferId}`, {
      inventario_base:     inventarioBaseField,
      inventarioBaseDate:  ts(TIMESTAMP),
    }, idToken, ["inventario_base", "inventarioBaseDate"]);

    // 3. Campo inventario_base en drivers/{uid}
    await patchDoc(`drivers/${choferId}`, {
      nombre:              str(chofer.nombre),
      ficha:               str(chofer.ficha),
      activo:              bool(true),
      inventario_base:     inventarioBaseField,
      inventarioBaseDate:  ts(TIMESTAMP),
    }, idToken);

    console.log(`✅  ${chofer.productos.length} movimientos + base OK`);
  }

  const totalChoferes = INVENTARIOS.length;
  const totalUds = INVENTARIOS.reduce((s, c) => s + c.productos.reduce((ss, p) => ss + p.cantidad, 0), 0);

  console.log(`
────────────────────────────────────────────────────
✔  ${totalMovimientos} movimientos_loker creados (entrada_consignacion_inicial)
✔  ${totalChoferes} documentos usuarios + drivers actualizados
✔  Total unidades cargadas: ${totalUds.toLocaleString()}
✔  Fecha: ${TIMESTAMP}
${sinUID.length > 0 ? `\n⚠️  Sin UID real (usaron ID fallback): fichas ${sinUID.join(", ")}` : "✔  Todos los choferes encontrados en usuarios"}

   Resumen por chofer:
${INVENTARIOS.map(c => {
  const uds = c.productos.reduce((s, p) => s + p.cantidad, 0);
  return `   [${c.ficha}] ${c.nombre.padEnd(36)} ${String(uds).padStart(3)} uds  ${c.productos.length} productos`;
}).join("\n")}
────────────────────────────────────────────────────
`);
}

main().catch((e) => { console.error("❌", e.message); process.exit(1); });
