"use client";

import { useAuth } from "@/lib/auth-context";
import LoginForm from "@/components/LoginForm";
import AdminDashboard from "@/components/AdminDashboard";
import DespachadorDashboard from "@/components/DespachadorDashboard";
import ChoferDashboard from "@/components/ChoferDashboard";

export default function Home() {
  const { user, profile, loading } = useAuth();

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-blue-900 to-cyan-700 flex items-center justify-center">
        <div className="text-center text-white">
          <div className="w-16 h-16 border-4 border-white/30 border-t-white rounded-full animate-spin mx-auto mb-4"></div>
          <p className="text-lg font-medium">Polar Breeze Hub</p>
          <p className="text-blue-200 text-sm">Cargando...</p>
        </div>
      </div>
    );
  }

  if (!user || !profile) {
    return <LoginForm />;
  }

  if (profile.role === "admin") return <AdminDashboard />;
  if (profile.role === "despachador") return <DespachadorDashboard />;
  if (profile.role === "chofer") return <ChoferDashboard />;

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-100">
      <div className="bg-white rounded-xl p-8 text-center shadow">
        <p className="text-gray-600">Rol no reconocido: <strong>{profile.role}</strong></p>
        <p className="text-sm text-gray-400 mt-2">Contacta al administrador del sistema.</p>
      </div>
    </div>
  );
}
