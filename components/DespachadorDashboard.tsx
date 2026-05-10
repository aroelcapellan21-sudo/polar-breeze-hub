"use client";

import { useState } from "react";
import { useAuth } from "@/lib/auth-context";
import CuartoFrio from "@/components/despachador/CuartoFrio";
import Choferes   from "@/components/despachador/Choferes";
import Comparar   from "@/components/despachador/Comparar";
import Historial  from "@/components/despachador/Historial";

type Tab = "cuartofrio" | "choferes" | "comparar" | "historial";

const TABS: { key: Tab; icon: string; label: string }[] = [
  { key: "cuartofrio", icon: "🥶", label: "Cuarto Frío" },
  { key: "choferes",   icon: "🚛", label: "Choferes"    },
  { key: "comparar",   icon: "⚖️", label: "Comparar"    },
  { key: "historial",  icon: "📅", label: "Historial"   },
];

export default function DespachadorDashboard() {
  const { profile, logout } = useAuth();
  const [tab, setTab] = useState<Tab>("cuartofrio");

  return (
    <div className="min-h-screen bg-gray-100">

      {/* ── Header ── */}
      <header className="bg-gradient-to-r from-blue-700 to-blue-900 text-white shadow-lg sticky top-0 z-30">
        <div className="max-w-6xl mx-auto px-4 py-3 flex items-center gap-3">

          {/* Logo */}
          <div className="w-9 h-9 bg-white/20 rounded-lg flex items-center justify-center
            font-black text-sm flex-shrink-0">
            PB
          </div>

          {/* Tabs */}
          <nav className="flex gap-1 flex-1 overflow-x-auto">
            {TABS.map((t) => (
              <button
                key={t.key}
                onClick={() => setTab(t.key)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm
                  font-medium whitespace-nowrap transition flex-shrink-0 ${
                  tab === t.key
                    ? "bg-white text-blue-800 shadow-sm"
                    : "text-blue-200 hover:bg-white/10 hover:text-white"
                }`}
              >
                <span>{t.icon}</span>
                <span className="hidden sm:inline">{t.label}</span>
              </button>
            ))}
          </nav>

          {/* Usuario */}
          <div className="flex items-center gap-2 flex-shrink-0">
            <div className="text-right hidden sm:block">
              <p className="text-sm font-medium leading-tight">{profile?.nombre}</p>
              <span className="text-xs text-blue-300">Despachador</span>
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

        {/* Sub-línea de contexto */}
        <div className="border-t border-white/10 bg-black/10">
          <div className="max-w-6xl mx-auto px-4 py-1.5 text-xs text-blue-200 flex items-center gap-3">
            <span className="font-medium text-white">
              {TABS.find((t) => t.key === tab)?.icon}{" "}
              {tab === "cuartofrio" && "Inventario de cuarto frío — foto o manual, IA extrae la lista"}
              {tab === "choferes"   && "Facturas por chofer — foto o manual, IA lee la entrega"}
              {tab === "comparar"   && "Confronta cuarto frío vs. entregas de choferes en tiempo real"}
              {tab === "historial"  && "Registros por día — cuarto frío, choferes y despachos"}
            </span>
            <span className="ml-auto flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-blue-300 animate-pulse" />
              Firebase polar-breeze
            </span>
          </div>
        </div>
      </header>

      {/* ── Contenido ── */}
      <main className="max-w-6xl mx-auto px-4 py-5">
        {tab === "cuartofrio" && <CuartoFrio />}
        {tab === "choferes"   && <Choferes />}
        {tab === "comparar"   && <Comparar />}
        {tab === "historial"  && <Historial />}
      </main>

    </div>
  );
}
