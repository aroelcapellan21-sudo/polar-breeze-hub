"use client";

import { useEffect, useState } from "react";
import { collection, query, where, orderBy, onSnapshot } from "firebase/firestore";
import { db } from "@/lib/firebase";
import {
  UserProfile, ImbentarioRecord, SpikinScanRecord,
  calcSemaforo, Semaforo, toDate, fmtDate,
} from "@/lib/types";

interface Props {
  chofer: UserProfile;
  onBack: () => void;
}

const SEMAFORO_CFG: Record<Semaforo, { icon: string; label: string; color: string; bg: string }> = {
  verde:    { icon: "✅", label: "Eficiencia normal",   color: "text-green-700",  bg: "bg-green-50  border-green-200" },
  amarillo: { icon: "⚠️", label: "Revisar diferencias", color: "text-yellow-700", bg: "bg-yellow-50 border-yellow-200" },
  rojo:     { icon: "🚨", label: "Diferencias críticas", color: "text-red-700",   bg: "bg-red-50    border-red-200" },
};

export default function ChoferDetalle({ chofer, onBack }: Props) {
  const [records, setRecords] = useState<ImbentarioRecord[]>([]);
  const [rango, setRango]     = useState<7 | 15 | 30>(15);

  useEffect(() => {
    const q = query(
      collection(db, "imbentario"),
      where("choferId", "==", chofer.uid),
      orderBy("timestamp", "desc")
    );
    return onSnapshot(q, (snap) => {
      setRecords(snap.docs.map((d) => ({ id: d.id, ...d.data() } as ImbentarioRecord)));
    });
  }, [chofer.uid]);

  // Filtrar por rango de días
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - rango);
  const recientes = records.filter((r) => toDate(r.timestamp) >= cutoff);

  // Stats globales del rango
  const totalCargado   = recientes.reduce((s, r) => s + (r.cantidadCargada ?? 0), 0);
  const totalEntregado = recientes.reduce((s, r) => s + (r.cantidadEntregada ?? 0), 0);
  const totalCajas     = recientes.reduce((s, r) => s + (r.cajas ?? 0), 0);
  const totalPeso      = recientes.reduce((s, r) => s + (r.peso ?? 0), 0);
  const totalMonto     = recientes.reduce((s, r) => s + (r.monto ?? 0), 0);
  const diferencia     = totalCargado - totalEntregado;
  const semaforo       = calcSemaforo(recientes);
  const sfg            = SEMAFORO_CFG[semaforo];

  // Desglose por producto
  const porProducto = recientes.reduce<Record<string, {
    cargado: number; entregado: number; cajas: number; peso: number; monto: number; veces: number;
  }>>((acc, r) => {
    if (!acc[r.producto]) acc[r.producto] = { cargado: 0, entregado: 0, cajas: 0, peso: 0, monto: 0, veces: 0 };
    acc[r.producto].cargado   += r.cantidadCargada ?? 0;
    acc[r.producto].entregado += r.cantidadEntregada ?? 0;
    acc[r.producto].cajas     += r.cajas ?? 0;
    acc[r.producto].peso      += r.peso ?? 0;
    acc[r.producto].monto     += r.monto ?? 0;
    acc[r.producto].veces     += 1;
    return acc;
  }, {});

  // Historial por día (últimos rango días)
  const porDia = recientes.reduce<Record<string, { entregado: number; cargado: number }>>((acc, r) => {
    const dia = toDate(r.timestamp).toLocaleDateString("es-MX", { day: "2-digit", month: "short" });
    if (!acc[dia]) acc[dia] = { entregado: 0, cargado: 0 };
    acc[dia].entregado += r.cantidadEntregada ?? 0;
    acc[dia].cargado   += r.cantidadCargada ?? 0;
    return acc;
  }, {});

  const diasOrdenados = Object.entries(porDia).reverse();
  const maxEntregado  = Math.max(...diasOrdenados.map(([, v]) => v.entregado), 1);

  return (
    <div className="space-y-5">
      {/* ── Header ── */}
      <div className="flex items-center gap-4">
        <button
          onClick={onBack}
          className="p-2 rounded-lg hover:bg-gray-100 text-gray-500 transition"
        >
          ← Volver
        </button>
        <div className={`flex items-center gap-3 flex-1 p-3 rounded-xl border ${sfg.bg}`}>
          <div className="w-12 h-12 bg-cyan-500 rounded-full flex items-center justify-center text-white font-bold text-lg">
            {chofer.nombre.charAt(0).toUpperCase()}
          </div>
          <div>
            <p className="font-bold text-gray-800">{chofer.nombre}</p>
            <p className="text-xs text-gray-500">Ficha: {chofer.ficha ?? "—"} · {chofer.activo !== false ? "Activo" : "Baja"}</p>
          </div>
          <div className="ml-auto text-right">
            <p className="text-2xl">{sfg.icon}</p>
            <p className={`text-xs font-medium ${sfg.color}`}>{sfg.label}</p>
          </div>
        </div>

        {/* Selector de rango */}
        <div className="flex gap-1">
          {([7, 15, 30] as const).map((d) => (
            <button key={d} onClick={() => setRango(d)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition ${
                rango === d ? "bg-purple-600 text-white" : "bg-white text-gray-600 hover:bg-gray-100"
              }`}
            >
              {d}d
            </button>
          ))}
        </div>
      </div>

      {/* ── Stats principales ── */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <StatCard label="Unidades cargadas"   value={totalCargado}   icon="📥" color="bg-blue-50 text-blue-700" />
        <StatCard label="Unidades entregadas" value={totalEntregado} icon="📤" color="bg-green-50 text-green-700" />
        <StatCard label="Diferencia"          value={diferencia}     icon="⚡" color={diferencia > 0 ? "bg-orange-50 text-orange-700" : "bg-gray-50 text-gray-600"} />
        <StatCard label="Cajas"               value={totalCajas || "—"} icon="📦" color="bg-cyan-50 text-cyan-700" />
        <StatCard label="Peso total (kg)"     value={totalPeso ? totalPeso.toFixed(1) : "—"} icon="⚖️" color="bg-purple-50 text-purple-700" />
      </div>

      {totalMonto > 0 && (
        <div className="bg-green-50 border border-green-200 rounded-xl p-4 flex items-center gap-3">
          <span className="text-2xl">💰</span>
          <div>
            <p className="text-xs text-green-600">Ventas / Monto acumulado</p>
            <p className="text-2xl font-bold text-green-700">${totalMonto.toLocaleString()}</p>
          </div>
        </div>
      )}

      <div className="grid lg:grid-cols-2 gap-5">
        {/* ── Desglose por producto ── */}
        <div className="bg-white rounded-xl shadow-sm p-5">
          <h3 className="font-bold text-gray-700 mb-3">Desglose por producto</h3>
          {Object.keys(porProducto).length === 0 ? (
            <p className="text-gray-400 text-sm text-center py-6">Sin datos en este período</p>
          ) : (
            <div className="space-y-2 max-h-64 overflow-y-auto">
              {Object.entries(porProducto).map(([prod, dat]) => {
                const efic = dat.cargado > 0 ? (dat.entregado / dat.cargado) * 100 : 100;
                const sem: Semaforo = efic >= 95 ? "verde" : efic >= 85 ? "amarillo" : "rojo";
                return (
                  <div key={prod} className="border border-gray-100 rounded-lg p-3">
                    <div className="flex justify-between items-center mb-1.5">
                      <p className="font-medium text-sm text-gray-800">{prod}</p>
                      <span className="text-lg">{SEMAFORO_CFG[sem].icon}</span>
                    </div>
                    <div className="flex gap-4 text-xs text-gray-500">
                      <span>Carg: <strong>{dat.cargado}</strong></span>
                      <span>Entr: <strong>{dat.entregado}</strong></span>
                      <span>Efic: <strong className={SEMAFORO_CFG[sem].color}>{efic.toFixed(0)}%</strong></span>
                      {dat.peso > 0 && <span>Peso: <strong>{dat.peso.toFixed(1)}kg</strong></span>}
                    </div>
                    {/* Barra de progreso */}
                    <div className="mt-1.5 h-1.5 bg-gray-100 rounded-full overflow-hidden">
                      <div
                        className={`h-full rounded-full ${sem === "verde" ? "bg-green-400" : sem === "amarillo" ? "bg-yellow-400" : "bg-red-400"}`}
                        style={{ width: `${Math.min(efic, 100)}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* ── Historial últimos días ── */}
        <div className="bg-white rounded-xl shadow-sm p-5">
          <h3 className="font-bold text-gray-700 mb-3">Historial — últimos {rango} días</h3>
          {diasOrdenados.length === 0 ? (
            <p className="text-gray-400 text-sm text-center py-6">Sin actividad</p>
          ) : (
            <div className="space-y-2 max-h-64 overflow-y-auto">
              {diasOrdenados.map(([dia, dat]) => {
                const efic = dat.cargado > 0 ? (dat.entregado / dat.cargado) * 100 : 100;
                const sem: Semaforo = efic >= 95 ? "verde" : efic >= 85 ? "amarillo" : "rojo";
                const barW = Math.round((dat.entregado / maxEntregado) * 100);
                return (
                  <div key={dia} className="flex items-center gap-3">
                    <span className="text-xs text-gray-500 w-16 flex-shrink-0">{dia}</span>
                    <div className="flex-1 h-5 bg-gray-100 rounded-full overflow-hidden">
                      <div
                        className={`h-full rounded-full flex items-center justify-end pr-1 text-white text-xs font-medium transition-all ${
                          sem === "verde" ? "bg-green-400" : sem === "amarillo" ? "bg-yellow-400" : "bg-red-400"
                        }`}
                        style={{ width: `${Math.max(barW, 8)}%` }}
                      >
                        {dat.entregado > 0 && dat.entregado}
                      </div>
                    </div>
                    <span className="text-lg flex-shrink-0">{SEMAFORO_CFG[sem].icon}</span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* ── Registros individuales ── */}
      <div className="bg-white rounded-xl shadow-sm p-5">
        <h3 className="font-bold text-gray-700 mb-3">Registros individuales ({recientes.length})</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-xs text-gray-500 border-b">
                <th className="text-left pb-2 pr-4">Fecha</th>
                <th className="text-left pb-2 pr-4">Producto</th>
                <th className="text-left pb-2 pr-4">Ruta</th>
                <th className="text-right pb-2 pr-4">Cargado</th>
                <th className="text-right pb-2 pr-4">Entregado</th>
                <th className="text-right pb-2">Diff</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {recientes.length === 0 ? (
                <tr><td colSpan={6} className="text-center py-6 text-gray-400">Sin registros</td></tr>
              ) : recientes.map((r) => {
                const diff = (r.cantidadCargada ?? 0) - (r.cantidadEntregada ?? 0);
                return (
                  <tr key={r.id} className="hover:bg-gray-50">
                    <td className="py-2 pr-4 text-gray-500 text-xs">{fmtDate(r.timestamp)}</td>
                    <td className="py-2 pr-4 font-medium text-gray-800">{r.producto}</td>
                    <td className="py-2 pr-4 text-gray-500 text-xs">{r.ruta}</td>
                    <td className="py-2 pr-4 text-right">{r.cantidadCargada}</td>
                    <td className="py-2 pr-4 text-right text-green-600">{r.cantidadEntregada}</td>
                    <td className={`py-2 text-right font-medium ${diff > 0 ? "text-orange-500" : "text-gray-400"}`}>
                      {diff > 0 ? `+${diff}` : diff}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function StatCard({ label, value, icon, color }: { label: string; value: string | number; icon: string; color: string }) {
  return (
    <div className={`${color} rounded-xl p-3 text-center`}>
      <p className="text-xl mb-0.5">{icon}</p>
      <p className="text-xl font-bold leading-tight">{value}</p>
      <p className="text-xs opacity-75 mt-0.5">{label}</p>
    </div>
  );
}
