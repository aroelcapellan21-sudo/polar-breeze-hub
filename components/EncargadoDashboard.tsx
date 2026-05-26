"use client";

/**
 * EncargadoDashboard — Dashboard del Encargado (§23 diseño aprobado)
 *
 * Estructura:
 *  - Header negro #1A1A1A + logo 🧊 tricolor + banda tricolor
 *  - KPIs en tiempo real: Lotes hoy · Choferes pendientes · Completados
 *  - 🔔 Campana con badge — abre cápsula de alertas
 *  - Tabs: 📦 Lote · ⚖️ Weight · 📊 Stock · 👥 Choferes
 *  - Feed de actividad reciente (últimos movimientos loker)
 */

import { useState, useEffect, useMemo } from "react";
import {
  collection, query, orderBy, onSnapshot, where,
  limit, Timestamp,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useAuth } from "@/lib/auth-context";
import { MovimientoLoker, LoteLoker, toDate } from "@/lib/types";
import RegistroLote        from "@/components/encargado/RegistroLote";
import ConsultaChoferes    from "@/components/encargado/ConsultaChoferes";
import PolarBreezeWeight   from "@/components/encargado/PolarBreezeWeight";
import FloatingFAB         from "@/components/shared/FloatingFAB";
import ConsultarTablaModal from "@/components/shared/ConsultarTablaModal";

type Tab = "lote" | "weight" | "stock" | "choferes";

interface Alerta {
  id:        string;
  mensaje:   string;
  nivel:     "info" | "warning" | "error";
  timestamp: Date;
}

const TABS: { key: Tab; icon: string; label: string }[] = [
  { key: "lote",     icon: "📦", label: "Lote"     },
  { key: "weight",   icon: "⚖️",  label: "Weight"   },
  { key: "stock",    icon: "📊", label: "Stock"    },
  { key: "choferes", icon: "👥", label: "Choferes" },
];

export default function EncargadoDashboard() {
  const { profile, logout } = useAuth();
  const [tab,         setTab]         = useState<Tab>("lote");
  const [showTablas,  setShowTablas]  = useState(false);
  const [showAlertas, setShowAlertas] = useState(false);

  // ── Datos en tiempo real ──────────────────────────────────────────────────
  const [movimientos,    setMovimientos]    = useState<MovimientoLoker[]>([]);
  const [lotesHoy,       setLotesHoy]       = useState<LoteLoker[]>([]);
  const [invGuardados,   setInvGuardados]   = useState<number>(0);
  const [totalChoferes,  setTotalChoferes]  = useState<number>(0);
  const [alertas,        setAlertas]        = useState<Alerta[]>([]);
  const [stockCargado,   setStockCargado]   = useState(false);
  const [feed,           setFeed]           = useState<MovimientoLoker[]>([]);

  // KPIs — lotes registrados hoy
  useEffect(() => {
    const hoy = new Date(); hoy.setHours(0, 0, 0, 0);
    const unsub = onSnapshot(
      query(
        collection(db, "lotes_loker"),
        where("timestamp", ">=", Timestamp.fromDate(hoy)),
        orderBy("timestamp", "desc"),
      ),
      (snap) => setLotesHoy(snap.docs.map(d => ({ id: d.id, ...d.data() } as LoteLoker)))
    );
    return unsub;
  }, []);

  // KPIs — inventarios cerrados hoy
  useEffect(() => {
    const fechaKey = (() => {
      const d = new Date();
      return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
    })();
    const unsub = onSnapshot(
      collection(db, "inventarios", fechaKey, "choferes"),
      (snap) => setInvGuardados(snap.size)
    );
    return unsub;
  }, []);

  // KPIs — total choferes activos
  useEffect(() => {
    const unsub = onSnapshot(
      query(collection(db, "usuarios"), where("role", "==", "chofer")),
      (snap) => setTotalChoferes(
        snap.docs.filter(d => d.data().activo !== false).length
      )
    );
    return unsub;
  }, []);

  // Feed de actividad — últimos 15 movimientos del loker
  useEffect(() => {
    const unsub = onSnapshot(
      query(collection(db, "movimientos_loker"), orderBy("timestamp", "desc"), limit(15)),
      (snap) => setFeed(snap.docs.map(d => ({ id: d.id, ...d.data() } as MovimientoLoker)))
    );
    return unsub;
  }, []);

  // Stock — solo cuando el tab está activo
  useEffect(() => {
    if (tab !== "stock") return;
    setStockCargado(false);
    const unsub = onSnapshot(
      query(collection(db, "movimientos_loker"), orderBy("timestamp", "desc")),
      (snap) => {
        setMovimientos(snap.docs.map(d => ({ id: d.id, ...d.data() } as MovimientoLoker)));
        setStockCargado(true);
      }
    );
    return unsub;
  }, [tab]);

  // Alertas simuladas (se reemplazarán por onSnapshot a /alertas cuando exista)
  useEffect(() => {
    setAlertas([]);
  }, []);

  // ── Saldo por producto ────────────────────────────────────────────────────
  const saldo = useMemo(() => {
    const map = new Map<string, { nombre: string; saldo: number }>();
    for (const m of movimientos) {
      const prev = map.get(m.producto_id) ?? { nombre: m.nombre, saldo: 0 };
      map.set(m.producto_id, { nombre: m.nombre, saldo: prev.saldo + m.cantidad });
    }
    return Array.from(map.entries())
      .map(([pid, d]) => ({ pid, ...d }))
      .sort((a, b) => {
        if (a.saldo < 0 && b.saldo >= 0) return -1;
        if (b.saldo < 0 && a.saldo >= 0) return 1;
        return b.saldo - a.saldo;
      });
  }, [movimientos]);

  const pendientesChoferes = Math.max(0, totalChoferes - invGuardados);
  const unreadAlertas      = alertas.length;

  // ── Helper feed ───────────────────────────────────────────────────────────
  function feedIcon(tipo: MovimientoLoker["tipo"]) {
    if (tipo === "entrada_interior")          return { icon: "🟡", label: "Entrada" };
    if (tipo === "salida_despacho")           return { icon: "🔴", label: "Despacho" };
    if (tipo === "devolucion_chofer")         return { icon: "🟢", label: "Devolución" };
    if (tipo === "entrada_consignacion_inicial") return { icon: "🟡", label: "Consignación" };
    return { icon: "⚪", label: tipo };
  }

  return (
    <div className="min-h-screen bg-[#F9F9F7]">

      {/* ══════════════════════════════════════════
          HEADER — §23 diseño aprobado
      ══════════════════════════════════════════ */}
      <header className="bg-[#1A1A1A] text-white shadow-lg sticky top-0 z-30">
        <div className="max-w-2xl mx-auto px-4 py-3 flex items-center gap-3">

          {/* Logo tricolor 🧊 */}
          <div
            className="w-9 h-9 rounded-lg overflow-hidden flex-shrink-0 flex items-center justify-center"
            style={{ background: "linear-gradient(135deg, rgba(245,200,0,0.85) 33%, rgba(212,43,43,0.85) 33% 66%, rgba(30,140,58,0.85) 66%)" }}
          >
            <span className="text-lg relative z-10">🧊</span>
          </div>

          {/* Tabs de navegación */}
          <nav className="flex gap-1 flex-1 overflow-x-auto scrollbar-none">
            {TABS.map(t => (
              <button
                key={t.key}
                onClick={() => setTab(t.key)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium
                  whitespace-nowrap transition-all duration-100 active:scale-95 flex-shrink-0 ${
                  tab === t.key
                    ? "bg-[#F5C800] text-[#1A1A1A] shadow-sm font-bold"
                    : "text-gray-300 hover:bg-white/10 hover:text-white"
                }`}
              >
                <span>{t.icon}</span>
                <span className="hidden sm:inline">{t.label}</span>
              </button>
            ))}
          </nav>

          {/* Acciones */}
          <div className="flex items-center gap-1.5 flex-shrink-0">

            {/* 🔔 Campana de alertas */}
            <button
              onClick={() => setShowAlertas(v => !v)}
              title="Alertas"
              className="relative bg-white/10 hover:bg-white/20 active:scale-95 w-8 h-8 rounded-lg
                flex items-center justify-center text-base transition-all"
            >
              🔔
              {unreadAlertas > 0 && (
                <span className="absolute -top-1 -right-1 w-4 h-4 bg-[#D42B2B] rounded-full
                  flex items-center justify-center text-[9px] font-bold text-white border border-[#1A1A1A]">
                  {unreadAlertas}
                </span>
              )}
            </button>

            {/* Tablas de referencia */}
            <button
              onClick={() => setShowTablas(true)}
              title="Consultar tablas"
              className="bg-white/10 hover:bg-white/20 active:scale-95 w-8 h-8 rounded-lg
                flex items-center justify-center text-base transition-all"
            >
              📋
            </button>

            <div className="text-right hidden sm:block">
              <p className="text-sm font-medium leading-tight truncate max-w-[100px]">{profile?.nombre}</p>
              <span className="text-xs text-[#F5C800]">Encargado</span>
            </div>

            <button
              onClick={logout}
              className="bg-white/10 hover:bg-white/20 active:scale-95 px-3 py-1.5
                rounded-lg text-xs transition-all font-medium"
            >
              Salir
            </button>
          </div>
        </div>

        {/* Banda tricolor */}
        <div className="pb-tricolor" />

        {/* Breadcrumb */}
        <div className="border-t border-white/10 bg-black/20">
          <div className="max-w-2xl mx-auto px-4 py-1.5 text-xs text-gray-300 flex items-center justify-between">
            <span className="text-[#F5C800] font-medium">
              {tab === "lote"     && "📦 Registrar lote — entrada de mercancía al loker"}
              {tab === "weight"   && "⚖️ Weight — recepción con escáner + báscula BT"}
              {tab === "stock"    && "📊 Stock actual — saldo del loker en tiempo real"}
              {tab === "choferes" && "👥 Choferes — puntos quincena e inventario del día"}
            </span>
            <span className="flex items-center gap-1 text-gray-500 text-xs flex-shrink-0">
              <span className="w-1.5 h-1.5 rounded-full bg-[#1E8C3A] animate-pulse" />
              Firebase
            </span>
          </div>
        </div>
      </header>

      {/* ══════════════════════════════════════════
          KPIs — §23
      ══════════════════════════════════════════ */}
      <div className="max-w-2xl mx-auto px-4 pt-4">
        <div className="grid grid-cols-3 gap-3">
          {/* Lotes hoy */}
          <div className="bg-white rounded-xl shadow-sm p-3 border-l-4 border-[#F5C800]">
            <p className="text-2xl font-black text-[#1A1A1A]">{lotesHoy.length}</p>
            <p className="text-xs text-gray-500 mt-0.5 leading-tight">Lotes<br/>registrados hoy</p>
          </div>
          {/* Choferes pendientes */}
          <div className={`bg-white rounded-xl shadow-sm p-3 border-l-4 ${
            pendientesChoferes > 0 ? "border-[#D42B2B]" : "border-gray-200"
          }`}>
            <p className={`text-2xl font-black ${pendientesChoferes > 0 ? "text-[#D42B2B]" : "text-gray-300"}`}>
              {pendientesChoferes}
            </p>
            <p className="text-xs text-gray-500 mt-0.5 leading-tight">Choferes<br/>pendientes cierre</p>
          </div>
          {/* Completados */}
          <div className={`bg-white rounded-xl shadow-sm p-3 border-l-4 ${
            invGuardados > 0 ? "border-[#1E8C3A]" : "border-gray-200"
          }`}>
            <p className={`text-2xl font-black ${invGuardados > 0 ? "text-[#1E8C3A]" : "text-gray-300"}`}>
              {invGuardados}
            </p>
            <p className="text-xs text-gray-500 mt-0.5 leading-tight">Inventarios<br/>cerrados hoy</p>
          </div>
        </div>
      </div>

      {/* ══════════════════════════════════════════
          CÁPSULA DE ALERTAS — §23
      ══════════════════════════════════════════ */}
      {showAlertas && (
        <div className="max-w-2xl mx-auto px-4 pt-3">
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
            <div className="px-4 py-2.5 bg-[#1A1A1A] flex items-center justify-between">
              <p className="text-white font-bold text-sm">🔔 Alertas del sistema</p>
              <button onClick={() => setShowAlertas(false)}
                className="text-gray-400 hover:text-white transition-colors text-lg leading-none">×</button>
            </div>
            {alertas.length === 0 ? (
              <div className="px-4 py-6 text-center">
                <p className="text-2xl mb-1">✅</p>
                <p className="text-sm text-gray-400">Sin alertas activas</p>
              </div>
            ) : (
              <div className="divide-y divide-gray-50">
                {alertas.map(a => (
                  <div key={a.id} className="px-4 py-3 flex items-start gap-3">
                    <span className="text-base flex-shrink-0">
                      {a.nivel === "error" ? "🚨" : a.nivel === "warning" ? "⚠️" : "ℹ️"}
                    </span>
                    <div className="flex-1">
                      <p className="text-sm text-gray-800">{a.mensaje}</p>
                      <p className="text-xs text-gray-400 mt-0.5">
                        {a.timestamp.toLocaleTimeString("es-DO", { hour: "2-digit", minute: "2-digit" })}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ══════════════════════════════════════════
          CONTENIDO DE TABS
      ══════════════════════════════════════════ */}
      <main className="max-w-2xl mx-auto px-4 py-4 space-y-4">

        {tab === "lote"     && <RegistroLote />}
        {tab === "weight"   && <PolarBreezeWeight />}
        {tab === "choferes" && <ConsultaChoferes />}

        {/* ── Stock ── */}
        {tab === "stock" && (
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
            <div className="px-4 py-3 bg-[#1A1A1A]">
              <h2 className="text-white font-bold text-sm">📊 Stock actual del loker</h2>
              <p className="text-gray-400 text-xs mt-0.5">Saldo acumulado de entradas menos salidas</p>
            </div>
            <div className="h-0.5 flex">
              <div className="flex-1 bg-[#F5C800]" />
              <div className="flex-1 bg-[#D42B2B]" />
              <div className="flex-1 bg-[#1E8C3A]" />
            </div>
            {!stockCargado ? (
              <div className="px-4 py-10 text-center">
                <p className="text-sm text-gray-400 animate-pulse">Cargando stock…</p>
              </div>
            ) : saldo.length === 0 ? (
              <div className="px-4 py-10 text-center">
                <p className="text-3xl mb-2">📦</p>
                <p className="text-sm text-gray-400">Sin movimientos registrados aún.</p>
              </div>
            ) : (
              <div className="divide-y divide-gray-50">
                {saldo.map(p => (
                  <div key={p.pid}
                    className={`px-4 py-3 flex items-center justify-between ${p.saldo < 0 ? "bg-red-50/40" : ""}`}
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="text-sm flex-shrink-0">
                        {p.saldo < 0 ? "🚨" : p.saldo === 0 ? "⚠️" : "✅"}
                      </span>
                      <p className="text-sm font-medium text-gray-800 truncate">{p.nombre}</p>
                    </div>
                    <span className={`flex-shrink-0 text-sm font-bold px-2.5 py-0.5 rounded-full border ${
                      p.saldo < 0
                        ? "bg-red-100 text-red-700 border-red-300"
                        : p.saldo === 0
                        ? "bg-amber-100 text-amber-600 border-amber-200"
                        : "bg-green-100 text-green-700 border-green-200"
                    }`}>
                      {p.saldo > 0 ? "+" : ""}{p.saldo}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ── Feed de actividad reciente (visible en tab lote) ── */}
        {tab === "lote" && feed.length > 0 && (
          <div className="bg-white rounded-xl shadow-sm overflow-hidden">
            <div className="px-4 py-2.5 border-b border-gray-100 flex items-center justify-between">
              <p className="text-xs font-bold text-gray-600">Actividad reciente</p>
              <span className="text-xs text-gray-400">últimos {feed.length} movimientos</span>
            </div>
            <div className="divide-y divide-gray-50">
              {feed.slice(0, 8).map(m => {
                const { icon, label } = feedIcon(m.tipo);
                const ts = toDate(m.timestamp);
                return (
                  <div key={m.id} className="px-4 py-2.5 flex items-center gap-3">
                    <span className="text-sm flex-shrink-0">{icon}</span>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-medium text-gray-800 truncate">
                        {label} · {m.nombre}
                      </p>
                      <p className="text-[10px] text-gray-400">
                        {m.responsable}
                        {m.choferNombre ? ` → ${m.choferNombre}` : ""}
                      </p>
                    </div>
                    <div className="text-right flex-shrink-0">
                      <p className={`text-xs font-bold ${m.cantidad > 0 ? "text-[#1E8C3A]" : "text-[#D42B2B]"}`}>
                        {m.cantidad > 0 ? "+" : ""}{m.cantidad}
                      </p>
                      <p className="text-[10px] text-gray-400">
                        {ts.toLocaleTimeString("es-DO", { hour: "2-digit", minute: "2-digit" })}
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>
            {/* Barra de estado del sistema */}
            <div className="px-4 py-2 bg-[#1A1A1A] flex items-center gap-2">
              <span className="w-1.5 h-1.5 rounded-full bg-[#F5C800] animate-pulse flex-shrink-0" />
              <p className="text-[10px] text-gray-400">Conectado a Firebase polar-breeze · tiempo real</p>
            </div>
          </div>
        )}
      </main>

      {/* Modales */}
      {showTablas && <ConsultarTablaModal onClose={() => setShowTablas(false)} />}
      <FloatingFAB />
    </div>
  );
}
