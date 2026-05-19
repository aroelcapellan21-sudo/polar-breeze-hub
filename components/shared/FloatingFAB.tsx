"use client";

import { useState, useEffect, useRef } from "react";
import { useModalShare } from "./ModalShareContext";

const LS_KEY = "wa_last_number";

interface Props {
  /** Mensaje WhatsApp cuando no hay modal abierto */
  getMessage?: () => string;
  /** HTML imprimible cuando no hay modal abierto */
  getPrintHtml?: () => string;
}

export default function FloatingFAB({ getMessage, getPrintHtml }: Props) {
  const { isOpen: modalOpen, fnsRef } = useModalShare();

  const [open,   setOpen]   = useState(false);
  const [waOpen, setWaOpen] = useState(false);
  const [num,    setNum]    = useState("");
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => { setNum(localStorage.getItem(LS_KEY) ?? ""); }, []);

  // Cierra al hacer clic fuera
  useEffect(() => {
    if (!open && !waOpen) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
        setWaOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open, waOpen]);

  // Función de mensaje activa: modal > prop > título de página
  const activeGetMsg = (): string => {
    if (modalOpen && fnsRef.current?.getMessage) return fnsRef.current.getMessage();
    return getMessage ? getMessage() : document.title;
  };

  const handlePrint = () => {
    setOpen(false);
    // Primero intenta la función de print del modal, luego la del prop
    const modalPrint = modalOpen ? fnsRef.current?.getPrintHtml?.() : "";
    const html = modalPrint || (getPrintHtml ? getPrintHtml() : "");
    if (html) {
      const win = window.open("", "_blank");
      if (!win) return;
      win.document.write(html);
      win.document.close();
      win.onload = () => win.print();
    } else {
      window.print();
    }
  };

  const handleWaSend = () => {
    const cleaned = num.replace(/\D/g, "");
    if (cleaned) localStorage.setItem(LS_KEY, num);
    const text = encodeURIComponent(activeGetMsg());
    const url  = cleaned
      ? `https://wa.me/${cleaned}?text=${text}`
      : `https://wa.me/?text=${text}`;
    window.open(url, "_blank");
    setWaOpen(false);
    setOpen(false);
  };

  return (
    /* z-[60] — por encima de cualquier modal (z-50) */
    <div ref={ref} className="fixed bottom-5 right-5 z-[60] flex flex-col items-end gap-2 select-none">

      {/* Popover número WhatsApp */}
      {waOpen && (
        <div className="bg-white rounded-2xl shadow-2xl border border-gray-200 p-4 w-64 mb-1">
          <p className="text-xs font-semibold text-gray-600 mb-1.5">Número destino</p>
          <input
            type="tel"
            value={num}
            onChange={(e) => setNum(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleWaSend()}
            placeholder="521XXXXXXXXXX"
            autoFocus
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm
              text-gray-800 outline-none focus:ring-2 focus:ring-green-400 mb-1"
          />
          <p className="text-xs text-gray-400 mb-3">Opcional · recuerda el último número</p>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setWaOpen(false)}
              className="flex-1 py-2 rounded-lg border border-gray-200 text-xs
                text-gray-600 hover:bg-gray-50 transition"
            >
              Cancelar
            </button>
            <button
              type="button"
              onClick={handleWaSend}
              className="flex-1 py-2 rounded-lg bg-green-500 hover:bg-green-600
                active:scale-95 text-white text-xs font-semibold transition-all"
            >
              Enviar ↗
            </button>
          </div>
        </div>
      )}

      {/* Acciones expandidas */}
      {open && !waOpen && (
        <div className="flex flex-col items-end gap-2">
          <button
            type="button"
            onClick={() => setWaOpen(true)}
            className="flex items-center gap-2 px-4 py-2.5 bg-green-500 hover:bg-green-600
              active:scale-95 text-white rounded-full shadow-lg text-sm font-semibold
              transition-all duration-150 whitespace-nowrap"
          >
            📱 WhatsApp
          </button>
          <button
            type="button"
            onClick={handlePrint}
            className="flex items-center gap-2 px-4 py-2.5 bg-gray-700 hover:bg-gray-800
              active:scale-95 text-white rounded-full shadow-lg text-sm font-semibold
              transition-all duration-150 whitespace-nowrap"
          >
            🖨️ Imprimir
          </button>
        </div>
      )}

      {/* Botón principal — muestra un indicador cuando hay modal activo */}
      <button
        type="button"
        title={modalOpen ? "Compartir contenido del modal" : "Imprimir / WhatsApp"}
        onClick={() => { setOpen((o) => !o); setWaOpen(false); }}
        className={`w-14 h-14 rounded-full shadow-xl flex items-center justify-center
          text-2xl transition-all duration-200 active:scale-90 relative ${
          open
            ? "bg-gray-600 hover:bg-gray-700 text-white"
            : "bg-purple-700 hover:bg-purple-800 text-white"
        }`}
      >
        {open ? "✕" : "📤"}
        {/* Punto verde cuando hay modal con contenido activo */}
        {!open && modalOpen && (
          <span className="absolute -top-0.5 -right-0.5 w-3.5 h-3.5 bg-green-400
            rounded-full border-2 border-white" />
        )}
      </button>
    </div>
  );
}
