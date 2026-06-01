"use client";

import { useState, useEffect } from "react";
import PasswordInput from "@/components/shared/PasswordInput";
import {
  collection, query, where, onSnapshot,
  doc, setDoc, updateDoc, deleteDoc, getDoc, Timestamp,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import { auth } from "@/lib/firebase";
import { reauthenticateWithCredential, EmailAuthProvider } from "firebase/auth";
import { UserProfile, PuntosConfig, PuntoProducto } from "@/lib/types";
import { ShareBar } from "@/components/shared/ShareButtons";
import ProyeccionesChoferes from "@/components/admin/ProyeccionesChoferes";
import { pbHeader, pbFooter } from "@/lib/wa-format";
import { pbPrintDoc, pbTable } from "@/lib/print-template";

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

async function authDelete(idToken: string) {
  const r = await fetch(`${AUTH_URL}:delete?key=${API_KEY}`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ idToken }),
  });
  return r.json() as Promise<{ error?: { message: string } }>;
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
  const [eliminarModal, setEliminarModal] = useState<UserProfile | null>(null);
  const [eliminando,    setEliminando]    = useState(false);

  // Puntos config
  const [puntos,     setPuntos]     = useState<PuntoProducto[]>([]);
  const [meta,       setMeta]       = useState(100);
  const [puntosLock, setPuntosLock] = useState(true);
  const [puntosPwd,  setPuntosPwd]  = useState("");
  const [puntosMsg,  setPuntosMsg]  = useState<{ type: "ok"|"err"; text: string }|null>(null);

  useEffect(() => {
    getDoc(doc(db, "config", "puntos")).then((snap) => {
      if (snap.exists()) {
        const pd = snap.data() as PuntosConfig;
        setPuntos(pd.productos ?? []);
        setMeta(pd.meta ?? 100);
      }
    });
  }, []);

  useEffect(() => {
    const q = query(collection(db, "usuarios"), where("role", "==", "chofer"));
    return onSnapshot(
      q,
      (snap) => {
        // Always use d.id (the Firestore document path segment) as uid so that
        // updateDoc / deleteDoc always target the correct document, regardless
        // of whether the stored "uid" field matches the document ID.
        setChoferes(snap.docs.map((d) => ({ uid: d.id, ...d.data() } as UserProfile)));
      },
      (err) => flash("err", `Error al leer choferes: ${err.message}`),
    );
  }, []);

  const flash = (type: "ok" | "err", text: string) => {
    setMsg({ type, text });
    setTimeout(() => setMsg(null), 4000);
  };

  const flashPuntos = (type: "ok"|"err", text: string) => {
    setPuntosMsg({ type, text });
    setTimeout(() => setPuntosMsg(null), 4000);
  };

  const unlockPuntos = async () => {
    const user = auth.currentUser;
    if (!user?.email) return;
    try {
      const cred = EmailAuthProvider.credential(user.email, puntosPwd);
      await reauthenticateWithCredential(user, cred);
      setPuntosLock(false); setPuntosPwd("");
    } catch {
      flashPuntos("err", "Contraseña Admin incorrecta");
    }
  };

  const savePuntos = async () => {
    try {
      await setDoc(doc(db, "config", "puntos"), { productos: puntos, meta });
      flashPuntos("ok", "Puntos guardados ✓");
    } catch (e) {
      flashPuntos("err", e instanceof Error ? e.message : "Error");
    }
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
      // Firebase Auth requires ≥6 chars; pad with leading zeros so short fichas work
      const password = ficha.trim().padStart(6, "0");

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
    try {
      const nuevoEstado = !(chofer.activo ?? true);
      await updateDoc(doc(db, "usuarios", chofer.uid), { activo: nuevoEstado });
      flash("ok", `${chofer.nombre} ${nuevoEstado ? "reactivado" : "dado de baja"}`);
    } catch (err: unknown) {
      flash("err", err instanceof Error ? err.message : "Error al actualizar estado");
    }
  };

  // ── Cambiar contraseña/ficha ─────────────────────────────────────────────────
  const handleCambiarPassword = async () => {
    if (!passwdModal || !nuevaFicha.trim()) return;
    if (nuevaFicha.trim().length < 3) { flash("err", "Mínimo 3 caracteres"); return; }
    setChangingPw(true);
    try {
      const currentFicha = passwdModal.ficha ?? "";
      const email        = passwdModal.email;

      const signInData = await authSignIn(email, currentFicha.padStart(6, "0"));
      if (signInData.error) throw new Error(`No se pudo autenticar: ${signInData.error.message}`);

      await authUpdatePassword(signInData.idToken!, nuevaFicha.trim().padStart(6, "0"));
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

  // ── Eliminar chofer (baja + Firestore + Auth) ────────────────────────────────
  const handleEliminar = async () => {
    if (!eliminarModal) return;
    setEliminando(true);
    try {
      // Try to sign in as the chofer to obtain an idToken for Auth deletion
      const signInData = await authSignIn(
        eliminarModal.email,
        (eliminarModal.ficha ?? "").padStart(6, "0"),
      );
      if (signInData.idToken) {
        await authDelete(signInData.idToken);
      }
      // Always remove from Firestore regardless of Auth outcome
      await deleteDoc(doc(db, "usuarios", eliminarModal.uid));
      flash("ok", `${eliminarModal.nombre} eliminado completamente`);
      setEliminarModal(null);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Error desconocido";
      flash("err", message);
    } finally {
      setEliminando(false);
    }
  };

  // ── Filtrado ─────────────────────────────────────────────────────────────────
  const getWhatsAppMsg = () => {
    const activos = choferes.filter((c) => c.activo !== false);
    const bajas   = choferes.filter((c) => c.activo === false);
    const lines   = [pbHeader(), `👥 *Choferes Polar Breeze*`, ""];
    if (activos.length) {
      lines.push(`Activos (${activos.length}):`);
      activos.forEach((c) => lines.push(`  • ${c.nombre} — ficha ${c.ficha ?? "—"}`));
    }
    if (bajas.length) {
      lines.push(``, `Baja (${bajas.length}):`);
      bajas.forEach((c) => lines.push(`  • ${c.nombre} — ficha ${c.ficha ?? "—"}`));
    }
    lines.push("", pbFooter());
    return lines.join("\n");
  };

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
        <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
          <h2 className="text-base font-bold text-purple-700">
            👥 Choferes ({choferes.length})
          </h2>
          <div className="flex items-center gap-2 flex-wrap">
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
          <ShareBar
            getMessage={getWhatsAppMsg}
            getPrintHtml={() => {
              const activos = choferes.filter((c) => c.activo !== false);
              const bajas   = choferes.filter((c) => c.activo === false);
              const body = `
                <div class="sec-title">Choferes Activos (${activos.length})</div>
                ${activos.length ? pbTable(
                  ["Nombre", "Ficha", "Estado"],
                  activos.map((c) => [c.nombre, c.ficha ?? "—", "Activo"]),
                ) : "<p>Sin choferes activos.</p>"}
                ${bajas.length ? `
                <div class="sec-title">Choferes en Baja (${bajas.length})</div>
                ${pbTable(
                  ["Nombre", "Ficha", "Estado"],
                  bajas.map((c) => [c.nombre, c.ficha ?? "—", "Baja"]),
                )}` : ""}
              `;
              return pbPrintDoc("CHOFERES POLAR BREEZE", `Total: ${choferes.length} registros`, body);
            }}
          />
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
                    activo ? "border-gray-100 bg-white" : "border-gray-100 bg-gray-50"
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
                  <div className="flex flex-wrap gap-1.5 justify-end">
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
                    {!activo && (
                      <button
                        onClick={() => setEliminarModal(c)}
                        className="px-2.5 py-1.5 bg-red-600 hover:bg-red-700 active:scale-95 text-white rounded-lg text-xs font-medium transition-all duration-100"
                        title="Eliminar permanentemente"
                      >
                        🗑️
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* ── Proyecciones ── */}
      <ProyeccionesChoferes choferes={choferes} />

      {/* ── Panel Puntos ── */}
      <div className="lg:col-span-3 bg-white rounded-xl shadow-sm p-5">
        <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
          <h2 className="text-base font-bold text-yellow-700">⭐ Sistema de Puntos</h2>
          {!puntosLock && (
            <button
              onClick={() => setPuntosLock(true)}
              className="text-xs text-gray-400 hover:text-gray-600 px-2 py-1 rounded transition"
            >
              🔒 Bloquear
            </button>
          )}
        </div>
        {puntosLock ? (
          <div className="flex flex-wrap items-end gap-3 max-w-md">
            <div className="flex-1 min-w-48">
              <label className="block text-xs font-medium text-gray-600 mb-1">Contraseña Admin para editar puntos</label>
              <PasswordInput
                value={puntosPwd}
                onChange={(e) => setPuntosPwd(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && puntosPwd && unlockPuntos()}
                placeholder="Contraseña Admin"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm outline-none focus:ring-2 focus:ring-yellow-400"
              />
            </div>
            <button
              onClick={unlockPuntos} disabled={!puntosPwd}
              className="px-4 py-2 bg-yellow-500 hover:bg-yellow-600 active:scale-95 text-white rounded-lg text-sm font-semibold transition-all duration-100 disabled:opacity-60"
            >
              🔓 Desbloquear
            </button>
          </div>
        ) : (
          <div className="grid md:grid-cols-2 gap-6">
            <div className="space-y-3">
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Meta de puntos por quincena</label>
                <input
                  type="number" value={meta}
                  onChange={(e) => setMeta(Number(e.target.value))}
                  className="w-32 px-3 py-2 border border-gray-300 rounded-lg text-sm text-right outline-none focus:ring-2 focus:ring-yellow-400"
                />
              </div>
              <p className="text-xs text-gray-400">
                Los choferes acumulan puntos por cada unidad entregada según el producto. Los puntos se muestran en su panel personal cada quincena.
              </p>
            </div>
            <div>
              <div className="flex items-center justify-between mb-2">
                <p className="text-sm font-medium text-gray-700">Puntos por producto</p>
                <button
                  onClick={() => setPuntos((p) => [...p, { nombre: "", puntos: 1 }])}
                  className="text-xs text-yellow-600 hover:text-yellow-700 font-medium"
                >
                  + Agregar
                </button>
              </div>
              <div className="space-y-2 max-h-48 overflow-y-auto">
                {puntos.map((p, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <input
                      value={p.nombre}
                      onChange={(e) => {
                        const next = [...puntos];
                        next[i] = { ...next[i], nombre: e.target.value };
                        setPuntos(next);
                      }}
                      placeholder="Producto"
                      className="flex-1 px-2 py-1.5 border border-gray-200 rounded text-sm outline-none focus:ring-1 focus:ring-yellow-400"
                    />
                    <input
                      type="number" value={p.puntos}
                      onChange={(e) => {
                        const next = [...puntos];
                        next[i] = { ...next[i], puntos: Number(e.target.value) };
                        setPuntos(next);
                      }}
                      className="w-20 px-2 py-1.5 border border-gray-200 rounded text-sm text-right outline-none focus:ring-1 focus:ring-yellow-400"
                    />
                    <span className="text-xs text-gray-400">pts</span>
                    <button
                      onClick={() => setPuntos((prev) => prev.filter((_, idx) => idx !== i))}
                      className="text-gray-300 hover:text-red-400 text-lg leading-none"
                    >×</button>
                  </div>
                ))}
                {puntos.length === 0 && (
                  <p className="text-xs text-gray-400 text-center py-3">Sin productos configurados</p>
                )}
              </div>
            </div>
            <div className="md:col-span-2 flex items-center gap-3">
              <button
                onClick={savePuntos}
                className="px-5 py-2.5 bg-yellow-500 hover:bg-yellow-600 active:scale-95 text-white rounded-lg text-sm font-semibold transition-all duration-100"
              >
                ⭐ Guardar Puntos
              </button>
              {puntosMsg && (
                <span className={`text-sm px-3 py-1.5 rounded-lg ${
                  puntosMsg.type === "ok" ? "bg-green-50 text-green-700 border border-green-200"
                                         : "bg-red-50 text-red-700 border border-red-200"
                }`}>{puntosMsg.text}</span>
              )}
            </div>
          </div>
        )}
      </div>

      {/* ── Modal confirmar eliminación ── */}
      {eliminarModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6">
            <p className="text-3xl text-center mb-3">🗑️</p>
            <h3 className="font-bold text-gray-800 text-center mb-1">Eliminar chofer</h3>
            <p className="text-sm text-gray-500 text-center mb-1">
              <strong>{eliminarModal.nombre}</strong> · ficha {eliminarModal.ficha}
            </p>
            <p className="text-xs text-red-600 text-center mb-5">
              Se borrará de Firebase Auth y Firestore. Esta acción no se puede deshacer.
            </p>
            <div className="flex gap-2">
              <button
                onClick={() => setEliminarModal(null)}
                disabled={eliminando}
                className="flex-1 py-2.5 rounded-xl border border-gray-200 text-sm text-gray-600 hover:bg-gray-50 transition disabled:opacity-60"
              >
                Cancelar
              </button>
              <button
                onClick={handleEliminar}
                disabled={eliminando}
                className="flex-1 py-2.5 rounded-xl bg-red-600 hover:bg-red-700 active:scale-95 text-white text-sm font-bold transition-all duration-100 disabled:opacity-60"
              >
                {eliminando ? "Eliminando..." : "Sí, eliminar"}
              </button>
            </div>
          </div>
        </div>
      )}

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
