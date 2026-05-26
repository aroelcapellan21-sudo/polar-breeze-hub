"use client";

/**
 * PolarBreezeHTML — Carga e integra polar-breeze-final.html dentro del iframe.
 *
 * Para activar:
 *   1. Copia el archivo a /public/polar-breeze-final.html
 *   2. Este componente lo cargará automáticamente en el tab.
 */

import { useState, useEffect } from "react";

export default function PolarBreezeHTML() {
  const [available, setAvailable] = useState<boolean | null>(null);

  useEffect(() => {
    // Verificar si el archivo existe en /public
    fetch("/polar-breeze-final.html", { method: "HEAD" })
      .then((r) => setAvailable(r.ok))
      .catch(() => setAvailable(false));
  }, []);

  if (available === null) {
    return (
      <div className="flex items-center justify-center py-16">
        <span className="text-gray-400 text-sm animate-pulse">Cargando…</span>
      </div>
    );
  }

  if (!available) {
    return (
      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
        {/* Header */}
        <div className="px-4 py-3 bg-[#1A1A1A] flex items-center gap-3">
          <div
            className="w-8 h-8 rounded-lg flex items-center justify-center text-base flex-shrink-0"
            style={{ background: "linear-gradient(135deg, #F5C800 33%, #D42B2B 33% 66%, #1E8C3A 66%)" }}
          >
            📄
          </div>
          <div>
            <h2 className="text-white font-bold text-sm">polar-breeze-final.html</h2>
            <p className="text-gray-400 text-xs">Archivo no encontrado</p>
          </div>
        </div>
        <div className="flex h-0.5">
          <div className="flex-1 bg-[#F5C800]" />
          <div className="flex-1 bg-[#D42B2B]" />
          <div className="flex-1 bg-[#1E8C3A]" />
        </div>

        {/* Instrucciones */}
        <div className="px-6 py-8 text-center">
          <p className="text-4xl mb-3">📂</p>
          <p className="font-black text-gray-800 text-base mb-1">
            Archivo pendiente de agregar
          </p>
          <p className="text-sm text-gray-500 mb-4 max-w-xs mx-auto">
            Copia el archivo al proyecto y se integrará automáticamente aquí.
          </p>
          <div className="bg-gray-50 rounded-xl px-4 py-3 text-left text-xs font-mono text-gray-600 border border-gray-200">
            <p className="text-gray-400 mb-1"># Desde la terminal del proyecto:</p>
            <p className="text-[#1A1A1A] font-bold">
              cp ~/ruta/polar-breeze-final.html public/
            </p>
          </div>
          <p className="text-[10px] text-gray-400 mt-3">
            Después de copiarlo, recarga la página — no hace falta redeploy.
          </p>
        </div>
      </div>
    );
  }

  // Archivo disponible → cargar en iframe full-height
  return (
    <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
      <div className="px-4 py-3 bg-[#1A1A1A] flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div
            className="w-7 h-7 rounded-lg flex items-center justify-center text-sm flex-shrink-0"
            style={{ background: "linear-gradient(135deg, #F5C800 33%, #D42B2B 33% 66%, #1E8C3A 66%)" }}
          >
            🧊
          </div>
          <h2 className="text-white font-bold text-sm">Polar Breeze — Vista integrada</h2>
        </div>
        <a
          href="/polar-breeze-final.html"
          target="_blank"
          rel="noopener noreferrer"
          className="text-xs text-gray-400 hover:text-white transition-colors underline"
        >
          Abrir en tab ↗
        </a>
      </div>
      <div className="flex h-0.5">
        <div className="flex-1 bg-[#F5C800]" />
        <div className="flex-1 bg-[#D42B2B]" />
        <div className="flex-1 bg-[#1E8C3A]" />
      </div>
      <iframe
        src="/polar-breeze-final.html"
        className="w-full border-0"
        style={{ height: "calc(100vh - 180px)", minHeight: "500px" }}
        title="Polar Breeze Final"
        allow="clipboard-write"
      />
    </div>
  );
}
