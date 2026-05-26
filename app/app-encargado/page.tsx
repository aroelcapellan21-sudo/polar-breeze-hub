"use client";

import { useEffect } from "react";
import { useAuth } from "@/lib/auth-context";
import EncargadoDashboard from "@/components/EncargadoDashboard";
import PWAServiceWorker from "@/components/shared/PWAServiceWorker";

/** Punto de entrada de la PWA Encargado. Solo accesible para rol=encargado. */
export default function AppEncargadoPage() {
  const { user, profile, loading, logout } = useAuth();

  useEffect(() => {
    if (!loading && user && profile && profile.role !== "encargado") {
      window.location.href = "/";
    }
  }, [loading, user, profile]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center"
        style={{ background: "linear-gradient(135deg, #1A1A1A 0%, #0a2a14 100%)" }}>
        <div className="text-center">
          <div className="w-16 h-16 rounded-2xl mx-auto mb-4 flex items-center justify-center text-3xl shadow-2xl"
            style={{ background: "linear-gradient(135deg, #F5C800 33%, #D42B2B 33% 66%, #1E8C3A 66%)" }}>
            🧊
          </div>
          <p className="text-white font-black text-lg">App Encargado</p>
          <p className="text-[#1E8C3A]/80 text-sm mt-1 animate-pulse">Polar Breeze, S.R.L.</p>
          <div className="flex justify-center gap-1 mt-4">
            <span className="w-2 h-2 rounded-full bg-[#F5C800] animate-bounce" style={{ animationDelay: "0ms" }} />
            <span className="w-2 h-2 rounded-full bg-[#D42B2B] animate-bounce" style={{ animationDelay: "150ms" }} />
            <span className="w-2 h-2 rounded-full bg-[#1E8C3A] animate-bounce" style={{ animationDelay: "300ms" }} />
          </div>
        </div>
      </div>
    );
  }

  if (!user || !profile) {
    if (typeof window !== "undefined") window.location.href = "/";
    return null;
  }

  if (profile.role !== "encargado") {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#1A1A1A]">
        <div className="bg-white rounded-2xl p-8 text-center shadow-xl max-w-sm mx-4">
          <p className="text-4xl mb-3">🚫</p>
          <p className="font-black text-gray-800">Acceso restringido</p>
          <p className="text-sm text-gray-500 mt-1 mb-4">Esta app es solo para Encargados.</p>
          <button onClick={logout}
            className="w-full py-2.5 bg-[#1E8C3A] text-white rounded-xl font-bold text-sm">
            Salir
          </button>
        </div>
      </div>
    );
  }

  return (
    <>
      <PWAServiceWorker scope="/app-encargado" />
      <EncargadoDashboard />
    </>
  );
}
