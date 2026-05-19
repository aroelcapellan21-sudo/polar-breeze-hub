"use client";

import { useState, useEffect, useRef } from "react";

const LS_KEY = "wa_last_number";

function WaButton({ getMessage }: { getMessage: () => string }) {
  const [open, setOpen] = useState(false);
  const [num,  setNum]  = useState("");
  const ref = useRef<HTMLDivElement>(null);

  // Hydrate from localStorage on the client (avoids SSR mismatch)
  useEffect(() => { setNum(localStorage.getItem(LS_KEY) ?? ""); }, []);

  // Close popover when clicking outside
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  const send = () => {
    const cleaned = num.replace(/\D/g, "");
    if (cleaned) localStorage.setItem(LS_KEY, num);
    const text = encodeURIComponent(getMessage());
    const url  = cleaned
      ? `https://wa.me/${cleaned}?text=${text}`
      : `https://wa.me/?text=${text}`;
    window.open(url, "_blank");
    setOpen(false);
  };

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-1.5 px-3 py-1.5 bg-green-500 hover:bg-green-600
          active:scale-95 text-white rounded-lg text-xs font-medium transition-all duration-100"
      >
        💬 WhatsApp
      </button>

      {open && (
        <div className="absolute z-50 top-full mt-1.5 right-0 bg-white rounded-xl
          shadow-xl border border-gray-200 p-3 w-60">
          <p className="text-xs font-semibold text-gray-600 mb-1.5">Número destino</p>
          <input
            type="tel"
            value={num}
            onChange={(e) => setNum(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && send()}
            placeholder="521XXXXXXXXXX"
            autoFocus
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm
              text-gray-800 outline-none focus:ring-2 focus:ring-green-400 mb-1"
          />
          <p className="text-xs text-gray-400 mb-3">Opcional · recuerda el último número</p>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="flex-1 py-1.5 rounded-lg border border-gray-200 text-xs
                text-gray-600 hover:bg-gray-50 transition"
            >
              Cancelar
            </button>
            <button
              type="button"
              onClick={send}
              className="flex-1 py-1.5 rounded-lg bg-green-500 hover:bg-green-600
                active:scale-95 text-white text-xs font-semibold transition-all"
            >
              Enviar ↗
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export function ShareBar({
  getMessage,
  getPrintHtml,
  className = "",
}: {
  getMessage: () => string;
  getPrintHtml?: () => string;
  className?: string;
}) {
  const handlePrint = () => {
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

  return (
    <div className={`flex items-center gap-2 ${className}`}>
      <WaButton getMessage={getMessage} />
      <button
        type="button"
        onClick={handlePrint}
        className="flex items-center gap-1.5 px-3 py-1.5 bg-gray-600 hover:bg-gray-700
          active:scale-95 text-white rounded-lg text-xs font-medium transition-all duration-100"
      >
        🖨️ Imprimir
      </button>
    </div>
  );
}
