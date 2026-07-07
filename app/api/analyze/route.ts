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

Extrae también el ENCABEZADO completo de la factura (parte superior e información general, no la tabla de productos): proveedor (nombre del vendedor, ej. "HELADOS BON, S.A."), RNC del proveedor, número de factura, NCF (Número de Comprobante Fiscal, ej. "E310000585685"), tipo de factura (ej. "Crédito Fiscal Electrónica"), fecha de emisión, fecha "válido hasta", condición de pago (ej. "CREDITO", "CONTADO"), fecha de vencimiento, vendedor, cliente (nombre o razón social del comprador), RNC del cliente, y dirección del cliente. Si algún campo no aparece en la factura, usa cadena vacía "".

El documento tiene DOS números de RNC distintos, en lugares distintos — no los confundas ni mezcles sus dígitos: el RNC DEL PROVEEDOR está arriba, junto al nombre y dirección del proveedor (ej. junto a "HELADOS BON, S.A."); el RNC DEL CLIENTE está más abajo, en el bloque que dice "RNC Cliente:". Ambos son números de 9 dígitos (con o sin guiones) — cópialos dígito por dígito directamente de donde aparecen impresos, nunca completes uno con dígitos del otro.

El NCF SIEMPRE empieza con una letra (ej. "E31...") y está impreso junto a la etiqueta "Factura de Crédito Fiscal Electrónica" en el encabezado. NO es el mismo número que las "Referencia" puramente numéricas (ej. "0033993241...") que aparecen en los talones de pago en la parte INFERIOR del documento — esas son referencias de pago/cobro, jamás el NCF, aunque compartan varios dígitos.

Las 3 fechas (emisión, válido hasta, vencimiento) están impresas como DD.MM.AAAA con el año completo de 4 dígitos — lee los 4 dígitos del año tal cual están impresos, dígito por dígito, sin asumir ni cambiar el año por otro que hayas visto en otra parte del documento. Conviértelas siempre a formato "YYYY-MM-DD" (ej. "17.06.2026" → "2026-06-17").

La TABLA DE PRODUCTOS de estas facturas suele tener MUCHAS columnas parecidas — en este orden de izquierda a derecha: POS, Código (ITEM/PLU/COD.BARRA), Descripción, presentación (ej. CJ), cantidades (Sueltas / Und.Emp / Total U.), Precio Und. Sin ITBIS, % Descuentos (D1/D2), Precio Neto Und. Sin ITBIS, Royalties, ITBIS, y finalmente Valor Total Con ITBIS.
NO confundas estas columnas entre sí:
- "precioUnitario" = la columna "Precio Und. Sin ITBIS" — el precio de UNA unidad, sin impuesto ni descuento.
- "descuentoD1"/"descuentoD2" = las dos columnas de % de descuento (D1/D2), casi siempre 0.
- "precioNetoUnitario" = la columna "Precio Neto Und. Sin ITBIS" (precio unitario ya con el descuento aplicado).
- "royalties" = la columna "Royalties" de esa línea.
- "itbis" = la columna "ITBIS" de esa línea (el impuesto de ESA línea, NO el total).
- "valorTotalConItbis" = SIEMPRE la ÚLTIMA columna de la tabla (la más a la derecha), el total de esa línea completa ya con impuesto incluido. NUNCA debe ser igual al precio unitario — si te da el mismo número para ambos campos, releíste la columna equivocada.

La primera columna (POS) numera las filas en orden secuencial 1, 2, 3... Úsala como ancla para no mezclar filas: para leer el código, la descripción, las cantidades y los montos de la fila N, sigue ÚNICAMENTE esa fila horizontalmente desde su número de POS. Es común que la foto esté inclinada y las columnas no se vean perfectamente alineadas verticalmente — en ese caso guíate por la fila (misma altura relativa dentro de cada columna, siguiendo el ángulo de inclinación), NUNCA por la columna vertical absoluta, o vas a terminar poniendo el código de una fila con la descripción o el precio de la fila de arriba o de abajo. Antes de responder, verifica que cada código de línea corresponda a la MISMA fila que su descripción y su precio.

Lee cada palabra de la descripción completa, letra por letra — no la adivines por sus primeras letras. Palabras y números parecidos son fáciles de confundir por el ángulo o la resolución de la foto (ej. "Choco" vs "Coco", "32/1" vs "24/1", "90ML" vs "80ML") — si tienes dudas, mira la palabra completa antes de transcribirla.

Cuenta cuántas filas tiene la tabla de productos ANTES de responder, e incluye esa misma cantidad de elementos en "lineas" — verifica que el conteo coincida antes de dar tu respuesta final. Cada fila con cantidad, precio o total visibles es una línea aparte, aunque su código o descripción estén en blanco, tachados, o reemplazados por guiones/rayas/espacio en blanco (esto pasa cuando el proveedor no imprimió esos datos) — en ese caso igual agrégala como su propia línea con "codigo":"" y "descripcion":"". NUNCA combines dos filas en una ni omitas una fila solo porque le falten esos dos campos.

Para el RESUMEN DE TOTALES (Valor Bruto, Total Descuento, Royalty Helado, Royalty Yogan, Subtotal Gravado, Subtotal Exento, Total ITBIS, Valor Total, Valor a Pagar): son cifras oficiales ya impresas en la factura — LÉELAS tal cual aparecen, no las calcules ni las derives a partir de las líneas.

Formato de números: el separador decimal es el símbolo (coma o punto) seguido de EXACTAMENTE 2 dígitos al final del número; cualquier otro separador antes de eso (seguido de grupos de 3 dígitos) es de miles. Ejemplos: "1,014.33" → 1014.33. "20.083,74" → 20083.74. Un mismo documento puede mezclar ambas convenciones en distintas columnas — identifica el separador decimal por su posición en cada número, no por una convención fija para todo el documento. Devuelve siempre números planos con punto decimal.

RESPONDE ÚNICAMENTE con JSON válido, sin texto adicional, sin explicaciones, sin bloques de código markdown. Tu respuesta debe empezar directo con { y terminar con }:
{
  "proveedor": "", "rncProveedor": "", "numeroFactura": "", "ncf": "", "tipoFactura": "",
  "fecha": "", "validoHasta": "", "condicionPago": "", "fechaVencimiento": "",
  "vendedor": "", "cliente": "", "rncCliente": "", "direccionCliente": "",
  "lineas": [
    { "codigo": "", "descripcion": "", "cantidad": 0, "precioUnitario": 0,
      "descuentoD1": 0, "descuentoD2": 0, "precioNetoUnitario": 0, "royalties": 0, "itbis": 0,
      "valorTotalConItbis": 0 }
  ],
  "totales_factura": {
    "valorBruto": 0, "totalDescuento": 0, "royaltyHelado": 0, "royaltyYogan": 0,
    "subtotalGravado": 0, "subtotalExento": 0, "totalItbis": 0, "valorTotal": 0, "valorAPagar": 0
  }
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
