"use client";

import { useState, useEffect, useMemo } from "react";
import {
  collection, query, orderBy, onSnapshot, limit, getDoc, doc, where,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import { ImbentarioRecord, UserProfile, PuntosConfig, toDate } from "@/lib/types";

interface Props {
  choferes?: UserProfile[];   // opcional — si no se pasa, se carga internamente
}

interface ProyeccionChofer {
  uid:                string;
  nombre:             string;
  ficha?:             string;
  puntosActuales:     number;
  ventasActuales:     number;
  udsActuales:        number;
  ptsPromedioDia:     number;
  ventasPromedioDia:  number;
  udsPromedioDia:     number;
  ptsProyectados:     number;
  ventasProyectadas:  number;
}

export default function ProyeccionesChoferes({ choferes: choferesProp }: Props) {
  const [imb,           setImb]          = useState<ImbentarioRecord[]>([]);
  const [puntosConfig,  setPuntosConfig] = useState<PuntosConfig | null>(null);
  const [periodo,       setPeriodo]      = useState<15 | 30>(15);
  const [choferesLocal, setChoferesLocal] = useState<UserProfile[]>([]);

  // Carga choferes internamente si no vienen por prop
  useEffect(() => {
    if (choferesProp) return;
    const q = query(collection(db, "usuarios"), where("role", "==", "chofer"));
    const unsub = onSnapshot(q, (snap) =>
      setChoferesLocal(snap.docs.map((d) => d.data() as UserProfile)),
    );
    return unsub;
  }, [choferesProp]);

  const choferes = choferesProp ?? choferesLocal;

  useEffect(() => {
    const q = query(collection(db, "imbentario"), orderBy("timestamp", "desc"), limit(500));
    return onSnapshot(q, (snap) =>
      setImb(snap.docs.map((d) => ({ id: d.id, ...d.data() } as ImbentarioRecord))),
    );
  }, []);

  useEffect(() => {
    getDoc(doc(db, "config", "puntos")).then((snap) => {
      if (snap.exists()) setPuntosConfig(snap.data() as PuntosConfig);
    });
  }, []);

  const puntosMap = useMemo(() => {
    const map: Record<string, number> = {};
    puntosConfig?.productos.forEach((p) => {
      map[p.nombre.toLowerCase().trim()] = p.puntos;
    });
    return map;
  }, [puntosConfig]);

  const inicio = useMemo(() => {
    const d = new Date();
    d.setDate(d.getDate() - periodo + 1);
    d.setHours(0, 0, 0, 0);
    return d;
  }, [periodo]);

  const proyecciones = useMemo((): ProyeccionChofer[] => {
    const hoy = new Date();
    const horizonte = 30; // proyectar siempre a 30 días

    return choferes
      .filter((c) => c.activo !== false)
      .map((chofer) => {
        const records = imb.filter(
          (r) => r.choferId === chofer.uid && toDate(r.timestamp) >= inicio,
        );

        const puntosActuales = records.reduce((s, r) => {
          const pts = puntosMap[(r.producto ?? "").toLowerCase().trim()] ?? 0;
          return s + (r.cantidadEntregada ?? 0) * pts;
        }, 0);

        const ventasActuales = records.reduce((s, r) => s + (r.monto ?? 0), 0);
        const udsActuales    = records.reduce((s, r) => s + (r.cantidadEntregada ?? 0), 0);

        // Días con actividad (para promediar)
        const diasConActividad = new Set(
          records.map((r) => toDate(r.timestamp).toDateString()),
        ).size || 1;

        const ptsPromedioDia    = puntosActuales / diasConActividad;
        const ventasPromedioDia = ventasActuales  / diasConActividad;
        const udsPromedioDia    = udsActuales     / diasConActividad;

        // Días transcurridos en el período
        const msPerDay    = 86400000;
        const daysElapsed = Math.max(1, Math.ceil((hoy.getTime() - inicio.getTime()) / msPerDay));
        const remaining   = Math.max(0, horizonte - daysElapsed);

        const ptsProyectados    = puntosActuales + ptsPromedioDia    * remaining;
        const ventasProyectadas = ventasActuales  + ventasPromedioDia * remaining;

        return {
          uid: chofer.uid,
          nombre: chofer.nombre,
          ficha: chofer.ficha,
          puntosActuales,
          ventasActuales,
          udsActuales,
          ptsPromedioDia,
          ventasPromedioDia,
          udsPromedioDia,
          ptsProyectados,
          ventasProyectadas,
        };
      })
      .sort((a, b) => b.ptsProyectados - a.ptsProyectados);
  }, [choferes, imb, inicio, puntosMap]);

  const hayVentas = proyecciones.some((p) => p.ventasActuales > 0);

  return (
    <div className="lg:col-span-3 bg-white rounded-xl shadow-sm overflow-hidden">

      {/* Cabecera */}
      <div className="flex items-center justify-between px-5 py-4 border-b bg-gradient-to-r from-indigo-50 to-purple-50">
        <div>
          <h2 className="font-bold text-indigo-900">📈 Proyecciones del período</h2>
          <p className="text-xs text-indigo-500 mt-0.5">
            Ranking automático · actualización en tiempo real · proyección a 30 días
          </p>
        </div>
        <div className="flex gap-1.5">
          {([15, 30] as const).map((d) => (
            <button
              key={d}
              onClick={() => setPeriodo(d)}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all duration-100 active:scale-95 ${
                periodo === d
                  ? "bg-indigo-600 text-white shadow-sm"
                  : "bg-white text-gray-500 border border-gray-200 hover:bg-gray-50"
              }`}
            >
              {d}d
            </button>
          ))}
        </div>
      </div>

      {proyecciones.length === 0 ? (
        <div className="px-5 py-10 text-center text-gray-400 text-sm">Sin choferes activos</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-indigo-50/60 text-indigo-700 border-b border-indigo-100">
                <th className="text-center px-3 py-2.5 font-semibold w-10">#</th>
                <th className="text-left px-4 py-2.5 font-semibold">Chofer</th>
                <th className="text-right px-4 py-2.5 font-semibold">Pts actuales</th>
                <th className="text-right px-4 py-2.5 font-semibold">Pts/día</th>
                <th className="text-right px-4 py-2.5 font-semibold whitespace-nowrap">
                  Pts proy. 30d
                </th>
                {hayVentas && (
                  <>
                    <th className="text-right px-4 py-2.5 font-semibold whitespace-nowrap">Ventas actuales</th>
                    <th className="text-right px-4 py-2.5 font-semibold">Ventas/día</th>
                    <th className="text-right px-4 py-2.5 font-semibold whitespace-nowrap">
                      Ventas proy. 30d
                    </th>
                  </>
                )}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {proyecciones.map((p, i) => {
                const isPrimero = i === 0 && p.ptsProyectados > 0;
                return (
                  <tr
                    key={p.uid}
                    className={`transition-colors ${
                      isPrimero
                        ? "bg-yellow-50 border-l-4 border-l-yellow-400"
                        : "hover:bg-indigo-50/20"
                    }`}
                  >
                    <td className="px-3 py-3 text-center">
                      {isPrimero ? (
                        <span className="text-lg">🥇</span>
                      ) : (
                        <span className="text-gray-400 font-bold">#{i + 1}</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <div
                          className={`w-7 h-7 rounded-full flex items-center justify-center text-white text-xs font-bold flex-shrink-0 ${
                            isPrimero ? "bg-yellow-500" : "bg-cyan-500"
                          }`}
                        >
                          {p.nombre.charAt(0).toUpperCase()}
                        </div>
                        <div>
                          <p className={`font-semibold text-xs ${isPrimero ? "text-yellow-900" : "text-gray-800"}`}>
                            {p.nombre}
                          </p>
                          {isPrimero && (
                            <p className="text-xs text-yellow-600 font-medium">🎉 ¡Líder del período!</p>
                          )}
                          {p.ficha && !isPrimero && (
                            <p className="text-xs text-gray-400">Ficha {p.ficha}</p>
                          )}
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <span className="font-bold text-indigo-700">
                        {p.puntosActuales > 0 ? p.puntosActuales.toLocaleString() : "—"}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right text-gray-500">
                      {p.ptsPromedioDia > 0 ? p.ptsPromedioDia.toFixed(1) : "—"}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <span className={`font-extrabold text-sm ${isPrimero ? "text-yellow-700" : "text-purple-700"}`}>
                        {p.ptsProyectados > 0 ? Math.round(p.ptsProyectados).toLocaleString() : "—"}
                      </span>
                    </td>
                    {hayVentas && (
                      <>
                        <td className="px-4 py-3 text-right font-medium text-green-700">
                          {p.ventasActuales > 0 ? `RD$${p.ventasActuales.toLocaleString()}` : "—"}
                        </td>
                        <td className="px-4 py-3 text-right text-gray-500">
                          {p.ventasPromedioDia > 0 ? `RD$${Math.round(p.ventasPromedioDia).toLocaleString()}` : "—"}
                        </td>
                        <td className="px-4 py-3 text-right">
                          <span className="font-extrabold text-emerald-700">
                            {p.ventasProyectadas > 0 ? `RD$${Math.round(p.ventasProyectadas).toLocaleString()}` : "—"}
                          </span>
                        </td>
                      </>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <div className="px-5 py-2.5 border-t flex items-center gap-1.5">
        <span className="w-2 h-2 rounded-full bg-indigo-400 animate-pulse" />
        <span className="text-xs text-gray-400">En tiempo real · base: últimos {periodo} días</span>
      </div>
    </div>
  );
}
