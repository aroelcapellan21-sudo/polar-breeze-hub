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

  factura_proveedor: `Eres un asistente que lee facturas fiscales de proveedores de helados en República Dominicana (ej. Helados Bon).
La factura tiene una TABLA DE PRODUCTOS con columnas como Código / Descripción / Cantidad / Precio Unitario / Valor Total con ITBIS, y al final un RESUMEN DE TOTALES separado con campos como Valor Bruto, Total Descuento, Subtotal Gravado, Subtotal Exento, Total ITBIS, Valor Total y Valor a Pagar.
Extrae AMBOS niveles por separado. IMPORTANTE: incluye TODAS las filas de la tabla de productos, incluso si el código o la descripción vienen en blanco — nunca omitas una fila que tenga cantidad, precio o total visibles.

RESPONDE ÚNICAMENTE con JSON válido, sin texto adicional:
{
  "lineas": [
    { "codigo": "", "descripcion": "", "cantidad": 0, "precioUnitario": 0, "valorTotalConItbis": 0 }
  ],
  "totales_factura": {
    "valorBruto": 0, "totalDescuento": 0, "subtotalGravado": 0, "subtotalExento": 0,
    "totalItbis": 0, "valorTotal": 0, "valorAPagar": 0
  },
  "proveedor": "",
  "numeroFactura": ""
}`,
};

function extractJSON(text: string): unknown {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) throw new Error("La IA no devolvió JSON válido");
  return JSON.parse(match[0]);
}

async function notifyTelegram(message: string) {
  try {
    const token   = process.env.TELEGRAM_BOT_TOKEN;
    const chatIds = (process.env.TELEGRAM_CHAT_IDS ?? process.env.TELEGRAM_CHAT_ID ?? "")
      .split(",").map(s => s.trim()).filter(Boolean);
    if (!token || chatIds.length === 0) return;
    const text = `🚨 *Polar Breeze Hub — API Anthropic*\n\`\`\`\n${message.slice(0, 500)}\n\`\`\`\n_${new Date().toLocaleString("es-MX")}_`;
    await Promise.all(chatIds.map(chatId =>
      fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: chatId, text, parse_mode: "Markdown" }),
      })
    ));
  } catch { /* silent */ }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as {
      tipo: "cuarto_frio" | "factura" | "factura_proveedor";
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
    await notifyTelegram(`/api/analyze falló: ${msg}`);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
