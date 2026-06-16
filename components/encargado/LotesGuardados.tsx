"use client";

import { useState, useEffect, useMemo } from "react";
import { collection, onSnapshot } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { LoteLoker, toDate } from "@/lib/types";
import BuscadorArea, { coincide } from "@/components/shared/BuscadorArea";

// YYYY-MM-DD en hora local del dispositivo (RD = UTC-4), igual que registra
// RegistroLote — así el filtro por día coincide con la fecha mostrada.
function localISO(d: Date): string {
  const p = (x: number) => String(x).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function fmtFechaHora(ts: LoteLoker["timestamp"]): string {
  const d = toDate(ts);
  if (!d.getTime()) return "—";
  return d.toLocaleString("es-DO", {
    day: "2-digit", month: "short", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
}

function totalUds(lote: LoteLoker): number {
  return (lote.productos ?? []).reduce((s, p) => s + (p.total ?? 0), 0);
}

// Mensaje de WhatsApp con el detalle del lote (wa.me sin número → el Encargado
// elige a quién enviarlo).
function buildLoteWa(lote: LoteLoker): string {
  const lines = [
    `📦 *LOTE ${lote.numero} — POLAR BREEZE*`,
    `📅 ${fmtFechaHora(lote.timestamp)}`,
    ...(lote.proveedor ? [`🏷️ Proveedor: ${lote.proveedor}`] : []),
    ...(lote.facturaNumero ? [`🧾 Factura: ${lote.facturaNumero}`] : []),
    "",
    ...(lote.productos ?? []).map(p => `• ${p.nombre}: *${p.total} uds*`),
    "",
    `Total: ${totalUds(lote)} uds · ${(lote.productos ?? []).length} producto${(lote.productos ?? []).length !== 1 ? "s" : ""}`,
  ].join("\n");
  return `https://wa.me/?text=${encodeURIComponent(lines)}`;
}

export default function LotesGuardados() {
  const [lotes,   setLotes]   = useState<LoteLoker[]>([]);
  const [cargado, setCargado] = useState(false);
  const [error,   setError]   = useState<string | null>(null);
  const [fecha,   setFecha]   = useState("");                 // "" = todos los días
  const [q,       setQ]       = useState("");                 // búsqueda por número/proveedor
  const [abierto, setAbierto] = useState<string | null>(null); // id del lote expandido

  // Suscripción viva a lotes_loker. Sin orderBy (evita índice compuesto), se
  // ordena en cliente por fecha desc — patrón usado en el resto del proyecto.
  useEffect(() => {
    const unsub = onSnapshot(
      collection(db, "lotes_loker"),
      (snap) => {
        const arr = snap.docs.map(d => ({ id: d.id, ...d.data() } as LoteLoker));
        arr.sort((a, b) => toDate(b.timestamp).getTime() - toDate(a.timestamp).getTime());
        setLotes(arr);
        setError(null);
        setCargado(true);
      },
      (err) => {
        setError(
          err?.code === "permission-denied"
            ? "No se pudo leer los lotes: sin permiso sobre lotes_loker. Revisa/despliega las reglas Firestore."
            : "No se pudo leer los lotes guardados."
        );
        setCargado(true);
      }
    );
    return unsub;
  }, []);

  const visibles = useMemo(
    () => lotes.filter(l =>
      (!fecha || localISO(toDate(l.timestamp)) === fecha) &&
      coincide(q, l.numero, l.proveedor, ...l.productos.map(p => p.nombre))
    ),
    [lotes, fecha, q],
  );

  const hoy = localISO(new Date());

  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
      {/* Header del card */}
      <div className="px-4 py-3 bg-[#1A1A1A] pb-print-flat flex items-center justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-white font-bold text-sm flex items-center gap-1.5">
            🗂️ Lotes guardados
            {cargado && !error && (
              <span className="bg-[#F5C800] text-[#1A1A1A] text-[10px] font-black px-1.5 py-0.5 rounded-full leading-none">
                {visibles.length}
              </span>
            )}
          </h2>
          <p className="text-gray-400 text-xs mt-0.5">Historial de mercancía recibida en el loker</p>
        </div>
      </div>
      {/* Banda tricolor */}
      <div className="h-[3px] flex pb-print-band">
        <div className="flex-1 bg-[#F5C800]" />
        <div className="flex-1 bg-[#D42B2B]" />
        <div className="flex-1 bg-[#1E8C3A]" />
      </div>

      {/* Buscador contextual por número / proveedor / producto */}
      {cargado && !error && lotes.length > 0 && (
        <div className="no-print px-4 pt-2.5 border-b border-gray-100 bg-gray-50/60">
          <BuscadorArea value={q} onChange={setQ} placeholder="Buscar lote por número, proveedor o producto…" />
        </div>
      )}

      {/* Barra de búsqueda por fecha */}
      {cargado && !error && lotes.length > 0 && (
        <div className="no-print flex flex-wrap items-center gap-2 px-4 py-2.5 border-b border-gray-100 bg-gray-50/60">
          <label className="text-xs font-semibold text-gray-600 flex items-center gap-1.5">
            📅 Fecha:
            <input
              type="date"
              value={fecha}
              max={hoy}
              onChange={(e) => { setFecha(e.target.value); setAbierto(null); }}
              className="border border-gray-200 rounded-lg px-2 py-1 text-xs text-gray-800
                focus:outline-none focus:ring-2 focus:ring-[#1E8C3A]/30"
            />
          </label>
          <button
            type="button"
            onClick={() => { setFecha(hoy); setAbierto(null); }}
            className={`px-2.5 py-1 rounded-md text-xs font-semibold transition-all ${
              fecha === hoy ? "bg-[#1E8C3A] text-white" : "bg-gray-100 text-gray-600 hover:bg-gray-200"
            }`}
          >
            Hoy
          </button>
          {fecha && (
            <button
              type="button"
              onClick={() => { setFecha(""); setAbierto(null); }}
              className="ml-auto px-2.5 py-1 rounded-md text-xs font-semibold text-gray-500
                hover:bg-gray-100 transition-all"
            >
              ✕ Todos
            </button>
          )}
        </div>
      )}

      {!cargado ? (
        <div className="px-4 py-12 text-center">
          <p className="text-sm text-gray-400 animate-pulse">Cargando lotes…</p>
        </div>
      ) : error ? (
        <div className="px-4 py-10 text-center">
          <p className="text-3xl mb-2">⚠️</p>
          <p className="text-sm font-semibold text-red-600">{error}</p>
        </div>
      ) : lotes.length === 0 ? (
        <div className="px-4 py-12 text-center">
          <p className="text-3xl mb-2">📦</p>
          <p className="text-sm font-semibold text-gray-600">Sin lotes registrados</p>
          <p className="text-xs text-gray-400 mt-1">Registra el primer lote en el tab 📦 Lote.</p>
        </div>
      ) : visibles.length === 0 ? (
        <div className="px-4 py-12 text-center">
          <p className="text-3xl mb-2">🔍</p>
          <p className="text-sm font-semibold text-gray-600">Sin lotes en esa fecha</p>
          <p className="text-xs text-gray-400 mt-1">Prueba otro día o muestra todos.</p>
        </div>
      ) : (
        <div className="divide-y divide-gray-100">
          {visibles.map((lote) => {
            const id = lote.id ?? lote.numero;
            const expandido = abierto === id;
            return (
              <div key={id}>
                {/* Fila resumen — clic para expandir */}
                <button
                  type="button"
                  onClick={() => setAbierto(expandido ? null : id)}
                  className="w-full text-left px-4 py-3 hover:bg-gray-50 active:bg-gray-100 transition-colors"
                >
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="text-[#1E8C3A] text-base flex-shrink-0">📦</span>
                      <div className="min-w-0">
                        <p className="text-sm font-bold text-gray-800 leading-tight">
                          Lote {lote.numero}
                          {lote.proveedor && (
                            <span className="font-medium text-gray-500"> · {lote.proveedor}</span>
                          )}
                        </p>
                        <p className="text-[11px] text-gray-400 leading-tight mt-0.5">
                          {fmtFechaHora(lote.timestamp)}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <span className="text-xs font-bold tabular-nums bg-green-100 text-green-700
                        border border-green-200 px-2.5 py-0.5 rounded-full">
                        {totalUds(lote)} uds
                      </span>
                      <span className={`no-print text-gray-400 text-xs transition-transform ${expandido ? "rotate-90" : ""}`}>
                        ▶
                      </span>
                    </div>
                  </div>
                  {/* Sub-línea: factura + nº productos */}
                  <div className="flex items-center gap-2 mt-1.5 pl-7">
                    {lote.facturaNumero ? (
                      <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full border ${
                        lote.facturaEntregada
                          ? "bg-green-50 text-green-700 border-green-200"
                          : "bg-amber-50 text-amber-700 border-amber-200"
                      }`}>
                        🧾 {lote.facturaNumero}{lote.facturaEntregada ? " ✓" : " pend."}
                      </span>
                    ) : (
                      <span className="text-[10px] text-gray-400">Sin factura</span>
                    )}
                    <span className="text-[10px] text-gray-400">
                      {(lote.productos ?? []).length} producto{(lote.productos ?? []).length !== 1 ? "s" : ""}
                    </span>
                  </div>
                </button>

                {/* Detalle expandido */}
                {expandido && (
                  <div className="px-4 pb-3 pt-1 bg-gray-50/60">
                    <div className="rounded-lg border border-gray-100 bg-white overflow-hidden">
                      {(lote.productos ?? []).map((p, i) => (
                        <div
                          key={`${id}-${p.producto_id}-${i}`}
                          className="flex items-center justify-between gap-3 px-3 py-2 border-b border-gray-50 last:border-0"
                        >
                          <p className="text-xs text-gray-700 truncate">{p.nombre}</p>
                          <span className="text-xs font-semibold tabular-nums text-gray-500 flex-shrink-0">
                            {p.cajas > 0 && <span className="text-gray-400">{p.cajas} cj </span>}
                            {p.unidades > 0 && <span className="text-gray-400">{p.unidades} ud </span>}
                            <span className="text-gray-800">= {p.total}</span>
                          </span>
                        </div>
                      ))}
                    </div>
                    {lote.registradoPor && (
                      <p className="text-[10px] text-gray-400 mt-2">
                        Registrado por {lote.registradoPor}
                      </p>
                    )}
                    {lote.notas && (
                      <p className="text-[11px] text-gray-500 mt-1 italic">“{lote.notas}”</p>
                    )}
                    <a
                      href={buildLoteWa(lote)}
                      target="_blank" rel="noopener noreferrer"
                      className="no-print mt-2.5 inline-flex items-center gap-1.5 bg-green-500 hover:bg-green-600
                        active:scale-95 text-white text-xs font-bold px-3 py-1.5 rounded-lg transition-all"
                    >
                      📱 Compartir
                    </a>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
