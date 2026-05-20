"use client";

import { useState, useEffect } from "react";
import { useAuth } from "@/lib/auth-context";
import { UserRole } from "@/lib/types";

const IS_DEV = process.env.NODE_ENV === "development";

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
  {
    key: "encargado" as UserRole,
    label: "ENCARGADO",
    icon: "🏭",
    hint: "Almacén · registro de lotes",
    email: "",
    border: "border-emerald-400 hover:border-emerald-500",
    active: "border-emerald-600 bg-emerald-50",
    text: "text-emerald-700",
    ring: "focus:ring-emerald-400",
    btn: "from-emerald-600 to-emerald-800",
  },
] as const;

export default function LoginForm() {
  const { login, devLogin } = useAuth();
  const [selectedRole, setSelectedRole] = useState<UserRole | null>(null);
  const [credential,    setCredential]    = useState("");
  const [credentialPwd, setCredentialPwd] = useState("");
  const [error,  setError]  = useState("");
  const [loading, setLoading] = useState(false);
  const [showNormalForm, setShowNormalForm] = useState(false);

  // Auto-fill ficha si viene ?ficha= en la URL (desde QR de factura)
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const ficha  = params.get("ficha");
    if (ficha) {
      setSelectedRole("chofer");
      setCredential(ficha);
    }
  }, []);

  const roleConfig  = ROLES.find((r) => r.key === selectedRole) ?? null;
  const isChofer    = selectedRole === "chofer";
  const isEncargado = selectedRole === "encargado";

  const handleRoleSelect = (role: UserRole) => {
    setSelectedRole(role);
    setCredential("");
    setCredentialPwd("");
    setError("");
  };

  const handleDevLogin = (role: UserRole) => {
    if (devLogin) {
      devLogin(role);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedRole || !roleConfig) return;
    setError("");
    setLoading(true);
    try {
      const email = isChofer
        ? `${credential.trim()}@chofer.polarbreeze.com`
        : isEncargado
        ? credential.trim()
        : roleConfig.email;
      const password = isChofer
        ? credential.trim().padStart(6, "0")
        : isEncargado
        ? credentialPwd
        : credential;
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

          {/* ── MODO DESARROLLO ─────────────────────────────── */}
          {IS_DEV && !showNormalForm && (
            <div className="mb-5">
              <div className="flex items-center gap-2 mb-3">
                <span className="flex-1 h-px bg-orange-200" />
                <span className="text-xs font-bold text-orange-500 tracking-widest uppercase">
                  🔧 Modo desarrollo
                </span>
                <span className="flex-1 h-px bg-orange-200" />
              </div>
              <div className="space-y-2">
                {ROLES.map((role) => (
                  <button
                    key={role.key}
                    type="button"
                    disabled={loading}
                    onClick={() => handleDevLogin(role.key)}
                    className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl border
                      bg-orange-50 border-orange-200 hover:bg-orange-100 active:scale-95
                      transition-all duration-100 text-left disabled:opacity-50`}
                  >
                    <span className="text-2xl leading-none flex-shrink-0">{role.icon}</span>
                    <div className="flex-1">
                      <p className="text-sm font-bold text-orange-800">{role.label}</p>
                      <p className="text-xs text-orange-500">{role.hint}</p>
                    </div>
                    <span className="text-orange-400 text-sm font-bold flex-shrink-0">⚡</span>
                  </button>
                ))}
              </div>
              {error && (
                <div className="mt-2 bg-red-50 border border-red-200 text-red-600 text-xs px-3 py-2 rounded-lg">
                  {error}
                </div>
              )}
              <button
                type="button"
                onClick={() => setShowNormalForm(true)}
                className="w-full mt-3 text-xs text-gray-400 hover:text-gray-600 active:scale-95 transition-all py-1"
              >
                Usar formulario completo →
              </button>
            </div>
          )}

          {/* ── Formulario normal (siempre en prod, toggle en dev) ── */}
          {(!IS_DEV || showNormalForm) && <>

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
              {isEncargado ? (
                <div className="space-y-3">
                  <div>
                    <label className={`block text-sm font-semibold mb-2 ${roleConfig?.text}`}>
                      📧 Email
                    </label>
                    <input
                      type="email"
                      value={credential}
                      onChange={(e) => setCredential(e.target.value)}
                      required
                      autoFocus
                      placeholder="tu@correo.com"
                      className={`w-full px-4 py-3 border-2 border-gray-200 rounded-xl outline-none
                        text-gray-800 text-base transition focus:ring-2 focus:border-transparent ${roleConfig?.ring}`}
                    />
                  </div>
                  <div>
                    <label className={`block text-sm font-semibold mb-2 ${roleConfig?.text}`}>
                      🔑 Contraseña
                    </label>
                    <input
                      type="password"
                      value={credentialPwd}
                      onChange={(e) => setCredentialPwd(e.target.value)}
                      required
                      placeholder="••••••••"
                      className={`w-full px-4 py-3 border-2 border-gray-200 rounded-xl outline-none
                        text-gray-800 text-base transition focus:ring-2 focus:border-transparent ${roleConfig?.ring}`}
                    />
                  </div>
                </div>
              ) : (
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
              )}

              {error && (
                <div className="bg-red-50 border border-red-200 text-red-600 text-sm px-4 py-2.5 rounded-lg">
                  {error}
                </div>
              )}

              <button
                type="submit"
                disabled={loading || (isEncargado
                  ? !credential || !credentialPwd || credentialPwd.length < 3
                  : !credential || credential.length < 3)}
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

          {/* Volver al panel dev */}
          {IS_DEV && showNormalForm && (
            <button
              type="button"
              onClick={() => { setShowNormalForm(false); setSelectedRole(null); setCredential(""); setError(""); }}
              className="w-full mt-3 text-xs text-orange-400 hover:text-orange-600 active:scale-95 transition-all py-1"
            >
              ← Volver a modo desarrollo
            </button>
          )}

          </> /* fin formulario normal */}
        </div>

        <p className="text-center text-blue-400/60 text-xs mt-6">
          Polar Breeze · Sistema interno
        </p>
      </div>
    </div>
  );
}
