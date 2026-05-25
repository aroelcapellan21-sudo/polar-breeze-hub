/**
 * POST /api/sync-sheets
 *
 * Sincroniza codigos_cajas de Firestore → Google Sheets.
 * Requiere variables de entorno:
 *   GOOGLE_SHEETS_ID               — ID del spreadsheet
 *   GOOGLE_SERVICE_ACCOUNT_EMAIL   — email de la cuenta de servicio
 *   GOOGLE_PRIVATE_KEY             — clave privada (con \n escapados)
 *   FIREBASE_ADMIN_PROJECT_ID (o NEXT_PUBLIC_FIREBASE_PROJECT_ID)
 *   FIREBASE_ADMIN_CLIENT_EMAIL
 *   FIREBASE_ADMIN_PRIVATE_KEY
 *
 * Hoja objetivo: CODIGOS_CAJAS (se crea si no existe)
 * Columnas: Código | Producto | Unids/Caja | Peso(kg) | CreadoPor | CreadoEn
 *
 * GET /api/sync-sheets — devuelve el estado de configuración.
 */

import { NextRequest, NextResponse } from "next/server";
import { google } from "googleapis";
import { initializeApp, getApps, cert } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

const SHEET_NAME = "CODIGOS_CAJAS";
const HEADERS    = ["Código", "Producto", "Unids/Caja", "Peso(kg)", "CreadoPor", "CreadoEn"];

function getAdmin() {
  if (getApps().length > 0) return getApps()[0];
  return initializeApp({
    credential: cert({
      projectId:   process.env.FIREBASE_ADMIN_PROJECT_ID ?? process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_ADMIN_CLIENT_EMAIL,
      privateKey:  (process.env.FIREBASE_ADMIN_PRIVATE_KEY ?? "").replace(/\\n/g, "\n"),
    }),
  });
}

function getSheetsClient() {
  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const key   = (process.env.GOOGLE_PRIVATE_KEY ?? "").replace(/\\n/g, "\n");
  if (!email || !key) return null;

  const auth = new google.auth.GoogleAuth({
    credentials: { client_email: email, private_key: key },
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });
  return google.sheets({ version: "v4", auth });
}

export async function GET() {
  const sheetsId = process.env.GOOGLE_SHEETS_ID;
  const email    = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const key      = process.env.GOOGLE_PRIVATE_KEY;

  return NextResponse.json({
    configurado: !!(sheetsId && email && key),
    sheetsId:    sheetsId ? `${sheetsId.slice(0, 8)}…` : null,
    mensaje: !sheetsId || !email || !key
      ? "Configura GOOGLE_SHEETS_ID, GOOGLE_SERVICE_ACCOUNT_EMAIL y GOOGLE_PRIVATE_KEY en Vercel."
      : "Listo para sincronizar.",
  });
}

export async function POST(req: NextRequest) {
  // Autenticación básica con Bearer token (clave del admin en Vercel)
  const auth = req.headers.get("Authorization") ?? "";
  const expectedToken = process.env.ADMIN_API_KEY ?? "";
  if (expectedToken && auth !== `Bearer ${expectedToken}`) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }

  const sheetsId = process.env.GOOGLE_SHEETS_ID;
  if (!sheetsId) {
    return NextResponse.json({ error: "GOOGLE_SHEETS_ID no configurado" }, { status: 503 });
  }

  const sheets = getSheetsClient();
  if (!sheets) {
    return NextResponse.json({ error: "Credenciales de Google Sheets no configuradas" }, { status: 503 });
  }

  try {
    // 1. Leer codigos_cajas de Firestore
    getAdmin();
    const db   = getFirestore();
    const snap = await db.collection("codigos_cajas").get();

    const rows: string[][] = [HEADERS];
    snap.docs.forEach((d) => {
      const data = d.data();
      const ts   = data.creadoEn?._seconds
        ? new Date(data.creadoEn._seconds * 1000).toLocaleDateString("es-DO")
        : "";
      rows.push([
        d.id,
        String(data.producto ?? ""),
        String(data.unidadesPorCaja ?? ""),
        String(data.pesoCajaKg ?? ""),
        String(data.creadoPor ?? ""),
        ts,
      ]);
    });

    // 2. Verificar/crear hoja CODIGOS_CAJAS en el spreadsheet
    const meta = await sheets.spreadsheets.get({ spreadsheetId: sheetsId });
    const sheetsList = meta.data.sheets ?? [];
    const existingSheet = sheetsList.find((s) => s.properties?.title === SHEET_NAME);

    if (!existingSheet) {
      await sheets.spreadsheets.batchUpdate({
        spreadsheetId: sheetsId,
        requestBody: {
          requests: [{ addSheet: { properties: { title: SHEET_NAME } } }],
        },
      });
    }

    // 3. Limpiar y escribir
    await sheets.spreadsheets.values.clear({
      spreadsheetId: sheetsId,
      range: `${SHEET_NAME}!A:Z`,
    });

    await sheets.spreadsheets.values.update({
      spreadsheetId: sheetsId,
      range:         `${SHEET_NAME}!A1`,
      valueInputOption: "RAW",
      requestBody: { values: rows },
    });

    return NextResponse.json({
      ok:      true,
      filas:   rows.length - 1,
      mensaje: `${rows.length - 1} códigos sincronizados con Google Sheets.`,
      url:     `https://docs.google.com/spreadsheets/d/${sheetsId}`,
    });

  } catch (err) {
    const msg = err instanceof Error ? err.message : "Error desconocido";
    console.error("[sync-sheets]", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
