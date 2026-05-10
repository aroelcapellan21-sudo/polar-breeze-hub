import { NextRequest, NextResponse } from "next/server";

export async function POST(req: NextRequest) {
  try {
    const { message, level = "info", window: win, fn } = await req.json() as {
      message: string;
      level?: "info" | "warning" | "error";
      window?: string;
      fn?: string;
    };

    const token  = process.env.TELEGRAM_BOT_TOKEN;
    const chatId = process.env.TELEGRAM_CHAT_ID;

    if (!token || !chatId) {
      return NextResponse.json({ ok: false, error: "Telegram no configurado" }, { status: 200 });
    }

    const emoji = level === "error" ? "🚨" : level === "warning" ? "⚠️" : "ℹ️";
    const text  = [
      `${emoji} *Polar Breeze Hub*`,
      `Nivel: ${level.toUpperCase()}`,
      win  ? `Ventana: ${win}` : null,
      fn   ? `Función: ${fn}` : null,
      `\`\`\`\n${message}\n\`\`\``,
      `_${new Date().toLocaleString("es-MX")}_`,
    ].filter(Boolean).join("\n");

    await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text, parse_mode: "Markdown" }),
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ ok: false, error: String(err) }, { status: 500 });
  }
}
