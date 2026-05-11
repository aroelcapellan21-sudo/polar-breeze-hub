"use client";

import { useState } from "react";
import {
  collection, getDocs, doc, setDoc, updateDoc, Timestamp, getDoc,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useAuth } from "@/lib/auth-context";
import { UserProfile } from "@/lib/types";
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
  const [tab,        setTab]        = useState<Tab>("cuartofrio");
  const [selChofer,  setSelChofer]  = useState<UserProfile | null>(null);

  // Restablecer modal state
  const [showReset,   setShowReset]   = useState(false);
  const [resetPwd,    setResetPwd]    = useState("");
  const [resetLoading, setResetLoading] = useState(false);
  const [resetMsg,    setResetMsg]    = useState<{ type: "ok"|"err"; text: string }|null>(null);

  const flashReset = (type: "ok"|"err", text: string) => {
    setResetMsg({ type, text });
    setTimeout(() => setResetMsg(null), 4000);
  };

  const handleReset = async () => {
    if (!resetPwd) return;
    setResetLoading(true);
    try {
      // Verify reset password from config/main
      const cfgSnap = await getDoc(doc(db, "config", "main"));
      const storedPwd = cfgSnap.exists() ? cfgSnap.data()?.resetPassword : null;
      if (!storedPwd || storedPwd !== resetPwd) {
        flashReset("err", "Clave de Restablecer incorrecta");
        setResetLoading(false);
        return;
      }

      // Clear session/despacho
      await setDoc(doc(db, "session", "despacho"), {
        cuartoFrio: [],
        totalProductos: 0, totalUnidades: 0, totalPeso: null,
        totalDespachos: 0, totalMonto: 0,
        despachadorId: profile?.uid ?? "",
        despachadorNombre: profile?.nombre ?? "",
        fecha: Timestamp.now(), estado: "activa",
        resetAt: Timestamp.now(),
      });

      // Clear each driver's entregas
      const driversSnap = await getDocs(collection(db, "drivers"));
      await Promise.all(
        driversSnap.docs.map((d) =>
          updateDoc(doc(db, "drivers", d.id), {
            entregas: [], totalEntregado: 0, totalMonto: null,
            observaciones: null, updatedAt: Timestamp.now(),
          }).catch(() => {/* ignore if doc doesn't have those fields */})
        )
      );

      flashReset("ok", "Día restablecido ✓ — historial conservado en Firebase");
      setResetPwd("");
      setTimeout(() => setShowReset(false), 2000);
    } catch (e) {
      flashReset("err", e instanceof Error ? e.message : "Error al restablecer");
    } finally {
      setResetLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-100">

      {/* ── Header ── */}
      <header className="bg-gradient-to-r from-blue-700 to-blue-900 text-white shadow-lg sticky top-0 z-30">
        <div className="max-w-6xl mx-auto px-4 py-3 flex items-center gap-3">

          {/* Logo */}
          <div className="w-9 h-9 bg-white/20 rounded-lg flex items-center justify-center font-black text-sm flex-shrink-0">
            PB
          </div>

          {/* Tabs */}
          <nav className="flex gap-1 flex-1 overflow-x-auto scrollbar-none">
            {TABS.map((t) => (
              <button
                key={t.key}
                onClick={() => setTab(t.key)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm
                  font-medium whitespace-nowrap transition-all duration-100 active:scale-95
                  flex-shrink-0 ${
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

          {/* Acciones */}
          <div className="flex items-center gap-2 flex-shrink-0">
            <button
              onClick={() => { setShowReset(true); setResetPwd(""); setResetMsg(null); }}
              title="Restablecer día"
              className="bg-white/10 hover:bg-white/20 active:scale-95 px-2 py-1.5
                rounded-lg text-xs transition-all duration-100 font-medium whitespace-nowrap"
            >
              🔄 Restablecer
            </button>
            <div className="text-right hidden sm:block">
              <p className="text-sm font-medium leading-tight">{profile?.nombre}</p>
              <span className="text-xs text-blue-300">Despachador</span>
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
          <div className="max-w-6xl mx-auto px-4 py-1.5 flex items-center gap-1.5 text-xs text-blue-200 overflow-x-auto">
            {/* Tab name */}
            <button
              onClick={() => { if (tab === "choferes") setSelChofer(null); }}
              className={`whitespace-nowrap font-medium ${
                tab === "choferes" && selChofer ? "hover:text-white transition-colors" : "text-white"
              }`}
            >
              {TABS.find((t) => t.key === tab)?.icon}{" "}
              {tab === "cuartofrio" && "Cuarto Frío — inventario, foto o manual"}
              {tab === "choferes"   && "Choferes — facturas por entrega"}
              {tab === "comparar"   && "Comparar — cuarto frío vs. choferes en tiempo real"}
              {tab === "historial"  && "Historial — registros del día por tipo"}
            </button>
            {/* Chofer breadcrumb */}
            {tab === "choferes" && selChofer && (
              <>
                <span className="opacity-40 flex-shrink-0">/</span>
                <span className="text-white font-semibold whitespace-nowrap">
                  {selChofer.nombre}
                </span>
                {selChofer.ficha && (
                  <span className="opacity-60 whitespace-nowrap">· ficha {selChofer.ficha}</span>
                )}
              </>
            )}
            <span className="ml-auto flex items-center gap-1 flex-shrink-0">
              <span className="w-1.5 h-1.5 rounded-full bg-blue-300 animate-pulse" />
              Firebase polar-breeze
            </span>
          </div>
        </div>
      </header>

      {/* ── Contenido ── */}
      <main className="max-w-6xl mx-auto px-4 py-5">
        {tab === "cuartofrio" && <CuartoFrio />}
        {tab === "choferes"   && (
          <Choferes onChoferSelect={setSelChofer} />
        )}
        {tab === "comparar"   && <Comparar />}
        {tab === "historial"  && <Historial />}
      </main>

      {/* ── Modal Restablecer ── */}
      {showReset && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6 space-y-4">
            <div className="text-center">
              <p className="text-3xl mb-2">🔄</p>
              <h3 className="font-bold text-gray-800 text-lg">Restablecer día</h3>
              <p className="text-sm text-gray-500 mt-1">
                Limpia cuarto frío y entregas del día.<br />
                <strong>El historial en Firebase se conserva.</strong>
              </p>
            </div>
            <input
              type="password" value={resetPwd} autoFocus
              onChange={(e) => setResetPwd(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && resetPwd && handleReset()}
              placeholder="Clave de Restablecer"
              className="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm outline-none focus:ring-2 focus:ring-blue-400"
            />
            {resetMsg && (
              <div className={`text-sm px-3 py-2 rounded-lg text-center ${
                resetMsg.type === "ok"
                  ? "bg-green-50 text-green-700 border border-green-200"
                  : "bg-red-50 text-red-700 border border-red-200"
              }`}>
                {resetMsg.text}
              </div>
            )}
            <div className="flex gap-2">
              <button
                onClick={() => { setShowReset(false); setResetPwd(""); setResetMsg(null); }}
                disabled={resetLoading}
                className="flex-1 py-2.5 rounded-xl border border-gray-200 text-sm text-gray-600 hover:bg-gray-50 transition disabled:opacity-60"
              >
                Cancelar
              </button>
              <button
                onClick={handleReset}
                disabled={resetLoading || !resetPwd}
                className="flex-1 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-700 active:scale-95 text-white text-sm font-bold transition-all duration-100 disabled:opacity-60"
              >
                {resetLoading ? "Restableciendo..." : "Restablecer"}
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
