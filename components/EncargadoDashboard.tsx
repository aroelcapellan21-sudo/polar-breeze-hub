"use client";

import { useState, useEffect, useMemo, useRef, useCallback } from "react";
import { collection, query, orderBy, onSnapshot } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useAuth } from "@/lib/auth-context";
import { MovimientoLoker } from "@/lib/types";
import RegistroLote       from "@/components/encargado/RegistroLote";
import ConsultaChoferes   from "@/components/encargado/ConsultaChoferes";
import PolarBreezeWeight  from "@/components/encargado/PolarBreezeWeight";
import FloatingFAB        from "@/components/shared/FloatingFAB";
import ConsultarTablaModal from "@/components/shared/ConsultarTablaModal";
import RolePill            from "@/components/shared/RolePill";
import PWAInstallBanner    from "@/components/shared/PWAInstallBanner";
import PolarBreezeHTML     from "@/components/encargado/PolarBreezeHTML";

type Tab = "lote" | "weight" | "stock" | "choferes" | "vista";

// Gradiente tricolor Polar Breeze (aplicado en todos los dashboards)
const HEADER_BG = "linear-gradient(90deg, rgba(245,200,0,0.55) 0% 33.33%, rgba(212,43,43,0.55) 33.33% 66.66%, rgba(30,140,58,0.55) 66.66% 100%), #1A1A1A";

export default function EncargadoDashboard() {
  const { profile, logout } = useAuth();

  const [tab,          setTab]          = useState<Tab>("lote");
  const [movimientos,  setMovimientos]  = useState<MovimientoLoker[]>([]);
  const [showTablas,   setShowTablas]   = useState(false);
  const [stockCargado, setStockCargado] = useState(false);

  // Badge del tab Choferes — recibe el conteo de ConsultaChoferes
  const [pendientesBadge, setPendientesBadge] = useState(0);

  // ── Stock (solo carga cuando se abre el tab) ──────────────────────────────
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

  // ── Definición de tabs ────────────────────────────────────────────────────
  const TABS: { key: Tab; icon: string; label: string }[] = [
    { key: "lote",     icon: "📦", label: "Lote"     },
    { key: "weight",   icon: "⚖️",  label: "Weight"   },
    { key: "stock",    icon: "📊", label: "Stock"    },
    { key: "choferes", icon: "👥", label: "Choferes" },
    { key: "vista",    icon: "🧊", label: "Vista"    },
  ];

  const BREADCRUMB: Record<Tab, string> = {
    lote:     "📦 Registrar lote — entrada de mercancía al loker",
    weight:   "⚖️ Weight — recepción con escáner + báscula BT",
    stock:    "📊 Stock actual — saldo del loker en tiempo real",
    choferes: "👥 Inventario de Choferes — cierre del día · puntos quincena",
    vista:    "🧊 Vista — polar-breeze-final.html integrado",
  };

  // ── Flechas de navegación de tabs ─────────────────────────────────────────
  const navRef  = useRef<HTMLElement>(null);
  const [canScrollLeft,  setCanScrollLeft]  = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);

  const checkScroll = useCallback(() => {
    const el = navRef.current;
    if (!el) return;
    setCanScrollLeft(el.scrollLeft > 4);
    setCanScrollRight(el.scrollLeft + el.clientWidth < el.scrollWidth - 4);
  }, []);

  useEffect(() => {
    const el = navRef.current;
    if (!el) return;
    checkScroll();
    el.addEventListener("scroll", checkScroll, { passive: true });
    const ro = new ResizeObserver(checkScroll);
    ro.observe(el);
    return () => { el.removeEventListener("scroll", checkScroll); ro.disconnect(); };
  }, [checkScroll]);

  // Scroll al tab activo cuando cambia
  useEffect(() => {
    const el = navRef.current;
    if (!el) return;
    const active = el.querySelector<HTMLButtonElement>("[data-active='true']");
    if (active) active.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "nearest" });
    setTimeout(checkScroll, 300);
  }, [tab, checkScroll]);

  const scrollNav = (dir: "left" | "right") => {
    const el = navRef.current;
    if (!el) return;
    el.scrollBy({ left: dir === "right" ? 120 : -120, behavior: "smooth" });
  };

  return (
    <div className="min-h-screen bg-[#F9F9F7]">

      {/* ══════════════════════════════════════════
          HEADER — gradiente tricolor Polar Breeze
      ══════════════════════════════════════════ */}
      <header
        className="text-white shadow-lg sticky top-0 z-30"
        style={{ background: HEADER_BG }}
      >
        <div className="max-w-2xl mx-auto px-4 py-3 flex items-center gap-3">

          {/* ── Logo 🧊 tricolor ── */}
          <div className="flex items-center gap-2 flex-shrink-0">
            <div
              className="w-10 h-10 rounded-xl flex items-center justify-center shadow-lg ring-2 ring-white/20"
              style={{ background: "linear-gradient(135deg, #F5C800 33%, #D42B2B 33% 66%, #1E8C3A 66%)" }}
            >
              <span className="text-lg">🧊</span>
            </div>
            <div className="hidden lg:block">
              <p className="text-white font-black text-xs leading-none">Polar Breeze</p>
              <p className="text-white/50 text-[9px] leading-none mt-0.5">Loker</p>
            </div>
          </div>

          {/* ── Tabs con scroll + flechas ── */}
          <div className="flex-1 flex items-center gap-0.5 min-w-0">

            {/* Flecha izquierda */}
            <button
              onClick={() => scrollNav("left")}
              aria-hidden={!canScrollLeft}
              className={`flex-shrink-0 w-7 h-8 rounded-md flex items-center justify-center
                text-white/70 hover:text-white hover:bg-white/15 transition-all active:scale-90
                text-lg font-bold leading-none
                ${canScrollLeft ? "opacity-100" : "opacity-0 pointer-events-none"}`}
            >
              ‹
            </button>

            <nav
              ref={navRef}
              className="flex gap-1 overflow-x-auto scrollbar-none flex-1 scroll-smooth"
            >
              {TABS.map(t => (
                <button
                  key={t.key}
                  data-active={tab === t.key}
                  onClick={() => setTab(t.key)}
                  className={`relative flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium
                    whitespace-nowrap transition-all duration-100 active:scale-95 flex-shrink-0 ${
                    tab === t.key
                      ? "bg-white text-[#1A1A1A] shadow-sm font-bold"
                      : "text-white/80 hover:bg-white/15 hover:text-white"
                  }`}
                >
                  <span>{t.icon}</span>
                  <span className="hidden sm:inline">{t.label}</span>
                  {/* Badge pendientes en tab Choferes */}
                  {t.key === "choferes" && pendientesBadge > 0 && (
                    <span className="absolute -top-1.5 -right-1.5 w-4 h-4 bg-[#D42B2B] rounded-full
                      flex items-center justify-center text-[9px] font-black text-white border border-white/30">
                      {pendientesBadge > 9 ? "9+" : pendientesBadge}
                    </span>
                  )}
                </button>
              ))}
            </nav>

            {/* Flecha derecha */}
            <button
              onClick={() => scrollNav("right")}
              aria-hidden={!canScrollRight}
              className={`flex-shrink-0 w-7 h-8 rounded-md flex items-center justify-center
                text-white/70 hover:text-white hover:bg-white/15 transition-all active:scale-90
                text-lg font-bold leading-none
                ${canScrollRight ? "opacity-100" : "opacity-0 pointer-events-none"}`}
            >
              ›
            </button>
          </div>

          {/* Acciones */}
          <div className="flex items-center gap-1.5 flex-shrink-0">
            <button
              onClick={() => setShowTablas(true)}
              title="Consultar tablas"
              className="bg-white/15 hover:bg-white/25 active:scale-95 w-8 h-8 rounded-lg
                flex items-center justify-center text-base transition-all"
            >
              📋
            </button>
            {/* ── Pastilla de rol — Encargado ── */}
            <RolePill rol="encargado" nombre={profile?.nombre ?? "Encargado"} />
            <button
              onClick={logout}
              className="bg-white/15 hover:bg-white/25 active:scale-95 px-3 py-1.5
                rounded-lg text-xs transition-all font-medium"
            >
              Salir
            </button>
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
              {BREADCRUMB[tab]}
            </span>
            <span className="flex items-center gap-1 text-gray-400 text-[10px] flex-shrink-0 ml-2">
              <span className="w-1.5 h-1.5 rounded-full bg-[#1E8C3A] animate-pulse" />
              Firebase
            </span>
          </div>
        </div>
      </header>

      {/* ══════════════════════════════════════════
          CONTENIDO
      ══════════════════════════════════════════ */}
      <main className="max-w-2xl mx-auto px-4 py-5">

        {tab === "lote"   && <RegistroLote />}
        {tab === "weight" && <PolarBreezeWeight />}

        {/* Tab Choferes — §24 integración completa */}
        {tab === "choferes" && (
          <ConsultaChoferes onPendientesChange={setPendientesBadge} />
        )}

        {/* Tab Stock */}
        {tab === "stock" && (
          <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
            {/* Header del card */}
            <div className="px-4 py-3 bg-[#1A1A1A]">
              <h2 className="text-white font-bold text-sm">📊 Stock actual del loker</h2>
              <p className="text-gray-400 text-xs mt-0.5">Saldo acumulado de entradas menos salidas</p>
            </div>
            {/* Banda tricolor */}
            <div className="h-[3px] flex">
              <div className="flex-1 bg-[#F5C800]" />
              <div className="flex-1 bg-[#D42B2B]" />
              <div className="flex-1 bg-[#1E8C3A]" />
            </div>

            {!stockCargado ? (
              <div className="px-4 py-12 text-center">
                <p className="text-sm text-gray-400 animate-pulse">Cargando stock…</p>
              </div>
            ) : saldo.length === 0 ? (
              <div className="px-4 py-12 text-center">
                <p className="text-3xl mb-2">📦</p>
                <p className="text-sm font-semibold text-gray-600">Sin movimientos registrados</p>
                <p className="text-xs text-gray-400 mt-1">Registra el primer lote para ver el stock.</p>
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
                      p.saldo < 0  ? "bg-red-100 text-red-700 border-red-300" :
                      p.saldo === 0 ? "bg-amber-100 text-amber-600 border-amber-200" :
                                     "bg-green-100 text-green-700 border-green-200"
                    }`}>
                      {p.saldo > 0 ? "+" : ""}{p.saldo}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Tab Vista — polar-breeze-final.html */}
        {tab === "vista" && <PolarBreezeHTML />}
      </main>

      {/* Modal Tablas */}
      {showTablas && <ConsultarTablaModal onClose={() => setShowTablas(false)} />}

      {/* FAB Polar Breeze */}
      <FloatingFAB />

      {/* ── Banner de instalación PWA ── */}
      <PWAInstallBanner appName="App Encargado" appIcon="🏭" />
    </div>
  );
}
