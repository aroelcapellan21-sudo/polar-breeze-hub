"use client";

import { useState } from "react";
import { useAuth } from "@/lib/auth-context";
import { UserRole } from "@/lib/types";

const ROLES = [
  {
    key: "admin" as UserRole,
    label: "ADMIN",
    icon: "👑",
    hint: "Panel completo del sistema",
    email: "admin@polarbreeze.com",
    border: "border-purple-400 hover:border-purple-500",
    active: "border-purple-600 bg-purple-50",
    text: "text-purple-700",
    ring: "focus:ring-purple-400",
    btn: "from-purple-600 to-purple-800",
  },
  {
    key: "despachador" as UserRole,
    label: "DESPACHADOR",
    icon: "🚛",
    hint: "SPIKINSCAN · FACTURASCAN",
    email: "despachador@polarbreeze.com",
    border: "border-blue-400 hover:border-blue-500",
    active: "border-blue-600 bg-blue-50",
    text: "text-blue-700",
    ring: "focus:ring-blue-400",
    btn: "from-blue-600 to-blue-800",
  },
  {
    key: "chofer" as UserRole,
    label: "CHOFER",
    icon: "📦",
    hint: "IMBENTARIO",
    email: "",
    border: "border-cyan-400 hover:border-cyan-500",
    active: "border-cyan-600 bg-cyan-50",
    text: "text-cyan-700",
    ring: "focus:ring-cyan-400",
    btn: "from-cyan-600 to-teal-700",
  },
] as const;

export default function LoginForm() {
  const { login } = useAuth();
  const [selectedRole, setSelectedRole] = useState<UserRole | null>(null);
  const [credential, setCredential] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const roleConfig = ROLES.find((r) => r.key === selectedRole) ?? null;
  const isChofer = selectedRole === "chofer";

  const handleRoleSelect = (role: UserRole) => {
    setSelectedRole(role);
    setCredential("");
    setError("");
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedRole || !roleConfig) return;
    setError("");
    setLoading(true);
    try {
      const email = isChofer
        ? `${credential.trim()}@chofer.polarbreeze.com`
        : roleConfig.email;
      // Chofer passwords are stored padded to ≥6 chars (Firebase Auth minimum)
      const password = isChofer ? credential.trim().padStart(6, "0") : credential;
      await login(email, password);
    } catch {
      const msg = isChofer
        ? "Ficha no reconocida. Verifica el número."
        : "Contraseña incorrecta. Intenta de nuevo.";
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-blue-950 to-cyan-900 flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        {/* Logo */}
        <div className="text-center mb-8">
          <div className="w-20 h-20 bg-gradient-to-br from-blue-400 to-cyan-400 rounded-2xl flex items-center justify-center mx-auto mb-4 shadow-xl shadow-blue-900/50">
            <span className="text-white text-3xl font-black tracking-tight">PB</span>
          </div>
          <h1 className="text-white text-2xl font-bold">Polar Breeze Hub</h1>
          <p className="text-blue-300 text-sm mt-1">¿Quién eres?</p>
        </div>

        <div className="bg-white rounded-2xl shadow-2xl shadow-black/30 p-6">
          {/* Role buttons — mismo tamaño, efecto punch */}
          <div className="space-y-3 mb-6">
            {ROLES.map((role) => (
              <button
                key={role.key}
                type="button"
                onClick={() => handleRoleSelect(role.key)}
                className={`w-full h-[72px] flex items-center gap-4 px-4 rounded-xl border-2
                  transition-all duration-100 text-left
                  active:scale-95 active:brightness-95
                  ${selectedRole === role.key
                    ? role.active + " " + role.border.replace("hover:", "")
                    : "border-gray-200 hover:border-gray-300 bg-white"
                  }`}
              >
                <span className="text-3xl leading-none flex-shrink-0">{role.icon}</span>
                <div className="flex-1">
                  <p className={`font-bold text-base tracking-wide ${selectedRole === role.key ? role.text : "text-gray-700"}`}>
                    {role.label}
                  </p>
                  <p className="text-xs text-gray-400">{role.hint}</p>
                </div>
                {selectedRole === role.key && (
                  <span className={`text-lg ${role.text} flex-shrink-0`}>✓</span>
                )}
              </button>
            ))}
          </div>

          {/* Password / Ficha field */}
          {selectedRole && (
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className={`block text-sm font-semibold mb-2 ${roleConfig?.text}`}>
                  {isChofer ? "🪪 Número de Ficha" : "🔑 Contraseña"}
                </label>
                <input
                  type={isChofer ? "text" : "password"}
                  value={credential}
                  onChange={(e) => setCredential(e.target.value)}
                  required
                  autoFocus
                  minLength={3}
                  placeholder={isChofer ? "Ej: 0042" : "••••••••"}
                  className={`w-full px-4 py-3 border-2 border-gray-200 rounded-xl outline-none text-gray-800 text-base transition
                    focus:ring-2 focus:border-transparent ${roleConfig?.ring}`}
                />
                {isChofer && (
                  <p className="text-xs text-gray-400 mt-1.5">
                    Usa el número de ficha que te asignó el admin. Mínimo 3 dígitos.
                  </p>
                )}
              </div>

              {error && (
                <div className="bg-red-50 border border-red-200 text-red-600 text-sm px-4 py-2.5 rounded-lg">
                  {error}
                </div>
              )}

              <button
                type="submit"
                disabled={loading || !credential || credential.length < 3}
                className={`w-full bg-gradient-to-r ${roleConfig?.btn} text-white py-3.5 rounded-xl font-bold text-base
                  hover:opacity-90 active:scale-95 transition-all duration-100 disabled:opacity-50 shadow-md`}
              >
                {loading ? "Entrando..." : `Entrar como ${roleConfig?.label}`}
              </button>

              <button
                type="button"
                onClick={() => { setSelectedRole(null); setCredential(""); setError(""); }}
                className="w-full text-sm text-gray-400 hover:text-gray-600 active:scale-95
                  transition-all duration-100 py-1"
              >
                ← Cambiar rol
              </button>
            </form>
          )}
        </div>

        <p className="text-center text-blue-400/60 text-xs mt-6">
          Polar Breeze · Sistema interno
        </p>
      </div>
    </div>
  );
}
