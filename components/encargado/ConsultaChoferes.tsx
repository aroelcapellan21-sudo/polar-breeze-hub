"use client";

/**
 * ConsultaChoferes — Tab Choferes del Encargado
 *
 * §24 diseño aprobado:
 *  - Cierre del día: chips 3 estados (⏳ pendiente · ✅ guardado · 🚨 tarde >22h)
 *  - Selector de fecha para consultar días anteriores
 *  - Puntos quincena: ranking con barra de progreso y desglose
 *  - Inventario despachado hoy
 */

import { useState, useEffect, useMemo, useRef } from "react";
import { collection, query, where, onSnapshot, getDoc, doc } from "firebase/firestore";
import { db } from "@/lib/firebase";
import {
  UserProfile, TalonarioDoc, MovimientoLoker,
  PuntoProducto, InventarioBaseItem, toDate,
} from "@/lib/types";
import RegistrarInventario from "@/components/encargado/RegistrarInventario";

// ─── Tipos locales ────────────────────────────────────────────────────────────

type InvGuardadoResumen = {
  ficha:    string;
  totales?: { sobrante: number; vendido: number; total_rd: number };
  bloqueado?: boolean;
};

type ChoferPuntos = {
  uid: string;
  nombre: string;
  ficha?: string;
  puntos: number;
  detalle: { nombre: string; cantidad: number; ptsUnitario: number; total: number }[];
};

// ─── Helpers de fecha ─────────────────────────────────────────────────────────

function getQuincena() {
  const now = new Date();
  const day = now.getDate(), month = now.getMonth(), year = now.getFullYear();
  if (day <= 15) {
    return { start: new Date(year, month, 1), end: new Date(year, month, 15, 23, 59, 59), label: "1ª quincena" };
  }
  const lastDay = new Date(year, month + 1, 0).getDate();
  return { start: new Date(year, month, 16), end: new Date(year, month, lastDay, 23, 59, 59), label: "2ª quincena" };
}

function toFechaKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function toInputValue(d: Date): string {
  return toFechaKey(d); // "YYYY-MM-DD" es el formato de <input type="date">
}

function fromInputValue(s: string): Date {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d, 0, 0, 0, 0);
}

/** ¿Es "tarde"? → después de las 22:00 del día seleccionado y el día es hoy */
function esHoy(d: Date): boolean {
  const now = new Date();
  return d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();
}

// ─── Componente ───────────────────────────────────────────────────────────────

// ── Sección activa del tab ───────────────────────────────────────────────────
type Seccion = "puntos" | "inventario" | "cierre";

export default function ConsultaChoferes() {
  const [choferes,    setChoferes]    = useState<UserProfile[]>([]);
  const [talonarios,  setTalonarios]  = useState<TalonarioDoc[]>([]);
  const [extras,      setExtras]      = useState<MovimientoLoker[]>([]);
  const [puntosMap,   setPuntosMap]   = useState<Record<string, number>>({});
  const [meta,        setMeta]        = useState(100);
  const [selChofer,   setSelChofer]   = useState("todos");
  const [cargando,    setCargando]    = useState(true);
  const [seccion,     setSeccion]     = useState<Seccion>("cierre");

  // Selector de fecha para la sección de cierre
  const [fechaSel,  setFechaSel]  = useState<Date>(() => { const d = new Date(); d.setHours(0,0,0,0); return d; });
  const fechaKey  = useMemo(() => toFechaKey(fechaSel), [fechaSel]);
  const esDiaHoy  = useMemo(() => esHoy(fechaSel), [fechaSel]);

  // Inventarios guardados del día seleccionado
  const [invGuardados, setInvGuardados] = useState<Record<string, InvGuardadoResumen>>({});

  // Modal de registro/detalle
  const [modalChofer, setModalChofer] = useState<{ uid: string; nombre: string; ficha: string } | null>(null);

  const rankingRef  = useRef<HTMLDivElement>(null);
  const quincena    = useMemo(() => getQuincena(), []);

  // ¿Es tarde? (>= 22:00 y es hoy)
  const [horaActual, setHoraActual] = useState(() => new Date().getHours());
  useEffect(() => {
    const t = setInterval(() => setHoraActual(new Date().getHours()), 60_000);
    return () => clearInterval(t);
  }, []);
  const esTarde = esDiaHoy && horaActual >= 22;

  const todayStart = useMemo(() => {
    const d = new Date(); d.setHours(0, 0, 0, 0); return d;
  }, []);

  // ── Cargar config puntos + choferes + talonario + movimientos ───────────────
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

  // ── Listener inventarios del día seleccionado ───────────────────────────────
  useEffect(() => {
    const invRef = collection(db, "inventarios", fechaKey, "choferes");
    const unsub = onSnapshot(invRef, (snap) => {
      const map: Record<string, InvGuardadoResumen> = {};
      snap.docs.forEach((d) => {
        const data = d.data();
        map[d.id] = { ficha: d.id, totales: data.totales, bloqueado: data.bloqueado };
      });
      setInvGuardados(map);
    });
    return unsub;
  }, [fechaKey]);

  // ── Puntos quincena ─────────────────────────────────────────────────────────
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
      t.productos.forEach((p) => acumular(t.choferId, t.choferNombre, t.choferFicha, p.nombre, p.cantidad ?? 0));
    });
    extras.forEach((m) => {
      if (!m.choferId) return;
      const d = toDate(m.timestamp);
      if (d < quincena.start || d > quincena.end) return;
      acumular(m.choferId, m.choferNombre ?? "", undefined, m.nombre, Math.abs(m.cantidad));
    });
    return Array.from(map.values()).sort((a, b) => b.puntos - a.puntos);
  }, [choferes, talonarios, extras, puntosMap, quincena]);

  // ── Inventario despachado hoy ───────────────────────────────────────────────
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

  // Vistas filtradas
  const rankingVista  = selChofer === "todos" ? ranking : ranking.filter((r) => r.uid === selChofer);
  const choferesVista = selChofer === "todos" ? choferes : choferes.filter((c) => c.uid === selChofer);
  // ── Contadores para el cierre ─────────────────────────────────────────────
  const cerrados   = Object.keys(invGuardados).length;
  const pendientes = choferes.length - cerrados;

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

      {/* ── Sub-tabs ── */}
      <div className="bg-white rounded-xl shadow-sm overflow-hidden">
        <div className="flex border-b border-gray-100">
          {([
            { key: "cierre",     icon: "📋", label: "Cierre" },
            { key: "puntos",     icon: "⭐", label: "Puntos" },
            { key: "inventario", icon: "🚛", label: "Despachado" },
          ] as { key: Seccion; icon: string; label: string }[]).map((s) => (
            <button key={s.key} onClick={() => setSeccion(s.key)}
              className={`flex-1 py-2.5 text-xs font-semibold flex flex-col items-center gap-0.5
                transition-all active:scale-95 ${
                  seccion === s.key
                    ? "bg-[#F5C800] text-[#1A1A1A] border-b-2 border-[#D42B2B]"
                    : "text-gray-500 hover:bg-gray-50"
                }`}
            >
              <span className="text-base">{s.icon}</span>
              <span>{s.label}</span>
            </button>
          ))}
        </div>
      </div>

      {/* ═══════════════════════════
          CIERRE DEL DÍA
      ═══════════════════════════ */}
      {seccion === "cierre" && (
        <div className="bg-white rounded-xl shadow-sm overflow-hidden">

          {/* Header */}
          <div className="px-4 py-3 bg-[#1A1A1A] flex items-center justify-between">
            <div>
              <h2 className="text-white font-bold text-sm">📋 Cierre de inventario</h2>
              <p className="text-gray-400 text-xs">Toca un chofer para registrar</p>
            </div>
            <div className="flex gap-1.5">
              <span className="bg-[#1E8C3A]/20 text-[#4ade80] text-xs font-bold px-2 py-0.5 rounded-full border border-[#1E8C3A]/30">
                ✅ {cerrados}
              </span>
              <span className="bg-amber-500/20 text-amber-300 text-xs font-bold px-2 py-0.5 rounded-full border border-amber-500/30">
                ⏳ {pendientes}
              </span>
            </div>
          </div>

          {/* Banda tricolor */}
          <div className="h-0.5 flex">
            <div className="flex-1 bg-[#F5C800]" />
            <div className="flex-1 bg-[#D42B2B]" />
            <div className="flex-1 bg-[#1E8C3A]" />
          </div>

          {/* Selector de fecha — §24 */}
          <div className="px-4 py-2.5 border-b border-gray-100 flex items-center gap-3 bg-gray-50">
            <span className="text-xs text-gray-500 font-medium flex-shrink-0">📅 Fecha:</span>
            <input
              type="date"
              value={toInputValue(fechaSel)}
              max={toInputValue(new Date())}
              onChange={(e) => {
                if (!e.target.value) return;
                setFechaSel(fromInputValue(e.target.value));
              }}
              className="flex-1 text-xs border border-gray-200 rounded-lg px-2 py-1.5
                outline-none focus:ring-2 focus:ring-[#F5C800] bg-white text-gray-700"
            />
            {!esDiaHoy && (
              <button
                onClick={() => { const d = new Date(); d.setHours(0,0,0,0); setFechaSel(d); }}
                className="text-xs text-[#D42B2B] font-semibold hover:underline flex-shrink-0"
              >
                Hoy
              </button>
            )}
            {esTarde && esDiaHoy && (
              <span className="text-xs bg-red-100 text-red-700 px-2 py-0.5 rounded-full font-bold border border-red-200 flex-shrink-0">
                🚨 +22h
              </span>
            )}
          </div>

          {/* Lista de choferes con 3 estados */}
          {choferes.length === 0 ? (
            <p className="text-sm text-gray-400 text-center py-8">Sin choferes activos</p>
          ) : (
            <div className="divide-y divide-gray-50">
              {choferes.map((c) => {
                const inv       = c.ficha ? invGuardados[c.ficha] : undefined;
                const guardado  = !!inv;
                // 🚨 tarde: es hoy, pasó de 22h y no tiene cierre
                const tarde     = esTarde && esDiaHoy && !guardado && !!c.ficha;
                const tot       = inv?.totales;

                return (
                  <button
                    key={c.uid}
                    onClick={() => {
                      if (!c.ficha) return;
                      setModalChofer({ uid: c.uid, nombre: c.nombre, ficha: c.ficha });
                    }}
                    disabled={!c.ficha}
                    className={`w-full px-4 py-3 flex items-center gap-3 text-left
                      hover:bg-gray-50 active:scale-[0.99] transition-all ${
                        guardado ? "bg-green-50/40" : tarde ? "bg-red-50/30" : ""
                      }`}
                  >
                    {/* Chip de estado — §24 */}
                    <div className={`w-9 h-9 rounded-full flex items-center justify-center
                      text-white text-xs font-bold flex-shrink-0 ${
                        guardado ? "bg-[#1E8C3A]"
                          : tarde  ? "bg-[#D42B2B] animate-pulse"
                          : "bg-gray-400"
                      }`}>
                      {guardado ? "✅" : tarde ? "🚨" : c.nombre.charAt(0).toUpperCase()}
                    </div>

                    {/* Info */}
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-gray-800 truncate">{c.nombre}</p>
                      <p className="text-xs text-gray-400">
                        {c.ficha ? `Ficha #${c.ficha}` : "Sin ficha"}
                      </p>
                      {guardado && tot && (
                        <p className="text-xs text-[#1E8C3A] font-medium mt-0.5">
                          {tot.vendido} vendidos · RD${tot.total_rd.toLocaleString("es-DO", { maximumFractionDigits: 0 })}
                        </p>
                      )}
                      {tarde && (
                        <p className="text-xs text-[#D42B2B] font-medium mt-0.5">
                          Sin reportar — más de 10 pm
                        </p>
                      )}
                    </div>

                    {/* Badge de estado */}
                    <div className="flex-shrink-0">
                      {guardado ? (
                        <span className="text-xs bg-green-100 text-[#1E8C3A] font-bold px-2 py-0.5 rounded-full border border-green-200">
                          Ver detalle
                        </span>
                      ) : tarde ? (
                        <span className="text-xs bg-red-100 text-[#D42B2B] font-bold px-2 py-0.5 rounded-full border border-red-200">
                          🚨 Tarde
                        </span>
                      ) : c.ficha ? (
                        <span className="text-xs bg-amber-100 text-amber-700 font-bold px-2 py-0.5 rounded-full border border-amber-200">
                          ⏳ Registrar
                        </span>
                      ) : (
                        <span className="text-xs text-gray-300">Sin ficha</span>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ═══════════════════════════
          PUNTOS QUINCENA
      ═══════════════════════════ */}
      {seccion === "puntos" && (
        <div className="space-y-4">
          {/* Filtro */}
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
                className="flex-1 px-3 py-2.5 border border-gray-200 rounded-lg text-sm
                  text-gray-800 outline-none focus:ring-2 focus:ring-[#F5C800] bg-white"
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

          {/* Ranking */}
          <div ref={rankingRef} className="bg-white rounded-xl shadow-sm overflow-hidden">
            <div className="px-4 py-3 bg-[#1A1A1A] flex items-center justify-between">
              <h2 className="text-[#F5C800] font-bold text-sm">⭐ Puntos — {quincena.label}</h2>
              {selChofer !== "todos" && (
                <button onClick={() => setSelChofer("todos")}
                  className="text-xs text-gray-400 hover:text-white underline">
                  Ver todos
                </button>
              )}
            </div>
            <div className="h-0.5 flex">
              <div className="flex-1 bg-[#F5C800]" />
              <div className="flex-1 bg-[#D42B2B]" />
              <div className="flex-1 bg-[#1E8C3A]" />
            </div>

            {rankingVista.length === 0 ? (
              <p className="text-sm text-gray-400 text-center py-8">Sin datos de puntos esta quincena</p>
            ) : (
              <div className="divide-y divide-gray-50">
                {rankingVista.map((c, i) => {
                  const realRank = ranking.findIndex((r) => r.uid === c.uid);
                  const pct      = meta > 0 ? Math.min((c.puntos / meta) * 100, 100) : 0;
                  const medal    = realRank === 0 ? "🥇" : realRank === 1 ? "🥈" : realRank === 2 ? "🥉" : null;
                  const barColor = pct >= 100 ? "bg-[#1E8C3A]" : pct >= 60 ? "bg-[#F5C800]" : pct >= 30 ? "bg-blue-400" : "bg-gray-300";
                  void i;
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
                              <span className={`text-base font-bold flex-shrink-0 ${c.puntos >= meta ? "text-[#1E8C3A]" : "text-gray-700"}`}>
                                {c.puntos} <span className="text-xs font-normal text-gray-400">pts</span>
                              </span>
                            </div>
                            <div className="flex items-center gap-2">
                              <div className="flex-1 h-2.5 bg-gray-100 rounded-full overflow-hidden">
                                <div className={`h-full rounded-full transition-all duration-500 ${barColor}`}
                                  style={{ width: `${pct}%` }} />
                              </div>
                              <span className="text-xs text-gray-400 flex-shrink-0 w-8 text-right">{Math.round(pct)}%</span>
                            </div>
                            {pct >= 100 && <p className="text-xs text-[#1E8C3A] font-medium mt-0.5">✅ Meta alcanzada</p>}
                          </div>
                          {c.ficha && <span className="text-xs text-gray-400 flex-shrink-0">#{c.ficha}</span>}
                        </div>
                      </button>
                      {selChofer === c.uid && c.detalle.length > 0 && (
                        <div className="px-4 pb-3 pt-1 bg-amber-50 border-t border-amber-100">
                          <p className="text-xs font-semibold text-amber-700 mb-1.5">Desglose por producto</p>
                          <div className="space-y-1">
                            {c.detalle.sort((a, b) => b.total - a.total).map((d, j) => (
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
        </div>
      )}

      {/* ═══════════════════════════
          INVENTARIO DESPACHADO
      ═══════════════════════════ */}
      {seccion === "inventario" && (
        <div className="space-y-4">
          <div className="bg-white rounded-xl shadow-sm p-4">
            <div className="flex items-center gap-3">
              <label className="text-xs font-semibold text-gray-600 flex-shrink-0">Filtrar:</label>
              <select value={selChofer} onChange={(e) => setSelChofer(e.target.value)}
                className="flex-1 px-3 py-2.5 border border-gray-200 rounded-lg text-sm
                  text-gray-800 outline-none focus:ring-2 focus:ring-[#F5C800] bg-white">
                <option value="todos">Todos los choferes ({choferes.length})</option>
                {choferes.map((c) => (
                  <option key={c.uid} value={c.uid}>{c.nombre}{c.ficha ? ` · Ficha ${c.ficha}` : ""}</option>
                ))}
              </select>
            </div>
          </div>
          <div className="bg-white rounded-xl shadow-sm overflow-hidden">
            <div className="px-4 py-3 bg-[#1A1A1A] flex items-center justify-between">
              <h2 className="text-[#F5C800] font-bold text-sm">🚛 Inventario despachado hoy</h2>
              {selChofer !== "todos" && (
                <button onClick={() => setSelChofer("todos")}
                  className="text-xs text-gray-400 hover:text-white underline">Ver todos</button>
              )}
            </div>
            <div className="h-0.5 flex">
              <div className="flex-1 bg-[#F5C800]" />
              <div className="flex-1 bg-[#D42B2B]" />
              <div className="flex-1 bg-[#1E8C3A]" />
            </div>
            {choferesVista.length === 0 ? (
              <p className="text-sm text-gray-400 text-center py-8">Sin choferes activos</p>
            ) : (
              <div className="divide-y divide-gray-50">
                {choferesVista.map((c) => {
                  const base: InventarioBaseItem[] = c.inventario_base ?? [];
                  const hoyMap  = invHoy.get(c.uid);
                  const hoyList = hoyMap ? Array.from(hoyMap.values()) : [];
                  const totalBase = base.reduce((s, i) => s + i.cantidad, 0);
                  const totalHoy  = hoyList.reduce((s, i) => s + i.cantidad, 0);
                  return (
                    <div key={c.uid}>
                      <div className="flex items-center gap-3 px-4 py-2.5 bg-gray-50">
                        <div className="w-8 h-8 rounded-full bg-[#1A1A1A] flex items-center justify-center
                          text-white text-xs font-bold flex-shrink-0">
                          {c.nombre.charAt(0).toUpperCase()}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-semibold text-gray-800 truncate">{c.nombre}</p>
                          {c.ficha && <p className="text-xs text-gray-400">Ficha #{c.ficha}</p>}
                        </div>
                        <div className="flex gap-1.5 flex-shrink-0 text-xs">
                          <span className="bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full font-medium">Base: {totalBase}</span>
                          <span className={`px-2 py-0.5 rounded-full font-medium ${
                            totalHoy > 0 ? "bg-green-100 text-[#1E8C3A]" : "bg-gray-100 text-gray-400"
                          }`}>Hoy: {totalHoy}</span>
                        </div>
                      </div>
                      <div className="grid grid-cols-2 gap-3 px-4 py-3">
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
                        <div>
                          <p className="text-xs font-semibold text-[#1E8C3A] mb-1.5">🚛 Hoy despachado</p>
                          {hoyList.length === 0 ? (
                            <p className="text-xs text-gray-400 italic">Sin despacho hoy</p>
                          ) : (
                            <div className="space-y-1">
                              {hoyList.map((item, j) => (
                                <div key={j} className="flex items-center justify-between text-xs
                                  bg-green-50 border border-green-100 rounded-lg px-2 py-1.5">
                                  <span className="text-gray-700 truncate mr-1 flex-1 min-w-0">{item.nombre}</span>
                                  <span className="font-bold text-[#1E8C3A] flex-shrink-0">{item.cantidad}</span>
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
      )}

      {/* Modal registro/detalle */}
      {modalChofer && (
        <RegistrarInventario
          uid={modalChofer.uid}
          nombre={modalChofer.nombre}
          ficha={modalChofer.ficha}
          onClose={() => setModalChofer(null)}
        />
      )}
    </div>
  );
}
