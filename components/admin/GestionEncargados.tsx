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

async function authSignUp(email: string, password: string) {
  const r = await fetch(`${AUTH_URL}:signUp?key=${API_KEY}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password, returnSecureToken: true }),
  });
  return r.json() as Promise<{ localId?: string; error?: { message: string } }>;
}

export default function GestionEncargados() {
  const [encargados, setEncargados] = useState<UserProfile[]>([]);
  const [form, setForm] = useState({ nombre: "", email: "", password: "" });
  const [creating, setCreating] = useState(false);
  const [msg,      setMsg]      = useState<{ type: "ok" | "err"; text: string } | null>(null);

  useEffect(() => {
    const q = query(collection(db, "usuarios"), where("role", "==", "encargado"));
    return onSnapshot(q, (snap) => {
      setEncargados(
        snap.docs.map(d => ({
          ...d.data(),
          createdAt: d.data().createdAt?.toDate?.() ?? new Date(),
        } as UserProfile))
      );
    });
  }, []);

  const flash = (type: "ok" | "err", text: string) => {
    setMsg({ type, text });
    setTimeout(() => setMsg(null), 4000);
  };

  async function crear() {
    const { nombre, email, password } = form;
    if (!nombre.trim() || !email.trim() || password.length < 6) {
      flash("err", "Completa nombre, email y contraseña (mín. 6 caracteres).");
      return;
    }
    setCreating(true);
    try {
      const res = await authSignUp(email.trim(), password);
      if (res.error) { flash("err", res.error.message); return; }
      const uid = res.localId!;
      await setDoc(doc(db, "usuarios", uid), {
        uid,
        email:  email.trim(),
        role:   "encargado",
        nombre: nombre.trim(),
        activo: true,
        createdAt: Timestamp.now(),
      });
      setForm({ nombre: "", email: "", password: "" });
      flash("ok", `Encargado "${nombre.trim()}" creado.`);
    } catch (e) {
      flash("err", e instanceof Error ? e.message : "Error al crear.");
    } finally {
      setCreating(false);
    }
  }

  async function toggleActivo(enc: UserProfile) {
    try {
      await updateDoc(doc(db, "usuarios", enc.uid), { activo: !enc.activo });
    } catch { /* non-critical */ }
  }

  const activos = encargados.filter(e => e.activo !== false);
  const bajas   = encargados.filter(e => e.activo === false);

  return (
    <div className="space-y-4">

      {/* ── Formulario crear ── */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
        <div className="px-4 py-3 bg-gradient-to-r from-emerald-600 to-emerald-800">
          <h2 className="text-white font-bold text-sm">+ Crear encargado de almacén</h2>
          <p className="text-emerald-200 text-xs mt-0.5">
            Accede al registro de lotes · sin datos de choferes ni precios
          </p>
        </div>
        <div className="p-4 space-y-3">
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Nombre completo</label>
            <input
              value={form.nombre}
              onChange={(e) => setForm(p => ({ ...p, nombre: e.target.value }))}
              placeholder="Nombre del encargado"
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm
                focus:outline-none focus:ring-2 focus:ring-emerald-400"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Email</label>
            <input
              type="email"
              value={form.email}
              onChange={(e) => setForm(p => ({ ...p, email: e.target.value }))}
              placeholder="correo@empresa.com"
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm
                focus:outline-none focus:ring-2 focus:ring-emerald-400"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Contraseña inicial</label>
            <input
              type="password"
              value={form.password}
              onChange={(e) => setForm(p => ({ ...p, password: e.target.value }))}
              onKeyDown={(e) => e.key === "Enter" && crear()}
              placeholder="Mínimo 6 caracteres"
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm
                focus:outline-none focus:ring-2 focus:ring-emerald-400"
            />
          </div>
          {msg && (
            <div className={`text-sm px-3 py-2 rounded-lg ${
              msg.type === "ok"
                ? "bg-green-50 text-green-700 border border-green-200"
                : "bg-red-50 text-red-600 border border-red-200"
            }`}>
              {msg.text}
            </div>
          )}
          <button
            onClick={crear} disabled={creating}
            className="w-full bg-gradient-to-r from-emerald-600 to-emerald-800 hover:from-emerald-500
              hover:to-emerald-700 text-white font-bold py-2.5 rounded-xl text-sm transition-all
              duration-100 active:scale-95 disabled:opacity-60"
          >
            {creating ? "Creando…" : "Crear encargado"}
          </button>
        </div>
      </div>

      {/* ── Lista: activos ── */}
      {activos.length > 0 && (
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-100 flex items-center gap-2">
            <span className="font-semibold text-gray-800 text-sm">Encargados activos</span>
            <span className="text-xs bg-emerald-100 text-emerald-700 border border-emerald-200
              px-2 py-0.5 rounded-full font-medium">
              {activos.length}
            </span>
          </div>
          <div className="divide-y divide-gray-50">
            {activos.map(enc => (
              <div key={enc.uid} className="px-4 py-3 flex items-center gap-3">
                <div className="w-9 h-9 rounded-full bg-emerald-100 flex items-center justify-center
                  text-emerald-700 font-bold text-sm flex-shrink-0">
                  {enc.nombre.charAt(0).toUpperCase()}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-gray-800 truncate">{enc.nombre}</p>
                  <p className="text-xs text-gray-400 truncate">{enc.email}</p>
                </div>
                <button
                  onClick={() => toggleActivo(enc)}
                  className="text-xs px-2.5 py-1.5 rounded-lg border border-gray-200 text-gray-600
                    hover:bg-red-50 hover:border-red-200 hover:text-red-700 active:scale-95
                    transition-all duration-100 whitespace-nowrap"
                >
                  Dar baja
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Lista: dados de baja ── */}
      {bajas.length > 0 && (
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-100 flex items-center gap-2">
            <span className="font-semibold text-gray-500 text-sm">Dados de baja</span>
            <span className="text-xs bg-gray-100 text-gray-500 border border-gray-200
              px-2 py-0.5 rounded-full font-medium">
              {bajas.length}
            </span>
          </div>
          <div className="divide-y divide-gray-50">
            {bajas.map(enc => (
              <div key={enc.uid} className="px-4 py-3 flex items-center gap-3 opacity-60">
                <div className="w-9 h-9 rounded-full bg-gray-100 flex items-center justify-center
                  text-gray-500 font-bold text-sm flex-shrink-0">
                  {enc.nombre.charAt(0).toUpperCase()}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-gray-600 truncate">{enc.nombre}</p>
                  <p className="text-xs text-gray-400 truncate">{enc.email}</p>
                </div>
                <button
                  onClick={() => toggleActivo(enc)}
                  className="text-xs px-2.5 py-1.5 rounded-lg border border-emerald-200 text-emerald-700
                    hover:bg-emerald-50 active:scale-95 transition-all duration-100 whitespace-nowrap opacity-100"
                >
                  Activar
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {encargados.length === 0 && (
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-8 text-center">
          <p className="text-3xl mb-2">🏭</p>
          <p className="text-sm text-gray-500 font-medium">Sin encargados registrados aún.</p>
          <p className="text-xs text-gray-400 mt-1">
            Usa el formulario de arriba para crear el primero.
          </p>
        </div>
      )}
    </div>
  );
}
