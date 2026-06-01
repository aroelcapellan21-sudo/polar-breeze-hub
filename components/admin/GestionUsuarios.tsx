"use client";

import { useState, useEffect } from "react";
import PasswordInput from "@/components/shared/PasswordInput";
import {
  collection, onSnapshot, doc, updateDoc, setDoc,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import { UserProfile, UserRole } from "@/lib/types";

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

const ROLES: UserRole[] = ["admin", "despachador", "encargado", "chofer"];

const ROLE_META: Record<UserRole, { label: string; emoji: string; bg: string; text: string; border: string }> = {
  admin:       { label: "Admin",       emoji: "⚡", bg: "bg-red-50",     text: "text-red-700",     border: "border-red-200" },
  despachador: { label: "Despachador", emoji: "🚚", bg: "bg-blue-50",    text: "text-blue-700",    border: "border-blue-200" },
  encargado:   { label: "Encargado",   emoji: "🏭", bg: "bg-emerald-50", text: "text-emerald-700", border: "border-emerald-200" },
  chofer:      { label: "Chofer",      emoji: "🧑‍✈️", bg: "bg-yellow-50", text: "text-yellow-700",  border: "border-yellow-200" },
};

const FORM_INIT = { nombre: "", email: "", password: "", role: "chofer" as UserRole, ficha: "", telefono: "" };

type FiltroRol = UserRole | "todos";

export default function GestionUsuarios() {
  const [usuarios,    setUsuarios]    = useState<UserProfile[]>([]);
  const [filtroRol,   setFiltroRol]   = useState<FiltroRol>("todos");
  const [busqueda,    setBusqueda]    = useState("");
  const [showForm,    setShowForm]    = useState(false);
  const [form,        setForm]        = useState(FORM_INIT);
  const [creando,     setCreando]     = useState(false);
  const [editando,    setEditando]    = useState<UserProfile | null>(null);
  const [guardandoE,  setGuardandoE]  = useState(false);
  const [msg,         setMsg]         = useState<{ type: "ok" | "err"; text: string } | null>(null);

  useEffect(() => {
    const unsub = onSnapshot(collection(db, "usuarios"), (snap) => {
      const list = snap.docs.map(d => ({
        ...d.data(),
        createdAt: d.data().createdAt?.toDate?.() ?? new Date(),
      } as UserProfile));
      list.sort((a, b) => a.nombre.localeCompare(b.nombre, "es"));
      setUsuarios(list);
    });
    return unsub;
  }, []);

  const flash = (type: "ok" | "err", text: string) => {
    setMsg({ type, text });
    setTimeout(() => setMsg(null), 5000);
  };

  // Conteos por rol
  const conteos = ROLES.reduce((acc, r) => {
    acc[r] = usuarios.filter(u => u.role === r).length;
    return acc;
  }, {} as Record<UserRole, number>);

  const activos   = usuarios.filter(u => u.activo !== false).length;
  const inactivos = usuarios.length - activos;

  // Lista filtrada
  const filtrados = usuarios.filter(u => {
    if (filtroRol !== "todos" && u.role !== filtroRol) return false;
    if (busqueda.trim()) {
      const q = busqueda.toLowerCase();
      return (
        u.nombre.toLowerCase().includes(q) ||
        u.email.toLowerCase().includes(q) ||
        (u.ficha ?? "").includes(q)
      );
    }
    return true;
  });

  async function crear() {
    const { nombre, email, password, role, ficha, telefono } = form;
    if (!nombre.trim() || !email.trim() || password.length < 6) {
      flash("err", "Completa nombre, email y contraseña (mín. 6 caracteres).");
      return;
    }
    if (role === "chofer" && !ficha.trim()) {
      flash("err", "Los choferes requieren número de ficha.");
      return;
    }
    setCreando(true);
    try {
      const res = await authSignUp(email.trim(), password);
      if (res.error) {
        flash("err", res.error.message === "EMAIL_EXISTS"
          ? "Este correo ya está registrado."
          : res.error.message);
        return;
      }
      const uid = res.localId!;
      await setDoc(doc(db, "usuarios", uid), {
        uid,
        email:  email.trim(),
        nombre: nombre.trim(),
        role,
        activo: true,
        createdAt: new Date(),
        ...(ficha.trim()    ? { ficha:    ficha.trim()    } : {}),
        ...(telefono.trim() ? { telefono: telefono.trim() } : {}),
      });
      flash("ok", `✅ ${nombre.trim()} creado con rol ${ROLE_META[role].label}.`);
      setForm(FORM_INIT);
      setShowForm(false);
    } catch (e) {
      flash("err", e instanceof Error ? e.message : "Error al crear usuario.");
    } finally {
      setCreando(false);
    }
  }

  async function guardarEdicion() {
    if (!editando) return;
    setGuardandoE(true);
    try {
      await updateDoc(doc(db, "usuarios", editando.uid), {
        nombre: editando.nombre,
        role:   editando.role,
        ...(editando.ficha    ? { ficha:    editando.ficha    } : {}),
        ...(editando.telefono ? { telefono: editando.telefono } : {}),
      });
      flash("ok", `✅ ${editando.nombre} actualizado.`);
      setEditando(null);
    } catch {
      flash("err", "Error al guardar cambios.");
    } finally {
      setGuardandoE(false);
    }
  }

  async function toggleActivo(u: UserProfile) {
    try {
      await updateDoc(doc(db, "usuarios", u.uid), { activo: !(u.activo !== false) });
    } catch {
      flash("err", "Error al cambiar estado.");
    }
  }

  return (
    <div className="space-y-5">

      {/* ── Header ── */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-lg font-black text-gray-900">👤 Gestión de Usuarios</h2>
          <p className="text-xs text-gray-500 mt-0.5">
            {usuarios.length} usuarios · {activos} activos · {inactivos} inactivos
          </p>
        </div>
        <button
          onClick={() => { setShowForm(v => !v); setEditando(null); }}
          className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-bold
            bg-[#1A1A1A] text-white hover:bg-black active:scale-95 transition-all"
        >
          {showForm ? "✕ Cancelar" : "＋ Nuevo usuario"}
        </button>
      </div>

      {/* ── Estadísticas por rol ── */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {ROLES.map(r => {
          const m = ROLE_META[r];
          return (
            <button
              key={r}
              onClick={() => setFiltroRol(filtroRol === r ? "todos" : r)}
              className={`p-3 rounded-xl border-2 text-left transition-all active:scale-95 ${
                filtroRol === r
                  ? `${m.bg} ${m.border} ${m.text}`
                  : "bg-white border-gray-200 text-gray-700 hover:border-gray-300"
              }`}
            >
              <div className="text-xl mb-1">{m.emoji}</div>
              <div className="text-xl font-black">{conteos[r]}</div>
              <div className="text-xs font-semibold">{m.label}</div>
            </button>
          );
        })}
      </div>

      {/* ── Formulario crear usuario ── */}
      {showForm && (
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
          <div className="px-4 py-3 bg-[#1A1A1A] flex items-center gap-3">
            <span className="text-lg">➕</span>
            <div>
              <p className="text-white font-bold text-sm">Nuevo usuario</p>
              <p className="text-white/50 text-xs">Se crea en Firebase Auth y Firestore</p>
            </div>
          </div>
          <div className="p-4 space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Nombre completo *</label>
                <input
                  value={form.nombre}
                  onChange={(e) => setForm(f => ({ ...f, nombre: e.target.value }))}
                  placeholder="Juan Pérez"
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm
                    focus:outline-none focus:ring-2 focus:ring-[#F5C800]"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Correo electrónico *</label>
                <input
                  type="email"
                  value={form.email}
                  onChange={(e) => setForm(f => ({ ...f, email: e.target.value }))}
                  placeholder="usuario@correo.com"
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm
                    focus:outline-none focus:ring-2 focus:ring-[#F5C800]"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Contraseña * (mín. 6 caracteres)</label>
                <PasswordInput
                  value={form.password}
                  onChange={(e) => setForm(f => ({ ...f, password: e.target.value }))}
                  placeholder="••••••••"
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm
                    focus:outline-none focus:ring-2 focus:ring-[#F5C800]"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Rol *</label>
                <select
                  value={form.role}
                  onChange={(e) => setForm(f => ({ ...f, role: e.target.value as UserRole }))}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm
                    focus:outline-none focus:ring-2 focus:ring-[#F5C800] bg-white"
                >
                  {ROLES.map(r => (
                    <option key={r} value={r}>{ROLE_META[r].emoji} {ROLE_META[r].label}</option>
                  ))}
                </select>
              </div>
              {form.role === "chofer" && (
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Nº Ficha *</label>
                  <input
                    value={form.ficha}
                    onChange={(e) => setForm(f => ({ ...f, ficha: e.target.value }))}
                    placeholder="103"
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm
                      focus:outline-none focus:ring-2 focus:ring-[#F5C800]"
                  />
                </div>
              )}
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Teléfono (opcional)</label>
                <input
                  value={form.telefono}
                  onChange={(e) => setForm(f => ({ ...f, telefono: e.target.value }))}
                  placeholder="+1 809 000 0000"
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm
                    focus:outline-none focus:ring-2 focus:ring-[#F5C800]"
                />
              </div>
            </div>
            <button
              onClick={crear}
              disabled={creando}
              className="w-full py-3 rounded-xl bg-[#1E8C3A] text-white font-bold text-sm
                hover:bg-green-700 active:scale-95 transition-all disabled:opacity-60"
            >
              {creando ? "Creando usuario…" : "✅ Crear usuario"}
            </button>
          </div>
        </div>
      )}

      {/* ── Modal de edición ── */}
      {editando && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md">
            <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
              <p className="font-bold text-gray-900">✏️ Editar usuario</p>
              <button onClick={() => setEditando(null)} className="text-gray-400 hover:text-gray-600 text-xl leading-none">×</button>
            </div>
            <div className="p-5 space-y-3">
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Nombre</label>
                <input
                  value={editando.nombre}
                  onChange={(e) => setEditando(u => u ? { ...u, nombre: e.target.value } : null)}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm
                    focus:outline-none focus:ring-2 focus:ring-[#F5C800]"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Correo (no editable)</label>
                <input
                  value={editando.email}
                  disabled
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm bg-gray-50 text-gray-400"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Rol</label>
                <select
                  value={editando.role}
                  onChange={(e) => setEditando(u => u ? { ...u, role: e.target.value as UserRole } : null)}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm
                    focus:outline-none focus:ring-2 focus:ring-[#F5C800] bg-white"
                >
                  {ROLES.map(r => (
                    <option key={r} value={r}>{ROLE_META[r].emoji} {ROLE_META[r].label}</option>
                  ))}
                </select>
              </div>
              {editando.role === "chofer" && (
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Nº Ficha</label>
                  <input
                    value={editando.ficha ?? ""}
                    onChange={(e) => setEditando(u => u ? { ...u, ficha: e.target.value } : null)}
                    placeholder="103"
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm
                      focus:outline-none focus:ring-2 focus:ring-[#F5C800]"
                  />
                </div>
              )}
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Teléfono</label>
                <input
                  value={editando.telefono ?? ""}
                  onChange={(e) => setEditando(u => u ? { ...u, telefono: e.target.value } : null)}
                  placeholder="+1 809 000 0000"
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm
                    focus:outline-none focus:ring-2 focus:ring-[#F5C800]"
                />
              </div>
              <div className="flex gap-3 pt-2">
                <button
                  onClick={() => setEditando(null)}
                  className="flex-1 py-2.5 rounded-xl border border-gray-200 text-sm text-gray-600
                    hover:bg-gray-50 active:scale-95 transition-all"
                >
                  Cancelar
                </button>
                <button
                  onClick={guardarEdicion}
                  disabled={guardandoE}
                  className="flex-1 py-2.5 rounded-xl bg-[#1E8C3A] text-white text-sm font-bold
                    hover:bg-green-700 active:scale-95 transition-all disabled:opacity-60"
                >
                  {guardandoE ? "Guardando…" : "💾 Guardar"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Mensaje de estado ── */}
      {msg && (
        <div className={`text-sm px-4 py-3 rounded-xl border font-medium ${
          msg.type === "ok"
            ? "bg-green-50 text-green-700 border-green-200"
            : "bg-red-50 text-red-600 border-red-200"
        }`}>
          {msg.text}
        </div>
      )}

      {/* ── Buscador + filtros ── */}
      <div className="flex gap-3 flex-wrap items-center">
        <div className="flex-1 min-w-0">
          <input
            type="search"
            value={busqueda}
            onChange={(e) => setBusqueda(e.target.value)}
            placeholder="🔍 Buscar por nombre, correo o ficha…"
            className="w-full border border-gray-300 rounded-xl px-4 py-2.5 text-sm
              focus:outline-none focus:ring-2 focus:ring-[#F5C800] bg-white"
          />
        </div>
        {filtroRol !== "todos" && (
          <button
            onClick={() => setFiltroRol("todos")}
            className="text-xs px-3 py-2 rounded-lg bg-gray-100 text-gray-600
              hover:bg-gray-200 transition flex items-center gap-1"
          >
            {ROLE_META[filtroRol].emoji} {ROLE_META[filtroRol].label} ×
          </button>
        )}
      </div>

      {/* ── Lista de usuarios ── */}
      <div className="space-y-3">
        {filtrados.length === 0 && (
          <div className="text-center py-12 text-gray-400">
            <div className="text-4xl mb-3">👤</div>
            <p className="font-semibold">Sin usuarios que mostrar</p>
            {busqueda && <p className="text-xs mt-1">No hay resultados para &ldquo;{busqueda}&rdquo;</p>}
          </div>
        )}

        {filtrados.map(u => {
          const m = ROLE_META[u.role];
          const esActivo = u.activo !== false;
          return (
            <div
              key={u.uid}
              className={`bg-white rounded-xl border shadow-sm overflow-hidden transition-all ${
                esActivo ? "border-gray-200" : "border-gray-100 opacity-60"
              }`}
            >
              <div className="px-4 py-3 flex items-center gap-3">
                {/* Avatar/emoji de rol */}
                <div className={`w-10 h-10 rounded-xl flex items-center justify-center text-xl
                  flex-shrink-0 border ${m.bg} ${m.border}`}>
                  {m.emoji}
                </div>

                {/* Info del usuario */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-bold text-gray-900 text-sm">{u.nombre}</span>
                    <span className={`text-xs px-2 py-0.5 rounded-full font-semibold border ${m.bg} ${m.text} ${m.border}`}>
                      {m.label}
                    </span>
                    {!esActivo && (
                      <span className="text-xs px-2 py-0.5 rounded-full font-semibold bg-gray-100 text-gray-500 border border-gray-200">
                        Inactivo
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-gray-500 mt-0.5 truncate">{u.email}</p>
                  {u.ficha && (
                    <p className="text-xs text-gray-400 mt-0.5">Ficha #{u.ficha}</p>
                  )}
                </div>

                {/* Acciones */}
                <div className="flex items-center gap-2 flex-shrink-0">
                  {/* Toggle activo/inactivo */}
                  <button
                    onClick={() => toggleActivo(u)}
                    title={esActivo ? "Desactivar usuario" : "Activar usuario"}
                    className={`w-8 h-8 rounded-lg flex items-center justify-center text-sm transition-all
                      active:scale-90 ${
                      esActivo
                        ? "bg-green-50 text-green-600 hover:bg-green-100 border border-green-200"
                        : "bg-gray-100 text-gray-400 hover:bg-gray-200 border border-gray-200"
                    }`}
                  >
                    {esActivo ? "✓" : "○"}
                  </button>

                  {/* Editar */}
                  <button
                    onClick={() => { setEditando(u); setShowForm(false); }}
                    title="Editar usuario"
                    className="w-8 h-8 rounded-lg flex items-center justify-center text-sm
                      bg-gray-50 text-gray-600 hover:bg-gray-100 border border-gray-200
                      active:scale-90 transition-all"
                  >
                    ✏️
                  </button>
                </div>
              </div>

              {/* Barra de estado (activo/inactivo) */}
              <div className={`h-1 ${esActivo ? "bg-[#1E8C3A]" : "bg-gray-200"}`} />
            </div>
          );
        })}
      </div>

      {/* Resumen al fondo */}
      {filtrados.length > 0 && (
        <p className="text-xs text-gray-400 text-center pb-2">
          Mostrando {filtrados.length} de {usuarios.length} usuarios
        </p>
      )}
    </div>
  );
}
