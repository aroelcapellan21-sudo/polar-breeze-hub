"use client";

/**
 * SearchableSelect — reemplazo de <select> nativo para listas largas (Mejora #45).
 *
 * Buscador en tiempo real (insensible a tildes/mayúsculas, vía `coincide` de
 * BuscadorArea) + botón "✕ Cerrar" explícito para salir sin completar la
 * selección — el <select> nativo no permite ninguna de las dos cosas.
 */

import { useEffect, useRef, useState } from "react";
import { coincide } from "./BuscadorArea";

export interface SearchableOption {
  id:       string;
  label:    string;
  sublabel?: string;
  disabled?: boolean;
}

interface Props {
  value:       string;
  onChange:    (id: string) => void;
  options:     SearchableOption[];
  placeholder?: string;
  emptyLabel?:  string;
  disabled?:    boolean;
  className?:   string;
}

export default function SearchableSelect({
  value, onChange, options, placeholder = "Buscar…", emptyLabel = "Elegir…",
  disabled = false, className = "",
}: Props) {
  const [busqueda, setBusqueda] = useState("");
  const [showDrop, setShowDrop] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const selected  = options.find((o) => o.id === value) ?? null;
  const filtrado  = options.filter((o) => coincide(busqueda, o.label, o.sublabel));

  useEffect(() => {
    if (!showDrop) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setShowDrop(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [showDrop]);

  return (
    <div className={`relative ${className}`} ref={ref}>
      <button
        type="button"
        onClick={() => { setShowDrop((v) => !v); setBusqueda(""); }}
        disabled={disabled}
        className={`w-full flex items-center justify-between gap-2 border rounded-lg px-3 py-2 text-sm
          text-left focus:outline-none focus:ring-2 focus:ring-blue-400 disabled:opacity-50
          disabled:cursor-not-allowed ${
          selected ? "border-blue-400 bg-blue-50 text-blue-900 font-medium" : "border-gray-300 bg-white text-gray-500"
        }`}
      >
        <span className="truncate">{selected ? selected.label : emptyLabel}</span>
        <span className="text-gray-400 flex-shrink-0 text-xs">{showDrop ? "▲" : "▼"}</span>
      </button>

      {showDrop && (
        <div className="absolute z-30 left-0 right-0 top-full mt-1 bg-white border border-gray-200
          rounded-xl shadow-2xl overflow-hidden">
          <div className="flex items-center gap-1.5 border-b border-gray-100 p-2">
            <input
              autoFocus
              type="text"
              value={busqueda}
              onChange={(e) => setBusqueda(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Escape") setShowDrop(false); }}
              placeholder={placeholder}
              className="flex-1 min-w-0 border border-gray-200 rounded-lg px-2 py-1.5 text-sm
                focus:outline-none focus:ring-2 focus:ring-blue-400"
            />
            <button
              type="button"
              onClick={() => setShowDrop(false)}
              title="Cerrar sin elegir"
              className="flex-shrink-0 px-2.5 h-8 flex items-center justify-center gap-1 rounded-lg
                text-xs font-semibold text-gray-500 hover:bg-gray-100 hover:text-gray-700 transition-colors"
            >
              ✕ Cerrar
            </button>
          </div>
          <div className="max-h-56 overflow-y-auto">
            {filtrado.length === 0 ? (
              <div className="px-4 py-3 text-sm text-gray-400 text-center">Sin resultados</div>
            ) : (
              filtrado.map((o) => (
                <button
                  key={o.id}
                  type="button"
                  disabled={o.disabled}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => { if (o.disabled) return; onChange(o.id); setShowDrop(false); setBusqueda(""); }}
                  className={`w-full text-left px-3 py-2.5 text-sm border-b border-gray-100 last:border-0
                    transition-colors ${
                    o.disabled
                      ? "text-gray-400 cursor-not-allowed opacity-60"
                      : o.id === value ? "bg-blue-50 text-blue-800 font-semibold" : "text-gray-800 hover:bg-blue-50 active:bg-blue-100"
                  }`}
                >
                  <span className="flex items-center justify-between gap-2">
                    <span className="flex-1 min-w-0">
                      <span className="block truncate">{o.label}</span>
                      {o.sublabel && (
                        <span className={`block text-xs font-normal truncate ${o.disabled ? "text-red-500" : "text-gray-400"}`}>
                          {o.sublabel}
                        </span>
                      )}
                    </span>
                    {o.id === value && <span className="text-blue-500 flex-shrink-0">✓</span>}
                  </span>
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
