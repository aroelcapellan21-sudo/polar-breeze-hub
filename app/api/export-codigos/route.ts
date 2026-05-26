/**
 * GET /api/export-codigos
 *
 * Exporta la colección codigos_cajas como CSV.
 * Usado como fallback cuando Google Sheets no está configurado,
 * o para importación manual al spreadsheet.
 *
 * Columnas: codigo, producto, unidades_por_caja, peso_caja_kg, creado_por, creado_en
 */

import { NextResponse } from "next/server";
import { initializeApp, getApps, cert } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

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

function escapeCSV(v: unknown): string {
  const s = String(v ?? "");
  if (s.includes(",") || s.includes('"') || s.includes("\n")) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

export async function GET() {
  try {
    getAdmin();
    const db   = getFirestore();
    const snap = await db.collection("codigos_cajas").get();

    const header = ["codigo", "producto", "unidades_por_caja", "peso_caja_kg", "creado_por", "creado_en"];
    const rows   = snap.docs.map((d) => {
      const data = d.data();
      const ts   = data.creadoEn?._seconds
        ? new Date(data.creadoEn._seconds * 1000).toISOString()
        : "";
      return [
        d.id,
        data.producto ?? "",
        data.unidadesPorCaja ?? "",
        data.pesoCajaKg ?? "",
        data.creadoPor ?? "",
        ts,
      ].map(escapeCSV).join(",");
    });

    const csv = [header.join(","), ...rows].join("\n");
    const fecha = new Date().toISOString().slice(0, 10);

    return new NextResponse(csv, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="codigos_cajas_${fecha}.csv"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
