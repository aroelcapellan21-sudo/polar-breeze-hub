"use client";

/**
 * AsistenteAI — Chat flotante con Gemini.
 * Disponible en App Encargado y App Despachador.
 *
 * Props:
 *   rol      — "encargado" | "despachador" | "admin"
 *   nombre   — nombre del usuario (para personalizar)
 *   contexto — string de contexto en tiempo real (pendientes, stock, etc.)
 */

import { useState, useRef, useEffect, useCallback } from "react";

interface Msg {
  id:   string;
  from: "user" | "bot";
  text: string;
  ts:   Date;
}

interface HistorialItem {
  role: "user" | "model";
  text: string;
}

interface Props {
  rol?:      "encargado" | "despachador" | "admin";
  nombre?:   string;
  contexto?: string;
}

const SUGERENCIAS: Record<string, string[]> = {
  encargado: [
    "¿Qué choferes faltan por reportar hoy?",
    "¿Cuánto se vendió esta semana?",
    "¿Hay productos con stock bajo?",
    "¿Cómo calculo los puntos de la quincena?",
  ],
  despachador: [
    "¿Qué choferes ya tienen su retiro?",
    "¿Cuántas facturas se procesaron hoy?",
    "¿Hay alguna alerta de peso activa?",
    "¿Cómo registro un lote en el sistema?",
  ],
  admin: [
    "¿Cuál fue el mejor chofer esta semana?",
    "¿Hay anomalías detectadas hoy?",
    "¿Cómo van los KPIs del mes?",
    "¿Qué choferes tienen semáforo rojo?",
  ],
};

export default function AsistenteAI({ rol = "encargado", nombre, contexto }: Props) {
  const [open,     setOpen]     = useState(false);
  const [msgs,     setMsgs]     = useState<Msg[]>([]);
  const [input,    setInput]    = useState("");
  const [loading,  setLoading]  = useState(false);
  const [badge,    setBadge]    = useState(false);
  const [historial, setHistorial] = useState<HistorialItem[]>([]);

  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef  = useRef<HTMLTextAreaElement>(null);

  // Scroll al último mensaje
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [msgs]);

  // Focus en input al abrir
  useEffect(() => {
    if (open) {
      setTimeout(() => inputRef.current?.focus(), 150);
      setBadge(false);
    }
  }, [open]);

  // Mensaje de bienvenida al abrir por primera vez
  useEffect(() => {
    if (open && msgs.length === 0) {
      const saludo = nombre
        ? `¡Hola ${nombre.split(" ")[0]}! 👋 Soy tu asistente de Polar Breeze. ¿En qué te puedo ayudar hoy?`
        : `¡Hola! 👋 Soy el asistente de Polar Breeze. ¿En qué te puedo ayudar?`;
      setMsgs([{ id: "bienvenida", from: "bot", text: saludo, ts: new Date() }]);
    }
  }, [open, msgs.length, nombre]);

  const enviar = useCallback(async (texto?: string) => {
    const msg = (texto ?? input).trim();
    if (!msg || loading) return;

    setInput("");
    const msgId = Date.now().toString();
    setMsgs(prev => [...prev, { id: msgId, from: "user", text: msg, ts: new Date() }]);
    setLoading(true);

    try {
      const res = await fetch("/api/asistente", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ mensaje: msg, rol, contexto, historial }),
      });
      const data = await res.json() as { respuesta?: string };
      const respuesta = data.respuesta ?? "No recibí respuesta. Intenta de nuevo.";

      setMsgs(prev => [...prev, {
        id:   `bot-${Date.now()}`,
        from: "bot",
        text: respuesta,
        ts:   new Date(),
      }]);

      // Actualizar historial para contexto de conversación
      setHistorial(prev => [
        ...prev,
        { role: "user",  text: msg },
        { role: "model", text: respuesta },
      ]);

    } catch {
      setMsgs(prev => [...prev, {
        id:   `err-${Date.now()}`,
        from: "bot",
        text: "Error de conexión. Verifica tu internet e inténtalo de nuevo.",
        ts:   new Date(),
      }]);
    } finally {
      setLoading(false);
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [input, loading, rol, contexto, historial]);

  const onKey = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      enviar();
    }
  };

  const sugerencias = SUGERENCIAS[rol] ?? SUGERENCIAS.encargado;
  const showSugs    = msgs.length <= 1 && !loading;

  return (
    <>
      {/* ── Botón flotante ── */}
      <button
        onClick={() => setOpen(v => !v)}
        title="Asistente Polar Breeze"
        className={`fixed bottom-24 left-4 z-40 w-12 h-12 rounded-full shadow-lg
          flex items-center justify-center transition-all duration-200
          ${open
            ? "bg-gray-700 hover:bg-gray-800 scale-90"
            : "bg-[#1A1A1A] hover:bg-gray-800 active:scale-95"
          }`}
      >
        {open ? (
          <span className="text-white text-lg leading-none">✕</span>
        ) : (
          <>
            <span className="text-xl leading-none">🤖</span>
            {badge && (
              <span className="absolute -top-1 -right-1 w-3 h-3 bg-[#F5C800] rounded-full animate-pulse border border-white" />
            )}
          </>
        )}
      </button>

      {/* ── Panel de chat ── */}
      {open && (
        <div
          className="fixed bottom-40 left-4 z-50 w-80 sm:w-96 bg-white rounded-2xl shadow-2xl
            border border-gray-200 flex flex-col overflow-hidden"
          style={{ maxHeight: "min(560px, calc(100vh - 180px))" }}
        >
          {/* Header */}
          <div className="px-4 py-3 flex items-center gap-3 flex-shrink-0"
            style={{ background: "linear-gradient(90deg, #1A1A1A 0%, #2d2d2d 100%)" }}>
            <div className="w-8 h-8 rounded-full bg-[#F5C800] flex items-center justify-center text-sm flex-shrink-0">
              🤖
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-white font-bold text-sm">Asistente Polar Breeze</p>
              <p className="text-white/50 text-[10px]">Gemini · {rol}</p>
            </div>
            <span className="flex items-center gap-1">
              <span className={`w-2 h-2 rounded-full ${loading ? "bg-yellow-400 animate-pulse" : "bg-[#1E8C3A]"}`} />
              <span className="text-white/40 text-[9px]">{loading ? "pensando…" : "activo"}</span>
            </span>
          </div>

          {/* Banda tricolor */}
          <div className="flex h-[3px] flex-shrink-0">
            <div className="flex-1 bg-[#F5C800]" />
            <div className="flex-1 bg-[#D42B2B]" />
            <div className="flex-1 bg-[#1E8C3A]" />
          </div>

          {/* Mensajes */}
          <div className="flex-1 overflow-y-auto p-3 space-y-2 bg-gray-50/50">
            {msgs.map((m) => (
              <div
                key={m.id}
                className={`flex ${m.from === "user" ? "justify-end" : "justify-start"}`}
              >
                <div className={`max-w-[82%] px-3 py-2 rounded-xl text-sm leading-snug ${
                  m.from === "user"
                    ? "bg-[#1A1A1A] text-white rounded-br-none"
                    : "bg-white text-gray-800 shadow-sm border border-gray-100 rounded-bl-none"
                }`}>
                  <p className="whitespace-pre-wrap">{m.text}</p>
                  <p className={`text-[9px] mt-1 ${m.from === "user" ? "text-white/40" : "text-gray-300"}`}>
                    {m.ts.toLocaleTimeString("es-DO", { hour: "2-digit", minute: "2-digit" })}
                  </p>
                </div>
              </div>
            ))}

            {/* Indicador "escribiendo" */}
            {loading && (
              <div className="flex justify-start">
                <div className="bg-white shadow-sm border border-gray-100 rounded-xl rounded-bl-none px-4 py-3">
                  <div className="flex gap-1">
                    {[0, 1, 2].map(i => (
                      <span
                        key={i}
                        className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce"
                        style={{ animationDelay: `${i * 0.15}s` }}
                      />
                    ))}
                  </div>
                </div>
              </div>
            )}

            <div ref={bottomRef} />
          </div>

          {/* Sugerencias (solo al inicio) */}
          {showSugs && (
            <div className="px-3 py-2 border-t border-gray-100 flex-shrink-0">
              <p className="text-[10px] text-gray-400 mb-1.5">Preguntas frecuentes:</p>
              <div className="flex flex-wrap gap-1.5">
                {sugerencias.map((s) => (
                  <button
                    key={s}
                    onClick={() => enviar(s)}
                    className="text-[10px] bg-[#F5C800]/15 text-[#b38a00] hover:bg-[#F5C800]/25
                      border border-[#F5C800]/30 rounded-full px-2.5 py-1 transition-colors"
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Input */}
          <div className="flex items-end gap-2 p-3 border-t border-gray-100 flex-shrink-0 bg-white">
            <textarea
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={onKey}
              placeholder="Escribe tu pregunta…"
              rows={1}
              disabled={loading}
              className="flex-1 resize-none rounded-xl border border-gray-200 px-3 py-2 text-sm
                focus:outline-none focus:ring-2 focus:ring-[#F5C800]/50 focus:border-[#F5C800]
                disabled:opacity-50 transition-all bg-gray-50 max-h-24"
              style={{ lineHeight: "1.5" }}
            />
            <button
              onClick={() => enviar()}
              disabled={!input.trim() || loading}
              className="w-9 h-9 rounded-xl bg-[#1A1A1A] hover:bg-gray-800 disabled:opacity-40
                flex items-center justify-center transition-all active:scale-95 flex-shrink-0"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                <path d="M22 2L11 13" stroke="white" strokeWidth="2" strokeLinecap="round" />
                <path d="M22 2L15 22L11 13L2 9L22 2Z" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
          </div>
        </div>
      )}
    </>
  );
}
