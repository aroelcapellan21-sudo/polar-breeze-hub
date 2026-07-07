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

La TABLA DE PRODUCTOS de estas facturas suele tener MUCHAS columnas parecidas — en este orden de izquierda a derecha: POS, Código (ITEM/PLU/COD.BARRA), Descripción, presentación (ej. CJ), cantidades (Sueltas / Und.Emp / Total U.), Precio Und. Sin ITBIS, % Descuentos (D1/D2), Precio Neto Und. Sin ITBIS, Royalties, ITBIS, y finalmente Valor Total Con ITBIS.
NO confundas estas columnas entre sí:
- "precioUnitario" = la columna "Precio Und. Sin ITBIS" (o "Precio Neto Und. Sin ITBIS" si son iguales) — el precio de UNA unidad, sin impuesto.
- "valorTotalConItbis" = SIEMPRE la ÚLTIMA columna de la tabla (la más a la derecha), el total de esa línea completa ya con impuesto incluido (cantidad × precio + ITBIS de esa línea). NUNCA debe ser igual al precio unitario — si te da el mismo número para ambos campos, releíste la columna equivocada.

Cuenta cuántas filas tiene la tabla de productos ANTES de responder, e incluye esa misma cantidad de elementos en "lineas" — verifica que el conteo coincida antes de dar tu respuesta final. Cada fila con cantidad, precio o total visibles es una línea aparte, aunque su código o descripción estén en blanco, tachados, o reemplazados por guiones/rayas/espacio en blanco (esto pasa cuando el proveedor no imprimió esos datos) — en ese caso igual agrégala como su propia línea con "codigo":"" y "descripcion":"". NUNCA combines dos filas en una ni omitas una fila solo porque le falten esos dos campos.

Para el RESUMEN DE TOTALES (Valor Bruto, Total Descuento, Subtotal Gravado, Subtotal Exento, Total ITBIS, Valor Total, Valor a Pagar): son cifras oficiales ya impresas en la factura — LÉELAS tal cual aparecen, no las calcules ni las derives a partir de las líneas.

Formato de números: el separador decimal es el símbolo (coma o punto) seguido de EXACTAMENTE 2 dígitos al final del número; cualquier otro separador antes de eso (seguido de grupos de 3 dígitos) es de miles. Ejemplos: "1,014.33" → 1014.33. "20.083,74" → 20083.74. Un mismo documento puede mezclar ambas convenciones en distintas columnas — identifica el separador decimal por su posición en cada número, no por una convención fija para todo el documento. Devuelve siempre números planos con punto decimal.

RESPONDE ÚNICAMENTE con JSON válido, sin texto adicional, sin explicaciones, sin bloques de código markdown. Tu respuesta debe empezar directo con { y terminar con }:
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
