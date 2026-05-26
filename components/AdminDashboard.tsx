"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { collection, query, where, getDocs, getDoc, doc } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useAuth } from "@/lib/auth-context";
import { UserProfile, PuntosConfig, PreciosConfig } from "@/lib/types";
import Overview        from "@/components/admin/Overview";
import GestionChoferes from "@/components/admin/GestionChoferes";
import ChoferDetalle   from "@/components/admin/ChoferDetalle";
import ConfigModal     from "@/components/admin/ConfigModal";
import StatusDashboard from "@/components/admin/StatusDashboard";
import Inventario          from "@/components/admin/Inventario";
import InformesHistorial  from "@/components/admin/InformesHistorial";
import Anomalias             from "@/components/admin/Anomalias";
import AnomaliasDespachador  from "@/components/admin/AnomaliasDespachador";
import GestionEncargados     from "@/components/admin/GestionEncargados";
import Reportes              from "@/components/admin/Reportes";
import GestionCodigos        from "@/components/admin/GestionCodigos";
import PWAControl            from "@/components/admin/PWAControl";
import FloatingFAB           from "@/components/shared/FloatingFAB";
import ConsultarTablaModal   from "@/components/shared/ConsultarTablaModal";
import RolePill              from "@/components/shared/RolePill";

type Tab = "overview" | "choferes" | "inventario" | "estado" | "informes" | "anomalias" | "encargados" | "anom_desp" | "reportes" | "codigos" | "pwa";

type SearchItem =
  | { kind: "chofer";   data: UserProfile }
  | { kind: "producto"; nombre: string; tipo: "puntos" | "precios" };

export default function AdminDashboard() {
  const { profile, logout } = useAuth();
  const [tab,         setTab]         = useState<Tab>("overview");
  const [chofer,      setChofer]      = useState<UserProfile | null>(null);
  const [showConfig,  setShowConfig]  = useState(false);
  const [showTablas,  setShowTablas]  = useState(false);

  // ── Buscador general ─────────────────────────────────────────────────────────
  const [searchOpen,  setSearchOpen]  = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchItems, setSearchItems] = useState<SearchItem[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const searchRef  = useRef<HTMLDivElement>(null);
  const searchInput = useRef<HTMLInputElement>(null);

  const openSearch = async () => {
    setSearchOpen(true);
    setSearchQuery("");
    setTimeout(() => searchInput.current?.focus(), 50);
    if (searchItems.length > 0) return;
    setSearchLoading(true);
    try {
      const [chofSnap, puntosSnap, preciosSnap] = await Promise.all([
        getDocs(query(collection(db, "usuarios"), where("role", "==", "chofer"))),
        getDoc(doc(db, "config", "puntos")),
        getDoc(doc(db, "config", "precios")),
      ]);
      const items: SearchItem[] = [];
      chofSnap.docs.forEach((d) => items.push({ kind: "chofer", data: d.data() as UserProfile }));
      if (puntosSnap.exists()) {
        const cfg = puntosSnap.data() as PuntosConfig;
        cfg.productos?.forEach((p) => items.push({ kind: "producto", nombre: p.nombre, tipo: "puntos" }));
      }
      if (preciosSnap.exists()) {
        const cfg = preciosSnap.data() as PreciosConfig;
        cfg.productos?.forEach((p) => {
          if (!items.some((x) => x.kind === "producto" && x.nombre.toLowerCase() === p.nombre.toLowerCase())) {
            items.push({ kind: "producto", nombre: p.nombre, tipo: "precios" });
          }
        });
      }
      setSearchItems(items);
    } finally {
      setSearchLoading(false);
    }
  };

  useEffect(() => {
    if (!searchOpen) return;
    const handler = (e: MouseEvent) => {
      if (searchRef.current && !searchRef.current.contains(e.target as Node)) {
        setSearchOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [searchOpen]);

  const q = searchQuery.trim().toLowerCase();
  const searchResults = q.length < 2 ? [] : searchItems.filter((item) => {
    if (item.kind === "chofer") {
      return (
        item.data.nombre?.toLowerCase().includes(q) ||
        item.data.ficha?.toLowerCase().includes(q)
      );
    }
    return item.nombre.toLowerCase().includes(q);
  }).slice(0, 12);

  const handleSearchSelect = (item: SearchItem) => {
    setSearchOpen(false);
    setSearchQuery("");
    if (item.kind === "chofer") {
      verChofer(item.data);
    } else {
      setTab("inventario");
      setChofer(null);
    }
  };

  // ─────────────────────────────────────────────────────────────────────────────

  const verChofer = (c: UserProfile) => {
    setChofer(c);
    setTab("choferes");
  };

  const volverALista = () => setChofer(null);

  // ── Flechas de navegación de tabs ────────────────────────────────────────
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
    el.scrollBy({ left: dir === "right" ? 140 : -140, behavior: "smooth" });
  };

  return (
    <div className="min-h-screen bg-gray-100">

      {/* ── Header — gradiente tricolor Polar Breeze ── */}
      <header
        className="text-white shadow-lg sticky top-0 z-30"
        style={{ background: "linear-gradient(90deg, rgba(245,200,0,0.55) 0% 33.33%, rgba(212,43,43,0.55) 33.33% 66.66%, rgba(30,140,58,0.55) 66.66% 100%), #1A1A1A" }}
      >
        <div className="max-w-7xl mx-auto px-4 py-3 flex items-center gap-3">

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
              <p className="text-white/50 text-[9px] leading-none mt-0.5">Hub Central</p>
            </div>
          </div>

          {/* Tabs con scroll + flechas */}
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
              <NavTab
                data-active={tab === "overview"}
                active={tab === "overview"}
                onClick={() => { setTab("overview"); setChofer(null); }}
              >
                <span>🏠</span>
                <span className="hidden sm:inline">Overview</span>
              </NavTab>
              <NavTab
                data-active={tab === "choferes"}
                active={tab === "choferes"}
                onClick={() => setTab("choferes")}
              >
                <span>👥</span>
                <span className="hidden sm:inline">Choferes</span>
                {chofer && (
                  <span className="ml-1 text-xs bg-white/20 px-1.5 py-0.5 rounded-full hidden sm:inline">
                    {chofer.nombre.split(" ")[0]}
                  </span>
                )}
              </NavTab>
              <NavTab
                data-active={tab === "inventario"}
                active={tab === "inventario"}
                onClick={() => { setTab("inventario"); setChofer(null); }}
              >
                <span>📦</span>
                <span className="hidden sm:inline">Inventario</span>
              </NavTab>
              <NavTab
                data-active={tab === "estado"}
                active={tab === "estado"}
                onClick={() => { setTab("estado"); setChofer(null); }}
              >
                <span>🖥️</span>
                <span className="hidden sm:inline">Estado</span>
              </NavTab>
              <NavTab
                data-active={tab === "informes"}
                active={tab === "informes"}
                onClick={() => { setTab("informes"); setChofer(null); }}
              >
                <span>📋</span>
                <span className="hidden sm:inline">Informes</span>
              </NavTab>
              <NavTab
                data-active={tab === "anomalias"}
                active={tab === "anomalias"}
                onClick={() => { setTab("anomalias"); setChofer(null); }}
              >
                <span>⚠️</span>
                <span className="hidden sm:inline">Anomalías</span>
              </NavTab>
              <NavTab
                data-active={tab === "encargados"}
                active={tab === "encargados"}
                onClick={() => { setTab("encargados"); setChofer(null); }}
              >
                <span>🏭</span>
                <span className="hidden sm:inline">Encargados</span>
              </NavTab>
              <NavTab
                data-active={tab === "anom_desp"}
                active={tab === "anom_desp"}
                onClick={() => { setTab("anom_desp"); setChofer(null); }}
              >
                <span>📋</span>
                <span className="hidden sm:inline">Anomalías Desp.</span>
              </NavTab>
              <NavTab
                data-active={tab === "reportes"}
                active={tab === "reportes"}
                onClick={() => { setTab("reportes"); setChofer(null); }}
              >
                <span>📊</span>
                <span className="hidden sm:inline">Reportes</span>
              </NavTab>
              <NavTab
                data-active={tab === "codigos"}
                active={tab === "codigos"}
                onClick={() => { setTab("codigos"); setChofer(null); }}
              >
                <span>🔲</span>
                <span className="hidden sm:inline">Códigos</span>
              </NavTab>
              <NavTab
                data-active={tab === "pwa"}
                active={tab === "pwa"}
                onClick={() => { setTab("pwa"); setChofer(null); }}
              >
                <span>📱</span>
                <span className="hidden sm:inline">PWA</span>
              </NavTab>
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
            {/* 🔍 Buscador */}
            <button
              onClick={openSearch}
              title="Buscar chofer, producto, ficha…"
              className="bg-white/10 hover:bg-white/20 active:scale-95 w-8 h-8 rounded-lg
                flex items-center justify-center text-base transition-all duration-100"
            >
              🔍
            </button>
            {/* 📋 Tablas */}
            <button
              onClick={() => setShowTablas(true)}
              title="Consultar tablas"
              className="bg-white/10 hover:bg-white/20 active:scale-95 w-8 h-8 rounded-lg
                flex items-center justify-center text-base transition-all duration-100"
            >
              📋
            </button>
            <button
              onClick={() => setShowConfig(true)}
              title="Configuración"
              className="bg-white/10 hover:bg-white/20 active:scale-95 w-8 h-8 rounded-lg
                flex items-center justify-center text-base transition-all duration-100"
            >
              ⚙️
            </button>
            {/* ── Pastilla de rol — Admin ── */}
            <RolePill rol="admin" nombre={profile?.nombre ?? ""} />
            <button
              onClick={logout}
              className="bg-white/10 hover:bg-white/20 active:scale-95 px-3 py-1.5
                rounded-lg text-xs transition-all duration-100 font-medium"
            >
              Salir
            </button>
          </div>
        </div>

        {/* ── Banda tricolor 5 px ── */}
        <div className="flex h-[5px]">
          <div className="flex-1 bg-[#F5C800]" />
          <div className="flex-1 bg-[#D42B2B]" />
          <div className="flex-1 bg-[#1E8C3A]" />
        </div>

        {/* Breadcrumb */}
        <div className="border-t border-white/10 bg-black/10">
          <div className="max-w-7xl mx-auto px-4 py-1.5 flex items-center gap-2 text-xs text-[#F5C800]/80 overflow-x-auto">
            {tab === "overview" && (
              <span className="text-white font-medium">🏠 Overview — resumen general del sistema</span>
            )}
            {tab === "inventario" && (
              <span className="text-white font-medium">📦 Inventario — loker · entradas y movimientos</span>
            )}
            {tab === "estado" && (
              <span className="text-white font-medium">🖥️ Estado — salud de servicios · acceso exclusivo del dueño</span>
            )}
            {tab === "informes" && (
              <span className="text-white font-medium">📋 Informes — cierres del día por fecha</span>
            )}
            {tab === "anomalias" && (
              <span className="text-white font-medium">⚠️ Anomalías — detección automática · Telegram</span>
            )}
            {tab === "encargados" && (
              <span className="text-white font-medium">🏭 Encargados — gestión de encargados de almacén</span>
            )}
            {tab === "anom_desp" && (
              <span className="text-white font-medium">📋 Anomalías Despacho — faltantes registrados por despachadores</span>
            )}
            {tab === "reportes" && (
              <span className="text-white font-medium">📊 Reportes — lotes · movimientos · sync Google Sheets</span>
            )}
            {tab === "codigos" && (
              <span className="text-white font-medium">🔲 Códigos — base de códigos de cajas SPIKINSCAN + Weight</span>
            )}
            {tab === "pwa" && (
              <span className="text-white font-medium">📱 PWA — control de apps instaladas · notificaciones · subdominios</span>
            )}
            {tab === "choferes" && !chofer && (
              <span className="text-white font-medium">👥 Choferes — gestión, inventario y sistema de puntos</span>
            )}
            {tab === "choferes" && chofer && (
              <>
                <button
                  onClick={volverALista}
                  className="hover:text-white active:scale-95 transition-all duration-100 flex items-center gap-1 whitespace-nowrap"
                >
                  ← 👥 Choferes
                </button>
                <span className="opacity-40">/</span>
                <span className="text-white font-medium whitespace-nowrap">{chofer.nombre}</span>
                {chofer.ficha && (
                  <span className="opacity-60 whitespace-nowrap">· ficha {chofer.ficha}</span>
                )}
              </>
            )}
          </div>
        </div>
      </header>

      {/* ── Contenido ── */}
      <main className="max-w-7xl mx-auto px-4 py-5">
        {tab === "overview" && <Overview onVerChofer={verChofer} />}
        {tab === "choferes" && !chofer && <GestionChoferes onVerDetalle={verChofer} />}
        {tab === "choferes" && chofer && <ChoferDetalle chofer={chofer} onBack={volverALista} />}
        {tab === "inventario" && <Inventario />}
        {tab === "estado" && <StatusDashboard />}
        {tab === "informes" && <InformesHistorial />}
        {tab === "anomalias"  && <Anomalias />}
        {tab === "encargados" && <GestionEncargados />}
        {tab === "anom_desp"  && <AnomaliasDespachador mode="admin" />}
        {tab === "reportes"   && <Reportes />}
        {tab === "codigos"    && <GestionCodigos />}
        {tab === "pwa"        && <PWAControl />}
      </main>

      {/* ── Modal Configuración ── */}
      {showConfig && <ConfigModal onClose={() => setShowConfig(false)} />}

      {/* ── Modal Tablas ── */}
      {showTablas && <ConsultarTablaModal onClose={() => setShowTablas(false)} />}

      {/* ── Modal Buscador ── */}
      {searchOpen && (
        <div className="fixed inset-0 bg-black/50 flex items-start justify-center z-50 pt-16 px-4">
          <div
            ref={searchRef}
            className="bg-white rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden"
          >
            <div className="flex items-center gap-3 px-4 py-3 border-b border-gray-100">
              <span className="text-gray-400 text-lg">🔍</span>
              <input
                ref={searchInput}
                type="search"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onKeyDown={(e) => e.key === "Escape" && setSearchOpen(false)}
                placeholder="Buscar chofer, producto, ficha…"
                className="flex-1 text-sm text-gray-800 outline-none placeholder-gray-400"
              />
              <button
                onClick={() => setSearchOpen(false)}
                className="text-gray-400 hover:text-gray-600 text-sm font-bold px-1 transition"
              >
                ✕
              </button>
            </div>

            <div className="max-h-80 overflow-y-auto">
              {searchLoading && (
                <div className="px-4 py-6 text-center">
                  <p className="text-sm text-gray-400 animate-pulse">Cargando índice…</p>
                </div>
              )}
              {!searchLoading && q.length < 2 && (
                <div className="px-4 py-6 text-center">
                  <p className="text-sm text-gray-400">Escribe al menos 2 caracteres para buscar.</p>
                  <p className="text-xs text-gray-300 mt-1">Busca por nombre, ficha o producto.</p>
                </div>
              )}
              {!searchLoading && q.length >= 2 && searchResults.length === 0 && (
                <div className="px-4 py-6 text-center">
                  <p className="text-sm text-gray-400">Sin resultados para <strong>"{searchQuery}"</strong></p>
                </div>
              )}
              {searchResults.map((item, i) => (
                <button
                  key={i}
                  type="button"
                  onClick={() => handleSearchSelect(item)}
                  className="w-full flex items-center gap-3 px-4 py-3 hover:bg-gray-50
                    transition text-left border-b border-gray-50 last:border-0"
                >
                  <span className="text-xl flex-shrink-0">
                    {item.kind === "chofer" ? "👤" : "📦"}
                  </span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-800 truncate">
                      {item.kind === "chofer" ? item.data.nombre : item.nombre}
                    </p>
                    <p className="text-xs text-gray-400">
                      {item.kind === "chofer"
                        ? `Chofer${item.data.ficha ? ` · ficha ${item.data.ficha}` : ""}`
                        : item.tipo === "puntos" ? "Tabla de puntos" : "Tabla de precios"}
                    </p>
                  </div>
                  <span className="text-gray-300 text-sm">›</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ── Botón flotante ── */}
      <FloatingFAB />
    </div>
  );
}

function NavTab({ active, onClick, children, "data-active": dataActive }: {
  active: boolean; onClick: () => void; children: React.ReactNode;
  "data-active"?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      data-active={dataActive ?? active}
      className={`flex items-center gap-1 px-3 py-1.5 rounded-lg text-sm font-medium
        transition-all duration-100 active:scale-95 whitespace-nowrap flex-shrink-0 ${
        active
          ? "bg-white text-purple-800 shadow-sm"
          : "text-purple-200 hover:bg-white/10 hover:text-white"
      }`}
    >
      {children}
    </button>
  );
}
