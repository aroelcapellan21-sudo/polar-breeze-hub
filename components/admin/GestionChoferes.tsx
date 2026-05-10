"use client";

import { useState, useEffect } from "react";
import {
  collection, query, where, onSnapshot,
  doc, setDoc, updateDoc, Timestamp,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import { UserProfile } from "@/lib/types";

const API_KEY  = process.env.NEXT_PUBLIC_FIREBASE_API_KEY!;
const AUTH_URL = "https://identitytoolkit.googleapis.com/v1/accounts";

interface Props {
  onVerDetalle: (chofer: UserProfile) => void;
}

// ─── Firebase Auth REST helpers ───────────────────────────────────────────────

async function authSignUp(email: string, password: string) {
  const r = await fetch(`${AUTH_URL}:signUp?key=${API_KEY}`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password, returnSecureToken: true }),
  });
  return r.json() as Promise<{ localId?: string; idToken?: string; error?: { message: string } }>;
}

async function authSignIn(email: string, password: string) {
  const r = await fetch(`${AUTH_URL}:signInWithPassword?key=${API_KEY}`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password, returnSecureToken: true }),
  });
  return r.json() as Promise<{ localId?: string; idToken?: string; error?: { message: string } }>;
}

async function authUpdatePassword(idToken: string, newPassword: string) {
  const r = await fetch(`${AUTH_URL}:update?key=${API_KEY}`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ idToken, password: newPassword, returnSecureToken: true }),
  });
  return r.json();
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function GestionChoferes({ onVerDetalle }: Props) {
  const [choferes, setChoferes] = useState<UserProfile[]>([]);
  const [form, setForm]         = useState({ nombre: "", ficha: "" });
  const [creating, setCreating] = useState(false);
  const [msg, setMsg]           = useState<{ type: "ok" | "err"; text: string } | null>(null);
  const [passwdModal, setPasswdModal] = useState<UserProfile | null>(null);
  const [nuevaFicha, setNuevaFicha]   = useState("");
  const [changingPw, setChangingPw]   = useState(false);
  const [filter, setFilter] = useState<"todos" | "activos" | "baja">("todos");

  useEffect(() => {
    const q = query(collection(db, "usuarios"), where("role", "==", "chofer"));
    return onSnapshot(q, (snap) => {
      setChoferes(snap.docs.map((d) => d.data() as UserProfile));
    });
  }, []);

  const flash = (type: "ok" | "err", text: string) => {
    setMsg({ type, text });
    setTimeout(() => setMsg(null), 4000);
  };

  // ── Crear chofer ─────────────────────────────────────────────────────────────
  const handleCrear = async (e: React.FormEvent) => {
    e.preventDefault();
    const { nombre, ficha } = form;
    if (!nombre.trim() || !ficha.trim()) return;
    if (ficha.trim().length < 3) { flash("err", "La ficha debe tener mínimo 3 caracteres"); return; }
    setCreating(true);
    try {
      const email    = `${ficha.trim()}@chofer.polarbreeze.com`;
      const password = ficha.trim();

      let data = await authSignUp(email, password);

      if (data.error?.message === "EMAIL_EXISTS") {
        flash("err", `La ficha ${ficha} ya está registrada.`);
        setCreating(false);
        return;
      }
      if (data.error) throw new Error(data.error.message);

      const uid = data.localId!;
      await setDoc(doc(db, "usuarios", uid), {
        uid, email, nombre: nombre.trim(), ficha: ficha.trim(),
        role: "chofer", activo: true, createdAt: Timestamp.now(),
      });

      setForm({ nombre: "", ficha: "" });
      flash("ok", `Chofer ${nombre} creado — ficha ${ficha}`);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Error desconocido";
      flash("err", message);
    } finally {
      setCreating(false);
    }
  };

  // ── Dar de baja / reactivar ──────────────────────────────────────────────────
  const toggleActivo = async (chofer: UserProfile) => {
    const nuevoEstado = !(chofer.activo ?? true);
    await updateDoc(doc(db, "usuarios", chofer.uid), { activo: nuevoEstado });
    flash("ok", `${chofer.nombre} ${nuevoEstado ? "reactivado" : "dado de baja"}`);
  };

  // ── Cambiar contraseña/ficha ─────────────────────────────────────────────────
  const handleCambiarPassword = async () => {
    if (!passwdModal || !nuevaFicha.trim()) return;
    if (nuevaFicha.trim().length < 3) { flash("err", "Mínimo 3 caracteres"); return; }
    setChangingPw(true);
    try {
      const currentFicha = passwdModal.ficha ?? "";
      const email        = passwdModal.email;

      const signInData = await authSignIn(email, currentFicha);
      if (signInData.error) throw new Error(`No se pudo autenticar: ${signInData.error.message}`);

      await authUpdatePassword(signInData.idToken!, nuevaFicha.trim());
      await updateDoc(doc(db, "usuarios", passwdModal.uid), { ficha: nuevaFicha.trim() });

      flash("ok", `Ficha/contraseña de ${passwdModal.nombre} actualizada`);
      setPasswdModal(null);
      setNuevaFicha("");
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Error desconocido";
      flash("err", message);
    } finally {
      setChangingPw(false);
    }
  };

  // ── Filtrado ─────────────────────────────────────────────────────────────────
  const visibles = choferes.filter((c) => {
    if (filter === "activos") return c.activo !== false;
    if (filter === "baja")    return c.activo === false;
    return true;
  });

  return (
    <div className="grid lg:grid-cols-3 gap-6">
      {/* ── Formulario crear chofer ── */}
      <div className="bg-white rounded-xl shadow-sm p-5">
        <h2 className="text-base font-bold text-purple-700 mb-4">➕ Crear Chofer</h2>
        <form onSubmit={handleCrear} className="space-y-3">
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Nombre completo</label>
            <input
              value={form.nombre}
              onChange={(e) => setForm((p) => ({ ...p, nombre: e.target.value }))}
              required placeholder="Ej: Juan Pérez"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm text-gray-800 outline-none focus:ring-2 focus:ring-purple-400"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">
              Número de ficha <span className="text-gray-400">(será su contraseña)</span>
            </label>
            <input
              value={form.ficha}
              onChange={(e) => setForm((p) => ({ ...p, ficha: e.target.value }))}
              required placeholder="Ej: 0042"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm text-gray-800 outline-none focus:ring-2 focus:ring-purple-400"
            />
          </div>

          {msg && (
            <div className={`text-xs px-3 py-2 rounded-lg ${
              msg.type === "ok"
                ? "bg-green-50 text-green-700 border border-green-200"
                : "bg-red-50 text-red-700 border border-red-200"
            }`}>
              {msg.text}
            </div>
          )}

          <button
            type="submit" disabled={creating}
            className="w-full bg-purple-600 hover:bg-purple-700 active:scale-95 text-white py-2.5 rounded-lg text-sm font-semibold transition-all duration-100 disabled:opacity-60"
          >
            {creating ? "Creando..." : "Crear Chofer"}
          </button>
        </form>

        <div className="mt-5 p-3 bg-gray-50 rounded-lg text-xs text-gray-500 space-y-1">
          <p className="font-medium text-gray-600">Acceso del chofer:</p>
          <p>• Selecciona rol 📦 CHOFER</p>
          <p>• Ingresa su número de ficha</p>
          <p>• Contraseña = ficha asignada</p>
        </div>
      </div>

      {/* ── Lista de choferes ── */}
      <div className="lg:col-span-2 bg-white rounded-xl shadow-sm p-5">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-base font-bold text-purple-700">
            👥 Choferes ({choferes.length})
          </h2>
          <div className="flex gap-1.5 text-xs">
            {(["todos", "activos", "baja"] as const).map((f) => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={`px-3 py-1 rounded-full transition capitalize ${
                  filter === f
                    ? "bg-purple-600 text-white"
                    : "bg-gray-100 text-gray-600 hover:bg-gray-200"
                }`}
              >
                {f}
              </button>
            ))}
          </div>
        </div>

        {visibles.length === 0 ? (
          <div className="text-center py-12 text-gray-400 text-sm">
            Sin choferes registrados
          </div>
        ) : (
          <div className="space-y-2 max-h-[500px] overflow-y-auto pr-1">
            {visibles.map((c) => {
              const activo = c.activo !== false;
              return (
                <div key={c.uid}
                  className={`flex items-center gap-3 p-3 rounded-lg border transition ${
                    activo ? "border-gray-100 bg-white" : "border-gray-100 bg-gray-50 opacity-70"
                  }`}
                >
                  {/* Avatar */}
                  <div className={`w-10 h-10 rounded-full flex items-center justify-center text-white font-bold text-sm flex-shrink-0 ${
                    activo ? "bg-cyan-500" : "bg-gray-400"
                  }`}>
                    {c.nombre.charAt(0).toUpperCase()}
                  </div>

                  {/* Info */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="font-semibold text-sm text-gray-800 truncate">{c.nombre}</p>
                      <span className={`text-xs px-1.5 py-0.5 rounded-full font-medium ${
                        activo
                          ? "bg-green-100 text-green-700"
                          : "bg-gray-200 text-gray-500"
                      }`}>
                        {activo ? "✅ activo" : "🔒 baja"}
                      </span>
                    </div>
                    <p className="text-xs text-gray-400">Ficha: {c.ficha ?? "—"}</p>
                  </div>

                  {/* Acciones */}
                  <div className="flex gap-1.5 flex-shrink-0">
                    <button
                      onClick={() => onVerDetalle(c)}
                      className="px-2.5 py-1.5 bg-blue-50 hover:bg-blue-100 text-blue-600 rounded-lg text-xs font-medium transition"
                    >
                      Ver
                    </button>
                    <button
                      onClick={() => { setPasswdModal(c); setNuevaFicha(""); }}
                      className="px-2.5 py-1.5 bg-yellow-50 hover:bg-yellow-100 text-yellow-700 rounded-lg text-xs font-medium transition"
                      title="Cambiar ficha/contraseña"
                    >
                      🔑
                    </button>
                    <button
                      onClick={() => toggleActivo(c)}
                      className={`px-2.5 py-1.5 rounded-lg text-xs font-medium transition ${
                        activo
                          ? "bg-red-50 hover:bg-red-100 text-red-600"
                          : "bg-green-50 hover:bg-green-100 text-green-600"
                      }`}
                    >
                      {activo ? "Dar baja" : "Reactivar"}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* ── Modal cambiar contraseña ── */}
      {passwdModal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6">
            <h3 className="font-bold text-gray-800 mb-1">🔑 Cambiar ficha</h3>
            <p className="text-sm text-gray-500 mb-4">{passwdModal.nombre} — ficha actual: <strong>{passwdModal.ficha}</strong></p>
            <input
              type="text"
              value={nuevaFicha}
              onChange={(e) => setNuevaFicha(e.target.value)}
              placeholder="Nueva ficha (mín. 3 caracteres)"
              minLength={3}
              className="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm text-gray-800 outline-none focus:ring-2 focus:ring-yellow-400 mb-1"
              autoFocus
            />
            <p className="text-xs text-gray-400 mb-4">Mínimo 3 caracteres</p>
            <div className="flex gap-2">
              <button
                onClick={() => setPasswdModal(null)}
                className="flex-1 py-2 rounded-lg border border-gray-200 text-sm text-gray-600 hover:bg-gray-50 transition"
              >
                Cancelar
              </button>
              <button
                onClick={handleCambiarPassword}
                disabled={changingPw || !nuevaFicha.trim()}
                className="flex-1 py-2 rounded-lg bg-yellow-500 hover:bg-yellow-600 text-white text-sm font-semibold transition disabled:opacity-60"
              >
                {changingPw ? "Actualizando..." : "Guardar"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
