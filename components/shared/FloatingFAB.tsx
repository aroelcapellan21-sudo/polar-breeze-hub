"use client";

/**
 * FloatingFAB — Botón flotante Polar Breeze
 *
 * §9 del documento maestro:
 *  - Botón principal rojo #D42B2B con pulso 3s
 *  - Abre abanico: 🖨️ Imprimir · 📲 WhatsApp · 📄 PDF · 📋 Lista
 *  - Imprimir pregunta el modo: Factura | Tabla | Normal
 *  - Se cierra al tocar fuera
 *
 * Estrategia de impresión:
 *  - Contenido normal → window.print() con CSS @media print inyectado
 *    (conserva todos los estilos Tailwind ya cargados en la página)
 *  - Modal activo con getPrintHtml → ventana nueva con HTML específico del modal
 */

import { useState, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { useModalShare } from "./ModalShareContext";

const LS_KEY    = "wa_last_number";
const LS_KEY_CC = "wa_last_cc";

const CC_OPTIONS = [
  { code: "1",  flag: "🇩🇴", label: "RD / US" },
  { code: "52", flag: "🇲🇽", label: "MX" },
  { code: "34", flag: "🇪🇸", label: "ES" },
  { code: "57", flag: "🇨🇴", label: "CO" },
];

interface Props {
  getMessage?:   () => string;
  getPrintHtml?: () => string;
}

type PrintMode = "factura" | "tabla" | "normal";

// ─── CSS de impresión para ventana nueva (modales con HTML propio) ────────────

function buildModalPrintCSS(mode: PrintMode): string {
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
  return base + `
    body { color: #000; }
    table { border-collapse: collapse; width: 100%; }
    th, td { border: none; padding: 3px 6px; }
    img { display: none; }
  `;
}

/** Abre una ventana nueva con HTML propio — usado solo para modales. */
function doPrintWindow(html: string, mode: PrintMode) {
  const win = window.open("", "_blank");
  if (!win) return;
  const styles = buildModalPrintCSS(mode);
  win.document.write(`<!DOCTYPE html><html><head>
    <meta charset="utf-8">
    <title>Polar Breeze — Impresión</title>
    <style>${styles}</style>
  </head><body>${html}</body></html>`);
  win.document.close();
  win.onload = () => { win.focus(); win.print(); };
}

// ─── CSS de impresión para la página actual ───────────────────────────────────

function buildPagePrintCSS(mode: PrintMode): string {
  // Ocultar chrome de UI: FAB, elementos fixed/sticky que no son contenido
  const base = `
    @media print {
      .pb-fab-root { display: none !important; }
      @page { margin: 12mm; }
      body { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
    }
  `;
  if (mode === "tabla") {
    return base + `
      @media print {
        table { border-collapse: collapse !important; width: 100% !important; }
        th, td { border: 1px solid #666 !important; padding: 4px 8px !important; }
        th { background: #eee !important; font-weight: bold !important; }
        tr:nth-child(even) { background: #f9f9f9 !important; }
      }
    `;
  }
  if (mode === "factura") {
    return base + `
      @media print {
        table { border-collapse: collapse !important; width: 100% !important; }
        th, td { border: none !important; padding: 3px 6px !important; }
        th { font-weight: bold !important; border-bottom: 1px solid #000 !important; }
      }
    `;
  }
  // normal
  return base + `
    @media print {
      img { display: none !important; }
    }
  `;
}

/**
 * Imprime la página actual con estilos Tailwind intactos.
 * Inyecta un <style> temporal con reglas @media print para el modo elegido
 * y lo elimina cuando el diálogo de impresión cierra.
 */
function doPrintPage(mode: PrintMode) {
  document.getElementById("pb-print-style")?.remove();

  const style = document.createElement("style");
  style.id = "pb-print-style";
  style.textContent = buildPagePrintCSS(mode);
  document.head.appendChild(style);

  window.print();

  const cleanup = () => document.getElementById("pb-print-style")?.remove();
  window.addEventListener("afterprint", cleanup, { once: true });
  // Fallback: algunos navegadores no disparan afterprint
  setTimeout(cleanup, 8000);
}

// ─── Componente ───────────────────────────────────────────────────────────────

export default function FloatingFAB({ getMessage, getPrintHtml }: Props) {
  const { isOpen: modalOpen, fnsRef } = useModalShare();

  const [open,       setOpen]       = useState(false);
  const [waOpen,     setWaOpen]     = useState(false);
  const [printOpen,  setPrintOpen]  = useState(false);
  const [num,        setNum]        = useState("");
  const [cc,         setCc]         = useState("1");
  const [mounted,    setMounted]    = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setNum(localStorage.getItem(LS_KEY)    ?? "");
    setCc(localStorage.getItem(LS_KEY_CC) ?? "1");
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

  /** Texto para WhatsApp / Copiar lista.
   *
   *  Prioridad:
   *  1. Modal registrado en ModalShareContext con getMessage propio.
   *  2. Prop getMessage del dashboard.
   *  3. Modal DOM abierto: backdrop con patrón 'inset-0 bg-black' → innerText
   *     del panel interior (primer hijo directo del backdrop).
   *  4. Sin modal: <main> (React renderiza solo el tab activo → no incluye
   *     header, barra de tabs ni otros tabs).
   *  5. Último recurso: body completo excluyendo el propio FAB.
   */
  const activeGetMsg = (): string => {
    if (modalOpen && fnsRef.current?.getMessage) return fnsRef.current.getMessage();
    if (getMessage) return getMessage();

    // ── Modal DOM abierto ────────────────────────────────────────────────────
    // Patrón consistente en esta app: backdrop = div.fixed.inset-0.bg-black/N
    // React no renderiza los modales cuando están cerrados → si está en el DOM, está abierto.
    const backdrop = document.querySelector<HTMLElement>(
      '[class*="inset-0"][class*="bg-black"]'
    );
    if (backdrop && !ref.current?.contains(backdrop)) {
      const panel = backdrop.querySelector<HTMLElement>(":scope > div") ?? backdrop;
      const text  = panel.innerText?.trim();
      if (text && text.length > 10) return text.slice(0, 3500);
    }

    // ── Tab activo: <main> contiene solo el panel visible ────────────────────
    const mainEl = document.querySelector<HTMLElement>("main");
    if (mainEl) {
      return `${document.title}\n\n${mainEl.innerText?.trim() ?? ""}`.slice(0, 3500);
    }

    // ── Último recurso: body sin el FAB ───────���──────────────────────────────
    const fabEl = ref.current;
    const prev  = fabEl?.style.display ?? "";
    if (fabEl) fabEl.style.display = "none";
    const raw = document.body.innerText
      .split("\n").map((l) => l.trim()).filter((l) => l.length > 0).join("\n");
    if (fabEl) fabEl.style.display = prev;
    return `${document.title}\n\n${raw}`.slice(0, 3500);
  };

  /** HTML para imprimir en ventana nueva (solo modales). */
  const activeGetModalHtml = (): string | null => {
    if (modalOpen) return fnsRef.current?.getPrintHtml?.() ?? null;
    if (getPrintHtml) return getPrintHtml();
    return null;
  };

  // ── Acciones ──────────────────────────────────────────────────────────────

  const handlePrintMode = (mode: PrintMode) => {
    setPrintOpen(false); setOpen(false);
    const modalHtml = activeGetModalHtml();
    if (modalHtml) {
      // Modal activo con HTML específico → ventana nueva
      doPrintWindow(modalHtml, mode);
    } else {
      // Contenido normal → imprimir la página actual (estilos Tailwind intactos)
      doPrintPage(mode);
    }
  };

  const handlePdf = () => {
    setOpen(false);
    const modalHtml = activeGetModalHtml();
    if (modalHtml) {
      doPrintWindow(modalHtml, "normal");
    } else {
      doPrintPage("normal");
    }
  };

  const handleCopyLista = async () => {
    setOpen(false);
    let text: string;
    if (modalOpen && fnsRef.current?.getMessage) {
      text = fnsRef.current.getMessage();
    } else if (getMessage) {
      text = getMessage();
    } else {
      // Capturar el texto visible real de la pantalla, filtrar líneas vacías
      text = document.body.innerText
        .split("\n")
        .map((l) => l.trim())
        .filter((l) => l.length > 0)
        .join("\n");
    }
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const ta = document.createElement("textarea");
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
    }
  };

  const handleWaSend = () => {
    const cleanedCc  = cc.replace(/\D/g, "");
    const cleanedNum = num.replace(/\D/g, "");
    localStorage.setItem(LS_KEY_CC, cc);
    if (cleanedNum) localStorage.setItem(LS_KEY, num);
    const text   = encodeURIComponent(activeGetMsg());
    const fullNum = cleanedNum ? `${cleanedCc}${cleanedNum}` : "";
    window.open(fullNum
      ? `https://wa.me/${fullNum}?text=${text}`
      : `https://wa.me/?text=${text}`, "_blank");
    setWaOpen(false); setOpen(false);
  };

  if (!mounted) return null;

  return createPortal(
    <div
      ref={ref}
      style={{ zIndex: 9999 }}
      className="pb-fab-root fixed bottom-5 right-5 flex flex-col items-end gap-2 select-none"
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
        <div className="bg-white rounded-2xl shadow-2xl border border-gray-200 p-4 w-72 mb-1">
          <p className="text-xs font-bold text-gray-600 mb-2">📲 Número destino</p>

          {/* Selector rápido de código de país */}
          <div className="flex gap-1.5 mb-2">
            {CC_OPTIONS.map((o) => (
              <button
                key={o.code}
                onClick={() => setCc(o.code)}
                className={`flex-1 py-1 rounded-lg text-xs font-semibold border transition-all ${
                  cc === o.code
                    ? "bg-[#1E8C3A] text-white border-[#1E8C3A]"
                    : "bg-gray-50 text-gray-600 border-gray-200 hover:bg-gray-100"
                }`}
              >
                {o.flag} +{o.code}
              </button>
            ))}
          </div>

          {/* Input: código + número local */}
          <div className="flex items-center border border-gray-300 rounded-lg overflow-hidden
            focus-within:ring-2 focus-within:ring-green-400 mb-1">
            <span className="px-2.5 py-2 text-sm font-bold text-gray-500 bg-gray-50
              border-r border-gray-300 select-none whitespace-nowrap">
              +{cc}
            </span>
            <input
              type="tel"
              value={num}
              onChange={(e) => setNum(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleWaSend()}
              placeholder="8295551234"
              autoFocus
              className="flex-1 px-3 py-2 text-sm text-gray-800 outline-none bg-white"
            />
          </div>
          <p className="text-xs text-gray-400 mb-3">Opcional · recuerda el último número y código</p>

          <div className="flex gap-2">
            <button
              onClick={() => setWaOpen(false)}
              className="flex-1 py-2 rounded-lg border border-gray-200 text-xs text-gray-600
                hover:bg-gray-50 transition"
            >
              Cancelar
            </button>
            <button
              onClick={handleWaSend}
              className="flex-1 py-2 rounded-lg bg-[#1E8C3A] hover:bg-green-700
                active:scale-95 text-white text-xs font-semibold transition-all"
            >
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
