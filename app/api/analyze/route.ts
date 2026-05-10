import Anthropic from "@anthropic-ai/sdk";
import type { Base64ImageSource } from "@anthropic-ai/sdk/resources/messages";
import { NextRequest, NextResponse } from "next/server";

const client = new Anthropic(); // usa ANTHROPIC_API_KEY del entorno

const PROMPTS = {
  cuarto_frio: `Eres un asistente especializado en inventario de distribuidoras de alimentos refrigerados.
Analiza la imagen o texto del inventario de cuarto frío.
Extrae TODOS los productos con sus cantidades exactas.

RESPONDE ÚNICAMENTE con JSON válido, sin texto adicional:
{
  "productos": [
    { "nombre": "nombre del producto", "cantidad": 0, "unidad": "cajas|bultos|piezas|kg", "peso": null }
  ],
  "observaciones": ""
}`,

  factura: `Eres un asistente especializado en logística y distribución de alimentos.
Analiza esta factura o lista de entrega de un chofer.
Extrae los productos entregados con sus cantidades y precios si son visibles.

RESPONDE ÚNICAMENTE con JSON válido, sin texto adicional:
{
  "productos": [
    { "nombre": "nombre del producto", "cantidad": 0, "unidad": "cajas|piezas|kg", "precio": null }
  ],
  "cliente": "",
  "total": null,
  "observaciones": ""
}`,
};

function extractJSON(text: string): unknown {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) throw new Error("La IA no devolvió JSON válido");
  return JSON.parse(match[0]);
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as {
      tipo: "cuarto_frio" | "factura";
      imageBase64?: string;
      mimeType?: string;
      texto?: string;
    };

    const { tipo, imageBase64, mimeType, texto } = body;
    const prompt = PROMPTS[tipo] ?? PROMPTS.factura;

    const content: Anthropic.MessageParam["content"] = [];

    if (imageBase64 && mimeType) {
      const allowedTypes: Base64ImageSource["media_type"][] = ["image/jpeg","image/png","image/gif","image/webp"];
      const media_type: Base64ImageSource["media_type"] = allowedTypes.includes(mimeType as Base64ImageSource["media_type"])
        ? (mimeType as Base64ImageSource["media_type"])
        : "image/jpeg";
      content.push({
        type: "image",
        source: { type: "base64", media_type, data: imageBase64 },
      });
      content.push({ type: "text", text: prompt });
    } else {
      content.push({
        type: "text",
        text: `${prompt}\n\nTexto a analizar:\n${texto ?? ""}`,
      });
    }

    const response = await client.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 4096,
      messages: [{ role: "user", content }],
    });

    const raw = response.content[0].type === "text" ? response.content[0].text : "";
    const parsed = extractJSON(raw);

    return NextResponse.json(parsed);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Error desconocido";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
