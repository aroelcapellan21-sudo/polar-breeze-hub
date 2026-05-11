import { NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";

type ServiceStatus = "ok" | "warning" | "error" | "unknown";

interface Check {
  status:  ServiceStatus;
  message: string;
  detail?: string;
  ms?:     number;
}

// ── Firebase: Firestore REST API (sin Admin SDK) ──────────────────────────────
async function checkFirebase(): Promise<Check> {
  const apiKey    = process.env.NEXT_PUBLIC_FIREBASE_API_KEY;
  const projectId = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;
  if (!apiKey || !projectId) {
    return { status: "error", message: "Config incompleta", detail: "Faltan variables NEXT_PUBLIC_FIREBASE_*" };
  }
  const t0 = Date.now();
  try {
    const url = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/config/main?key=${apiKey}`;
    const r   = await fetch(url, { signal: AbortSignal.timeout(6000) });
    const ms  = Date.now() - t0;
    if (r.status === 200 || r.status === 404) {
      return { status: "ok", message: "Conectado", detail: `${ms}ms · project=${projectId}`, ms };
    }
    return { status: "error", message: `HTTP ${r.status}`, detail: await r.text().then(t => t.slice(0, 100)), ms };
  } catch (e) {
    return { status: "error", message: "Sin conexión", detail: String(e), ms: Date.now() - t0 };
  }
}

// ── Anthropic: ping con modelo pequeño ───────────────────────────────────────
async function checkAnthropic(): Promise<Check> {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key || key.startsWith("sk-ant-tu")) {
    return { status: "warning", message: "API Key no configurada", detail: "Agrega ANTHROPIC_API_KEY en Vercel" };
  }
  const t0 = Date.now();
  try {
    const client = new Anthropic({ apiKey: key });
    await client.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 1,
      messages: [{ role: "user", content: "ok" }],
    });
    const ms = Date.now() - t0;
    return { status: "ok", message: "Activa", detail: `claude-haiku · ${ms}ms`, ms };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    const isAuth = msg.includes("auth") || msg.includes("401") || msg.includes("invalid");
    return {
      status:  isAuth ? "error" : "warning",
      message: isAuth ? "API Key inválida" : "Error de conexión",
      detail:  msg.slice(0, 120),
      ms:      Date.now() - t0,
    };
  }
}

// ── Telegram: getMe ───────────────────────────────────────────────────────────
async function checkTelegram(): Promise<Check> {
  const token   = process.env.TELEGRAM_BOT_TOKEN;
  const chatIds = (process.env.TELEGRAM_CHAT_IDS ?? process.env.TELEGRAM_CHAT_ID ?? "")
    .split(",").map(s => s.trim()).filter(Boolean);

  if (!token) {
    return { status: "warning", message: "Token no configurado", detail: "Agrega TELEGRAM_BOT_TOKEN en Vercel" };
  }
  const t0 = Date.now();
  try {
    const r    = await fetch(`https://api.telegram.org/bot${token}/getMe`, { signal: AbortSignal.timeout(5000) });
    const data = await r.json() as { ok: boolean; result?: { username: string; first_name: string } };
    const ms   = Date.now() - t0;
    if (data.ok && data.result) {
      return {
        status:  "ok",
        message: `@${data.result.username}`,
        detail:  `${chatIds.length} chat${chatIds.length !== 1 ? "s" : ""} configurado${chatIds.length !== 1 ? "s" : ""} · ${ms}ms`,
        ms,
      };
    }
    return { status: "error", message: "Token inválido", detail: JSON.stringify(data).slice(0, 100), ms };
  } catch (e) {
    return { status: "error", message: "Sin conexión", detail: String(e), ms: Date.now() - t0 };
  }
}

// ── Vercel: env vars inyectadas ───────────────────────────────────────────────
function checkVercel(): Check {
  const env    = process.env.VERCEL_ENV;
  const url    = process.env.VERCEL_URL;
  const sha    = process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7);
  const branch = process.env.VERCEL_GIT_COMMIT_REF;
  const msg    = process.env.VERCEL_GIT_COMMIT_MESSAGE?.slice(0, 60);

  if (!env) {
    return { status: "unknown", message: "Local / Dev", detail: "No se detecta entorno Vercel" };
  }
  return {
    status:  env === "production" ? "ok" : "warning",
    message: env === "production" ? "Production" : env,
    detail:  [sha && `commit ${sha}`, branch && `branch ${branch}`, msg].filter(Boolean).join(" · "),
  };
}

// ── Variables de entorno ──────────────────────────────────────────────────────
const ENV_VARS = [
  { name: "NEXT_PUBLIC_FIREBASE_API_KEY",       label: "Firebase API Key",       required: true  },
  { name: "NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN",   label: "Firebase Auth Domain",   required: true  },
  { name: "NEXT_PUBLIC_FIREBASE_PROJECT_ID",    label: "Firebase Project ID",    required: true  },
  { name: "NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET",label: "Firebase Storage Bucket",required: false },
  { name: "ANTHROPIC_API_KEY",                  label: "Anthropic API Key",       required: true  },
  { name: "TELEGRAM_BOT_TOKEN",                 label: "Telegram Bot Token",     required: false },
  { name: "TELEGRAM_CHAT_IDS",                  label: "Telegram Chat IDs",      required: false },
  { name: "VERCEL_TOKEN",                       label: "Vercel Token",           required: false },
];

export const dynamic = "force-dynamic";

export async function GET() {
  const [firebase, anthropic, telegram] = await Promise.all([
    checkFirebase(),
    checkAnthropic(),
    checkTelegram(),
  ]);
  const vercel  = checkVercel();
  const envVars = ENV_VARS.map(({ name, label, required }) => ({
    name, label, required,
    set: !!process.env[name],
  }));

  return NextResponse.json({
    firebase, anthropic, telegram, vercel, envVars,
    checkedAt: new Date().toISOString(),
  });
}
