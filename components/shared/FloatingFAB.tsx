"use client";

import { useState, useEffect, useRef } from "react";

const LS_KEY = "wa_last_number";

interface Props {
  getMessage?: () => string;
  getPrintHtml?: () => string;
}

export default function FloatingFAB({ getMessage, getPrintHtml }: Props) {
  const [open,   setOpen]   = useState(false);
  const [waOpen, setWaOpen] = useState(false);
  const [num,    setNum]    = useState("");
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => { setNum(localStorage.getItem(LS_KEY) ?? ""); }, []);

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

  const handlePrint = () => {
    setOpen(false);
    if (getPrintHtml) {
      const html = getPrintHtml();
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
    const msg  = getMessage ? getMessage() : document.title;
    const text = encodeURIComponent(msg);
    const url  = cleaned
      ? `https://wa.me/${cleaned}?text=${text}`
      : `https://wa.me/?text=${text}`;
    window.open(url, "_blank");
    setWaOpen(false);
    setOpen(false);
  };

  return (
    <div ref={ref} className="fixed bottom-5 right-5 z-40 flex flex-col items-end gap-2 select-none">

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

      {/* Botón principal */}
      <button
        type="button"
        title="Imprimir / WhatsApp"
        onClick={() => { setOpen((o) => !o); setWaOpen(false); }}
        className={`w-14 h-14 rounded-full shadow-xl flex items-center justify-center
          text-2xl transition-all duration-200 active:scale-90 ${
          open
            ? "bg-gray-600 hover:bg-gray-700 text-white"
            : "bg-purple-700 hover:bg-purple-800 text-white"
        }`}
      >
        {open ? "✕" : "📤"}
      </button>
    </div>
  );
}
