"use client";

/**
 * Reposicion — Módulo de reposición inteligente (Mejora #9)
 *
 * El Encargado fija un MÍNIMO manual por producto. El módulo sugiere reponer
 * cuando el stock cae por debajo del mínimo (pedir = mínimo − stock) y arma un
 * pedido para BON que se puede compartir por WhatsApp. Muestra además el
 * consumo diario reciente (informativo) para ayudar a fijar el mínimo.
 *
 * Los mínimos se persisten en localStorage (pb_minimos) — marcador local del
 * Encargado, sin cambiar el formato de datos en Firestore.
 */

import { useState, useEffect, useMemo } from "react";
import { collection, query, orderBy, onSnapshot } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { MovimientoLoker, toDate } from "@/lib/types";
import BuscadorArea, { coincide } from "@/components/shared/BuscadorArea";

const VENTANA_DIAS = 14; // ventana para el consumo diario informativo

type Fila = {
  pid: string;
  nombre: string;
  stock: number;
  minimo: number;
  pedir: number;            // max(0, minimo - stock)
  consumoDia: number;       // salidas recientes / VENTANA_DIAS
  estado: "critico" | "bajo" | "ok" | "sinminimo";
};

export default function Reposicion() {
  const [movs,    setMovs]    = useState<MovimientoLoker[]>([]);
  const [cargado, setCargado] = useState(false);
  const [error,   setError]   = useState<string | null>(null);
  const [minimos, setMinimos] = useState<Record<string, number>>({});
  const [filtro,  setFiltro]  = useState<"reponer" | "todos">("reponer");
  const [q,       setQ]       = useState("");

  // Cargar mínimos guardados
  useEffect(() => {
    try {
      const raw = localStorage.getItem("pb_minimos");
      setMinimos(raw ? (JSON.parse(raw) as Record<string, number>) : {});
    } catch { setMinimos({}); }
  }, []);

  function setMinimo(pid: string, n: number) {
    setMinimos((prev) => {
      const next = { ...prev, [pid]: Math.max(0, n) };
      if (!n) delete next[pid];
      try { localStorage.setItem("pb_minimos", JSON.stringify(next)); } catch {/* bloqueado */}
      return next;
    });
  }

  // Stock en vivo
  useEffect(() => {
    const unsub = onSnapshot(
      query(collection(db, "movimientos_loker"), orderBy("timestamp", "desc")),
      (snap) => {
        setMovs(snap.docs.map((d) => ({ id: d.id, ...d.data() } as MovimientoLoker)));
        setError(null);
        setCargado(true);
      },
      (err) => {
        setError(
          err?.code === "permission-denied"
            ? "No se pudo leer el stock: sin permiso sobre movimientos_loker."
            : "No se pudo leer el stock del loker."
        );
        setCargado(true);
      }
    );
    return unsub;
  }, []);

  const filas = useMemo<Fila[]>(() => {
    const desde = Date.now() - VENTANA_DIAS * 86_400_000;
    const stockMap   = new Map<string, { nombre: string; stock: number }>();
    const consumoMap = new Map<string, number>(); // salidas (abs) en la ventana
    for (const m of movs) {
      const prev = stockMap.get(m.producto_id) ?? { nombre: m.nombre, stock: 0 };
      stockMap.set(m.producto_id, { nombre: m.nombre, stock: prev.stock + m.cantidad });
      if (m.cantidad < 0 && toDate(m.timestamp).getTime() >= desde) {
        consumoMap.set(m.producto_id, (consumoMap.get(m.producto_id) ?? 0) + Math.abs(m.cantidad));
      }
    }
    return Array.from(stockMap.entries()).map(([pid, d]) => {
      const minimo     = minimos[pid] ?? 0;
      const pedir      = minimo > 0 ? Math.max(0, minimo - d.stock) : 0;
      const consumoDia = (consumoMap.get(pid) ?? 0) / VENTANA_DIAS;
      const estado: Fila["estado"] =
        minimo <= 0           ? "sinminimo"
        : d.stock <= 0        ? "critico"
        : d.stock < minimo    ? "bajo"
        :                       "ok";
      return { pid, nombre: d.nombre, stock: d.stock, minimo, pedir, consumoDia, estado };
    });
  }, [movs, minimos]);

  const orden = { critico: 0, bajo: 1, ok: 2, sinminimo: 3 } as const;
  const ordenadas = useMemo(
    () => [...filas].sort((a, b) =>
      orden[a.estado] - orden[b.estado] || b.pedir - a.pedir || a.nombre.localeCompare(b.nombre, "es")
    ),
    [filas],
  );

  const porReponer = useMemo(() => ordenadas.filter((f) => f.pedir > 0), [ordenadas]);
  const visibles   = (filtro === "reponer" ? porReponer : ordenadas).filter((f) => coincide(q, f.nombre));
  const nCritico   = porReponer.filter((f) => f.estado === "critico").length;
  const nBajo      = porReponer.filter((f) => f.estado === "bajo").length;
  const totalPedir = porReponer.reduce((s, f) => s + f.pedir, 0);

  function buildWa(): string {
    const fecha = new Date().toLocaleDateString("es-DO", { day: "2-digit", month: "short", year: "numeric" });
    const lines = [
      "♻️ *PEDIDO DE REPOSICIÓN — POLAR BREEZE*",
      `📅 ${fecha}`,
      "",
      ...porReponer.map((f) => `• ${f.nombre}: *pedir ${f.pedir}* (stock ${f.stock}, mín ${f.minimo})`),
      "",
      `Total a pedir: ${totalPedir} uds · ${porReponer.length} producto${porReponer.length !== 1 ? "s" : ""}`,
    ].join("\n");
    return `https://wa.me/?text=${encodeURIComponent(lines)}`;
  }

  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
      {/* Header */}
      <div className="px-4 py-3 bg-[#1A1A1A] pb-print-flat flex items-center justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-white font-bold text-sm flex items-center gap-1.5">
            ♻️ Reposición
            {cargado && !error && porReponer.length > 0 && (
              <span className="bg-[#D42B2B] text-white text-[10px] font-black px-1.5 py-0.5 rounded-full leading-none">
                {porReponer.length}
              </span>
            )}
          </h2>
          <p className="text-gray-400 text-xs mt-0.5">Sugerencias según stock vs. mínimo por producto</p>
        </div>
        {cargado && !error && porReponer.length > 0 && (
          <a
            href={buildWa()}
            target="_blank" rel="noopener noreferrer"
            className="no-print flex-shrink-0 flex items-center gap-1.5 bg-green-500 hover:bg-green-600
              active:scale-95 text-white text-xs font-bold px-3 py-1.5 rounded-lg transition-all"
          >
            📱 Compartir pedido
          </a>
        )}
      </div>
      {/* Banda tricolor */}
      <div className="h-[3px] flex pb-print-band">
        <div className="flex-1 bg-[#F5C800]" />
        <div className="flex-1 bg-[#D42B2B]" />
        <div className="flex-1 bg-[#1E8C3A]" />
      </div>

      {/* Buscador contextual por producto */}
      {cargado && !error && filas.length > 0 && (
        <div className="no-print px-4 pt-2.5 bg-gray-50/60">
          <BuscadorArea value={q} onChange={setQ} placeholder="Buscar producto…" />
        </div>
      )}

      {/* Filtro + resumen */}
      {cargado && !error && filas.length > 0 && (
        <div className="no-print flex items-center gap-2 px-4 py-2.5 border-b border-gray-100 bg-gray-50/60">
          <div className="flex bg-gray-100 rounded-lg p-0.5">
            <button
              type="button"
              onClick={() => setFiltro("reponer")}
              className={`px-3 py-1 rounded-md text-xs font-semibold transition-all ${
                filtro === "reponer" ? "bg-white text-[#D42B2B] shadow-sm" : "text-gray-500"
              }`}
            >
              Por reponer
            </button>
            <button
              type="button"
              onClick={() => setFiltro("todos")}
              className={`px-3 py-1 rounded-md text-xs font-semibold transition-all ${
                filtro === "todos" ? "bg-white text-gray-800 shadow-sm" : "text-gray-500"
              }`}
            >
              Todos (fijar mínimos)
            </button>
          </div>
          <div className="ml-auto flex items-center gap-2 text-[11px] font-semibold">
            {nCritico > 0 && <span className="text-[#D42B2B]">🔴 {nCritico}</span>}
            {nBajo > 0 && <span className="text-amber-600">🟡 {nBajo}</span>}
          </div>
        </div>
      )}

      {!cargado ? (
        <div className="px-4 py-12 text-center">
          <p className="text-sm text-gray-400 animate-pulse">Cargando stock…</p>
        </div>
      ) : error ? (
        <div className="px-4 py-10 text-center">
          <p className="text-3xl mb-2">⚠️</p>
          <p className="text-sm font-semibold text-red-600">{error}</p>
        </div>
      ) : filas.length === 0 ? (
        <div className="px-4 py-12 text-center">
          <p className="text-3xl mb-2">📦</p>
          <p className="text-sm font-semibold text-gray-600">Sin productos en stock</p>
          <p className="text-xs text-gray-400 mt-1">Registra entradas para empezar a fijar mínimos.</p>
        </div>
      ) : visibles.length === 0 ? (
        <div className="px-4 py-12 text-center">
          <p className="text-3xl mb-2">🎉</p>
          <p className="text-sm font-semibold text-gray-600">Nada por reponer</p>
          <p className="text-xs text-gray-400 mt-1">Ningún producto está bajo su mínimo. Usa “Todos” para fijar mínimos.</p>
        </div>
      ) : (
        <div className="divide-y divide-gray-100">
          {visibles.map((f) => {
            const icon = f.estado === "critico" ? "🔴" : f.estado === "bajo" ? "🟡" : f.estado === "ok" ? "🟢" : "⚪";
            const cobertura = f.consumoDia > 0 ? (f.stock / f.consumoDia) : null;
            return (
              <div key={f.pid} className="px-4 py-3">
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="text-sm flex-shrink-0">{icon}</span>
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-gray-800 truncate">{f.nombre}</p>
                      <p className="text-[11px] text-gray-400">
                        Stock {f.stock}
                        {f.consumoDia > 0 && ` · consumo ~${f.consumoDia.toFixed(1)}/día`}
                        {cobertura != null && f.stock > 0 && ` · cobertura ${cobertura.toFixed(0)} d`}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    {f.pedir > 0 && (
                      <span className="text-xs font-bold tabular-nums bg-red-100 text-red-700
                        border border-red-200 px-2.5 py-0.5 rounded-full">
                        pedir {f.pedir}
                      </span>
                    )}
                    <label className="no-print flex items-center gap-1 text-[11px] text-gray-500">
                      mín
                      <input
                        type="number"
                        min={0}
                        value={f.minimo || ""}
                        onChange={(e) => setMinimo(f.pid, Number(e.target.value))}
                        placeholder="0"
                        className="w-14 text-center border border-gray-200 rounded-lg px-1 py-1 text-sm
                          text-gray-800 focus:outline-none focus:ring-2 focus:ring-[#1E8C3A]/30"
                      />
                    </label>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
