"use client";

/**
 * AsistenteAI — Chat flotante con Gemini.
 * El botón es arrastrable: el usuario puede colocarlo donde no tape contenido.
 * La posición se guarda en localStorage.
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

const POS_KEY  = "pb_asistente_pos";
const BTN_SIZE = 48;

function clamp(x: number, y: number) {
  const W = window.innerWidth;
  const H = window.innerHeight;
  return {
    x: Math.max(8, Math.min(W - BTN_SIZE - 8, x)),
    y: Math.max(8, Math.min(H - BTN_SIZE - 8, y)),
  };
}

function defaultPos() {
  // Esquina inferior izquierda, sobre el área de FAB (que está a la derecha)
  return { x: 16, y: Math.max(8, window.innerHeight - BTN_SIZE - 96) };
}

export default function AsistenteAI({ rol = "encargado", nombre, contexto }: Props) {
  const [open,      setOpen]      = useState(false);
  const [msgs,      setMsgs]      = useState<Msg[]>([]);
  const [input,     setInput]     = useState("");
  const [loading,   setLoading]   = useState(false);
  const [badge,     setBadge]     = useState(false);
  const [historial, setHistorial] = useState<HistorialItem[]>([]);
  const [pos,       setPos]       = useState<{ x: number; y: number } | null>(null);

  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef  = useRef<HTMLTextAreaElement>(null);

  // Drag refs — sin re-renders durante el arrastre
  const dragging  = useRef(false);
  const dragMoved = useRef(false);
  const dragStart = useRef({ px: 0, py: 0, bx: 0, by: 0 });

  // ── Inicializar posición ────────────────────────────────────────────────────
  useEffect(() => {
    try {
      const saved = localStorage.getItem(POS_KEY);
      setPos(saved ? JSON.parse(saved) as { x: number; y: number } : defaultPos());
    } catch {
      setPos(defaultPos());
    }
  }, []);

  // ── Drag handlers ──────────────────────────────────────────────────────────
  const handlePointerDown = (e: React.PointerEvent<HTMLButtonElement>) => {
    if (!pos) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    dragging.current  = true;
    dragMoved.current = false;
    dragStart.current = { px: e.clientX, py: e.clientY, bx: pos.x, by: pos.y };
  };

  const handlePointerMove = useCallback((e: React.PointerEvent<HTMLButtonElement>) => {
    if (!dragging.current) return;
    const dx = e.clientX - dragStart.current.px;
    const dy = e.clientY - dragStart.current.py;
    if (Math.abs(dx) > 4 || Math.abs(dy) > 4) dragMoved.current = true;
    if (dragMoved.current) setPos(clamp(dragStart.current.bx + dx, dragStart.current.by + dy));
  }, []);

  const handlePointerUp = useCallback(() => {
    if (!dragging.current) return;
    dragging.current = false;
    if (dragMoved.current) {
      // Guardar posición final
      setPos((p) => { if (p) localStorage.setItem(POS_KEY, JSON.stringify(p)); return p; });
    } else {
      // Fue un toque/clic — abrir/cerrar chat
      setOpen((v) => !v);
    }
  }, []);

  // ── Posición del panel (inteligente, no sale de pantalla) ──────────────────
  const getPanelStyle = (): React.CSSProperties => {
    if (!pos || typeof window === "undefined") return {};
    const W  = window.innerWidth;
    const H  = window.innerHeight;
    const PW = Math.min(384, W - 24);
    const GAP = 10;
    const style: React.CSSProperties = {
      width:     PW,
      maxHeight: `min(560px, calc(100vh - ${BTN_SIZE + GAP * 2}px))`,
    };

    // Horizontal: abre a la derecha si cabe, si no a la izquierda
    if (pos.x + BTN_SIZE + GAP + PW <= W) {
      style.left = pos.x + BTN_SIZE + GAP;
    } else if (pos.x - GAP - PW >= 0) {
      style.left = pos.x - GAP - PW;
    } else {
      style.left = Math.max(8, (W - PW) / 2);
    }

    // Vertical: centra sobre el botón, ajusta si sale de pantalla
    const PANEL_H = Math.min(560, H - BTN_SIZE - GAP * 2);
    let top = pos.y + BTN_SIZE / 2 - PANEL_H / 2;
    style.top = Math.max(8, Math.min(H - PANEL_H - 8, top));

    return style;
  };

  // ── Efectos ────────────────────────────────────────────────────────────────
  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: "smooth" }); }, [msgs]);

  useEffect(() => {
    if (open) { setTimeout(() => inputRef.current?.focus(), 150); setBadge(false); }
  }, [open]);

  useEffect(() => {
    if (open && msgs.length === 0) {
      const saludo = nombre
        ? `¡Hola ${nombre.split(" ")[0]}! 👋 Soy tu asistente de Polar Breeze. ¿En qué te puedo ayudar hoy?`
        : `¡Hola! 👋 Soy el asistente de Polar Breeze. ¿En qué te puedo ayudar?`;
      setMsgs([{ id: "bienvenida", from: "bot", text: saludo, ts: new Date() }]);
    }
  }, [open, msgs.length, nombre]);

  // ── Enviar mensaje ─────────────────────────────────────────────────────────
  const enviar = useCallback(async (texto?: string) => {
    const msg = (texto ?? input).trim();
    if (!msg || loading) return;
    setInput("");
    setMsgs((prev) => [...prev, { id: Date.now().toString(), from: "user", text: msg, ts: new Date() }]);
    setLoading(true);
    try {
      const res  = await fetch("/api/asistente", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ mensaje: msg, rol, contexto, historial }),
      });
      const data = await res.json() as { respuesta?: string };
      const respuesta = data.respuesta ?? "No recibí respuesta. Intenta de nuevo.";
      setMsgs((prev) => [...prev, { id: `bot-${Date.now()}`, from: "bot", text: respuesta, ts: new Date() }]);
      setHistorial((prev) => [...prev,
        { role: "user",  text: msg },
        { role: "model", text: respuesta },
      ]);
    } catch {
      setMsgs((prev) => [...prev, {
        id: `err-${Date.now()}`, from: "bot",
        text: "Error de conexión. Verifica tu internet e inténtalo de nuevo.", ts: new Date(),
      }]);
    } finally {
      setLoading(false);
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [input, loading, rol, contexto, historial]);

  const onKey = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); enviar(); }
  };

  const sugerencias = SUGERENCIAS[rol] ?? SUGERENCIAS.encargado;
  const showSugs    = msgs.length <= 1 && !loading;

  if (!pos) return null;

  return (
    <>
      {/* ── Botón flotante arrastrable ── */}
      <button
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        title="Asistente Polar Breeze — arrastra para mover"
        style={{ left: pos.x, top: pos.y, zIndex: 9040, touchAction: "none" }}
        className={`fixed w-12 h-12 rounded-full shadow-lg select-none
          flex items-center justify-center transition-transform duration-150
          cursor-grab active:cursor-grabbing
          ${open ? "bg-gray-700 hover:bg-gray-800 scale-90" : "bg-[#1A1A1A] hover:bg-gray-800"}`}
      >
        {open ? (
          <span className="text-white text-lg leading-none">🤖</span>
        ) : (
          <>
            <span className="text-xl leading-none">🤖</span>
            {badge && (
              <span className="absolute -top-1 -right-1 w-3 h-3 bg-[#F5C800] rounded-full
                animate-pulse border border-white" />
            )}
          </>
        )}
      </button>

      {/* ── Panel de chat ── */}
      {open && (
        <div
          className="fixed bg-white rounded-2xl shadow-2xl border border-gray-200
            flex flex-col overflow-hidden"
          style={{ ...getPanelStyle(), zIndex: 9050 }}
        >
          {/* Header */}
          <div
            className="px-4 py-3 flex items-center gap-3 flex-shrink-0"
            style={{ background: "linear-gradient(90deg, #1A1A1A 0%, #2d2d2d 100%)" }}
          >
            <div className="w-8 h-8 rounded-full bg-[#F5C800] flex items-center
              justify-center text-sm flex-shrink-0">
              🤖
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-white font-bold text-sm">Asistente Polar Breeze</p>
              <p className="text-white/50 text-[10px]">Gemini · {rol}</p>
            </div>
            <div className="flex items-center gap-2">
              <span className="flex items-center gap-1">
                <span className={`w-2 h-2 rounded-full ${loading ? "bg-yellow-400 animate-pulse" : "bg-[#1E8C3A]"}`} />
                <span className="text-white/40 text-[9px]">{loading ? "pensando…" : "activo"}</span>
              </span>
              <button
                onClick={() => setOpen(false)}
                className="text-white/50 hover:text-white text-xl leading-none ml-1 transition-colors"
              >
                ✕
              </button>
            </div>
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
              <div key={m.id} className={`flex ${m.from === "user" ? "justify-end" : "justify-start"}`}>
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
                    {[0, 1, 2].map((i) => (
                      <span key={i}
                        className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce"
                        style={{ animationDelay: `${i * 0.15}s` }} />
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
                  <button key={s} onClick={() => enviar(s)}
                    className="text-[10px] bg-[#F5C800]/15 text-[#b38a00] hover:bg-[#F5C800]/25
                      border border-[#F5C800]/30 rounded-full px-2.5 py-1 transition-colors">
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
                <path d="M22 2L15 22L11 13L2 9L22 2Z" stroke="white" strokeWidth="2"
                  strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
          </div>
        </div>
      )}
    </>
  );
}
