/**
 * /api/registrar-producto-nuevo — Agrega un producto nuevo a config/precios
 * desde el flujo de "no reconocido" de Registro de Lote (Encargado).
 *
 * config/precios solo lo puede escribir `admin` (firestore.rules, catch-all
 * `allow write: if esAdmin()`). El Encargado no tiene permiso directo, así
 * que esto se resuelve server-side con el service account (mismo patrón
 * JWT+REST que /api/admin-reset-user-password y /api/verify-reset-password,
 * sin firebase-admin):
 *   1. Se verifica el idToken de quien llama (Identity Toolkit lookup).
 *   2. Se confirma en Firestore que ese uid es role=admin o role=encargado.
 *   3. Recién ahí se usa el token del service account para leer
 *      config/precios.productos, agregar el producto nuevo, y reescribirlo.
 */
import { NextRequest, NextResponse } from "next/server";
import { toProductoId } from "@/lib/types";

export const runtime = "nodejs";

// ─── Rate limiter (in-memory, best-effort en serverless) — mismo patrón que los demás endpoints ───
const _attempts = new Map<string, { count: number; resetAt: number }>();
const RATE_LIMIT  = 10;
const RATE_WINDOW = 60_000;

function checkRate(ip: string): boolean {
  const now = Date.now();
  const e   = _attempts.get(ip);
  if (!e || now > e.resetAt) { _attempts.set(ip, { count: 1, resetAt: now + RATE_WINDOW }); return true; }
  if (e.count >= RATE_LIMIT) return false;
  e.count++;
  return true;
}

const FS_URL   = "https://firestore.googleapis.com/v1/projects/polar-breeze/databases/(default)/documents";
const AUTH_URL = "https://identitytoolkit.googleapis.com/v1/accounts";
const API_KEY  = process.env.NEXT_PUBLIC_FIREBASE_API_KEY!;

// ─── JWT RS256 via Web Crypto (mismo patrón que los demás endpoints privilegiados) ───
function b64url(buf: ArrayBuffer): string {
  return Buffer.from(buf).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function b64urlStr(s: string): string {
  return Buffer.from(s).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function importPrivateKey(pem: string): Promise<CryptoKey> {
  const b64 = pem
    .replace(/\\n/g, "\n")
    .replace(/-----BEGIN PRIVATE KEY-----/g, "")
    .replace(/-----END PRIVATE KEY-----/g, "")
    .replace(/\s+/g, "");
  const der = Buffer.from(b64, "base64");
  return crypto.subtle.importKey(
    "pkcs8", der,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false, ["sign"],
  );
}

async function getServiceAccountToken(): Promise<string | null> {
  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const pem   = process.env.GOOGLE_PRIVATE_KEY;
  if (!email || !pem) return null;

  const now     = Math.floor(Date.now() / 1000);
  const header  = b64urlStr(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const payload = b64urlStr(JSON.stringify({
    iss: email,
    scope: "https://www.googleapis.com/auth/datastore",
    aud: "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600,
  }));
  const key    = await importPrivateKey(pem);
  const sigBuf = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, Buffer.from(`${header}.${payload}`));
  const jwt    = `${header}.${payload}.${b64url(sigBuf)}`;

  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: jwt }),
  });
  const d = await r.json() as { access_token?: string; error?: string };
  return d.access_token ?? null;
}

/** Resuelve el uid del idToken de quien llama (endpoint público de Identity Toolkit). */
async function lookupUidFromIdToken(idToken: string): Promise<string | null> {
  const r = await fetch(`${AUTH_URL}:lookup?key=${API_KEY}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ idToken }),
  });
  if (!r.ok) return null;
  const d = await r.json() as { users?: { localId?: string }[] };
  return d.users?.[0]?.localId ?? null;
}

/** Confirma en Firestore (service account, bypassa reglas) el role del uid. */
async function rolDe(uid: string, saToken: string): Promise<string | null> {
  const r = await fetch(`${FS_URL}/usuarios/${uid}`, { headers: { Authorization: `Bearer ${saToken}` } });
  if (!r.ok) return null;
  const d = await r.json() as { fields?: { role?: { stringValue?: string } } };
  return d.fields?.role?.stringValue ?? null;
}

interface PrecioProductoDoc { codigo: number; nombre: string; producto_id: string; precio: number; moneda: string }

/** Lee config/precios y devuelve el array `productos` ya parseado a objetos JS. */
async function leerCatalogoPrecios(saToken: string): Promise<PrecioProductoDoc[]> {
  const r = await fetch(`${FS_URL}/config/precios`, { headers: { Authorization: `Bearer ${saToken}` } });
  if (!r.ok) return [];
  const d = await r.json() as { fields?: { productos?: { arrayValue?: { values?: unknown[] } } } };
  const values = d.fields?.productos?.arrayValue?.values ?? [];
  return (values as { mapValue: { fields: Record<string, { stringValue?: string; integerValue?: string; doubleValue?: number }> } }[])
    .map((v) => {
      const f = v.mapValue.fields;
      return {
        codigo:      Number(f.codigo?.integerValue ?? f.codigo?.doubleValue ?? 0),
        nombre:      f.nombre?.stringValue ?? "",
        producto_id: f.producto_id?.stringValue ?? "",
        precio:      Number(f.precio?.integerValue ?? f.precio?.doubleValue ?? 0),
        moneda:      f.moneda?.stringValue ?? "RD$",
      };
    });
}

/** Escribe el array `productos` completo de vuelta en config/precios (solo ese campo). */
async function escribirCatalogoPrecios(saToken: string, productos: PrecioProductoDoc[]): Promise<string | null> {
  const toNum  = (n: number) => Number.isInteger(n) ? { integerValue: String(n) } : { doubleValue: n };
  const values = productos.map((p) => ({
    mapValue: {
      fields: {
        codigo:      toNum(p.codigo),
        nombre:      { stringValue: p.nombre },
        producto_id: { stringValue: p.producto_id },
        precio:      toNum(p.precio),
        moneda:      { stringValue: p.moneda },
      },
    },
  }));
  const r = await fetch(`${FS_URL}/config/precios?updateMask.fieldPaths=productos`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${saToken}` },
    body: JSON.stringify({ fields: { productos: { arrayValue: { values } } } }),
  });
  return r.ok ? null : await r.text();
}

export async function POST(req: NextRequest) {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  if (!checkRate(ip)) {
    return NextResponse.json({ error: "Demasiados intentos. Intenta más tarde." }, { status: 429 });
  }

  const body = await req.json().catch(() => null) as
    { idToken?: string; codigo?: number; nombre?: string; precio?: number } | null;
  const { idToken, codigo, nombre, precio } = body ?? {};

  if (!idToken || !nombre?.trim() || codigo == null || precio == null) {
    return NextResponse.json({ error: "Faltan datos: idToken, codigo, nombre y precio son obligatorios." }, { status: 400 });
  }
  if (!Number.isFinite(codigo) || codigo <= 0) {
    return NextResponse.json({ error: "El código debe ser un número positivo." }, { status: 400 });
  }
  if (!Number.isFinite(precio) || precio < 0) {
    return NextResponse.json({ error: "El precio debe ser un número válido." }, { status: 400 });
  }

  const callerUid = await lookupUidFromIdToken(idToken);
  if (!callerUid) {
    return NextResponse.json({ error: "Sesión inválida." }, { status: 401 });
  }

  const saToken = await getServiceAccountToken();
  if (!saToken) {
    return NextResponse.json({ error: "Config del servidor incompleta." }, { status: 500 });
  }

  const rol = await rolDe(callerUid, saToken);
  if (rol !== "admin" && rol !== "encargado" && rol !== "despachador") {
    return NextResponse.json({ error: "Solo Admin, Encargado o Despachador pueden registrar productos nuevos." }, { status: 403 });
  }

  const producto_id = toProductoId(nombre);
  const catalogo = await leerCatalogoPrecios(saToken);

  if (catalogo.some((p) => p.producto_id === producto_id)) {
    return NextResponse.json({ error: `Ya existe un producto con ese nombre (producto_id="${producto_id}").` }, { status: 409 });
  }
  if (catalogo.some((p) => p.codigo === codigo)) {
    return NextResponse.json({ error: `El código ${codigo} ya está en uso por otro producto.` }, { status: 409 });
  }

  const nuevo: PrecioProductoDoc = { codigo, nombre: nombre.trim(), producto_id, precio, moneda: "RD$" };
  const catalogoActualizado = [...catalogo, nuevo];

  const err = await escribirCatalogoPrecios(saToken, catalogoActualizado);
  if (err) return NextResponse.json({ error: "Error al escribir en Firestore.", detail: err }, { status: 500 });

  return NextResponse.json({ ok: true, producto: nuevo, catalogo: catalogoActualizado });
}
