"use client";

/**
 * Reportes — Tab de reportes y sincronización del Hub Admin
 *
 * - Resumen de lotes recibidos del día/semana
 * - Panel de sincronización Google Sheets
 * - Exportar CSV de codigos_cajas
 * - Reporte de choferes: inventarios cerrados del día
 */

import { useState, useEffect } from "react";
import {
  collection, query, where, orderBy, limit,
  onSnapshot, Timestamp,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import { LoteLoker, MovimientoLoker, toDate, fmtDate } from "@/lib/types";
import SyncSheetsPanel from "@/components/shared/SyncSheetsPanel";

type PeriodoLotes = "hoy" | "semana" | "mes";

export default function Reportes() {
  const [periodo,  setPeriodo]  = useState<PeriodoLotes>("hoy");
  const [lotes,    setLotes]    = useState<LoteLoker[]>([]);
  const [movs,     setMovs]     = useState<MovimientoLoker[]>([]);
  const [loading,  setLoading]  = useState(true);

  // ── Fechas de referencia ───────────────────────────────────────────────────
  const fechaInicio = (): Date => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    if (periodo === "semana") { d.setDate(d.getDate() - 6); }
    if (periodo === "mes")    { d.setDate(d.getDate() - 29); }
    return d;
  };

  useEffect(() => {
    setLoading(true);
    const desde = Timestamp.fromDate(fechaInicio());

    const unsubLotes = onSnapshot(
      query(
        collection(db, "lotes_loker"),
        where("timestamp", ">=", desde),
        orderBy("timestamp", "desc"),
        limit(50),
      ),
      (snap) => {
        setLotes(snap.docs.map((d) => ({ id: d.id, ...d.data() } as LoteLoker)));
        setLoading(false);
      }
    );

    const unsubMovs = onSnapshot(
      query(
        collection(db, "movimientos_loker"),
        where("timestamp", ">=", desde),
        orderBy("timestamp", "desc"),
        limit(100),
      ),
      (snap) => setMovs(snap.docs.map((d) => ({ id: d.id, ...d.data() } as MovimientoLoker)))
    );

    return () => { unsubLotes(); unsubMovs(); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [periodo]);

  // ── Métricas derivadas ────────────────────────────────────────────────────
  const totalLotes     = lotes.length;
  const totalUnidades  = lotes.reduce((s, l) =>
    s + l.productos.reduce((ps, p) => ps + (p.total ?? 0), 0), 0);
  const pendFactura    = lotes.filter((l) => !l.facturaEntregada).length;
  const totalMovs      = movs.length;
  const entradas       = movs.filter((m) => m.cantidad > 0).reduce((s, m) => s + m.cantidad, 0);
  const salidas        = movs.filter((m) => m.cantidad < 0).reduce((s, m) => s + Math.abs(m.cantidad), 0);

  const PERIODO_LABELS: Record<PeriodoLotes, string> = {
    hoy:    "Hoy",
    semana: "Últimos 7 días",
    mes:    "Últimos 30 días",
  };

  return (
    <div className="space-y-6">
      {/* ── Encabezado ── */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-lg font-bold text-[#1A1A1A]">📊 Reportes y Exportación</h2>
          <p className="text-xs text-gray-400">Resumen operativo · Sincronización Google Sheets</p>
        </div>
        <div className="flex bg-gray-100 rounded-xl p-1 gap-1">
          {(["hoy", "semana", "mes"] as PeriodoLotes[]).map((p) => (
            <button key={p}
              onClick={() => setPeriodo(p)}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                periodo === p ? "bg-white shadow-sm text-[#1A1A1A]" : "text-gray-500 hover:text-gray-700"
              }`}
            >
              {PERIODO_LABELS[p]}
            </button>
          ))}
        </div>
      </div>

      {/* ── KPIs ── */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        {[
          { label: "Lotes recibidos", value: totalLotes, icon: "📦", color: "text-blue-700" },
          { label: "Total unidades",  value: totalUnidades.toLocaleString("es-DO"), icon: "🔢", color: "text-green-700" },
          { label: "Sin factura",     value: pendFactura, icon: "🧾", color: pendFactura > 0 ? "text-red-600" : "text-gray-400" },
          { label: "Movimientos",     value: totalMovs,   icon: "🔄", color: "text-purple-700" },
          { label: "Entradas loker",  value: entradas.toLocaleString("es-DO"), icon: "⬆️", color: "text-green-700" },
          { label: "Salidas loker",   value: salidas.toLocaleString("es-DO"),  icon: "⬇️", color: "text-orange-600" },
        ].map((kpi) => (
          <div key={kpi.label} className="bg-white rounded-xl shadow-sm p-4 text-center">
            <p className="text-2xl mb-1">{kpi.icon}</p>
            <p className={`text-xl font-black ${kpi.color}`}>{kpi.value}</p>
            <p className="text-xs text-gray-400 leading-tight mt-0.5">{kpi.label}</p>
          </div>
        ))}
      </div>

      {/* ── Grid: Lotes + Sync ── */}
      <div className="grid lg:grid-cols-2 gap-5">

        {/* Lotes recibidos */}
        <div className="bg-white rounded-xl shadow-sm p-5 space-y-3">
          <h3 className="font-bold text-sm text-[#1A1A1A] flex items-center gap-2">
            📦 Lotes recibidos
            <span className="text-xs font-normal text-gray-400">— {PERIODO_LABELS[periodo]}</span>
          </h3>

          {loading ? (
            <div className="space-y-2">
              {[1,2,3].map((i) => (
                <div key={i} className="h-12 bg-gray-100 rounded-lg animate-pulse" />
              ))}
            </div>
          ) : lotes.length === 0 ? (
            <div className="text-center py-8 text-gray-400">
              <p className="text-2xl mb-1">📦</p>
              <p className="text-sm">Sin lotes en este período</p>
            </div>
          ) : (
            <div className="space-y-2 max-h-64 overflow-y-auto">
              {lotes.map((l) => (
                <div key={l.id} className="flex items-center justify-between py-2 px-3
                  rounded-xl bg-gray-50 border border-gray-100">
                  <div>
                    <p className="text-sm font-bold text-gray-800">
                      Lote {l.numero}
                      {!l.facturaEntregada && (
                        <span className="ml-2 text-xs bg-red-100 text-red-600 px-1.5 py-0.5 rounded-full">
                          Sin factura
                        </span>
                      )}
                    </p>
                    <p className="text-xs text-gray-400">
                      {l.proveedor ?? "Proveedor —"} · {l.productos.length} productos · {fmtDate(l.timestamp)}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-bold text-blue-700">
                      {l.productos.reduce((s, p) => s + (p.total ?? 0), 0).toLocaleString("es-DO")}
                    </p>
                    <p className="text-xs text-gray-400">uds total</p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Sync Google Sheets */}
        <div className="space-y-4">
          <SyncSheetsPanel />

          {/* Acciones rápidas */}
          <div className="bg-white rounded-xl shadow-sm p-4 space-y-2">
            <p className="text-xs font-bold text-gray-600 mb-2">⚡ Acciones rápidas</p>
            <a href="/api/export-codigos" target="_blank" rel="noreferrer"
              className="flex items-center gap-3 p-3 rounded-xl bg-gray-50 hover:bg-gray-100
                transition-all active:scale-98 cursor-pointer border border-gray-100">
              <span className="text-lg">📥</span>
              <div>
                <p className="text-sm font-semibold text-gray-800">Exportar códigos CSV</p>
                <p className="text-xs text-gray-400">Descarga base de codigos_cajas</p>
              </div>
            </a>
            <a href="/api/status" target="_blank" rel="noreferrer"
              className="flex items-center gap-3 p-3 rounded-xl bg-gray-50 hover:bg-gray-100
                transition-all active:scale-98 cursor-pointer border border-gray-100">
              <span className="text-lg">🖥️</span>
              <div>
                <p className="text-sm font-semibold text-gray-800">Estado del sistema</p>
                <p className="text-xs text-gray-400">JSON de estado en tiempo real</p>
              </div>
            </a>
          </div>
        </div>
      </div>

      {/* ── Movimientos recientes ── */}
      <div className="bg-white rounded-xl shadow-sm p-5">
        <h3 className="font-bold text-sm text-[#1A1A1A] mb-3 flex items-center gap-2">
          🔄 Movimientos del loker
          <span className="text-xs font-normal text-gray-400">— últimos {movs.length}</span>
        </h3>
        {movs.length === 0 ? (
          <p className="text-sm text-gray-400 text-center py-4">Sin movimientos en este período</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-gray-100">
                  <th className="text-left py-2 px-2 text-gray-500 font-semibold">Tipo</th>
                  <th className="text-left py-2 px-2 text-gray-500 font-semibold">Producto</th>
                  <th className="text-right py-2 px-2 text-gray-500 font-semibold">Cantidad</th>
                  <th className="text-left py-2 px-2 text-gray-500 font-semibold">Responsable</th>
                  <th className="text-left py-2 px-2 text-gray-500 font-semibold">Fecha</th>
                </tr>
              </thead>
              <tbody>
                {movs.slice(0, 20).map((m, i) => (
                  <tr key={m.id ?? i} className="border-b border-gray-50 hover:bg-gray-50">
                    <td className="py-1.5 px-2">
                      <span className={`px-1.5 py-0.5 rounded-full text-xs font-medium ${
                        m.tipo === "entrada_interior"           ? "bg-green-100 text-green-700" :
                        m.tipo === "salida_despacho"            ? "bg-blue-100 text-blue-700"   :
                        m.tipo === "devolucion_chofer"          ? "bg-yellow-100 text-yellow-700" :
                        m.tipo === "merma"                     ? "bg-red-100 text-red-700"     :
                        "bg-gray-100 text-gray-600"
                      }`}>
                        {m.tipo.replace(/_/g, " ")}
                      </span>
                    </td>
                    <td className="py-1.5 px-2 font-medium text-gray-800">{m.nombre}</td>
                    <td className={`py-1.5 px-2 text-right font-bold ${m.cantidad >= 0 ? "text-green-700" : "text-red-600"}`}>
                      {m.cantidad >= 0 ? "+" : ""}{m.cantidad}
                    </td>
                    <td className="py-1.5 px-2 text-gray-500">{m.responsable}</td>
                    <td className="py-1.5 px-2 text-gray-400">{fmtDate(m.timestamp)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
