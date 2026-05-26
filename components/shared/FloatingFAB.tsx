"use client";

/**
 * FloatingFAB — Botón flotante Polar Breeze
 *
 * §9 del documento maestro:
 *  - Botón principal rojo #D42B2B con pulso 3s
 *  - Abre abanico: 🖨️ Imprimir · 📲 WhatsApp · 📄 PDF · 📋 Lista
 *  - Imprimir pregunta el modo: Factura | Tabla | Normal
 *  - Se cierra al tocar fuera
 */

import { useState, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { useModalShare } from "./ModalShareContext";

const LS_KEY = "wa_last_number";

interface Props {
  getMessage?:   () => string;
  getPrintHtml?: () => string;
}

type PrintMode = "factura" | "tabla" | "normal";

// ─── CSS de impresión por modo ────────────────────────────────────────────────

function buildPrintStyles(mode: PrintMode): string {
  const base = `
    @page { margin: 10mm; }
    body { font-family: Arial, sans-serif; font-size: 11pt; color: #000; }
    .no-print { display: none !important; }
  `;
  if (mode === "factura") {
    return base + `
      body { background: #fff; }
      table { border-collapse: collapse; width: 100%; }
      th, td { border: none; padding: 3px 6px; }
      th { font-weight: bold; border-bottom: 1px solid #000; }
      .total-row { border-top: 1px solid #000; font-weight: bold; }
      @media print {
        body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
        .header-empresa { font-size: 14pt; font-weight: bold; text-align: center; margin-bottom: 8px; }
      }
    `;
  }
  if (mode === "tabla") {
    return base + `
      table { border-collapse: collapse; width: 100%; }
      th, td { border: 1px solid #666; padding: 4px 8px; }
      th { background: #eee; font-weight: bold; }
      tr:nth-child(even) { background: #f9f9f9; }
    `;
  }
  // normal
  return base + `
    body { color: #000; }
    table { border-collapse: collapse; width: 100%; }
    th, td { border: none; padding: 3px 6px; }
    img { display: none; }
  `;
}

function doPrint(html: string, mode: PrintMode) {
  const win = window.open("", "_blank");
  if (!win) return;
  const styles = buildPrintStyles(mode);
  win.document.write(`<!DOCTYPE html><html><head>
    <meta charset="utf-8">
    <title>Polar Breeze — Impresión</title>
    <style>${styles}</style>
  </head><body>${html}</body></html>`);
  win.document.close();
  win.onload = () => { win.focus(); win.print(); };
}

// ─── Componente ───────────────────────────────────────────────────────────────

export default function FloatingFAB({ getMessage, getPrintHtml }: Props) {
  const { isOpen: modalOpen, fnsRef } = useModalShare();

  const [open,       setOpen]       = useState(false);
  const [waOpen,     setWaOpen]     = useState(false);
  const [printOpen,  setPrintOpen]  = useState(false);
  const [num,        setNum]        = useState("");
  const [mounted,    setMounted]    = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setNum(localStorage.getItem(LS_KEY) ?? "");
    setMounted(true);
  }, []);

  // Cierra al clic fuera
  useEffect(() => {
    if (!open && !waOpen && !printOpen) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false); setWaOpen(false); setPrintOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open, waOpen, printOpen]);

  const activeGetMsg = (): string => {
    if (modalOpen && fnsRef.current?.getMessage) return fnsRef.current.getMessage();
    return getMessage ? getMessage() : document.title;
  };

  const activeGetHtml = (): string => {
    const modalHtml = modalOpen ? fnsRef.current?.getPrintHtml?.() ?? "" : "";
    return modalHtml || (getPrintHtml ? getPrintHtml() : document.body.innerHTML);
  };

  // ── Acciones ──────────────────────────────────────────────────────────────
  const handlePrintMode = (mode: PrintMode) => {
    setPrintOpen(false); setOpen(false);
    doPrint(activeGetHtml(), mode);
  };

  const handlePdf = () => {
    setOpen(false);
    doPrint(activeGetHtml(), "normal");
  };

  const handleCopyLista = async () => {
    setOpen(false);
    const text = activeGetMsg();
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // fallback
      const ta = document.createElement("textarea");
      ta.value = text; document.body.appendChild(ta);
      ta.select(); document.execCommand("copy");
      document.body.removeChild(ta);
    }
  };

  const handleWaSend = () => {
    const cleaned = num.replace(/\D/g, "");
    if (cleaned) localStorage.setItem(LS_KEY, num);
    const text = encodeURIComponent(activeGetMsg());
    window.open(cleaned
      ? `https://wa.me/${cleaned}?text=${text}`
      : `https://wa.me/?text=${text}`, "_blank");
    setWaOpen(false); setOpen(false);
  };

  if (!mounted) return null;

  return createPortal(
    <div
      ref={ref}
      style={{ zIndex: 9999 }}
      className="fixed bottom-5 right-5 flex flex-col items-end gap-2 select-none"
    >

      {/* ── Modal: selector de modo de impresión ── */}
      {printOpen && (
        <div className="bg-white rounded-2xl shadow-2xl border border-gray-100 p-4 w-64 mb-1">
          <p className="text-xs font-bold text-gray-600 mb-3 flex items-center gap-1.5">
            🖨️ Modo de impresión
          </p>
          <div className="space-y-2">
            <button
              onClick={() => handlePrintMode("factura")}
              className="w-full flex items-start gap-3 p-3 rounded-xl border-2 border-[#F5C800]
                bg-yellow-50 hover:bg-yellow-100 active:scale-95 transition-all text-left"
            >
              <span className="text-lg flex-shrink-0">🧾</span>
              <div>
                <p className="text-sm font-bold text-yellow-800">Factura</p>
                <p className="text-xs text-yellow-600">Papel blanco + carbón. Sin líneas.</p>
              </div>
            </button>
            <button
              onClick={() => handlePrintMode("tabla")}
              className="w-full flex items-start gap-3 p-3 rounded-xl border-2 border-gray-200
                bg-gray-50 hover:bg-gray-100 active:scale-95 transition-all text-left"
            >
              <span className="text-lg flex-shrink-0">📊</span>
              <div>
                <p className="text-sm font-bold text-gray-700">Tabla</p>
                <p className="text-xs text-gray-500">Con líneas y columnas.</p>
              </div>
            </button>
            <button
              onClick={() => handlePrintMode("normal")}
              className="w-full flex items-start gap-3 p-3 rounded-xl border-2 border-gray-200
                bg-white hover:bg-gray-50 active:scale-95 transition-all text-left"
            >
              <span className="text-lg flex-shrink-0">🖨️</span>
              <div>
                <p className="text-sm font-bold text-gray-700">Normal</p>
                <p className="text-xs text-gray-500">Blanco y negro simple.</p>
              </div>
            </button>
          </div>
          <button
            onClick={() => setPrintOpen(false)}
            className="w-full mt-3 py-1.5 text-xs text-gray-400 hover:text-gray-600 transition-colors"
          >
            Cancelar
          </button>
        </div>
      )}

      {/* ── Popover WhatsApp ── */}
      {waOpen && (
        <div className="bg-white rounded-2xl shadow-2xl border border-gray-200 p-4 w-64 mb-1">
          <p className="text-xs font-semibold text-gray-600 mb-1.5">Número destino</p>
          <input
            type="tel" value={num}
            onChange={(e) => setNum(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleWaSend()}
            placeholder="1829XXXXXXX"
            autoFocus
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm
              text-gray-800 outline-none focus:ring-2 focus:ring-green-400 mb-1"
          />
          <p className="text-xs text-gray-400 mb-3">Opcional · recuerda el último número</p>
          <div className="flex gap-2">
            <button onClick={() => setWaOpen(false)}
              className="flex-1 py-2 rounded-lg border border-gray-200 text-xs text-gray-600 hover:bg-gray-50 transition">
              Cancelar
            </button>
            <button onClick={handleWaSend}
              className="flex-1 py-2 rounded-lg bg-[#1E8C3A] hover:bg-green-700
                active:scale-95 text-white text-xs font-semibold transition-all">
              Enviar ↗
            </button>
          </div>
        </div>
      )}

      {/* ── Abanico de acciones ── */}
      {open && !waOpen && !printOpen && (
        <div className="flex flex-col items-end gap-2">
          {/* 🖨️ Imprimir */}
          <button
            onClick={() => setPrintOpen(true)}
            className="flex items-center gap-2 px-4 py-2.5 rounded-full shadow-lg text-sm
              font-semibold transition-all duration-150 active:scale-95 whitespace-nowrap
              bg-[#F5C800] text-[#1A1A1A] hover:brightness-95"
          >
            🖨️ Imprimir
          </button>
          {/* 📲 WhatsApp */}
          <button
            onClick={() => setWaOpen(true)}
            className="flex items-center gap-2 px-4 py-2.5 rounded-full shadow-lg text-sm
              font-semibold transition-all duration-150 active:scale-95 whitespace-nowrap
              bg-[#1E8C3A] text-white hover:bg-green-700"
          >
            📲 WhatsApp
          </button>
          {/* 📄 PDF */}
          <button
            onClick={handlePdf}
            className="flex items-center gap-2 px-4 py-2.5 rounded-full shadow-lg text-sm
              font-semibold transition-all duration-150 active:scale-95 whitespace-nowrap
              bg-white text-gray-700 border border-gray-200 hover:bg-gray-50"
          >
            📄 PDF
          </button>
          {/* 📋 Copiar lista */}
          <button
            onClick={handleCopyLista}
            className="flex items-center gap-2 px-4 py-2.5 rounded-full shadow-lg text-sm
              font-semibold transition-all duration-150 active:scale-95 whitespace-nowrap
              bg-white text-gray-700 border border-gray-200 hover:bg-gray-50"
          >
            📋 Copiar lista
          </button>
        </div>
      )}

      {/* ── Botón principal ── */}
      <button
        type="button"
        title={open ? "Cerrar" : "Imprimir / Compartir"}
        onClick={() => { setOpen((o) => !o); setWaOpen(false); setPrintOpen(false); }}
        style={{ animationDuration: open ? "0s" : "3s" }}
        className={`w-14 h-14 rounded-full shadow-xl flex items-center justify-center
          text-2xl transition-all duration-200 active:scale-90 relative
          ${open ? "bg-gray-700 hover:bg-gray-600" : "bg-[#D42B2B] hover:bg-[#b82424] animate-pulse"}
          text-white`}
      >
        {open ? "✕" : "📤"}
        {!open && modalOpen && (
          <span className="absolute -top-0.5 -right-0.5 w-3.5 h-3.5 bg-[#1E8C3A]
            rounded-full border-2 border-white" />
        )}
      </button>
    </div>,
    document.body
  );
}
