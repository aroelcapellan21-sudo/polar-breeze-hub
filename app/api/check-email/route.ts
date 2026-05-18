import { NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";

const FS_URL    = `https://firestore.googleapis.com/v1/projects/polar-breeze/databases/(default)/documents`;
const AUTH_URL  = "https://identitytoolkit.googleapis.com/v1/accounts";
const API_KEY   = process.env.NEXT_PUBLIC_FIREBASE_API_KEY!;
const AI_CLIENT = new Anthropic();

async function getAdminToken(): Promise<string | null> {
  const r = await fetch(`${AUTH_URL}:signInWithPassword?key=${API_KEY}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      email: "admin@polarbreeze.com",
      password: process.env.ADMIN_PASSWORD ?? "polar2024",
      returnSecureToken: true,
    }),
  });
  const data = await r.json();
  return data.idToken ?? null;
}

async function getConfig(idToken: string) {
  const r = await fetch(`${FS_URL}/config/main`, {
    headers: { Authorization: `Bearer ${idToken}` },
  });
  const doc = await r.json();
  const fields = doc.fields ?? {};
  return {
    correoMonitoreo: fields.correoMonitoreo?.stringValue ?? "",
    correoPassword:  fields.correoPassword?.stringValue  ?? "",
  };
}

export async function POST() {
  try {
    const idToken = await getAdminToken();
    if (!idToken) return NextResponse.json({ error: "Sin autenticación admin" }, { status: 401 });

    const { correoMonitoreo, correoPassword } = await getConfig(idToken);
    if (!correoMonitoreo) {
      return NextResponse.json({
        error: "No hay correo configurado. Ve a Admin → Configuración → Correo.",
      }, { status: 400 });
    }

    // Verificar si imapflow está disponible (instalarlo: npm install imapflow)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let ImapMod: any = null;
    try {
      const mod = "imapflow";
      ImapMod = await import(/* webpackIgnore: true */ /* @vite-ignore */ mod);
    } catch {
      return NextResponse.json({
        message: `Correo configurado: ${correoMonitoreo}. Instala 'imapflow' (npm install imapflow) para activar la lectura automática de facturas.`,
        correo: correoMonitoreo,
        estado: "sin_libreria",
      });
    }

    // Conectar a Gmail via IMAP
    const client = new ImapMod.ImapFlow({
      host: "imap.gmail.com",
      port: 993,
      secure: true,
      auth: { user: correoMonitoreo, pass: correoPassword },
      logger: false,
    });

    await client.connect();
    const facturas: string[] = [];

    await client.mailboxOpen("INBOX");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    for await (const msg of client.fetch({ seen: false }, { source: true })) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const texto = (msg as any).source?.toString("utf8") ?? "";
      if (/factura|invoice|lote|proveedor/i.test(texto)) {
        facturas.push(texto.slice(0, 3000));
      }
    }

    await client.logout();

    if (facturas.length === 0) {
      return NextResponse.json({
        message: `Sin facturas nuevas en ${correoMonitoreo}`,
        procesados: 0,
      });
    }

    // Procesar con IA
    let procesados = 0;
    for (const texto of facturas.slice(0, 5)) {
      const response = await AI_CLIENT.messages.create({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 1024,
        messages: [{
          role: "user",
          content: `Extrae los datos de esta factura de proveedor de helados.
Responde SOLO con JSON:
{
  "proveedor": "",
  "facturaNumero": "",
  "productos": [
    { "nombre": "", "cajas": 0, "unidades": 0 }
  ]
}

FACTURA:
${texto}`,
        }],
      });

      const raw = response.content[0]?.type === "text" ? response.content[0].text : "";
      const match = raw.match(/\{[\s\S]*\}/);
      if (!match) continue;

      try {
        JSON.parse(match[0]); // validar JSON
        procesados++;
        // El lote se crea manualmente desde el panel del Encargado por ahora.
        // En fase 2: auto-crear en lotes_loker y notificar al Encargado.
      } catch { /* JSON inválido */ }
    }

    return NextResponse.json({
      message: `${procesados} factura(s) procesada(s) de ${correoMonitoreo}. El encargado debe confirmar los lotes.`,
      procesados,
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Error interno" },
      { status: 500 }
    );
  }
}
