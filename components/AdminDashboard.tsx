"use client";

import { useState, useEffect, useRef } from "react";
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
import FloatingFAB           from "@/components/shared/FloatingFAB";
import ConsultarTablaModal   from "@/components/shared/ConsultarTablaModal";

type Tab = "overview" | "choferes" | "inventario" | "estado" | "informes" | "anomalias" | "encargados" | "anom_desp" | "reportes" | "codigos";

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

  return (
    <div className="min-h-screen bg-gray-100">

      {/* ── Header — gradiente tricolor Polar Breeze ── */}
      <header
        className="text-white shadow-lg sticky top-0 z-30"
        style={{ background: "linear-gradient(90deg, rgba(245,200,0,0.55) 0% 33.33%, rgba(212,43,43,0.55) 33.33% 66.66%, rgba(30,140,58,0.55) 66.66% 100%), #1A1A1A" }}
      >
        <div className="max-w-7xl mx-auto px-4 py-3 flex items-center gap-3">

          {/* Logo 🧊 tricolor */}
          <div
            className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 shadow-md"
            style={{ background: "linear-gradient(135deg, rgba(245,200,0,0.92) 33%, rgba(212,43,43,0.92) 33% 66%, rgba(30,140,58,0.92) 66%)" }}
          >
            <span className="text-base">🧊</span>
          </div>

          {/* Tabs */}
          <nav className="flex gap-1 flex-1 overflow-x-auto scrollbar-none">
            <NavTab
              active={tab === "overview"}
              onClick={() => { setTab("overview"); setChofer(null); }}
            >
              <span>🏠</span>
              <span className="hidden sm:inline">Overview</span>
            </NavTab>
            <NavTab
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
              active={tab === "inventario"}
              onClick={() => { setTab("inventario"); setChofer(null); }}
            >
              <span>📦</span>
              <span className="hidden sm:inline">Inventario</span>
            </NavTab>
            <NavTab
              active={tab === "estado"}
              onClick={() => { setTab("estado"); setChofer(null); }}
            >
              <span>🖥️</span>
              <span className="hidden sm:inline">Estado</span>
            </NavTab>
            <NavTab
              active={tab === "informes"}
              onClick={() => { setTab("informes"); setChofer(null); }}
            >
              <span>📋</span>
              <span className="hidden sm:inline">Informes</span>
            </NavTab>
            <NavTab
              active={tab === "anomalias"}
              onClick={() => { setTab("anomalias"); setChofer(null); }}
            >
              <span>⚠️</span>
              <span className="hidden sm:inline">Anomalías</span>
            </NavTab>
            <NavTab
              active={tab === "encargados"}
              onClick={() => { setTab("encargados"); setChofer(null); }}
            >
              <span>🏭</span>
              <span className="hidden sm:inline">Encargados</span>
            </NavTab>
            <NavTab
              active={tab === "anom_desp"}
              onClick={() => { setTab("anom_desp"); setChofer(null); }}
            >
              <span>📋</span>
              <span className="hidden sm:inline">Anomalías Desp.</span>
            </NavTab>
            <NavTab
              active={tab === "reportes"}
              onClick={() => { setTab("reportes"); setChofer(null); }}
            >
              <span>📊</span>
              <span className="hidden sm:inline">Reportes</span>
            </NavTab>
            <NavTab
              active={tab === "codigos"}
              onClick={() => { setTab("codigos"); setChofer(null); }}
            >
              <span>🔲</span>
              <span className="hidden sm:inline">Códigos</span>
            </NavTab>
          </nav>

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
            <div className="text-right hidden sm:block">
              <p className="text-sm font-medium leading-tight">{profile?.nombre}</p>
              <span className="text-xs text-purple-300">Administrador</span>
            </div>
            <button
              onClick={logout}
              className="bg-white/10 hover:bg-white/20 active:scale-95 px-3 py-1.5
                rounded-lg text-xs transition-all duration-100 font-medium"
            >
              Salir
            </button>
          </div>
        </div>

        {/* Banda tricolor */}
        <div className="flex h-[5px]">
          <div className="flex-1 bg-[#F5C800]" />
          <div className="flex-1 bg-[#D42B2B]" />
          <div className="flex-1 bg-[#1E8C3A]" />
        </div>

        {/* Breadcrumb */}
        <div className="border-t border-white/10 bg-black/10">
          <div className="max-w-7xl mx-auto px-4 py-1.5 flex items-center gap-2 text-xs text-purple-200 overflow-x-auto">
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

function NavTab({ active, onClick, children }: {
  active: boolean; onClick: () => void; children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
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
