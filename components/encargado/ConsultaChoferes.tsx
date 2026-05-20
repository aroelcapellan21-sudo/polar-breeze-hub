"use client";

import { useState, useEffect, useMemo, useRef } from "react";
import { collection, query, where, onSnapshot, getDoc, doc } from "firebase/firestore";
import { db } from "@/lib/firebase";
import {
  UserProfile, TalonarioDoc, MovimientoLoker,
  PuntoProducto, InventarioBaseItem, toDate,
} from "@/lib/types";

function getQuincena() {
  const now = new Date();
  const day = now.getDate(), month = now.getMonth(), year = now.getFullYear();
  if (day <= 15) {
    return { start: new Date(year, month, 1), end: new Date(year, month, 15, 23, 59, 59), label: "1ª quincena" };
  }
  const lastDay = new Date(year, month + 1, 0).getDate();
  return { start: new Date(year, month, 16), end: new Date(year, month, lastDay, 23, 59, 59), label: "2ª quincena" };
}

function getTodayStart() {
  const d = new Date(); d.setHours(0, 0, 0, 0); return d;
}

type ChoferPuntos = {
  uid: string;
  nombre: string;
  ficha?: string;
  puntos: number;
  detalle: { nombre: string; cantidad: number; ptsUnitario: number; total: number }[];
};

export default function ConsultaChoferes() {
  const [choferes,    setChoferes]    = useState<UserProfile[]>([]);
  const [talonarios,  setTalonarios]  = useState<TalonarioDoc[]>([]);
  const [extras,      setExtras]      = useState<MovimientoLoker[]>([]);
  const [puntosMap,   setPuntosMap]   = useState<Record<string, number>>({});
  const [meta,        setMeta]        = useState(100);
  const [selChofer,   setSelChofer]   = useState("todos");
  const [cargando,    setCargando]    = useState(true);

  const rankingRef = useRef<HTMLDivElement>(null);

  const quincena   = useMemo(() => getQuincena(), []);
  const todayStart = useMemo(() => getTodayStart(), []);

  useEffect(() => {
    getDoc(doc(db, "config", "puntos")).then((snap) => {
      if (!snap.exists()) return;
      const data = snap.data();
      const map: Record<string, number> = {};
      (data.productos as PuntoProducto[] ?? []).forEach((p) => {
        map[p.nombre.toLowerCase().trim()] = p.puntos;
      });
      setPuntosMap(map);
      if (data.meta) setMeta(data.meta as number);
    });

    const unsubChof = onSnapshot(
      query(collection(db, "usuarios"), where("role", "==", "chofer")),
      (snap) => setChoferes(
        snap.docs.map((d) => d.data() as UserProfile).filter((u) => u.activo !== false)
      )
    );

    const unsubTal = onSnapshot(
      query(collection(db, "talonario"), where("tipo", "==", "retirada")),
      (snap) => {
        setTalonarios(snap.docs.map((d) => ({ id: d.id, ...d.data() } as TalonarioDoc)));
        setCargando(false);
      }
    );

    const unsubMov = onSnapshot(
      query(collection(db, "movimientos_loker"), where("generaPuntos", "==", true)),
      (snap) => setExtras(snap.docs.map((d) => ({ id: d.id, ...d.data() } as MovimientoLoker)))
    );

    return () => { unsubChof(); unsubTal(); unsubMov(); };
  }, []);

  // ── Puntos por chofer en la quincena ──────────────────────────────────────────
  const ranking = useMemo((): ChoferPuntos[] => {
    const map = new Map<string, ChoferPuntos>();

    choferes.forEach((c) =>
      map.set(c.uid, { uid: c.uid, nombre: c.nombre, ficha: c.ficha, puntos: 0, detalle: [] })
    );

    const acumular = (uid: string, nombre: string, ficha: string | undefined, prodNombre: string, cant: number) => {
      if (!map.has(uid)) map.set(uid, { uid, nombre, ficha, puntos: 0, detalle: [] });
      const entry   = map.get(uid)!;
      const ptsUnit = puntosMap[prodNombre.toLowerCase().trim()] ?? 0;
      const total   = ptsUnit * cant;
      if (total === 0) return;
      entry.puntos += total;
      const existing = entry.detalle.find((d) => d.nombre === prodNombre);
      if (existing) { existing.cantidad += cant; existing.total += total; }
      else entry.detalle.push({ nombre: prodNombre, cantidad: cant, ptsUnitario: ptsUnit, total });
    };

    talonarios.forEach((t) => {
      const d = toDate(t.timestamp);
      if (d < quincena.start || d > quincena.end) return;
      t.productos.forEach((p) =>
        acumular(t.choferId, t.choferNombre, t.choferFicha, p.nombre, p.cantidad ?? 0)
      );
    });

    extras.forEach((m) => {
      if (!m.choferId) return;
      const d = toDate(m.timestamp);
      if (d < quincena.start || d > quincena.end) return;
      acumular(m.choferId, m.choferNombre ?? "", undefined, m.nombre, Math.abs(m.cantidad));
    });

    return Array.from(map.values())
      .sort((a, b) => b.puntos - a.puntos);
  }, [choferes, talonarios, extras, puntosMap, quincena]);

  // ── Inventario del día por chofer ─────────────────────────────────────────────
  const invHoy = useMemo(() => {
    const map = new Map<string, Map<string, { nombre: string; cantidad: number }>>();
    talonarios
      .filter((t) => t.tipo === "retirada" && toDate(t.timestamp) >= todayStart)
      .forEach((t) => {
        if (!map.has(t.choferId)) map.set(t.choferId, new Map());
        const pm = map.get(t.choferId)!;
        t.productos.forEach((p) => {
          const prev = pm.get(p.nombre) ?? { nombre: p.nombre, cantidad: 0 };
          pm.set(p.nombre, { nombre: p.nombre, cantidad: prev.cantidad + (p.cantidad ?? 0) });
        });
      });
    return map;
  }, [talonarios, todayStart]);

  // ── Vista filtrada ────────────────────────────────────────────────────────────
  const rankingVista = selChofer === "todos"
    ? ranking
    : ranking.filter((r) => r.uid === selChofer);

  const choferesVista = selChofer === "todos"
    ? choferes
    : choferes.filter((c) => c.uid === selChofer);

  if (cargando) {
    return (
      <div className="text-center py-16 text-gray-400">
        <p className="text-2xl animate-pulse mb-2">⭐</p>
        <p className="text-sm">Cargando datos…</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">

      {/* ── Selector de chofer ── */}
      <div className="bg-white rounded-xl shadow-sm p-4 space-y-2">
        <div className="flex items-center gap-3">
          <label className="text-xs font-semibold text-gray-600 flex-shrink-0">Filtrar:</label>
          <select
            value={selChofer}
            onChange={(e) => {
              setSelChofer(e.target.value);
              if (e.target.value !== "todos")
                setTimeout(() => rankingRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 50);
            }}
            className="flex-1 px-3 py-2.5 border border-gray-200 rounded-lg text-sm text-gray-800
              outline-none focus:ring-2 focus:ring-emerald-400 bg-white"
          >
            <option value="todos">Todos los choferes ({choferes.length})</option>
            {choferes.map((c) => (
              <option key={c.uid} value={c.uid}>
                {c.nombre}{c.ficha ? ` · Ficha ${c.ficha}` : ""}
              </option>
            ))}
          </select>
        </div>
        <div className="flex items-center justify-between text-xs text-gray-400">
          <span>📅 {quincena.label} actual</span>
          <span>Meta: <strong className="text-gray-600">{meta} pts</strong></span>
        </div>
      </div>

      {/* ── Ranking de puntos ── */}
      <div ref={rankingRef} className="bg-white rounded-xl shadow-sm overflow-hidden">
        <div className="px-4 py-3 bg-gradient-to-r from-amber-400 to-yellow-500 flex items-center justify-between">
          <h2 className="text-white font-bold text-sm">⭐ Puntos — {quincena.label}</h2>
          {selChofer !== "todos" && (
            <button
              onClick={() => setSelChofer("todos")}
              className="text-xs text-yellow-100 hover:text-white underline"
            >
              Ver todos
            </button>
          )}
        </div>

        {rankingVista.length === 0 ? (
          <p className="text-sm text-gray-400 text-center py-8">Sin datos de puntos esta quincena</p>
        ) : (
          <div className="divide-y divide-gray-50">
            {rankingVista.map((c, i) => {
              const realRank = ranking.findIndex((r) => r.uid === c.uid);
              const pct      = meta > 0 ? Math.min((c.puntos / meta) * 100, 100) : 0;
              const medal    = realRank === 0 ? "🥇" : realRank === 1 ? "🥈" : realRank === 2 ? "🥉" : null;
              const barColor = pct >= 100 ? "bg-green-500" : pct >= 60 ? "bg-amber-400" : pct >= 30 ? "bg-blue-400" : "bg-gray-300";

              return (
                <div key={c.uid}>
                  <button
                    onClick={() => setSelChofer(c.uid === selChofer ? "todos" : c.uid)}
                    className={`w-full px-4 py-3 text-left hover:bg-gray-50 active:scale-[0.99] transition-all ${
                      selChofer === c.uid ? "bg-amber-50" : ""
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      <span className="text-xl flex-shrink-0 w-8 text-center">
                        {medal ?? <span className="text-sm text-gray-400">{realRank + 1}</span>}
                      </span>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between mb-1.5">
                          <p className="text-sm font-semibold text-gray-800 truncate mr-2">{c.nombre}</p>
                          <span className={`text-base font-bold flex-shrink-0 ${
                            c.puntos >= meta ? "text-green-600" : "text-gray-700"
                          }`}>
                            {c.puntos} <span className="text-xs font-normal text-gray-400">pts</span>
                          </span>
                        </div>
                        <div className="flex items-center gap-2">
                          <div className="flex-1 h-2.5 bg-gray-100 rounded-full overflow-hidden">
                            <div
                              className={`h-full rounded-full transition-all duration-500 ${barColor}`}
                              style={{ width: `${pct}%` }}
                            />
                          </div>
                          <span className="text-xs text-gray-400 flex-shrink-0 w-8 text-right">
                            {Math.round(pct)}%
                          </span>
                        </div>
                        {pct >= 100 && (
                          <p className="text-xs text-green-600 font-medium mt-0.5">✅ Meta alcanzada</p>
                        )}
                      </div>
                      {c.ficha && (
                        <span className="text-xs text-gray-400 flex-shrink-0">#{c.ficha}</span>
                      )}
                    </div>
                  </button>

                  {/* Detalle de puntos cuando está seleccionado */}
                  {selChofer === c.uid && c.detalle.length > 0 && (
                    <div className="px-4 pb-3 pt-1 bg-amber-50 border-t border-amber-100">
                      <p className="text-xs font-semibold text-amber-700 mb-1.5">Desglose por producto</p>
                      <div className="space-y-1">
                        {c.detalle
                          .sort((a, b) => b.total - a.total)
                          .map((d, j) => (
                            <div key={j} className="flex items-center justify-between text-xs bg-white rounded-lg px-3 py-1.5 border border-amber-100">
                              <span className="text-gray-700 flex-1 truncate mr-2">{d.nombre}</span>
                              <span className="text-gray-400 flex-shrink-0 mr-2">{d.cantidad} × {d.ptsUnitario}</span>
                              <span className="font-bold text-amber-600 flex-shrink-0">{d.total} pts</span>
                            </div>
                          ))}
                      </div>
                    </div>
                  )}
                  {selChofer === c.uid && c.detalle.length === 0 && (
                    <p className="text-xs text-gray-400 italic px-4 pb-2 pt-1 bg-amber-50 border-t border-amber-100">
                      Sin entregas con puntos esta quincena
                    </p>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* ── Inventario ── */}
      <div className="bg-white rounded-xl shadow-sm overflow-hidden">
        <div className="px-4 py-3 bg-gradient-to-r from-blue-500 to-blue-700 flex items-center justify-between">
          <h2 className="text-white font-bold text-sm">📋 Inventario por chofer</h2>
          {selChofer !== "todos" && (
            <button
              onClick={() => setSelChofer("todos")}
              className="text-xs text-blue-100 hover:text-white underline"
            >
              Ver todos
            </button>
          )}
        </div>

        {choferesVista.length === 0 ? (
          <p className="text-sm text-gray-400 text-center py-8">Sin choferes activos</p>
        ) : (
          <div className="divide-y divide-gray-50">
            {choferesVista.map((c) => {
              const base: InventarioBaseItem[] = c.inventario_base ?? [];
              const hoyMap = invHoy.get(c.uid);
              const hoyList = hoyMap ? Array.from(hoyMap.values()) : [];
              const totalBase = base.reduce((s, i) => s + i.cantidad, 0);
              const totalHoy  = hoyList.reduce((s, i) => s + i.cantidad, 0);

              return (
                <div key={c.uid}>
                  {/* Cabecera del chofer */}
                  <div className="flex items-center gap-3 px-4 py-2.5 bg-gray-50">
                    <div className="w-8 h-8 rounded-full bg-blue-500 flex items-center justify-center
                      text-white text-xs font-bold flex-shrink-0">
                      {c.nombre.charAt(0).toUpperCase()}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-gray-800 truncate">{c.nombre}</p>
                      {c.ficha && <p className="text-xs text-gray-400">Ficha #{c.ficha}</p>}
                    </div>
                    <div className="flex gap-2 flex-shrink-0 text-xs">
                      <span className="bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full font-medium">
                        Base: {totalBase}
                      </span>
                      <span className={`px-2 py-0.5 rounded-full font-medium ${
                        totalHoy > 0
                          ? "bg-green-100 text-green-700"
                          : "bg-gray-100 text-gray-400"
                      }`}>
                        Hoy: {totalHoy}
                      </span>
                    </div>
                  </div>

                  {/* Detalle base + hoy */}
                  <div className="grid grid-cols-2 gap-3 px-4 py-3">
                    {/* Inventario base */}
                    <div>
                      <p className="text-xs font-semibold text-blue-600 mb-1.5">📦 Base asignada</p>
                      {base.length === 0 ? (
                        <p className="text-xs text-gray-400 italic">Sin asignar</p>
                      ) : (
                        <div className="space-y-1">
                          {base.map((item, j) => (
                            <div key={j} className="flex items-center justify-between text-xs
                              bg-blue-50 border border-blue-100 rounded-lg px-2 py-1.5">
                              <span className="text-gray-700 truncate mr-1 flex-1 min-w-0">{item.nombre}</span>
                              <span className="font-bold text-blue-700 flex-shrink-0">{item.cantidad}</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>

                    {/* Hoy */}
                    <div>
                      <p className="text-xs font-semibold text-green-600 mb-1.5">🚛 Hoy despachado</p>
                      {hoyList.length === 0 ? (
                        <p className="text-xs text-gray-400 italic">Sin despacho hoy</p>
                      ) : (
                        <div className="space-y-1">
                          {hoyList.map((item, j) => (
                            <div key={j} className="flex items-center justify-between text-xs
                              bg-green-50 border border-green-100 rounded-lg px-2 py-1.5">
                              <span className="text-gray-700 truncate mr-1 flex-1 min-w-0">{item.nombre}</span>
                              <span className="font-bold text-green-700 flex-shrink-0">{item.cantidad}</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
