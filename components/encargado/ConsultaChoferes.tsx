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
import { collection, query, where, onSnapshot, getDoc, setDoc, doc, Timestamp } from "firebase/firestore";
import { db } from "@/lib/firebase";
import {
  UserProfile, TalonarioDoc, MovimientoLoker,
  PuntoProducto, InventarioBaseItem, PrecioProducto, toProductoId, toDate,
} from "@/lib/types";
import RegistrarInventario from "@/components/encargado/RegistrarInventario";
import DespachoChofer      from "@/components/encargado/DespachoChofer";
import BuscadorArea, { coincide } from "@/components/shared/BuscadorArea";

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

interface Props {
  /** Reporta cuántos choferes están pendientes al padre (para el badge del tab) */
  onPendientesChange?: (n: number) => void;
}

export default function ConsultaChoferes({ onPendientesChange }: Props) {
  const [choferes,    setChoferes]    = useState<UserProfile[]>([]);
  const [talonarios,  setTalonarios]  = useState<TalonarioDoc[]>([]);
  const [extras,      setExtras]      = useState<MovimientoLoker[]>([]);
  const [puntosMap,   setPuntosMap]   = useState<Record<string, number>>({});
  const [meta,        setMeta]        = useState(100);
  const [selChofer,   setSelChofer]   = useState("todos");
  const [cargando,    setCargando]    = useState(true);
  const [seccion,     setSeccion]     = useState<Seccion>("cierre");

  // ── Fase 1 (plan de conexión): declarar inventario_base ──────────────────────
  const [precios, setPrecios] = useState<PrecioProducto[]>([]);
  useEffect(() => {
    getDoc(doc(db, "config", "precios")).then((snap) => {
      if (snap.exists()) setPrecios((snap.data().productos as PrecioProducto[]) ?? []);
    }).catch(() => {/* catálogo opcional */});
  }, []);

  // Resuelve un nombre libre contra el catálogo — mismo patrón que
  // resolverProducto() en components/despachador/Choferes.tsx (fix D-1b):
  // nunca guardar un producto_id derivado de texto crudo sin anclar.
  const resolverProducto = (nombreLibre: string): { nombre: string; producto_id: string } => {
    const pid = toProductoId(nombreLibre);
    const exacto = precios.find((p) => p.producto_id === pid);
    if (exacto) return { nombre: exacto.nombre, producto_id: exacto.producto_id };
    const parcial = precios.find((p) => p.producto_id.includes(pid) || pid.includes(p.producto_id));
    if (parcial) return { nombre: parcial.nombre, producto_id: parcial.producto_id };
    return { nombre: nombreLibre.trim(), producto_id: pid };
  };

  const [editandoBase, setEditandoBase] = useState<string | null>(null); // uid del chofer en edición
  const [filasBase,    setFilasBase]    = useState<InventarioBaseItem[]>([]);
  const [nuevoProdId,  setNuevoProdId]  = useState("");
  const [nuevoCant,    setNuevoCant]    = useState(1);
  const [guardandoBase, setGuardandoBase] = useState(false);
  const [baseMsg, setBaseMsg] = useState<{ uid: string; type: "ok" | "err"; text: string } | null>(null);

  const abrirEdicionBase = (c: UserProfile) => {
    setEditandoBase(c.uid);
    setFilasBase(c.inventario_base ?? []);
    setNuevoProdId(""); setNuevoCant(1);
  };

  const usarHoyComoBorrador = (uid: string) => {
    const hoyMap = invHoy.get(uid);
    if (!hoyMap) return;
    const filas: InventarioBaseItem[] = Array.from(hoyMap.values()).map((item) => {
      const r = resolverProducto(item.nombre);
      return { nombre: r.nombre, producto_id: r.producto_id, cantidad: item.cantidad };
    });
    setFilasBase(filas);
  };

  const agregarFilaBase = () => {
    if (!nuevoProdId || nuevoCant <= 0) return;
    const prod = precios.find((p) => p.producto_id === nuevoProdId);
    if (!prod) return;
    setFilasBase((prev) => {
      const idx = prev.findIndex((f) => f.producto_id === nuevoProdId);
      if (idx >= 0) {
        const next = [...prev];
        next[idx] = { ...next[idx], cantidad: next[idx].cantidad + nuevoCant };
        return next;
      }
      return [...prev, { nombre: prod.nombre, producto_id: prod.producto_id, cantidad: nuevoCant }];
    });
    setNuevoProdId(""); setNuevoCant(1);
  };

  const quitarFilaBase = (producto_id: string) => {
    setFilasBase((prev) => prev.filter((f) => f.producto_id !== producto_id));
  };

  const guardarBase = async (uid: string) => {
    setGuardandoBase(true);
    try {
      await setDoc(doc(db, "usuarios", uid), {
        inventario_base: filasBase,
        inventarioBaseDate: Timestamp.now(),
      }, { merge: true });
      setBaseMsg({ uid, type: "ok", text: "Base declarada ✓" });
      setEditandoBase(null);
    } catch (e) {
      setBaseMsg({ uid, type: "err", text: e instanceof Error ? e.message : "Error al guardar" });
    } finally {
      setGuardandoBase(false);
      setTimeout(() => setBaseMsg(null), 4000);
    }
  };

  // Selector de fecha para la sección de cierre
  const [fechaSel,  setFechaSel]  = useState<Date>(() => { const d = new Date(); d.setHours(0,0,0,0); return d; });
  const fechaKey  = useMemo(() => toFechaKey(fechaSel), [fechaSel]);
  const esDiaHoy  = useMemo(() => esHoy(fechaSel), [fechaSel]);

  // Inventarios guardados del día seleccionado
  const [invGuardados, setInvGuardados] = useState<Record<string, InvGuardadoResumen>>({});

  // Choferes que el Encargado marcó como revisados/sincronizados manualmente
  // ese día (indicador azul). No conecta con Sheets; se persiste por fecha en
  // localStorage (clave pb_revisados_<fecha>) — marcador local del Encargado.
  const [revisados, setRevisados] = useState<Set<string>>(new Set());

  useEffect(() => {
    try {
      const raw = localStorage.getItem(`pb_revisados_${fechaKey}`);
      setRevisados(new Set(raw ? (JSON.parse(raw) as string[]) : []));
    } catch { setRevisados(new Set()); }
  }, [fechaKey]);

  function toggleRevisado(ficha: string) {
    setRevisados((prev) => {
      const next = new Set(prev);
      if (next.has(ficha)) next.delete(ficha); else next.add(ficha);
      try { localStorage.setItem(`pb_revisados_${fechaKey}`, JSON.stringify([...next])); } catch {/* almacenamiento bloqueado */}
      return next;
    });
  }

  // Modal de registro/detalle
  const [modalChofer, setModalChofer] = useState<{ uid: string; nombre: string; ficha: string } | null>(null);

  // Modal de despacho directo Encargado → chofer (Mejora #7)
  const [despachoChofer, setDespachoChofer] = useState<{ uid: string; nombre: string; ficha?: string } | null>(null);

  // Buscador contextual del cierre (#13): filtra choferes por nombre o ficha
  const [choferQ, setChoferQ] = useState("");
  const choferesCierre = useMemo(
    () => choferes.filter((c) => coincide(choferQ, c.nombre, c.ficha)),
    [choferes, choferQ],
  );

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
    // Timeout de seguridad: si algún snapshot no responde en 8 s, desbloquear UI
    const safetyTimer = setTimeout(() => setCargando(false), 8_000);

    getDoc(doc(db, "config", "puntos"))
      .then((snap) => {
        if (!snap.exists()) return;
        const data = snap.data();
        const map: Record<string, number> = {};
        (data.productos as PuntoProducto[] ?? []).forEach((p) => {
          map[p.nombre.toLowerCase().trim()] = p.puntos;
        });
        setPuntosMap(map);
        if (data.meta) setMeta(data.meta as number);
      })
      .catch(() => {/* config opcional */});

    const unsubChof = onSnapshot(
      query(collection(db, "usuarios"), where("role", "==", "chofer")),
      (snap) => setChoferes(
        snap.docs.map((d) => d.data() as UserProfile).filter((u) => u.activo !== false)
      ),
      (err) => { console.warn("ConsultaChoferes [usuarios]:", err); setCargando(false); }
    );

    const unsubTal = onSnapshot(
      query(collection(db, "talonario"), where("tipo", "==", "retirada")),
      (snap) => {
        setTalonarios(snap.docs.map((d) => ({ id: d.id, ...d.data() } as TalonarioDoc)));
        clearTimeout(safetyTimer);
        setCargando(false);
      },
      (err) => { console.warn("ConsultaChoferes [talonario]:", err); setCargando(false); }
    );

    const unsubMov = onSnapshot(
      query(collection(db, "movimientos_loker"), where("generaPuntos", "==", true)),
      (snap) => setExtras(snap.docs.map((d) => ({ id: d.id, ...d.data() } as MovimientoLoker))),
      (err) => console.warn("ConsultaChoferes [movimientos_loker]:", err)
    );

    return () => {
      clearTimeout(safetyTimer);
      unsubChof(); unsubTal(); unsubMov();
    };
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
      if (!uid || !prodNombre) return;
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
      (t.productos ?? []).forEach((p) => acumular(t.choferId, t.choferNombre, t.choferFicha, p.nombre, p.cantidad ?? 0));
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
        (t.productos ?? []).forEach((p) => {
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
  const cerrados      = Object.keys(invGuardados).length;
  const pendientes    = choferes.length - cerrados;
  const revisadosCount = choferes.filter((c) => c.ficha && revisados.has(c.ficha)).length;

  // Reportar badge al padre (EncargadoDashboard)
  useEffect(() => {
    onPendientesChange?.(pendientes);
  }, [pendientes, onPendientesChange]);

  if (cargando) {
    return (
      <div className="text-center py-16 text-gray-400">
        <p className="text-2xl animate-spin mb-2">⭐</p>
        <p className="text-sm font-medium">Cargando datos…</p>
        <p className="text-xs mt-2 text-gray-300">Conectando con Firebase</p>
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
              {revisadosCount > 0 && (
                <span className="bg-blue-500/20 text-blue-300 text-xs font-bold px-2 py-0.5 rounded-full border border-blue-500/30">
                  🔵 {revisadosCount}
                </span>
              )}
            </div>
          </div>

          {/* Banda tricolor */}
          <div className="h-0.5 flex">
            <div className="flex-1 bg-[#F5C800]" />
            <div className="flex-1 bg-[#D42B2B]" />
            <div className="flex-1 bg-[#1E8C3A]" />
          </div>

          {/* ── Barra de progreso de la jornada — §24 ── */}
          {choferes.length > 0 && (
            <div className="px-4 pt-3 pb-2 bg-gray-50 border-b border-gray-100">
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-xs font-semibold text-gray-500">Progreso de la jornada</span>
                <span className="text-xs font-black text-[#1A1A1A]">
                  {cerrados}/{choferes.length}
                </span>
              </div>
              {/* Barra tricolor animada */}
              <div className="h-2.5 rounded-full bg-gray-200 overflow-hidden">
                <div
                  className="h-full rounded-full transition-all duration-700"
                  style={{
                    width: `${Math.max(2, (cerrados / choferes.length) * 100)}%`,
                    background: cerrados === 0
                      ? "#F5C800"
                      : cerrados === choferes.length
                      ? "#1E8C3A"
                      : "linear-gradient(90deg, #F5C800 0%, #D42B2B 50%, #1E8C3A 100%)",
                  }}
                />
              </div>
              {/* Chips de estado rápido */}
              <div className="flex items-center gap-2 mt-2 text-[10px] font-semibold">
                <span className="flex items-center gap-1 text-[#1E8C3A]">
                  <span className="w-2 h-2 rounded-full bg-[#1E8C3A]" />
                  {cerrados} Cerrados
                </span>
                <span className="flex items-center gap-1 text-amber-600">
                  <span className="w-2 h-2 rounded-full bg-amber-400" />
                  {pendientes} Pendientes
                </span>
                {revisadosCount > 0 && (
                  <span className="flex items-center gap-1 text-blue-600">
                    <span className="w-2 h-2 rounded-full bg-blue-500" />
                    {revisadosCount} Revisados
                  </span>
                )}
                {esTarde && esDiaHoy && pendientes > 0 && (
                  <span className="flex items-center gap-1 text-[#D42B2B] animate-pulse">
                    <span className="w-2 h-2 rounded-full bg-[#D42B2B]" />
                    {pendientes} Tarde
                  </span>
                )}
              </div>
            </div>
          )}

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

          {/* Buscador contextual por nombre / ficha */}
          {choferes.length > 0 && (
            <div className="px-4 py-2.5 border-b border-gray-100 bg-gray-50/40">
              <BuscadorArea value={choferQ} onChange={setChoferQ} placeholder="Buscar chofer por nombre o ficha…" />
            </div>
          )}

          {/* ── Lista con panel lateral en tablet — §24 ── */}
          {choferes.length === 0 ? (
            <p className="text-sm text-gray-400 text-center py-8">Sin choferes activos</p>
          ) : choferesCierre.length === 0 ? (
            <p className="text-sm text-gray-400 text-center py-8">Sin coincidencias para “{choferQ}”</p>
          ) : (
            <div className="lg:flex">

              {/* Panel lateral fijo — solo tablet/desktop (§24) */}
              <aside className="hidden lg:block w-56 flex-shrink-0 border-r border-gray-100
                border-l-4 border-l-[#F5C800] bg-gray-50/60">
                <p className="px-3 py-2 text-[10px] font-black text-gray-400 uppercase tracking-wider">
                  Choferes ({choferes.length})
                </p>
                <div className="overflow-y-auto max-h-[420px]">
                  {choferesCierre.map((c) => {
                    const guardado = !!(c.ficha && invGuardados[c.ficha]);
                    const tarde    = esTarde && esDiaHoy && !guardado && !!c.ficha;
                    const revisado = !!c.ficha && revisados.has(c.ficha);
                    return (
                      <button
                        key={c.uid}
                        onClick={() => c.ficha && setModalChofer({ uid: c.uid, nombre: c.nombre, ficha: c.ficha })}
                        disabled={!c.ficha}
                        className="w-full flex items-center gap-2 px-3 py-2 text-left
                          hover:bg-white active:scale-[0.98] transition-all border-b border-gray-100"
                      >
                        <span className={`w-2 h-2 rounded-full flex-shrink-0 ${
                          revisado ? "bg-blue-500"
                            : guardado ? "bg-[#1E8C3A]"
                            : tarde ? "bg-[#D42B2B] animate-pulse"
                            : "bg-amber-400"
                        }`} />
                        <span className="text-xs font-medium text-gray-700 truncate flex-1">
                          {c.nombre.split(" ")[0]}
                        </span>
                        {c.ficha && (
                          <span className="text-[9px] text-gray-400 flex-shrink-0">#{c.ficha}</span>
                        )}
                      </button>
                    );
                  })}
                </div>
              </aside>

              {/* Lista principal */}
              <div className="flex-1 divide-y divide-gray-50">
                {choferesCierre.map((c) => {
                  const inv      = c.ficha ? invGuardados[c.ficha] : undefined;
                  const guardado = !!inv;
                  const tarde    = esTarde && esDiaHoy && !guardado && !!c.ficha;
                  const tot      = inv?.totales;
                  const revisado = !!c.ficha && revisados.has(c.ficha);

                  return (
                    <div
                      key={c.uid}
                      className={`flex items-stretch transition-colors ${
                        revisado ? "bg-blue-50/50"
                          : guardado ? "bg-green-50/40"
                          : tarde ? "bg-red-50/30"
                          : ""
                      }`}
                    >
                      {/* Botón principal → abre el modal de registro/detalle */}
                      <button
                        onClick={() => {
                          if (!c.ficha) return;
                          setModalChofer({ uid: c.uid, nombre: c.nombre, ficha: c.ficha });
                        }}
                        disabled={!c.ficha}
                        className="flex-1 min-w-0 px-4 py-3 flex items-center gap-3 text-left
                          hover:bg-black/[0.02] active:scale-[0.99] transition-all"
                      >
                        {/* Chip de estado — azul si revisado · ✅ verde · 🚨 rojo · ⏳ amarillo */}
                        <div className={`w-9 h-9 rounded-full flex items-center justify-center
                          text-white text-xs font-bold flex-shrink-0 shadow-sm ${
                            revisado ? "bg-blue-500"
                              : guardado ? "bg-[#1E8C3A]"
                              : tarde  ? "bg-[#D42B2B] animate-pulse"
                              : "bg-[#F5C800]"
                          }`}>
                          <span className={revisado || guardado || tarde ? "" : "text-[#1A1A1A]"}>
                            {revisado ? "✓" : guardado ? "✅" : tarde ? "🚨" : "⏳"}
                          </span>
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
                          {revisado && (
                            <p className="text-xs text-blue-600 font-semibold mt-0.5">
                              🔵 Revisado por el Encargado
                            </p>
                          )}
                          {tarde && !revisado && (
                            <p className="text-xs text-[#D42B2B] font-bold mt-0.5 animate-pulse">
                              ⚠ Sin reportar — más de 10 pm
                            </p>
                          )}
                        </div>

                        {/* Badge de estado */}
                        <div className="flex-shrink-0">
                          {guardado ? (
                            <span className="text-xs bg-green-100 text-[#1E8C3A] font-bold px-2 py-0.5 rounded-full border border-green-200">
                              Ver ›
                            </span>
                          ) : tarde ? (
                            <span className="text-xs bg-red-100 text-[#D42B2B] font-bold px-2 py-0.5 rounded-full border border-red-200 animate-pulse">
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

                      {/* Botón de despacho directo a este chofer (Mejora #7) */}
                      <button
                        onClick={() => setDespachoChofer({ uid: c.uid, nombre: c.nombre, ficha: c.ficha })}
                        title={`Despachar mercancía a ${c.nombre}`}
                        className="flex-shrink-0 w-12 flex items-center justify-center text-base
                          border-l border-gray-100 bg-white text-gray-400
                          hover:bg-green-50 hover:text-[#1E8C3A] active:scale-95 transition-colors"
                      >
                        🚚
                      </button>

                      {/* Botón de revisión manual — azul cuando está marcado */}
                      {c.ficha && (
                        <button
                          onClick={() => toggleRevisado(c.ficha!)}
                          title={revisado
                            ? "Revisado/sincronizado manualmente — toca para desmarcar"
                            : "Marcar como revisado/sincronizado"}
                          aria-pressed={revisado}
                          className={`flex-shrink-0 w-12 flex items-center justify-center text-base
                            border-l transition-colors active:scale-95 ${
                              revisado
                                ? "bg-blue-500 text-white border-blue-500 hover:bg-blue-600"
                                : "bg-white text-gray-400 border-gray-100 hover:bg-blue-50 hover:text-blue-500"
                            }`}
                        >
                          {revisado ? "✓" : "🔄"}
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
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
                          <div className="flex items-center justify-between mb-1.5">
                            <p className="text-xs font-semibold text-blue-600">📦 Base asignada</p>
                            {editandoBase !== c.uid && (
                              <button onClick={() => abrirEdicionBase(c)}
                                className="text-xs text-blue-600 hover:text-blue-800 font-semibold active:scale-95 transition-all">
                                ✏️ Editar
                              </button>
                            )}
                          </div>
                          {editandoBase === c.uid ? (
                            <div className="space-y-2 bg-blue-50/60 border border-blue-100 rounded-lg p-2.5">
                              {filasBase.length === 0 ? (
                                <p className="text-xs text-gray-400 italic">Sin filas — agrega productos abajo</p>
                              ) : (
                                <div className="space-y-1">
                                  {filasBase.map((item) => (
                                    <div key={item.producto_id} className="flex items-center justify-between text-xs
                                      bg-white border border-blue-100 rounded-lg px-2 py-1.5">
                                      <span className="text-gray-700 truncate mr-1 flex-1 min-w-0">{item.nombre}</span>
                                      <span className="font-bold text-blue-700 flex-shrink-0 mr-2">{item.cantidad}</span>
                                      <button onClick={() => quitarFilaBase(item.producto_id)}
                                        className="text-red-400 hover:text-red-600 flex-shrink-0 font-bold">✕</button>
                                    </div>
                                  ))}
                                </div>
                              )}
                              <div className="flex gap-1.5">
                                <select value={nuevoProdId} onChange={(e) => setNuevoProdId(e.target.value)}
                                  className="flex-1 min-w-0 px-2 py-1.5 border border-gray-200 rounded-lg text-xs bg-white outline-none focus:ring-2 focus:ring-blue-400">
                                  <option value="">Producto…</option>
                                  {precios.map((p) => (
                                    <option key={p.producto_id} value={p.producto_id}>{p.nombre}</option>
                                  ))}
                                </select>
                                <input type="number" min={1} value={nuevoCant}
                                  onChange={(e) => setNuevoCant(Number(e.target.value) || 1)}
                                  className="w-14 px-2 py-1.5 border border-gray-200 rounded-lg text-xs outline-none focus:ring-2 focus:ring-blue-400" />
                                <button onClick={agregarFilaBase}
                                  className="px-2.5 py-1.5 bg-blue-100 text-blue-700 rounded-lg text-xs font-bold hover:bg-blue-200 active:scale-95 transition-all">
                                  + Agregar
                                </button>
                              </div>
                              <div className="flex gap-1.5 pt-1">
                                <button onClick={() => usarHoyComoBorrador(c.uid)} disabled={!invHoy.get(c.uid)}
                                  className="flex-1 text-xs bg-green-50 text-[#1E8C3A] border border-green-200 rounded-lg py-1.5 font-semibold hover:bg-green-100 active:scale-95 transition-all disabled:opacity-40">
                                  🚛 Usar hoy despachado
                                </button>
                                <button onClick={() => setEditandoBase(null)}
                                  className="px-3 text-xs bg-gray-100 text-gray-600 rounded-lg py-1.5 font-semibold hover:bg-gray-200 active:scale-95 transition-all">
                                  Cancelar
                                </button>
                                <button onClick={() => guardarBase(c.uid)} disabled={guardandoBase}
                                  className="px-3 text-xs bg-blue-600 text-white rounded-lg py-1.5 font-bold hover:bg-blue-700 active:scale-95 transition-all disabled:opacity-60">
                                  {guardandoBase ? "..." : "💾 Guardar"}
                                </button>
                              </div>
                              {baseMsg && baseMsg.uid === c.uid && (
                                <p className={`text-xs font-semibold ${baseMsg.type === "ok" ? "text-[#1E8C3A]" : "text-red-600"}`}>
                                  {baseMsg.text}
                                </p>
                              )}
                            </div>
                          ) : base.length === 0 ? (
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

      {despachoChofer && (
        <DespachoChofer
          uid={despachoChofer.uid}
          nombre={despachoChofer.nombre}
          ficha={despachoChofer.ficha}
          onClose={() => setDespachoChofer(null)}
        />
      )}
    </div>
  );
}
