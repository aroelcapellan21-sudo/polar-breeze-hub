import { NextRequest, NextResponse } from "next/server";

// Soporta TELEGRAM_CHAT_IDS (coma-separados) o el legacy TELEGRAM_CHAT_ID
function getChatIds(): string[] {
  const multi  = process.env.TELEGRAM_CHAT_IDS ?? "";
  const single = process.env.TELEGRAM_CHAT_ID  ?? "";
  const raw    = multi || single;
  return raw.split(",").map((s) => s.trim()).filter(Boolean);
}

export async function POST(req: NextRequest) {
  try {
    const { message, level = "info", window: win, fn } = await req.json() as {
      message: string;
      level?: "info" | "warning" | "error";
      window?: string;
      fn?: string;
    };

    const token   = process.env.TELEGRAM_BOT_TOKEN;
    const chatIds = getChatIds();

    if (!token || chatIds.length === 0) {
      return NextResponse.json({ ok: false, error: "Telegram no configurado" }, { status: 200 });
    }

    const emoji = level === "error" ? "🚨" : level === "warning" ? "⚠️" : "ℹ️";
    const lines = [
      `${emoji} *Polar Breeze Hub*`,
      `Nivel: \`${level.toUpperCase()}\``,
    ];
    if (win)     lines.push(`Ventana: \`${win}\``);
    if (fn)      lines.push(`Función: \`${fn}\``);
    lines.push(`\`\`\`\n${message.slice(0, 3000)}\n\`\`\``);
    lines.push(`_${new Date().toLocaleString("es-MX")}_`);
    const text = lines.join("\n");

    // Enviar a todos los chat IDs en paralelo
    const results = await Promise.allSettled(
      chatIds.map((chatId) =>
        fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ chat_id: chatId, text, parse_mode: "Markdown" }),
        })
      )
    );

    const sent = results.filter((r) => r.status === "fulfilled").length;
    return NextResponse.json({ ok: true, sent, total: chatIds.length });
  } catch (err) {
    return NextResponse.json({ ok: false, error: String(err) }, { status: 500 });
  }
}
