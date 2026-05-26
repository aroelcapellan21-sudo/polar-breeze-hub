/**
 * POST /api/sync-sheets
 *
 * Sincroniza datos con Google Sheets.
 *
 * Requiere variable de entorno GOOGLE_SHEETS_ID configurada en Vercel.
 * Si no está configurada devuelve 404 para que el cliente muestre
 * el estado "no configurado" sin error.
 *
 * Implementación futura: usa Google Sheets API v4 con service account
 * para escribir lotes, movimientos y códigos al spreadsheet.
 */

import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function POST() {
  const sheetsId = process.env.GOOGLE_SHEETS_ID;

  // Si no está configurado, devolver 404 para que el cliente lo maneje
  if (!sheetsId) {
    return new NextResponse("Google Sheets no configurado", { status: 404 });
  }

  // TODO: implementar sync real con Google Sheets API v4
  // 1. Autenticar con service account (GOOGLE_SERVICE_ACCOUNT_KEY)
  // 2. Leer lotes_loker, movimientos_loker, codigos_cajas de Firestore
  // 3. Escribir en las hojas correspondientes del spreadsheet GOOGLE_SHEETS_ID
  // 4. Registrar timestamp del último sync en config/sync_sheets

  return NextResponse.json({
    ok:       true,
    message:  "Sync completado (placeholder)",
    sheetsId: sheetsId.slice(0, 8) + "…",
    syncedAt: new Date().toISOString(),
  });
}
