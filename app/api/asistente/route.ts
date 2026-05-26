/**
 * POST /api/asistente
 *
 * Asistente conversacional Gemini para el personal de Polar Breeze.
 * Usa Gemini Flash (Google AI Studio — gratis).
 *
 * Body: { mensaje: string; rol: "encargado" | "despachador"; contexto?: string; historial?: { role: "user"|"model"; text: string }[] }
 * Responde: { respuesta: string }
 */

import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

const GEMINI_KEY   = process.env.GEMINI_API_KEY ?? "";
const GEMINI_MODEL = "gemini-2.0-flash";
const GEMINI_URL   = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_KEY}`;

// ─── System prompts por rol ───────────────────────────────────────────────────

const SYSTEM: Record<string, string> = {
  encargado: `Eres el asistente inteligente de Polar Breeze, S.R.L., una distribuidora de helados en Santiago, República Dominicana.
Trabajas junto al Encargado de almacén, ayudándole con:
- Información de stock del loker (productos, saldos, lotes recibidos)
- Estado de los choferes (quién reportó, quién falta, sobrantes)
- Alertas de inventario y anomalías detectadas
- Cálculo de puntos y comisiones de la quincena
- Responder preguntas operativas del día

REGLAS:
- Responde en español dominicano, informal pero profesional.
- Sé breve y directo. Máximo 3-4 oraciones por respuesta.
- Si no tienes el dato exacto, di qué información necesitarías.
- Usa RD$ para montos. Usa números simples (no comas en miles salvo para claridad).
- Emojis permitidos: solo al inicio de respuesta, uno máximo.`,

  despachador: `Eres el asistente inteligente de Polar Breeze, S.R.L., una distribuidora de helados en Santiago, República Dominicana.
Trabajas junto al Despachador, ayudándole con:
- Gestión del proceso de despacho diario
- Estado de los choferes (retiros, facturas, cierre del día)
- Escaneo de productos (SPIKINSCAN, FACTURASCAN)
- Inventario del Cuarto Frío
- Alertas de peso y diferencias detectadas

REGLAS:
- Responde en español dominicano, informal pero profesional.
- Sé breve y directo. Máximo 3-4 oraciones por respuesta.
- Si no tienes el dato exacto, di qué información necesitarías.
- Usa RD$ para montos.
- Emojis permitidos: solo al inicio de respuesta, uno máximo.`,

  admin: `Eres el asistente inteligente de Polar Breeze, S.R.L., una distribuidora de helados en Santiago, República Dominicana.
Trabajas junto al administrador (Oliver), ayudándole con análisis del negocio, anomalías detectadas, rendimiento de choferes y métricas del Hub Admin.

REGLAS:
- Responde en español dominicano, formal y analítico.
- Máximo 4-5 oraciones por respuesta.
- Usa RD$ para montos. Cita datos específicos cuando estén disponibles.
- Emojis permitidos: solo al inicio, uno máximo.`,
};

// ─── Tipos ────────────────────────────────────────────────────────────────────

interface MensajeHistorial {
  role: "user" | "model";
  text: string;
}

interface GeminiPart    { text: string }
interface GeminiContent { role: "user" | "model"; parts: GeminiPart[] }

// ─── Handler ─────────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as {
      mensaje:    string;
      rol?:       string;
      contexto?:  string;
      historial?: MensajeHistorial[];
    };

    if (!body.mensaje?.trim()) {
      return NextResponse.json({ error: "Mensaje vacío" }, { status: 400 });
    }

    if (!GEMINI_KEY) {
      return NextResponse.json(
        { respuesta: "El asistente no está configurado aún (falta GEMINI_API_KEY). Contacta al administrador." },
        { status: 200 }
      );
    }

    const rol       = body.rol ?? "encargado";
    const systemTxt = SYSTEM[rol] ?? SYSTEM.encargado;
    const contexto  = body.contexto?.trim() ?? "";
    const historial = body.historial ?? [];

    // ── Construir conversación para Gemini ────────────────────────────────
    const contents: GeminiContent[] = [];

    // Primer mensaje de usuario = system prompt + contexto (Gemini no tiene rol "system" en REST)
    const systemMsg = contexto
      ? `${systemTxt}\n\nCONTEXTO ACTUAL DEL SISTEMA:\n${contexto}`
      : systemTxt;

    // Si no hay historial, inyectamos el system como primer turno user + ack model
    if (historial.length === 0) {
      contents.push({ role: "user",  parts: [{ text: systemMsg + "\n\n---\n(Sistema inicializado. Listo para responder.)" }] });
      contents.push({ role: "model", parts: [{ text: "Entendido. ¿En qué te puedo ayudar?" }] });
    } else {
      // Con historial previo, usamos el systemMsg solo la primera vez
      contents.push({ role: "user",  parts: [{ text: systemMsg + "\n\n---\n(Sistema inicializado. Listo para responder.)" }] });
      contents.push({ role: "model", parts: [{ text: "Entendido. ¿En qué te puedo ayudar?" }] });
      // Historial previo (máx últimos 10 turnos para no exceder tokens)
      historial.slice(-10).forEach((m) => {
        contents.push({ role: m.role, parts: [{ text: m.text }] });
      });
    }

    // Mensaje actual del usuario
    contents.push({ role: "user", parts: [{ text: body.mensaje.trim() }] });

    // ── Llamada a Gemini ──────────────────────────────────────────────────
    const geminiRes = await fetch(GEMINI_URL, {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({
        contents,
        generationConfig: {
          maxOutputTokens: 512,
          temperature:     0.7,
          topP:            0.9,
        },
        safetySettings: [
          { category: "HARM_CATEGORY_HARASSMENT",        threshold: "BLOCK_NONE" },
          { category: "HARM_CATEGORY_HATE_SPEECH",       threshold: "BLOCK_NONE" },
          { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_NONE" },
          { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_NONE" },
        ],
      }),
      signal: AbortSignal.timeout(25000),
    });

    if (!geminiRes.ok) {
      const errText = await geminiRes.text().catch(() => "");
      console.error("[asistente] Gemini error:", geminiRes.status, errText.slice(0, 200));
      return NextResponse.json(
        { respuesta: "No pude conectar con el asistente. Intenta de nuevo en un momento." },
        { status: 200 }
      );
    }

    const geminiData = await geminiRes.json() as {
      candidates?: { content?: { parts?: GeminiPart[] } }[];
      error?: { message?: string };
    };

    const respuesta =
      geminiData.candidates?.[0]?.content?.parts?.[0]?.text?.trim() ??
      "No recibí respuesta del asistente. Inténtalo de nuevo.";

    return NextResponse.json({ respuesta });

  } catch (e: unknown) {
    console.error("[asistente] Error:", e);
    return NextResponse.json(
      { respuesta: "Error interno del asistente. Inténtalo de nuevo." },
      { status: 200 }
    );
  }
}
