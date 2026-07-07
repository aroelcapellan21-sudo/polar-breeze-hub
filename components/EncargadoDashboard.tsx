"use client";

import { useState, useEffect, useMemo } from "react";
import { collection, query, orderBy, onSnapshot } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useAuth } from "@/lib/auth-context";
import { MovimientoLoker } from "@/lib/types";
import RegistroLote       from "@/components/encargado/RegistroLote";
import SalidaPicking      from "@/components/encargado/SalidaPicking";
import InventarioChoferesTab from "@/components/encargado/InventarioChoferesTab";
import LotesGuardados     from "@/components/encargado/LotesGuardados";
import Reposicion         from "@/components/encargado/Reposicion";
import BuscadorArea, { coincide } from "@/components/shared/BuscadorArea";
import ConsultaChoferes   from "@/components/encargado/ConsultaChoferes";
import PolarBreezeWeight  from "@/components/encargado/PolarBreezeWeight";
import FloatingFAB        from "@/components/shared/FloatingFAB";
import ConsultarTablaModal from "@/components/shared/ConsultarTablaModal";
import RolePill            from "@/components/shared/RolePill";
import PWAInstallBanner    from "@/components/shared/PWAInstallBanner";
import PolarBreezeHTML     from "@/components/encargado/PolarBreezeHTML";
import FacturaProveedor    from "@/components/encargado/FacturaProveedor";
import BuscadorGlobal      from "@/components/encargado/BuscadorGlobal";
import AsistenteAI         from "@/components/shared/AsistenteAI";
import SyncSheetsPanel     from "@/components/shared/SyncSheetsPanel";
import WelcomeBanner       from "@/components/shared/WelcomeBanner";
import AvisoAreaBanner     from "@/components/shared/AvisoAreaBanner";
import SideNavDrawer, { NavSection } from "@/components/shared/SideNavDrawer";

type Tab = "lote" | "guardados" | "weight" | "stock" | "urgente" | "reposicion" | "choferes" | "vista" | "facturaProveedor";

// Gradiente tricolor Polar Breeze (aplicado en todos los dashboards)
const HEADER_BG = "linear-gradient(90deg, rgba(245,200,0,0.55) 0% 33.33%, rgba(212,43,43,0.55) 33.33% 66.66%, rgba(30,140,58,0.55) 66.66% 100%), #1A1A1A";

// ── Fila de stock (reutilizada por los tabs Stock y Urgente) ────────────────
type StockItem = { pid: string; nombre: string; saldo: number };

function StockRows({ items, maxSaldo }: { items: StockItem[]; maxSaldo: number }) {
  return (
    <div className="divide-y divide-gray-100">
      {items.map(p => {
        const pct   = p.saldo <= 0 ? 0 : Math.min((p.saldo / maxSaldo) * 100, 100);
        const color = p.saldo <= 0  ? "#D42B2B"
                    : pct >= 60     ? "#1E8C3A"
                    : pct >= 25     ? "#F5C800"
                    :                 "#D42B2B";
        const trackBg = p.saldo < 0 ? "bg-red-100" : "bg-gray-100";
        const rowBg   = p.saldo < 0 ? "pb-alarm" : "";
        return (
          <div key={p.pid} className={`px-4 py-3 ${rowBg}`}>
            {/* Fila superior: icono + nombre + badge */}
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2 min-w-0">
                <span className="text-sm flex-shrink-0">
                  {p.saldo < 0 ? "🚨" : p.saldo === 0 ? "⚠️" : "✅"}
                </span>
                <p className="text-sm font-medium text-gray-800 truncate">{p.nombre}</p>
              </div>
              <span className={`flex-shrink-0 text-sm font-bold tabular-nums px-2.5 py-0.5 rounded-full border ml-3 ${
                p.saldo < 0   ? "bg-red-100 text-red-700 border-red-300" :
                p.saldo === 0 ? "bg-amber-100 text-amber-600 border-amber-200" :
                                "bg-green-100 text-green-700 border-green-200"
              }`}>
                {p.saldo > 0 ? "+" : ""}{p.saldo} uds
              </span>
            </div>
            {/* Barra de progreso */}
            <div className={`h-2 rounded-full overflow-hidden ${trackBg}`}>
              <div
                className="h-full rounded-full transition-all duration-700 ease-out"
                style={{
                  width: `${p.saldo < 0 ? 100 : pct}%`,
                  background: color,
                  opacity: p.saldo === 0 ? 0 : 1,
                }}
              />
            </div>
            {/* Etiqueta de nivel debajo de la barra (solo en casos extremos) */}
            {p.saldo < 0 && (
              <p className="text-[10px] text-red-500 font-semibold mt-0.5">
                Stock negativo — revisar registros
              </p>
            )}
            {p.saldo === 0 && (
              <p className="text-[10px] text-amber-500 font-semibold mt-0.5">
                Sin unidades disponibles
              </p>
            )}
          </div>
        );
      })}
    </div>
  );
}

export default function EncargadoDashboard() {
  const { profile, logout } = useAuth();

  const [tab,          setTab]          = useState<Tab>("lote");
  const [loteVista,    setLoteVista]    = useState<"entrada" | "salida" | "choferes">("entrada");
  const [movimientos,  setMovimientos]  = useState<MovimientoLoker[]>([]);
  const [showTablas,     setShowTablas]     = useState(false);
  const [showBuscador,   setShowBuscador]   = useState(false);
  const [stockCargado, setStockCargado] = useState(false);
  const [stockError,   setStockError]   = useState<string | null>(null);

  // Badge del tab Choferes — recibe el conteo de ConsultaChoferes
  const [pendientesBadge, setPendientesBadge] = useState(0);

  // ── Stock (suscripción viva desde que abre el dashboard, para que el badge
  //    🚨 Urgente y la alarma estén siempre actualizados sin entrar al tab) ──
  useEffect(() => {
    const unsub = onSnapshot(
      query(collection(db, "movimientos_loker"), orderBy("timestamp", "desc")),
      (snap) => {
        setMovimientos(snap.docs.map(d => ({ id: d.id, ...d.data() } as MovimientoLoker)));
        setStockError(null);
        setStockCargado(true);
      },
      (err) => {
        setStockError(
          err?.code === "permission-denied"
            ? "No se pudo leer el stock: sin permiso sobre movimientos_loker. Revisa/despliega las reglas Firestore."
            : "No se pudo leer el stock del loker."
        );
        setStockCargado(true);
      }
    );
    return unsub;
  }, []);

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

  // Productos críticos (agotado o negativo) — alimentan el tab Urgente
  const criticos = useMemo(() => saldo.filter(p => p.saldo <= 0), [saldo]);
  const maxSaldo = useMemo(() => Math.max(...saldo.map(p => p.saldo), 1), [saldo]);

  // Buscador contextual por área (#13): filtra la lista del tab activo por nombre
  const [productoQ, setProductoQ] = useState("");
  const saldoFiltrado    = useMemo(() => saldo.filter(p => coincide(productoQ, p.nombre)),    [saldo, productoQ]);
  const criticosFiltrado = useMemo(() => criticos.filter(p => coincide(productoQ, p.nombre)), [criticos, productoQ]);

  // Mensaje de WhatsApp con la lista de stock crítico (URL sin número → el
  // Encargado elige a quién enviarlo: proveedor, admin, grupo…).
  function buildStockUrgenteWa(): string {
    const fecha = new Date().toLocaleDateString("es-DO", { day: "2-digit", month: "short", year: "numeric" });
    const lines = [
      "🚨 *STOCK URGENTE — POLAR BREEZE*",
      `📅 ${fecha}`,
      "",
      ...criticos.map(p => `• ${p.nombre}: *${p.saldo} uds* ${p.saldo < 0 ? "(negativo)" : "(agotado)"}`),
      "",
      `Total crítico: ${criticos.length} producto${criticos.length !== 1 ? "s" : ""}`,
    ].join("\n");
    return `https://wa.me/?text=${encodeURIComponent(lines)}`;
  }

  // ── Definición de tabs ────────────────────────────────────────────────────
  const TABS: { key: Tab; icon: string; label: string }[] = [
    { key: "lote",      icon: "📦", label: "Lote"      },
    { key: "guardados", icon: "🗂️",  label: "Guardados" },
    { key: "weight",    icon: "⚖️",  label: "Weight"    },
    { key: "stock",    icon: "📊", label: "Stock"    },
    { key: "urgente",  icon: "🚨", label: "Urgente"  },
    { key: "reposicion", icon: "♻️", label: "Reposición" },
    { key: "choferes", icon: "👥", label: "Choferes" },
    { key: "vista",    icon: "🧊", label: "Vista"    },
    { key: "facturaProveedor", icon: "🧾", label: "Factura Prov." },
  ];

  const BREADCRUMB: Record<Tab, string> = {
    lote:      "📦 Registrar lote — entrada de mercancía al loker",
    guardados: "🗂️ Lotes guardados — historial con búsqueda por fecha",
    weight:    "⚖️ Weight — recepción con escáner + báscula BT",
    stock:    "📊 Stock actual — saldo del loker en tiempo real",
    urgente:  "🚨 Urgente — productos agotados o en negativo · compartir por WhatsApp",
    reposicion: "♻️ Reposición — sugerencias según stock vs. mínimo · pedido a BON",
    choferes: "👥 Inventario de Choferes — cierre del día · puntos quincena",
    vista:    "🧊 Vista — polar-breeze-final.html integrado",
    facturaProveedor: "🧾 Factura de proveedor — recepción fiscal (registro, no afecta el loker)",
  };

  // Deep-link desde los shortcuts del manifest PWA (?tab=...) — comportamiento nativo
  useEffect(() => {
    const t = new URLSearchParams(window.location.search).get("tab");
    if (t && TABS.some(x => x.key === t)) setTab(t as Tab);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Menú lateral de navegación ───────────────────────────────────────────
  const [showNav, setShowNav] = useState(false);

  const NAV_SECTIONS: NavSection[] = [
    {
      title: "Supervisor",
      color: "verde",
      items: TABS.map((t) => ({
        key: t.key,
        icon: t.icon,
        label: t.label,
        badge:
          t.key === "choferes" && pendientesBadge > 0
            ? (pendientesBadge > 9 ? "9+" : String(pendientesBadge))
            : t.key === "urgente" && criticos.length > 0
            ? (criticos.length > 9 ? "9+" : String(criticos.length))
            : undefined,
      })),
    },
  ];

  return (
    <div className="min-h-screen bg-[#F9F9F7]">
      <AvisoAreaBanner area="encargado" />

      {/* ══════════════════════════════════════════
          HEADER — gradiente tricolor Polar Breeze
      ══════════════════════════════════════════ */}
      <header
        className="text-white shadow-lg sticky top-0 z-30"
        style={{ background: HEADER_BG }}
      >
        {/* ── Fila 1: Menú + Logo + Nombre + Acciones ── */}
        <div className="max-w-2xl mx-auto px-4 pt-3 pb-2 flex items-center gap-3">
          <button
            onClick={() => setShowNav(true)}
            title="Menú"
            className="bg-white/15 hover:bg-white/25 active:scale-95 w-9 h-9 rounded-lg
              flex items-center justify-center text-lg transition-all duration-100 flex-shrink-0"
          >
            ☰
          </button>
          <div className="flex items-center gap-2 flex-shrink-0">
            <div
              className="w-9 h-9 rounded-xl flex items-center justify-center shadow-lg ring-2 ring-white/20"
              style={{ background: "linear-gradient(135deg, #F5C800 33%, #D42B2B 33% 66%, #1E8C3A 66%)" }}
            >
              <span className="text-base">🧊</span>
            </div>
            <div>
              <p className="text-white/60 text-[9px] leading-none uppercase tracking-widest">Polar Breeze</p>
              <p className="text-white font-black text-sm leading-tight">Supervisor</p>
            </div>
          </div>
          <div className="flex-1" />
          <div className="flex items-center gap-1.5 flex-shrink-0">
            <button
              onClick={() => setShowBuscador(true)}
              title="Buscar en el dashboard"
              className="bg-white/15 hover:bg-white/25 active:scale-95 w-8 h-8 rounded-lg
                flex items-center justify-center text-base transition-all"
            >
              🔍
            </button>
            <button
              onClick={() => setShowTablas(true)}
              title="Consultar tablas"
              className="bg-white/15 hover:bg-white/25 active:scale-95 w-8 h-8 rounded-lg
                flex items-center justify-center text-base transition-all"
            >
              📋
            </button>
            <RolePill rol="encargado" nombre={profile?.nombre ?? "Encargado"} />
          </div>
        </div>

        {/* Banda tricolor 5 px */}
        <div className="flex h-[5px]">
          <div className="flex-1 bg-[#F5C800]" />
          <div className="flex-1 bg-[#D42B2B]" />
          <div className="flex-1 bg-[#1E8C3A]" />
        </div>

        {/* Breadcrumb */}
        <div className="bg-black/20 border-t border-white/10">
          <div className="max-w-2xl mx-auto px-4 py-1.5 flex items-center justify-between">
            <span className="text-xs text-[#F5C800] font-medium truncate">
              {tab === "lote"
                ? (loteVista === "entrada"
                    ? "📥 Entrada — registrar lotes recibidos de BON"
                    : loteVista === "salida"
                    ? "📤 Salida (Picking) — descuenta del stock del loker"
                    : "📋 Inventario Choferes — ajusta el inventario fijo del chofer")
                : BREADCRUMB[tab]}
            </span>
            <span className="flex items-center gap-1 text-gray-400 text-[10px] flex-shrink-0 ml-2">
              <span className="w-1.5 h-1.5 rounded-full bg-[#1E8C3A] animate-pulse" />
              Firebase
            </span>
          </div>
        </div>
      </header>

      <WelcomeBanner nombre={profile?.nombre ?? ""} area="Supervisor" acento="#1E8C3A" />

      {/* ══════════════════════════════════════════
          CONTENIDO
      ══════════════════════════════════════════ */}
      <main className="max-w-2xl mx-auto px-4 py-5">

        {tab === "lote" && (
          <div className="space-y-4">
            {/* Sub-toggle Entrada / Salida (Picking) / Inventario Choferes */}
            <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-1 flex gap-1">
              <button
                type="button"
                onClick={() => setLoteVista("entrada")}
                className={`flex-1 py-2 rounded-lg text-xs font-bold truncate transition-all ${
                  loteVista === "entrada"
                    ? "bg-blue-600 text-white shadow-sm"
                    : "text-gray-500 hover:bg-gray-50"
                }`}
              >
                📥 Entrada
              </button>
              <button
                type="button"
                onClick={() => setLoteVista("salida")}
                className={`flex-1 py-2 rounded-lg text-xs font-bold truncate transition-all ${
                  loteVista === "salida"
                    ? "bg-[#D42B2B] text-white shadow-sm"
                    : "text-gray-500 hover:bg-gray-50"
                }`}
              >
                📤 Salida
              </button>
              <button
                type="button"
                onClick={() => setLoteVista("choferes")}
                className={`flex-1 py-2 rounded-lg text-xs font-bold truncate transition-all ${
                  loteVista === "choferes"
                    ? "bg-[#1E8C3A] text-white shadow-sm"
                    : "text-gray-500 hover:bg-gray-50"
                }`}
              >
                📋 Choferes
              </button>
            </div>
            {loteVista === "entrada"
              ? <RegistroLote />
              : loteVista === "salida"
              ? <SalidaPicking />
              : <InventarioChoferesTab />}
          </div>
        )}
        {tab === "guardados"  && <LotesGuardados />}
        {tab === "reposicion" && <Reposicion />}
        {tab === "weight" && (
          <div className="space-y-4">
            <PolarBreezeWeight />
            <SyncSheetsPanel />
          </div>
        )}

        {/* Tab Choferes — §24 integración completa */}
        {tab === "choferes" && (
          <ConsultaChoferes onPendientesChange={setPendientesBadge} />
        )}

        {/* Tab Stock */}
        {tab === "stock" && (
          <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
            {/* Header del card */}
            <div className="px-4 py-3 bg-[#1A1A1A] pb-print-flat">
              <h2 className="text-white font-bold text-sm">📊 Stock actual del loker</h2>
              <p className="text-gray-400 text-xs mt-0.5">Saldo acumulado de entradas menos salidas</p>
            </div>
            {/* Banda tricolor */}
            <div className="h-[3px] flex pb-print-band">
              <div className="flex-1 bg-[#F5C800]" />
              <div className="flex-1 bg-[#D42B2B]" />
              <div className="flex-1 bg-[#1E8C3A]" />
            </div>

            {!stockCargado ? (
              <div className="px-4 py-12 text-center">
                <p className="text-sm text-gray-400 animate-pulse">Cargando stock…</p>
              </div>
            ) : stockError ? (
              <div className="px-4 py-10 text-center">
                <p className="text-3xl mb-2">⚠️</p>
                <p className="text-sm font-semibold text-red-600">{stockError}</p>
              </div>
            ) : saldo.length === 0 ? (
              <div className="px-4 py-12 text-center">
                <p className="text-3xl mb-2">📦</p>
                <p className="text-sm font-semibold text-gray-600">Sin movimientos registrados</p>
                <p className="text-xs text-gray-400 mt-1">Registra el primer lote para ver el stock.</p>
              </div>
            ) : (
              <>
                <div className="px-4 py-2.5 border-b border-gray-100 bg-gray-50/60">
                  <BuscadorArea value={productoQ} onChange={setProductoQ} placeholder="Buscar producto…" />
                </div>
                {saldoFiltrado.length === 0 ? (
                  <div className="px-4 py-10 text-center">
                    <p className="text-2xl mb-1">🔍</p>
                    <p className="text-sm font-semibold text-gray-600">Sin coincidencias</p>
                  </div>
                ) : (
                  <StockRows items={saldoFiltrado} maxSaldo={maxSaldo} />
                )}
              </>
            )}
          </div>
        )}

        {/* Tab Urgente — productos críticos + compartir por WhatsApp */}
        {tab === "urgente" && (
          <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
            {/* Header del card */}
            <div className="px-4 py-3 bg-[#1A1A1A] pb-print-flat flex items-center justify-between gap-3">
              <div className="min-w-0">
                <h2 className="text-white font-bold text-sm flex items-center gap-1.5">
                  🚨 Stock urgente
                  {stockCargado && !stockError && criticos.length > 0 && (
                    <span className="bg-[#D42B2B] text-white text-[10px] font-black px-1.5 py-0.5 rounded-full leading-none">
                      {criticos.length}
                    </span>
                  )}
                </h2>
                <p className="text-gray-400 text-xs mt-0.5">Productos agotados o en negativo</p>
              </div>
              {stockCargado && !stockError && criticos.length > 0 && (
                <a
                  href={buildStockUrgenteWa()}
                  target="_blank" rel="noopener noreferrer"
                  className="no-print flex-shrink-0 flex items-center gap-1.5 bg-green-500 hover:bg-green-600
                    active:scale-95 text-white text-xs font-bold px-3 py-1.5 rounded-lg transition-all"
                >
                  📱 Compartir
                </a>
              )}
            </div>
            {/* Banda tricolor */}
            <div className="h-[3px] flex pb-print-band">
              <div className="flex-1 bg-[#F5C800]" />
              <div className="flex-1 bg-[#D42B2B]" />
              <div className="flex-1 bg-[#1E8C3A]" />
            </div>

            {!stockCargado ? (
              <div className="px-4 py-12 text-center">
                <p className="text-sm text-gray-400 animate-pulse">Cargando stock…</p>
              </div>
            ) : stockError ? (
              <div className="px-4 py-10 text-center">
                <p className="text-3xl mb-2">⚠️</p>
                <p className="text-sm font-semibold text-red-600">{stockError}</p>
              </div>
            ) : criticos.length === 0 ? (
              <div className="px-4 py-12 text-center">
                <p className="text-3xl mb-2">🎉</p>
                <p className="text-sm font-semibold text-gray-600">Sin productos críticos</p>
                <p className="text-xs text-gray-400 mt-1">Ningún producto está agotado o en negativo.</p>
              </div>
            ) : (
              <>
                <div className="px-4 py-2.5 border-b border-gray-100 bg-gray-50/60">
                  <BuscadorArea value={productoQ} onChange={setProductoQ} placeholder="Buscar producto crítico…" />
                </div>
                {criticosFiltrado.length === 0 ? (
                  <div className="px-4 py-10 text-center">
                    <p className="text-2xl mb-1">🔍</p>
                    <p className="text-sm font-semibold text-gray-600">Sin coincidencias</p>
                  </div>
                ) : (
                  <StockRows items={criticosFiltrado} maxSaldo={maxSaldo} />
                )}
              </>
            )}
          </div>
        )}

        {/* Tab Vista — polar-breeze-final.html */}
        {tab === "vista" && <PolarBreezeHTML />}
        {tab === "facturaProveedor" && <FacturaProveedor />}
      </main>

      {/* ── Menú lateral de navegación ── */}
      <SideNavDrawer
        open={showNav}
        onClose={() => setShowNav(false)}
        sections={NAV_SECTIONS}
        activeKey={tab}
        onSelect={(key) => setTab(key as Tab)}
        roleLabel="Supervisor"
        userName={profile?.nombre}
        userRoleLabel="Supervisor"
        onLogout={logout}
        headerColor="#1E8C3A"
      />

      {/* Modal Tablas */}
      {showTablas && <ConsultarTablaModal onClose={() => setShowTablas(false)} />}

      {/* Buscador global */}
      {showBuscador && (
        <BuscadorGlobal
          onClose={() => setShowBuscador(false)}
          onNavigate={setTab}
        />
      )}

      {/* FAB Polar Breeze */}
      <FloatingFAB />

      {/* ── Asistente IA Gemini ── */}
      <AsistenteAI
        rol="encargado"
        nombre={profile?.nombre}
        contexto={[
          `Choferes pendientes por reportar hoy: ${pendientesBadge}`,
          `Tab activo: ${tab}`,
          stockCargado ? `Productos en stock: ${saldo.length} tipos, ${saldo.filter(p => p.saldo < 0).length} en negativo` : "Stock: cargando",
        ].join(". ")}
      />

      {/* ── Banner de instalación PWA ── */}
      <PWAInstallBanner appName="App Encargado" appIcon="🏭" />
    </div>
  );
}
