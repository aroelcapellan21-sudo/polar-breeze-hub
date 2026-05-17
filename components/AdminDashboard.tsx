"use client";

import { useState } from "react";
import { useAuth } from "@/lib/auth-context";
import { UserProfile } from "@/lib/types";
import Overview        from "@/components/admin/Overview";
import GestionChoferes from "@/components/admin/GestionChoferes";
import ChoferDetalle   from "@/components/admin/ChoferDetalle";
import ConfigModal     from "@/components/admin/ConfigModal";
import StatusDashboard from "@/components/admin/StatusDashboard";
import Inventario      from "@/components/admin/Inventario";

type Tab = "overview" | "choferes" | "inventario" | "estado";

export default function AdminDashboard() {
  const { profile, logout } = useAuth();
  const [tab,         setTab]         = useState<Tab>("overview");
  const [chofer,      setChofer]      = useState<UserProfile | null>(null);
  const [showConfig,  setShowConfig]  = useState(false);

  const verChofer = (c: UserProfile) => {
    setChofer(c);
    setTab("choferes");
  };

  const volverALista = () => setChofer(null);

  return (
    <div className="min-h-screen bg-gray-100">

      {/* ── Header ── */}
      <header className="bg-gradient-to-r from-purple-800 to-purple-950 text-white shadow-lg sticky top-0 z-30">
        <div className="max-w-7xl mx-auto px-4 py-3 flex items-center gap-3">

          {/* Logo */}
          <div className="w-9 h-9 bg-white/20 rounded-lg flex items-center justify-center
            font-black text-sm flex-shrink-0 tracking-tight">
            PB
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
          </nav>

          {/* Acciones */}
          <div className="flex items-center gap-2 flex-shrink-0">
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
      </main>

      {/* ── Modal Configuración ── */}
      {showConfig && <ConfigModal onClose={() => setShowConfig(false)} />}
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
