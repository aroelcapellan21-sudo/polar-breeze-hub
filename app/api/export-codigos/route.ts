/**
 * GET /api/export-codigos
 *
 * Exporta la colección `codigos_cajas` de Firestore como archivo CSV.
 * No requiere Admin SDK — usa la REST API pública de Firestore con la API Key.
 */

import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

interface FirestoreDoc {
  name: string;
  fields: Record<string, {
    stringValue?: string;
    integerValue?: string;
    doubleValue?: number;
    booleanValue?: boolean;
    nullValue?: string;
  }>;
}

interface FirestoreListResponse {
  documents?: FirestoreDoc[];
  nextPageToken?: string;
}

function getField(fields: FirestoreDoc["fields"], key: string): string {
  const f = fields[key];
  if (!f) return "";
  if (f.stringValue  !== undefined) return f.stringValue;
  if (f.integerValue !== undefined) return f.integerValue;
  if (f.doubleValue  !== undefined) return String(f.doubleValue);
  if (f.booleanValue !== undefined) return f.booleanValue ? "true" : "false";
  return "";
}

export async function GET() {
  const apiKey    = process.env.NEXT_PUBLIC_FIREBASE_API_KEY;
  const projectId = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;

  if (!apiKey || !projectId) {
    return new NextResponse("Firebase no configurado", { status: 503 });
  }

  try {
    const url = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/codigos_cajas?key=${apiKey}&pageSize=500`;
    const res = await fetch(url, { signal: AbortSignal.timeout(10000) });

    if (!res.ok) {
      return new NextResponse(`Error Firestore: ${res.status}`, { status: 502 });
    }

    const data = await res.json() as FirestoreListResponse;
    const docs  = data.documents ?? [];

    // Construir CSV
    const header = ["codigo", "producto", "unidades_por_caja", "peso_caja_kg", "creado_por"].join(",");
    const rows   = docs.map((d) => {
      const f = d.fields ?? {};
      const cols = [
        getField(f, "codigo"),
        getField(f, "producto"),
        getField(f, "unidadesPorCaja"),
        getField(f, "pesoCajaKg"),
        getField(f, "creadoPor"),
      ].map((v) => `"${v.replace(/"/g, '""')}"`);
      return cols.join(",");
    });

    const csv  = [header, ...rows].join("\n");
    const date = new Date().toISOString().slice(0, 10);

    return new NextResponse(csv, {
      status: 200,
      headers: {
        "Content-Type":        "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="codigos_cajas_${date}.csv"`,
        "Cache-Control":       "no-store",
      },
    });
  } catch (e) {
    return new NextResponse(String(e), { status: 500 });
  }
}
