"use client";

import { useState, useEffect, useMemo } from "react";
import {
  collection, query, orderBy, onSnapshot, addDoc, Timestamp, where,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useAuth } from "@/lib/auth-context";
import {
  MovimientoLoker, TalonarioDoc, LoteLoker, toDate, fmtDate, toProductoId,
} from "@/lib/types";

// ─── Tipos internos ───────────────────────────────────────────────────────────

interface ResumenChofer {
  choferId:        string;
  choferNombre:    string;
  productos: {
    pid:        string;
    nombre:     string;
    despachado: number;
    sobrante:   number;
    vendido:    number;
  }[];
  totalDespachado: number;
  totalSobrante:   number;
  totalVendido:    number;
  reportado:       boolean;
}

interface SaldoDetalle {
  pid:         string;
  nombre:      string;
  saldo:       number;
  despachHoy:  number;
  sobranteHoy: number;
  vendidoHoy:  number;
}

// ─── Config de tipos de movimiento ───────────────────────────────────────────

const TIPO_CFG = {
  entrada_interior:  { label: "Entrada interior",  sign:  1, bg: "bg-green-100",  text: "text-green-700",  border: "border-green-200"  },
  devolucion_chofer: { label: "Devolución chofer", sign:  1, bg: "bg-blue-100",   text: "text-blue-700",   border: "border-blue-200"   },
  salida_despacho:   { label: "Salida despacho",   sign: -1, bg: "bg-orange-100", text: "text-orange-700", border: "border-orange-200" },
  merma:             { label: "Merma",             sign: -1, bg: "bg-red-100",    text: "text-red-700",    border: "border-red-200"    },
  ajuste:            { label: "Ajuste",            sign:  0, bg: "bg-gray-100",   text: "text-gray-700",   border: "border-gray-200"   },
} as const;

type TipoLoker = MovimientoLoker["tipo"];

const TIPOS_ORDEN: TipoLoker[] = [
  "entrada_interior", "devolucion_chofer", "salida_despacho", "merma", "ajuste",
];

function getTodayStart(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function Inventario() {
  const { profile } = useAuth();

  const [movimientos,  setMovimientos]  = useState<MovimientoLoker[]>([]);
  const [talonarioHoy, setTalonarioHoy] = useState<TalonarioDoc[]>([]);
  const [cargando,     setCargando]     = useState(true);

  // Form state
  const [tipo,      setTipo]      = useState<TipoLoker>("entrada_interior");
  const [nombre,    setNombre]    = useState("");
  const [cantidad,  setCantidad]  = useState("");
  const [ajustePos, setAjustePos] = useState(true);
  const [notas,     setNotas]     = useState("");
  const [guardando, setGuardando] = useState(false);
  const [msg, setMsg]             = useState<{ type: "ok" | "err"; text: string } | null>(null);

  // UI toggles
  const [saldoAbierto,   setSaldoAbierto]   = useState(true);
  const [chofersAbierto, setChofersAbierto] = useState(true);
  const [movAbierto,     setMovAbierto]     = useState(false);
  const [lotesAbierto,   setLotesAbierto]   = useState(false);
  const [lotes,          setLotes]          = useState<LoteLoker[]>([]);

  // Modal
  type InvModal =
    | { type: "stat"; key: "loker" | "despachado" | "vendido" | "facturado" }
    | { type: "producto"; pid: string; nombre: string }
    | { type: "chofer"; ch: ResumenChofer }
    | { type: "lote"; lote: LoteLoker }
    | null;
  const [invModal, setInvModal] = useState<InvModal>(null);

  // Timestamps estables (solo se calculan una vez por montaje)
  const todayStart = useMemo(() => getTodayStart(), []);
  const todayTs    = useMemo(() => Timestamp.fromDate(todayStart), [todayStart]);

  // ── Listener 1: movimientos_loker (tiempo real completo) ──────────────────
  useEffect(() => {
    const q = query(collection(db, "movimientos_loker"), orderBy("timestamp", "desc"));
    return onSnapshot(q, (snap) => {
      setMovimientos(snap.docs.map((d) => ({ id: d.id, ...d.data() } as MovimientoLoker)));
      setCargando(false);
    });
  }, []);

  // ── Listener 2: talonario de hoy (para calcular dinero facturado) ─────────
  useEffect(() => {
    const q = query(
      collection(db, "talonario"),
      where("timestamp", ">=", todayTs),
      orderBy("timestamp", "desc"),
    );
    const unsub = onSnapshot(q, (snap) => {
      setTalonarioHoy(snap.docs.map((d) => ({ id: d.id, ...d.data() } as TalonarioDoc)));
    }, () => {
      // Si no hay índice, fallback silencioso
      setTalonarioHoy([]);
    });
    return unsub;
  }, [todayTs]);

  // ── Listener 3: lotes_loker ───────────────────────────────────────────────
  useEffect(() => {
    const q = query(collection(db, "lotes_loker"), orderBy("timestamp", "desc"));
    return onSnapshot(q, (snap) => {
      setLotes(snap.docs.map((d) => ({ id: d.id, ...d.data() } as LoteLoker)));
    });
  }, []);

  // ── Movimientos de hoy ────────────────────────────────────────────────────
  const movHoy = useMemo(
    () => movimientos.filter((m) => toDate(m.timestamp) >= todayStart),
    [movimientos, todayStart],
  );

  // ── Saldo acumulado + desglose del día por producto ───────────────────────
  const saldoConDetalle = useMemo((): SaldoDetalle[] => {
    // Balance acumulado (todo el tiempo)
    const saldoMap = new Map<string, { nombre: string; saldo: number }>();
    for (const m of movimientos) {
      const prev = saldoMap.get(m.producto_id) ?? { nombre: m.nombre, saldo: 0 };
      saldoMap.set(m.producto_id, { nombre: m.nombre, saldo: prev.saldo + m.cantidad });
    }

    // Desglose de hoy
    const despachHoyMap  = new Map<string, number>();
    const sobranteHoyMap = new Map<string, number>();
    for (const m of movHoy) {
      if (m.tipo === "salida_despacho") {
        despachHoyMap.set(m.producto_id, (despachHoyMap.get(m.producto_id) ?? 0) + Math.abs(m.cantidad));
      }
      if (m.tipo === "devolucion_chofer") {
        sobranteHoyMap.set(m.producto_id, (sobranteHoyMap.get(m.producto_id) ?? 0) + m.cantidad);
      }
    }

    return Array.from(saldoMap.entries())
      .map(([pid, d]) => {
        const despachHoy  = despachHoyMap.get(pid)  ?? 0;
        const sobranteHoy = sobranteHoyMap.get(pid) ?? 0;
        return { pid, nombre: d.nombre, saldo: d.saldo, despachHoy, sobranteHoy, vendidoHoy: despachHoy - sobranteHoy };
      })
      .sort((a, b) => {
        // Negativos primero (alerta)
        if (a.saldo < 0 && b.saldo >= 0) return -1;
        if (b.saldo < 0 && a.saldo >= 0) return 1;
        return b.saldo - a.saldo;
      });
  }, [movimientos, movHoy]);

  // ── Resumen de sobrantes por chofer ──────────────────────────────────────
  const resumenChoferes = useMemo((): ResumenChofer[] => {
    const mapaChoferes = new Map<string, {
      nombre:         string;
      despachadoProd: Map<string, { nombre: string; cantidad: number }>;
      sobranteProd:   Map<string, { nombre: string; cantidad: number }>;
    }>();

    for (const m of movHoy) {
      if (!m.choferId || !m.choferNombre) continue;
      if (m.tipo !== "salida_despacho" && m.tipo !== "devolucion_chofer") continue;

      if (!mapaChoferes.has(m.choferId)) {
        mapaChoferes.set(m.choferId, {
          nombre:         m.choferNombre,
          despachadoProd: new Map(),
          sobranteProd:   new Map(),
        });
      }
      const ch = mapaChoferes.get(m.choferId)!;

      if (m.tipo === "salida_despacho") {
        const prev = ch.despachadoProd.get(m.producto_id) ?? { nombre: m.nombre, cantidad: 0 };
        ch.despachadoProd.set(m.producto_id, { nombre: m.nombre, cantidad: prev.cantidad + Math.abs(m.cantidad) });
      } else {
        const prev = ch.sobranteProd.get(m.producto_id) ?? { nombre: m.nombre, cantidad: 0 };
        ch.sobranteProd.set(m.producto_id, { nombre: m.nombre, cantidad: prev.cantidad + m.cantidad });
      }
    }

    return Array.from(mapaChoferes.entries())
      .map(([choferId, data]) => {
        const productos = Array.from(data.despachadoProd.entries()).map(([pid, d]) => {
          const sob = data.sobranteProd.get(pid)?.cantidad ?? 0;
          return { pid, nombre: d.nombre, despachado: d.cantidad, sobrante: sob, vendido: d.cantidad - sob };
        });
        const totalDespachado = productos.reduce((s, p) => s + p.despachado, 0);
        const totalSobrante   = productos.reduce((s, p) => s + p.sobrante,   0);
        const totalVendido    = productos.reduce((s, p) => s + p.vendido,     0);
        return {
          choferId,
          choferNombre: data.nombre,
          productos,
          totalDespachado,
          totalSobrante,
          totalVendido,
          reportado: data.sobranteProd.size > 0,
        };
      })
      .sort((a, b) => a.choferNombre.localeCompare(b.choferNombre));
  }, [movHoy]);

  // ── Dashboard stats del día ───────────────────────────────────────────────
  const dashboard = useMemo(() => {
    const totalEnLoker    = saldoConDetalle.reduce((s, p) => s + Math.max(0, p.saldo), 0);
    const totalDespachado = saldoConDetalle.reduce((s, p) => s + p.despachHoy, 0);
    const totalSobrante   = saldoConDetalle.reduce((s, p) => s + p.sobranteHoy, 0);

    const chofersConReport  = resumenChoferes.filter((c) => c.reportado);
    const totalVendido      = chofersConReport.reduce((s, c) => s + c.totalVendido, 0);
    const chofersReportados = chofersConReport.length;
    const chofersTotal      = resumenChoferes.length;
    const productosAlerta   = saldoConDetalle.filter((p) => p.saldo <= 0).length;

    // Dinero facturado (de talonario, precio * cantidad para cada producto con precio)
    let moneyHoy  = 0;
    let hayPrecios = false;
    for (const tal of talonarioHoy) {
      if (tal.tipo !== "retirada") continue;
      for (const p of tal.productos) {
        if (p.precio != null && p.precio > 0) {
          moneyHoy  += p.precio * (p.cantidad ?? 0);
          hayPrecios = true;
        }
      }
    }

    return {
      totalEnLoker,
      totalDespachado,
      totalSobrante,
      totalVendido,
      moneyHoy,
      hayPrecios,
      productosAlerta,
      chofersTotal,
      chofersReportados,
      pendientes: chofersTotal - chofersReportados,
    };
  }, [saldoConDetalle, resumenChoferes, talonarioHoy]);

  // ── Guardar movimiento ────────────────────────────────────────────────────
  async function handleGuardar(e: React.FormEvent) {
    e.preventDefault();
    const qty = parseFloat(cantidad);
    if (!nombre.trim() || isNaN(qty) || qty <= 0) {
      setMsg({ type: "err", text: "Completa producto y cantidad (> 0)." });
      return;
    }
    setGuardando(true);
    setMsg(null);
    const cfg  = TIPO_CFG[tipo];
    const sign = cfg.sign !== 0 ? cfg.sign : (ajustePos ? 1 : -1);
    const mov: Omit<MovimientoLoker, "id"> = {
      tipo,
      producto_id: toProductoId(nombre),
      nombre:      nombre.trim(),
      cantidad:    sign * qty,
      responsable: profile?.nombre ?? "—",
      timestamp:   Timestamp.now(),
      notas:       notas.trim() || undefined,
    };
    try {
      await addDoc(collection(db, "movimientos_loker"), mov);
      setNombre(""); setCantidad(""); setNotas("");
      setMsg({ type: "ok", text: "Movimiento registrado." });
      setTimeout(() => setMsg(null), 3000);
    } catch {
      setMsg({ type: "err", text: "Error al guardar. Intenta de nuevo." });
    } finally {
      setGuardando(false);
    }
  }

  // ── Render ────────────────────────────────────────────────────────────────
  const hoyLabel = new Date().toLocaleDateString("es-MX", {
    weekday: "long", day: "numeric", month: "long",
  });

  return (
    <div className="space-y-4">

      {/* ── 1. Dashboard del día ─────────────────────────────────────────────── */}
      {!cargando && (
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
          <div className="px-4 py-3 bg-gradient-to-r from-indigo-700 to-purple-800">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h2 className="text-white font-bold text-sm">📊 Dashboard del día</h2>
                <p className="text-indigo-200 text-xs capitalize mt-0.5">{hoyLabel}</p>
              </div>
              {dashboard.productosAlerta > 0 && (
                <span className="flex-shrink-0 text-xs bg-red-500 text-white
                  px-2.5 py-1 rounded-full font-bold animate-pulse">
                  🚨 {dashboard.productosAlerta} en alerta
                </span>
              )}
            </div>
          </div>

          <div className="p-4 space-y-4">
            {/* Stats 2×2 en móvil, 4 en escritorio */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <StatCard icon="📦" label="En loker"       value={dashboard.totalEnLoker}    color="purple"
                onClick={() => setInvModal({ type: "stat", key: "loker" })} />
              <StatCard icon="🚚" label="Despachado hoy" value={dashboard.totalDespachado} color="orange"
                onClick={() => setInvModal({ type: "stat", key: "despachado" })} />
              <StatCard
                icon="✅"
                label="Vendido hoy"
                value={dashboard.chofersReportados === 0 ? "—" : dashboard.totalVendido}
                color="green"
                sub={dashboard.chofersReportados === 0 ? "sin reportes" : undefined}
                onClick={() => setInvModal({ type: "stat", key: "vendido" })}
              />
              <StatCard
                icon="💰"
                label="Facturado hoy"
                value={dashboard.hayPrecios ? `$${dashboard.moneyHoy.toLocaleString("es-MX")}` : "—"}
                color="yellow"
                sub={!dashboard.hayPrecios ? "sin precios" : undefined}
                onClick={() => setInvModal({ type: "stat", key: "facturado" })}
              />
            </div>

            {/* Progreso sobrantes por chofer */}
            {dashboard.chofersTotal > 0 && (
              <div className="bg-gray-50 rounded-xl p-3 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-gray-600">
                    Choferes con sobrantes reportados
                  </span>
                  <span className="text-xs font-bold text-gray-700">
                    {dashboard.chofersReportados}/{dashboard.chofersTotal}
                  </span>
                </div>

                {/* Barra de progreso */}
                <div className="h-2 bg-gray-200 rounded-full overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all duration-500 ${
                      dashboard.pendientes === 0 ? "bg-green-500" : "bg-amber-500"
                    }`}
                    style={{
                      width: dashboard.chofersTotal > 0
                        ? `${(dashboard.chofersReportados / dashboard.chofersTotal) * 100}%`
                        : "0%",
                    }}
                  />
                </div>

                {/* Chips por chofer */}
                <div className="flex gap-1.5 flex-wrap">
                  {resumenChoferes.map((ch) => (
                    <button
                      key={ch.choferId}
                      onClick={() => setInvModal({ type: "chofer", ch })}
                      title={`${ch.choferNombre} — Despachado: ${ch.totalDespachado} | Vendido: ${ch.totalVendido}`}
                      className={`text-xs px-2.5 py-1 rounded-full border font-medium active:scale-95 transition-all duration-100 ${
                        ch.reportado
                          ? "bg-green-100 text-green-700 border-green-200 hover:bg-green-200"
                          : "bg-amber-100 text-amber-700 border-amber-200 hover:bg-amber-200"
                      }`}
                    >
                      {ch.reportado ? "✅" : "⏳"} {ch.choferNombre.split(" ")[0]}
                    </button>
                  ))}
                </div>

                {dashboard.pendientes > 0 && (
                  <p className="text-xs text-amber-600 font-medium">
                    ⏳ {dashboard.pendientes}{" "}
                    {dashboard.pendientes === 1 ? "chofer pendiente" : "choferes pendientes"} de reportar
                  </p>
                )}
              </div>
            )}

            {/* Resumen numérico compacto */}
            {dashboard.totalDespachado > 0 && (
              <div className="grid grid-cols-3 gap-2 text-center">
                <div className="bg-orange-50 border border-orange-100 rounded-lg py-2">
                  <p className="text-xs text-orange-500 font-medium">Despachado</p>
                  <p className="text-lg font-bold text-orange-700">{dashboard.totalDespachado}</p>
                  <p className="text-xs text-orange-400">unidades</p>
                </div>
                <div className="bg-blue-50 border border-blue-100 rounded-lg py-2">
                  <p className="text-xs text-blue-500 font-medium">Sobrante</p>
                  <p className="text-lg font-bold text-blue-700">{dashboard.totalSobrante}</p>
                  <p className="text-xs text-blue-400">regresadas</p>
                </div>
                <div className="bg-green-50 border border-green-100 rounded-lg py-2">
                  <p className="text-xs text-green-500 font-medium">Vendido</p>
                  <p className="text-lg font-bold text-green-700">
                    {dashboard.chofersReportados > 0 ? dashboard.totalVendido : "—"}
                  </p>
                  <p className="text-xs text-green-400">
                    {dashboard.chofersReportados > 0 ? "calculado" : "sin datos"}
                  </p>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── 2. Stock del loker con desglose ─────────────────────────────────── */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
        <button
          onClick={() => setSaldoAbierto((v) => !v)}
          className="w-full flex items-center justify-between px-4 py-3
            bg-gradient-to-r from-purple-50 to-purple-100 hover:from-purple-100
            hover:to-purple-150 transition-colors duration-100"
        >
          <div className="flex items-center gap-2">
            <span className="text-lg">📦</span>
            <span className="font-semibold text-purple-900 text-sm">Stock del loker</span>
            <span className="text-xs bg-purple-200 text-purple-800 px-2 py-0.5 rounded-full">
              {saldoConDetalle.length} {saldoConDetalle.length === 1 ? "producto" : "productos"}
            </span>
            {saldoConDetalle.some((p) => p.saldo <= 0) && (
              <span className="text-xs bg-red-100 text-red-700 border border-red-200
                px-2 py-0.5 rounded-full font-medium">
                🚨 stock bajo
              </span>
            )}
          </div>
          <span className="text-purple-600 text-sm">{saldoAbierto ? "▲" : "▼"}</span>
        </button>

        {saldoAbierto && (
          <div>
            {cargando ? (
              <div className="px-4 py-6 text-center">
                <p className="text-sm text-gray-400 animate-pulse">Cargando stock…</p>
              </div>
            ) : saldoConDetalle.length === 0 ? (
              <div className="px-4 py-6 text-center">
                <p className="text-2xl mb-2">📦</p>
                <p className="text-sm text-gray-400">Sin productos — registra la primera entrada.</p>
              </div>
            ) : (
              <div className="divide-y divide-gray-50">
                {saldoConDetalle.map((p) => {
                  const negativo    = p.saldo < 0;
                  const sinStock    = p.saldo === 0;
                  const hayDesp     = p.despachHoy > 0;
                  const haySobrante = p.sobranteHoy > 0;

                  return (
                    <button
                      key={p.pid}
                      onClick={() => setInvModal({ type: "producto", pid: p.pid, nombre: p.nombre })}
                      className={`w-full px-4 py-3 transition-colors text-left active:scale-[0.99] hover:bg-gray-50/80 ${negativo ? "bg-red-50/50" : ""}`}
                    >
                      <div className="flex items-center justify-between gap-3">
                        {/* Ícono + nombre */}
                        <div className="flex items-center gap-2 min-w-0">
                          <span className={`flex-shrink-0 text-sm ${
                            negativo ? "text-red-500" : sinStock ? "text-amber-400" : "text-green-500"
                          }`}>
                            {negativo ? "🚨" : sinStock ? "⚠️" : "✅"}
                          </span>
                          <p className="text-sm font-medium text-gray-800 truncate">{p.nombre}</p>
                        </div>

                        {/* Stock badge */}
                        <span className={`flex-shrink-0 text-sm font-bold px-2.5 py-0.5 rounded-full border ${
                          negativo
                            ? "bg-red-100 text-red-700 border-red-300"
                            : sinStock
                            ? "bg-amber-100 text-amber-600 border-amber-200"
                            : "bg-green-100 text-green-700 border-green-200"
                        }`}>
                          {p.saldo > 0 ? "+" : ""}{p.saldo}
                        </span>
                      </div>

                      {/* Desglose del día (solo si hubo movimiento hoy) */}
                      {hayDesp && (
                        <div className="mt-2 flex gap-2 flex-wrap text-xs">
                          <span className="flex items-center gap-1 bg-orange-50 text-orange-700
                            border border-orange-200 px-2 py-0.5 rounded-full">
                            🚚 {p.despachHoy} despachado
                          </span>
                          <span className={`flex items-center gap-1 px-2 py-0.5 rounded-full border ${
                            haySobrante
                              ? "bg-blue-50 text-blue-700 border-blue-200"
                              : "bg-gray-50 text-gray-400 border-gray-200"
                          }`}>
                            🔄 {haySobrante ? p.sobranteHoy : "—"} sobrante
                          </span>
                          {haySobrante && (
                            <span className={`flex items-center gap-1 px-2 py-0.5 rounded-full border ${
                              p.vendidoHoy < 0
                                ? "bg-red-50 text-red-700 border-red-200"
                                : "bg-green-50 text-green-700 border-green-200"
                            }`}>
                              ✅ {p.vendidoHoy < 0 ? "🚨 ERROR" : p.vendidoHoy} vendido
                            </span>
                          )}
                        </div>
                      )}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── 3. Sobrantes por chofer (hoy) ────────────────────────────────────── */}
      {resumenChoferes.length > 0 && (
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
          <button
            onClick={() => setChofersAbierto((v) => !v)}
            className="w-full flex items-center justify-between px-4 py-3
              bg-gradient-to-r from-teal-50 to-teal-100 hover:from-teal-100
              hover:to-teal-150 transition-colors duration-100"
          >
            <div className="flex items-center gap-2">
              <span className="text-lg">🚚</span>
              <span className="font-semibold text-teal-900 text-sm">
                Sobrantes choferes — hoy
              </span>
              <span className="text-xs bg-teal-200 text-teal-800 px-2 py-0.5 rounded-full">
                {resumenChoferes.length} {resumenChoferes.length === 1 ? "chofer" : "choferes"}
              </span>
              {resumenChoferes.some((c) => !c.reportado) && (
                <span className="text-xs bg-amber-100 text-amber-700 border border-amber-200
                  px-2 py-0.5 rounded-full font-medium animate-pulse">
                  ⏳ pendientes
                </span>
              )}
            </div>
            <span className="text-teal-600 text-sm">{chofersAbierto ? "▲" : "▼"}</span>
          </button>

          {chofersAbierto && (
            <div className="divide-y divide-gray-50">
              {resumenChoferes.map((ch) => {
                const alerta = !ch.reportado || ch.productos.some((p) => p.vendido < 0);
                return (
                  <div key={ch.choferId} className={`p-4 ${alerta && ch.reportado ? "bg-red-50/30" : ""}`}>
                    {/* Cabecera chofer */}
                    <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-semibold text-sm text-gray-800">{ch.choferNombre}</span>
                        {!ch.reportado ? (
                          <span className="text-xs bg-amber-100 text-amber-700 border border-amber-200
                            px-2 py-0.5 rounded-full font-medium">⏳ Sin sobrantes</span>
                        ) : (
                          <span className="text-xs bg-green-100 text-green-700 border border-green-200
                            px-2 py-0.5 rounded-full font-medium">✅ Reportado</span>
                        )}
                        {alerta && ch.reportado && (
                          <span className="text-xs bg-red-100 text-red-700 border border-red-200
                            px-2 py-0.5 rounded-full font-medium">🚨 Inconsistencia</span>
                        )}
                      </div>
                      <div className="flex gap-3 text-xs text-center">
                        <div>
                          <p className="text-gray-400">Despachado</p>
                          <p className="font-bold text-cyan-700">{ch.totalDespachado}</p>
                        </div>
                        <div>
                          <p className="text-gray-400">Sobrante</p>
                          <p className="font-bold text-blue-600">{ch.totalSobrante}</p>
                        </div>
                        <div>
                          <p className="text-gray-400">Vendido</p>
                          <p className={`font-bold ${ch.totalVendido < 0 ? "text-red-600" : "text-green-700"}`}>
                            {ch.totalVendido}
                          </p>
                        </div>
                      </div>
                    </div>

                    {/* Tabla de productos */}
                    <div className="overflow-x-auto rounded-lg border border-gray-100">
                      <table className="w-full text-xs">
                        <thead>
                          <tr className="bg-gray-50 text-gray-500">
                            <th className="text-left px-3 py-2 font-medium">Producto</th>
                            <th className="text-right px-3 py-2 font-medium">Despachado</th>
                            <th className="text-right px-3 py-2 font-medium">Sobrante</th>
                            <th className="text-right px-3 py-2 font-medium">Vendido</th>
                            <th className="text-center px-3 py-2 font-medium">Estado</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-50">
                          {ch.productos.map((p) => {
                            const prodAlerta = p.vendido < 0 || p.sobrante > p.despachado;
                            const sinReporte = !ch.reportado;
                            return (
                              <tr key={p.pid} className={prodAlerta ? "bg-red-50" : "hover:bg-gray-50/50"}>
                                <td className="px-3 py-2 font-medium text-gray-700 max-w-[120px] truncate">
                                  {p.nombre}
                                </td>
                                <td className="px-3 py-2 text-right text-cyan-700 font-semibold">
                                  {p.despachado}
                                </td>
                                <td className="px-3 py-2 text-right text-blue-600 font-semibold">
                                  {sinReporte ? <span className="text-gray-300">—</span> : p.sobrante}
                                </td>
                                <td className={`px-3 py-2 text-right font-semibold ${
                                  sinReporte ? "text-gray-300"
                                  : prodAlerta ? "text-red-600"
                                  : "text-green-700"
                                }`}>
                                  {sinReporte ? "—" : p.vendido}
                                </td>
                                <td className="px-3 py-2 text-center">
                                  {sinReporte ? "⏳" : prodAlerta ? "🚨" : "✅"}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ── 4. Lotes de almacén ──────────────────────────────────────────────── */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
        <button
          onClick={() => setLotesAbierto((v) => !v)}
          className="w-full flex items-center justify-between px-4 py-3
            bg-gradient-to-r from-emerald-50 to-emerald-100 hover:from-emerald-100
            hover:to-emerald-150 transition-colors duration-100"
        >
          <div className="flex items-center gap-2">
            <span className="text-lg">🏭</span>
            <span className="font-semibold text-emerald-900 text-sm">Lotes registrados</span>
            <span className="text-xs bg-emerald-200 text-emerald-800 px-2 py-0.5 rounded-full">
              {lotes.length} {lotes.length === 1 ? "lote" : "lotes"}
            </span>
            {lotes.some((l) => !l.facturaEntregada) && (
              <span className="text-xs bg-amber-100 text-amber-700 border border-amber-200
                px-2 py-0.5 rounded-full font-medium animate-pulse">
                ⏳ facturas pendientes
              </span>
            )}
          </div>
          <span className="text-emerald-600 text-sm">{lotesAbierto ? "▲" : "▼"}</span>
        </button>

        {lotesAbierto && (
          <div>
            {lotes.length === 0 ? (
              <div className="px-4 py-8 text-center">
                <p className="text-2xl mb-2">🏭</p>
                <p className="text-sm text-gray-400">Sin lotes registrados aún.</p>
                <p className="text-xs text-gray-300 mt-1">Los encargados de almacén registran lotes desde su panel.</p>
              </div>
            ) : (
              <div className="divide-y divide-gray-50">
                {lotes.map((lote) => (
                  <button
                    key={lote.id}
                    onClick={() => setInvModal({ type: "lote", lote })}
                    className="w-full px-4 py-3 text-left hover:bg-gray-50 active:scale-[0.99]
                      transition-all duration-100"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="text-sm font-bold text-emerald-700 flex-shrink-0">
                          {lote.numero}
                        </span>
                        {lote.proveedor && (
                          <span className="text-xs text-gray-500 truncate">{lote.proveedor}</span>
                        )}
                        <span className={`flex-shrink-0 text-xs px-1.5 py-0.5 rounded-full border font-medium ${
                          lote.facturaEntregada
                            ? "bg-green-100 text-green-700 border-green-200"
                            : "bg-amber-100 text-amber-700 border-amber-200"
                        }`}>
                          {lote.facturaEntregada ? "✅ Factura" : "⏳ Sin factura"}
                        </span>
                      </div>
                      <div className="text-right flex-shrink-0">
                        <p className="text-xs text-gray-400">{fmtDate(lote.timestamp)}</p>
                        <p className="text-xs text-gray-500 mt-0.5">
                          {lote.productos.length} prod · {lote.registradoPor}
                        </p>
                      </div>
                    </div>
                    {lote.productos.length > 0 && (
                      <div className="mt-1.5 flex gap-1.5 flex-wrap">
                        {lote.productos.map((p) => (
                          <span key={p.producto_id}
                            className="text-xs bg-emerald-50 text-emerald-700 border border-emerald-200
                              px-2 py-0.5 rounded-full"
                          >
                            {p.nombre.split(" ")[0]} {p.cajas > 0 ? `${p.cajas}caj` : ""}{p.cajas > 0 && p.unidades > 0 ? "+" : ""}{p.unidades > 0 ? `${p.unidades}uds` : ""}
                          </span>
                        ))}
                      </div>
                    )}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── 5. Formulario + Lista de movimientos ─────────────────────────────── */}
      <div className="grid grid-cols-1 md:grid-cols-5 gap-4">

        {/* Formulario */}
        <div className="md:col-span-2">
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
            <div className="px-4 py-3 bg-gradient-to-r from-purple-700 to-purple-900">
              <h2 className="text-white font-semibold text-sm">+ Registrar movimiento</h2>
            </div>
            <form onSubmit={handleGuardar} className="p-4 space-y-3">

              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Tipo</label>
                <select
                  value={tipo}
                  onChange={(e) => setTipo(e.target.value as TipoLoker)}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm
                    focus:outline-none focus:ring-2 focus:ring-purple-400 bg-white"
                >
                  {TIPOS_ORDEN.map((t) => (
                    <option key={t} value={t}>{TIPO_CFG[t].label}</option>
                  ))}
                </select>
                <div className={`mt-1.5 inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs
                  font-medium border ${TIPO_CFG[tipo].bg} ${TIPO_CFG[tipo].text} ${TIPO_CFG[tipo].border}`}>
                  <span>{TIPO_CFG[tipo].sign >= 0 ? "▲" : "▼"}</span>
                  <span>{TIPO_CFG[tipo].label}</span>
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Producto</label>
                <input
                  type="text" value={nombre}
                  onChange={(e) => setNombre(e.target.value)}
                  placeholder="Ej. Helado de fresa"
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm
                    focus:outline-none focus:ring-2 focus:ring-purple-400"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Cantidad</label>
                <div className="flex gap-2">
                  {tipo === "ajuste" && (
                    <button
                      type="button"
                      onClick={() => setAjustePos((v) => !v)}
                      className={`px-3 py-2 rounded-lg border text-sm font-bold transition-colors ${
                        ajustePos
                          ? "bg-green-100 border-green-300 text-green-700"
                          : "bg-red-100 border-red-300 text-red-700"
                      }`}
                    >
                      {ajustePos ? "+" : "−"}
                    </button>
                  )}
                  <input
                    type="number" value={cantidad}
                    onChange={(e) => setCantidad(e.target.value)}
                    placeholder="0" min="0" step="any"
                    className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm
                      focus:outline-none focus:ring-2 focus:ring-purple-400"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">
                  Notas <span className="text-gray-400 font-normal">(opcional)</span>
                </label>
                <textarea
                  value={notas} onChange={(e) => setNotas(e.target.value)}
                  rows={2} placeholder="Observaciones, lote, proveedor…"
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm
                    focus:outline-none focus:ring-2 focus:ring-purple-400 resize-none"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Responsable</label>
                <div className="border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-500 bg-gray-50">
                  {profile?.nombre ?? "—"}
                </div>
              </div>

              {msg && (
                <p className={`text-xs rounded-lg px-3 py-2 ${
                  msg.type === "ok"
                    ? "bg-green-50 text-green-700 border border-green-200"
                    : "bg-red-50 text-red-600 border border-red-200"
                }`}>
                  {msg.text}
                </p>
              )}

              <button
                type="submit" disabled={guardando}
                className="w-full bg-gradient-to-r from-purple-700 to-purple-900 hover:from-purple-600
                  hover:to-purple-800 text-white font-semibold py-2.5 rounded-lg text-sm
                  transition-all duration-100 active:scale-95 disabled:opacity-60"
              >
                {guardando ? "Guardando…" : "Registrar movimiento"}
              </button>
            </form>
          </div>
        </div>

        {/* Lista de movimientos (colapsable) */}
        <div className="md:col-span-3">
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
            <button
              onClick={() => setMovAbierto((v) => !v)}
              className="w-full px-4 py-3 border-b border-gray-100 flex items-center
                justify-between hover:bg-gray-50 transition-colors"
            >
              <h2 className="font-semibold text-gray-800 text-sm">Movimientos recientes</h2>
              <div className="flex items-center gap-2">
                <span className="text-xs text-gray-400">
                  {cargando ? "…" : `${movimientos.length} total`}
                </span>
                <span className="text-gray-400 text-sm">{movAbierto ? "▲" : "▼"}</span>
              </div>
            </button>

            {movAbierto && (
              <div className="divide-y divide-gray-50 max-h-[60vh] overflow-y-auto">
                {cargando ? (
                  <div className="px-4 py-8 text-center">
                    <p className="text-sm text-gray-400 animate-pulse">Cargando movimientos…</p>
                  </div>
                ) : movimientos.length === 0 ? (
                  <div className="px-4 py-8 text-center">
                    <p className="text-2xl mb-2">📦</p>
                    <p className="text-sm text-gray-400">Sin movimientos aún.</p>
                    <p className="text-xs text-gray-300 mt-1">Registra la primera entrada al loker.</p>
                  </div>
                ) : (
                  movimientos.slice(0, 100).map((m) => {
                    const cfg = TIPO_CFG[m.tipo] ?? TIPO_CFG.ajuste;
                    return (
                      <div key={m.id} className="px-4 py-3 hover:bg-gray-50 transition-colors">
                        <div className="flex items-start gap-3">
                          <span className={`mt-0.5 flex-shrink-0 px-2 py-0.5 rounded-full text-xs
                            font-medium border ${cfg.bg} ${cfg.text} ${cfg.border}`}>
                            {cfg.sign >= 0 ? "▲" : "▼"} {cfg.label}
                          </span>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center justify-between gap-2">
                              <p className="text-sm font-medium text-gray-800 truncate">{m.nombre}</p>
                              <span className={`text-sm font-bold flex-shrink-0 ${
                                m.cantidad > 0 ? "text-green-600" : "text-red-600"
                              }`}>
                                {m.cantidad > 0 ? "+" : ""}{m.cantidad}
                              </span>
                            </div>
                            <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                              <span className="text-xs text-gray-400">{m.responsable}</span>
                              <span className="text-gray-200">·</span>
                              <span className="text-xs text-gray-400">{fmtDate(m.timestamp)}</span>
                              {m.choferNombre && (
                                <>
                                  <span className="text-gray-200">·</span>
                                  <span className="text-xs bg-cyan-50 text-cyan-700 border border-cyan-200
                                    px-1.5 py-0.5 rounded-full font-medium">
                                    → {m.choferNombre}
                                  </span>
                                </>
                              )}
                            </div>
                            {m.notas && (
                              <p className="text-xs text-gray-500 mt-1 italic truncate">{m.notas}</p>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            )}

            {movAbierto && movimientos.length > 100 && (
              <div className="px-4 py-2 border-t border-gray-100 bg-gray-50">
                <p className="text-xs text-gray-400 text-center">
                  Mostrando los últimos 100 de {movimientos.length} movimientos.
                </p>
              </div>
            )}

            {!movAbierto && !cargando && (
              <div className="px-4 py-3">
                <p className="text-xs text-gray-400 text-center">
                  Toca para ver {movimientos.length} movimientos
                </p>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ── Modal global ── */}
      {invModal !== null && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-end sm:items-center justify-center p-4" onClick={() => setInvModal(null)}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[80vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 py-4 border-b flex-shrink-0">
              <h3 className="font-bold text-gray-800">
                {invModal.type === "stat" && invModal.key === "loker"      && "📦 Stock en el loker"}
                {invModal.type === "stat" && invModal.key === "despachado" && "🚚 Despachado hoy"}
                {invModal.type === "stat" && invModal.key === "vendido"    && "✅ Vendido hoy"}
                {invModal.type === "stat" && invModal.key === "facturado"  && "💰 Facturado hoy"}
                {invModal.type === "producto" && `📊 Historial — ${invModal.nombre}`}
                {invModal.type === "chofer"   && `🚛 ${invModal.ch.choferNombre}`}
                {invModal.type === "lote"     && `🏭 Lote ${invModal.lote.numero}`}
              </h3>
              <button onClick={() => setInvModal(null)} className="text-gray-400 hover:text-gray-600 text-2xl leading-none active:scale-95 transition-all">×</button>
            </div>
            <div className="flex-1 overflow-y-auto p-4 space-y-2">

              {/* Stat: loker */}
              {invModal.type === "stat" && invModal.key === "loker" && (
                saldoConDetalle.length === 0 ? (
                  <p className="text-sm text-gray-400 text-center py-8">Sin productos en el loker aún</p>
                ) : saldoConDetalle.map((p) => (
                  <div key={p.pid} className={`flex justify-between items-center px-3 py-2 rounded-xl border text-sm ${p.saldo < 0 ? "bg-red-50 border-red-200" : p.saldo === 0 ? "bg-amber-50 border-amber-200" : "bg-green-50 border-green-100"}`}>
                    <span className="font-medium text-gray-800">{p.nombre}</span>
                    <span className={`font-bold ${p.saldo < 0 ? "text-red-700" : p.saldo === 0 ? "text-amber-600" : "text-green-700"}`}>
                      {p.saldo > 0 ? "+" : ""}{p.saldo}
                    </span>
                  </div>
                ))
              )}

              {/* Stat: despachado */}
              {invModal.type === "stat" && invModal.key === "despachado" && (
                saldoConDetalle.filter(p => p.despachHoy > 0).length === 0 ? (
                  <p className="text-sm text-gray-400 text-center py-8">Sin despachos registrados hoy</p>
                ) : saldoConDetalle.filter(p => p.despachHoy > 0).map((p) => (
                  <div key={p.pid} className="flex justify-between items-center px-3 py-2 rounded-xl border border-orange-100 bg-orange-50 text-sm">
                    <span className="font-medium text-gray-800">{p.nombre}</span>
                    <span className="font-bold text-orange-700">{p.despachHoy} uds</span>
                  </div>
                ))
              )}

              {/* Stat: vendido */}
              {invModal.type === "stat" && invModal.key === "vendido" && (
                resumenChoferes.filter(c => c.reportado).length === 0 ? (
                  <div className="text-center py-8">
                    <p className="text-3xl mb-2">⏳</p>
                    <p className="text-sm text-gray-500 font-medium">Sin reportes de sobrantes aún</p>
                    <p className="text-xs text-gray-400 mt-1">Los choferes deben reportar sus sobrantes para ver lo vendido</p>
                  </div>
                ) : resumenChoferes.filter(c => c.reportado).map((ch) => (
                  <div key={ch.choferId} className="border border-green-100 rounded-xl p-3 bg-green-50">
                    <p className="text-sm font-semibold text-gray-800 mb-2">{ch.choferNombre} <span className="text-xs font-normal text-green-600">· vendido: {ch.totalVendido}</span></p>
                    <div className="space-y-1">
                      {ch.productos.map(p => (
                        <div key={p.pid} className="flex justify-between text-xs text-gray-600">
                          <span>{p.nombre}</span>
                          <span className="font-semibold">{p.vendido} vend. / {p.despachado} desp.</span>
                        </div>
                      ))}
                    </div>
                  </div>
                ))
              )}

              {/* Stat: facturado */}
              {invModal.type === "stat" && invModal.key === "facturado" && (() => {
                const items = talonarioHoy
                  .filter(t => t.tipo === "retirada")
                  .flatMap(t => t.productos.filter(p => p.precio != null && p.precio! > 0).map(p => ({
                    chofer: t.choferNombre, nombre: p.nombre,
                    cantidad: p.cantidad ?? 0, precio: p.precio!,
                    subtotal: p.precio! * (p.cantidad ?? 0),
                  })));
                return items.length === 0 ? (
                  <div className="text-center py-8">
                    <p className="text-3xl mb-2">💰</p>
                    <p className="text-sm text-gray-500 font-medium">Sin precios configurados hoy</p>
                    <p className="text-xs text-gray-400 mt-1">Asigna precios al registrar talonarios para ver el facturado</p>
                  </div>
                ) : (
                  <>
                    {items.map((it, i) => (
                      <div key={i} className="flex items-center justify-between border border-gray-100 rounded-xl px-3 py-2 text-sm">
                        <div>
                          <p className="font-medium text-gray-800">{it.nombre}</p>
                          <p className="text-xs text-gray-400">{it.chofer} · {it.cantidad} × ${it.precio.toLocaleString()}</p>
                        </div>
                        <span className="font-bold text-green-700">${it.subtotal.toLocaleString()}</span>
                      </div>
                    ))}
                    <div className="flex justify-between bg-green-50 border border-green-200 rounded-xl px-3 py-2.5">
                      <span className="font-bold text-green-700">Total</span>
                      <span className="font-bold text-green-700">${dashboard.moneyHoy.toLocaleString("es-MX")}</span>
                    </div>
                  </>
                );
              })()}

              {/* Producto: historial de movimientos */}
              {invModal.type === "producto" && (() => {
                const movProd = movimientos.filter(m => m.producto_id === invModal.pid).slice(0, 50);
                return movProd.length === 0 ? (
                  <p className="text-sm text-gray-400 text-center py-8">Sin movimientos para este producto</p>
                ) : movProd.map((m) => {
                  const cfg = TIPO_CFG[m.tipo] ?? TIPO_CFG.ajuste;
                  return (
                    <div key={m.id} className={`flex items-center justify-between text-sm px-3 py-2 rounded-xl border ${cfg.bg} ${cfg.border}`}>
                      <div className="flex-1 min-w-0">
                        <p className={`text-xs font-medium ${cfg.text}`}>{cfg.label}</p>
                        <p className="text-xs text-gray-500 truncate">{m.responsable} {m.choferNombre ? `→ ${m.choferNombre}` : ""}</p>
                      </div>
                      <div className="text-right flex-shrink-0 ml-2">
                        <p className={`font-bold ${m.cantidad > 0 ? "text-green-700" : "text-red-600"}`}>
                          {m.cantidad > 0 ? "+" : ""}{m.cantidad}
                        </p>
                        <p className="text-xs text-gray-400">{fmtDate(m.timestamp)}</p>
                      </div>
                    </div>
                  );
                });
              })()}

              {/* Chofer: detalle sobrantes */}
              {invModal.type === "chofer" && (() => {
                const ch = invModal.ch;
                return (
                  <div className="space-y-3">
                    <div className="grid grid-cols-3 gap-3">
                      <div className="bg-cyan-50 rounded-xl p-3 text-center">
                        <p className="text-xl font-bold text-cyan-700">{ch.totalDespachado}</p>
                        <p className="text-xs text-cyan-500">Despachado</p>
                      </div>
                      <div className="bg-blue-50 rounded-xl p-3 text-center">
                        <p className="text-xl font-bold text-blue-700">{ch.reportado ? ch.totalSobrante : "—"}</p>
                        <p className="text-xs text-blue-500">Sobrante</p>
                      </div>
                      <div className="bg-green-50 rounded-xl p-3 text-center">
                        <p className="text-xl font-bold text-green-700">{ch.reportado ? ch.totalVendido : "—"}</p>
                        <p className="text-xs text-green-500">Vendido</p>
                      </div>
                    </div>
                    {!ch.reportado && (
                      <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 text-center">
                        <p className="text-sm font-medium text-amber-700">⏳ Sin sobrantes reportados</p>
                      </div>
                    )}
                    <div className="space-y-1.5">
                      {ch.productos.map(p => (
                        <div key={p.pid} className="flex items-center justify-between text-xs border border-gray-100 rounded-lg px-3 py-2">
                          <span className="font-medium text-gray-800">{p.nombre}</span>
                          <div className="flex gap-3 text-right">
                            <span className="text-cyan-700">{p.despachado} desp.</span>
                            {ch.reportado && <span className="text-green-700 font-semibold">{p.vendido} vend.</span>}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })()}

              {/* Lote: detalle completo */}
              {invModal.type === "lote" && (() => {
                const lote = invModal.lote;
                const fecha = (() => {
                  const d = toDate(lote.timestamp);
                  return d.toLocaleDateString("es-MX", { weekday: "short", day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
                })();
                return (
                  <div className="space-y-3">
                    {/* Meta */}
                    <div className="grid grid-cols-2 gap-2 text-sm">
                      <div className="bg-gray-50 rounded-xl p-3">
                        <p className="text-xs text-gray-400 mb-0.5">Registrado</p>
                        <p className="font-medium text-gray-800">{lote.registradoPor}</p>
                        <p className="text-xs text-gray-400 mt-0.5">{fecha}</p>
                      </div>
                      <div className={`rounded-xl p-3 ${lote.facturaEntregada ? "bg-green-50" : "bg-amber-50"}`}>
                        <p className="text-xs text-gray-400 mb-0.5">Factura</p>
                        {lote.facturaNumero && (
                          <p className="font-medium text-gray-800 text-xs">{lote.facturaNumero}</p>
                        )}
                        <p className={`text-xs font-semibold mt-0.5 ${lote.facturaEntregada ? "text-green-700" : "text-amber-700"}`}>
                          {lote.facturaEntregada ? "✅ Entregada" : "⏳ Pendiente"}
                        </p>
                      </div>
                    </div>
                    {lote.proveedor && (
                      <div className="bg-gray-50 rounded-xl px-3 py-2.5 text-sm">
                        <span className="text-xs text-gray-400">Proveedor: </span>
                        <span className="font-medium text-gray-800">{lote.proveedor}</span>
                      </div>
                    )}
                    {/* Productos */}
                    <div>
                      <p className="text-xs font-semibold text-gray-600 mb-2">
                        Productos ({lote.productos.length})
                      </p>
                      <div className="space-y-1.5">
                        {lote.productos.map((p) => (
                          <div key={p.producto_id}
                            className="flex items-center justify-between bg-emerald-50 border border-emerald-200
                              rounded-xl px-3 py-2.5 text-sm"
                          >
                            <span className="font-medium text-emerald-900">{p.nombre}</span>
                            <div className="flex items-center gap-2 text-emerald-700 text-xs font-semibold">
                              {p.cajas    > 0 && <span>{p.cajas} caj</span>}
                              {p.cajas    > 0 && p.unidades > 0 && <span>+</span>}
                              {p.unidades > 0 && <span>{p.unidades} uds</span>}
                              <span className="text-emerald-400 font-normal">· {p.total} total</span>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                    {/* Totales */}
                    <div className="bg-emerald-50 border border-emerald-200 rounded-xl px-3 py-2.5 flex justify-between text-sm">
                      <span className="text-emerald-700 font-semibold">Total entradas</span>
                      <span className="font-bold text-emerald-800">
                        +{lote.productos.reduce((s, p) => s + p.total, 0)} unidades
                      </span>
                    </div>
                    {lote.notas && (
                      <div className="bg-gray-50 border border-gray-200 rounded-xl px-3 py-2.5">
                        <p className="text-xs text-gray-400 mb-0.5">Notas</p>
                        <p className="text-sm text-gray-700 italic">{lote.notas}</p>
                      </div>
                    )}
                  </div>
                );
              })()}

            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── StatCard ─────────────────────────────────────────────────────────────────

function StatCard({
  icon, label, value, color, sub, onClick,
}: {
  icon:    string;
  label:   string;
  value:   number | string;
  color:   "purple" | "orange" | "green" | "yellow";
  sub?:    string;
  onClick?: () => void;
}) {
  const bg = {
    purple: "from-purple-500 to-purple-700",
    orange: "from-orange-400 to-orange-600",
    green:  "from-emerald-500 to-emerald-700",
    yellow: "from-yellow-500 to-amber-600",
  }[color];

  return (
    <button onClick={onClick} className={`w-full rounded-xl p-3.5 text-white bg-gradient-to-br ${bg} shadow-sm text-left active:scale-95 transition-all duration-100 hover:brightness-110`}>
      <p className="text-xl leading-none mb-1">{icon}</p>
      <p className="text-lg font-bold leading-tight">{value}</p>
      <p className="text-xs opacity-80 mt-0.5 leading-tight">{label}</p>
      {sub && <p className="text-xs opacity-60 italic leading-tight">{sub}</p>}
    </button>
  );
}
