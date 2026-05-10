"use client";

import { useState } from "react";
import { useAuth } from "@/lib/auth-context";
import { UserProfile } from "@/lib/types";
import TiempoReal      from "@/components/admin/TiempoReal";
import GestionChoferes from "@/components/admin/GestionChoferes";
import ChoferDetalle   from "@/components/admin/ChoferDetalle";

type Tab = "tiemporeal" | "choferes";

export default function AdminDashboard() {
  const { profile, logout } = useAuth();
  const [tab, setTab]                       = useState<Tab>("tiemporeal");
  const [choferSeleccionado, setChofer]     = useState<UserProfile | null>(null);

  const handleVerDetalle = (c: UserProfile) => {
    setChofer(c);
    setTab("choferes");
  };

  return (
    <div className="min-h-screen bg-gray-100">
      {/* ── Header ── */}
      <header className="bg-gradient-to-r from-purple-800 to-purple-950 text-white shadow-lg">
        <div className="max-w-7xl mx-auto px-4 py-3 flex items-center gap-3">
          {/* Logo */}
          <div className="w-9 h-9 bg-white/20 rounded-lg flex items-center justify-center font-black text-sm flex-shrink-0">
            PB
          </div>

          {/* Tabs */}
          <nav className="flex gap-1 flex-1">
            <TabBtn active={tab === "tiemporeal"} onClick={() => { setTab("tiemporeal"); setChofer(null); }}>
              📡 Tiempo Real
            </TabBtn>
            <TabBtn active={tab === "choferes"}   onClick={() => setTab("choferes")}>
              👥 Choferes
            </TabBtn>
          </nav>

          {/* User */}
          <div className="flex items-center gap-2 flex-shrink-0">
            <div className="text-right hidden sm:block">
              <p className="text-sm font-medium leading-tight">{profile?.nombre}</p>
              <span className="text-xs text-purple-300">Admin</span>
            </div>
            <button
              onClick={logout}
              className="bg-white/10 hover:bg-white/20 px-3 py-1.5 rounded-lg text-xs transition"
            >
              Salir
            </button>
          </div>
        </div>
      </header>

      {/* ── Breadcrumb cuando se ve detalle de chofer ── */}
      {tab === "choferes" && choferSeleccionado && (
        <div className="bg-purple-900/10 border-b border-purple-100">
          <div className="max-w-7xl mx-auto px-4 py-2 flex items-center gap-2 text-sm text-purple-700">
            <button onClick={() => setChofer(null)} className="hover:underline">
              👥 Choferes
            </button>
            <span className="text-gray-400">/</span>
            <span className="font-medium">{choferSeleccionado.nombre}</span>
          </div>
        </div>
      )}

      {/* ── Contenido ── */}
      <main className="max-w-7xl mx-auto px-4 py-5">
        {tab === "tiemporeal" && <TiempoReal />}

        {tab === "choferes" && !choferSeleccionado && (
          <GestionChoferes onVerDetalle={handleVerDetalle} />
        )}

        {tab === "choferes" && choferSeleccionado && (
          <ChoferDetalle
            chofer={choferSeleccionado}
            onBack={() => setChofer(null)}
          />
        )}
      </main>
    </div>
  );
}

function TabBtn({ active, onClick, children }: {
  active: boolean; onClick: () => void; children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`px-4 py-1.5 rounded-lg text-sm font-medium transition ${
        active
          ? "bg-white text-purple-800"
          : "text-purple-200 hover:bg-white/10"
      }`}
    >
      {children}
    </button>
  );
}
