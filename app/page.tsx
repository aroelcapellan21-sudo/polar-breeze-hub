"use client";

import { useEffect } from "react";
import { useAuth } from "@/lib/auth-context";
import LoginForm from "@/components/LoginForm";
import AdminDashboard from "@/components/AdminDashboard";

/** Cada rol tiene su propia ruta. El Hub Admin (/) es exclusivo del admin. */
const RUTA_POR_ROL: Partial<Record<string, string>> = {
  despachador: "/app-despachador",
  encargado:   "/app-encargado",
  chofer:      "/app-chofer",
};

function Spinner({ mensaje }: { mensaje: string }) {
  return (
    <div
      className="min-h-screen flex items-center justify-center"
      style={{ background: "linear-gradient(90deg, rgba(245,200,0,0.55) 0% 33.33%, rgba(212,43,43,0.55) 33.33% 66.66%, rgba(30,140,58,0.55) 66.66% 100%), #1A1A1A" }}
    >
      <div className="text-center text-white">
        <div className="w-16 h-16 border-4 border-white/30 border-t-[#F5C800] rounded-full animate-spin mx-auto mb-4" />
        <div
          className="w-10 h-10 rounded-xl mx-auto mb-3 flex items-center justify-center shadow-lg"
          style={{ background: "linear-gradient(135deg, #F5C800 33%, #D42B2B 33% 66%, #1E8C3A 66%)" }}
        >
          <span className="text-lg">🧊</span>
        </div>
        <p className="text-lg font-black">Polar Breeze Hub</p>
        <p className="text-white/60 text-sm">{mensaje}</p>
      </div>
    </div>
  );
}

export default function Home() {
  const { user, profile, loading } = useAuth();

  // Roles no-admin: redirigir a su ruta propia
  useEffect(() => {
    if (!loading && user && profile) {
      const ruta = RUTA_POR_ROL[profile.role];
      if (ruta) window.location.replace(ruta);
    }
  }, [loading, user, profile]);

  if (loading) return <Spinner mensaje="Cargando..." />;

  if (!user || !profile) return <LoginForm />;

  // Admin: Hub Admin en "/"
  if (profile.role === "admin") return <AdminDashboard />;

  // Otros roles: el useEffect ya disparó la redirección; mostrar spinner
  if (RUTA_POR_ROL[profile.role]) return <Spinner mensaje="Redirigiendo..." />;

  // Rol desconocido
  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-100">
      <div className="bg-white rounded-xl p-8 text-center shadow">
        <p className="text-gray-600">Rol no reconocido: <strong>{profile.role}</strong></p>
        <p className="text-sm text-gray-400 mt-2">Contacta al administrador del sistema.</p>
      </div>
    </div>
  );
}
