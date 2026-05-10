"use client";

import { useState } from "react";
import { useAuth } from "@/lib/auth-context";
import { UserProfile } from "@/lib/types";
import Overview        from "@/components/admin/Overview";
import GestionChoferes from "@/components/admin/GestionChoferes";
import ChoferDetalle   from "@/components/admin/ChoferDetalle";

type Tab = "overview" | "choferes";

export default function AdminDashboard() {
  const { profile, logout } = useAuth();
  const [tab,    setTab]    = useState<Tab>("overview");
  const [chofer, setChofer] = useState<UserProfile | null>(null);

  // Navega a la tab Choferes y abre el detalle de ese chofer
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
          <nav className="flex gap-1 flex-1">
            <Tab
              active={tab === "overview"}
              onClick={() => { setTab("overview"); setChofer(null); }}
            >
              🏠 Overview
            </Tab>
            <Tab
              active={tab === "choferes"}
              onClick={() => setTab("choferes")}
            >
              👥 Choferes
              {chofer && (
                <span className="ml-1.5 text-xs bg-white/20 px-1.5 py-0.5 rounded-full">
                  {chofer.nombre.split(" ")[0]}
                </span>
              )}
            </Tab>
          </nav>

          {/* Usuario */}
          <div className="flex items-center gap-2 flex-shrink-0">
            <div className="text-right hidden sm:block">
              <p className="text-sm font-medium leading-tight">{profile?.nombre}</p>
              <span className="text-xs text-purple-300">Administrador</span>
            </div>
            <button
              onClick={logout}
              className="bg-white/10 hover:bg-white/20 px-3 py-1.5 rounded-lg text-xs
                transition font-medium"
            >
              Salir
            </button>
          </div>
        </div>

        {/* Breadcrumb inline cuando se ve un chofer */}
        {tab === "choferes" && chofer && (
          <div className="border-t border-white/10 bg-black/10">
            <div className="max-w-7xl mx-auto px-4 py-1.5 flex items-center gap-2 text-xs text-purple-200">
              <button
                onClick={volverALista}
                className="hover:text-white transition"
              >
                👥 Choferes
              </button>
              <span className="opacity-40">/</span>
              <span className="text-white font-medium">{chofer.nombre}</span>
              {chofer.ficha && (
                <span className="opacity-60">· ficha {chofer.ficha}</span>
              )}
            </div>
          </div>
        )}
      </header>

      {/* ── Contenido ── */}
      <main className="max-w-7xl mx-auto px-4 py-5">

        {tab === "overview" && (
          <Overview onVerChofer={verChofer} />
        )}

        {tab === "choferes" && !chofer && (
          <GestionChoferes onVerDetalle={verChofer} />
        )}

        {tab === "choferes" && chofer && (
          <ChoferDetalle chofer={chofer} onBack={volverALista} />
        )}

      </main>
    </div>
  );
}

function Tab({ active, onClick, children }: {
  active: boolean; onClick: () => void; children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-all ${
        active
          ? "bg-white text-purple-800 shadow-sm"
          : "text-purple-200 hover:bg-white/10 hover:text-white"
      }`}
    >
      {children}
    </button>
  );
}
