"use client";

import { useState, useEffect } from "react";
import {
  collection, query, where, onSnapshot,
  doc, setDoc, updateDoc, Timestamp, getDocs,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import { UserProfile, LoteLoker, toDate, fmtDate } from "@/lib/types";

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

interface Detalle {
  enc:      UserProfile;
  lotes:    LoteLoker[];
  cargando: boolean;
}

export default function GestionEncargados() {
  const [encargados, setEncargados] = useState<UserProfile[]>([]);
  const [form,       setForm]       = useState({ nombre: "", email: "", password: "", telefono: "" });
  const [creating,   setCreating]   = useState(false);
  const [msg,        setMsg]        = useState<{ type: "ok" | "err"; text: string } | null>(null);
  const [detalle,    setDetalle]    = useState<Detalle | null>(null);
  const [editTel,    setEditTel]    = useState({ show: false, val: "" });

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

  async function abrirDetalle(enc: UserProfile) {
    setDetalle({ enc, lotes: [], cargando: true });
    setEditTel({ show: false, val: enc.telefono ?? "" });
    try {
      const snap = await getDocs(
        query(collection(db, "lotes_loker"), where("registradoPorId", "==", enc.uid))
      );
      const lotes = snap.docs
        .map(d => ({ id: d.id, ...d.data() } as LoteLoker))
        .sort((a, b) => toDate(b.timestamp).getTime() - toDate(a.timestamp).getTime());
      setDetalle({ enc, lotes, cargando: false });
    } catch {
      setDetalle(prev => prev ? { ...prev, cargando: false } : null);
    }
  }

  async function crear() {
    const { nombre, email, password, telefono } = form;
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
        email:     email.trim(),
        role:      "encargado",
        nombre:    nombre.trim(),
        telefono:  telefono.trim() || null,
        activo:    true,
        createdAt: Timestamp.now(),
      });
      setForm({ nombre: "", email: "", password: "", telefono: "" });
      flash("ok", `Encargado "${nombre.trim()}" creado.`);
    } catch (e) {
      flash("err", e instanceof Error ? e.message : "Error al crear.");
    } finally {
      setCreating(false);
    }
  }

  async function toggleActivo(enc: UserProfile) {
    const nuevoActivo = !enc.activo;
    await updateDoc(doc(db, "usuarios", enc.uid), { activo: nuevoActivo }).catch(() => {});
    if (detalle?.enc.uid === enc.uid) {
      setDetalle(prev => prev ? { ...prev, enc: { ...prev.enc, activo: nuevoActivo } } : null);
    }
  }

  async function guardarTel() {
    if (!detalle) return;
    const tel = editTel.val.trim();
    await updateDoc(doc(db, "usuarios", detalle.enc.uid), { telefono: tel || null }).catch(() => {});
    setEditTel({ show: false, val: tel });
    setDetalle(prev => prev ? { ...prev, enc: { ...prev.enc, telefono: tel || undefined } } : null);
  }

  const activos = encargados.filter(e => e.activo !== false);
  const bajas   = encargados.filter(e => e.activo === false);

  // ── Stats del detalle ─────────────────────────────────────────────────────
  const detalleStats = detalle ? (() => {
    const totalLotes    = detalle.lotes.length;
    const totalUnidades = detalle.lotes.reduce(
      (s, l) => s + l.productos.reduce((ss, p) => ss + p.total, 0), 0
    );
    const sinFactura = detalle.lotes.filter(l => !l.facturaEntregada).length;
    return { totalLotes, totalUnidades, sinFactura };
  })() : null;

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
          <div className="grid grid-cols-2 gap-3">
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
              <label className="block text-xs font-medium text-gray-600 mb-1">
                Teléfono <span className="text-gray-400 font-normal">(opcional)</span>
              </label>
              <input
                type="tel"
                value={form.telefono}
                onChange={(e) => setForm(p => ({ ...p, telefono: e.target.value }))}
                placeholder="Ej. 6621234567"
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm
                  focus:outline-none focus:ring-2 focus:ring-emerald-400"
              />
            </div>
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
              <button
                key={enc.uid}
                onClick={() => abrirDetalle(enc)}
                className="w-full px-4 py-3 flex items-center gap-3 text-left hover:bg-emerald-50/50
                  active:scale-[0.99] transition-all duration-100"
              >
                <div className="w-10 h-10 rounded-full bg-emerald-100 flex items-center justify-center
                  text-emerald-700 font-bold text-sm flex-shrink-0">
                  {enc.nombre.charAt(0).toUpperCase()}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-gray-800 truncate">{enc.nombre}</p>
                  <p className="text-xs text-gray-400 truncate">
                    {enc.telefono ? `📱 ${enc.telefono}` : enc.email}
                  </p>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  <span className="text-xs bg-green-100 text-green-700 border border-green-200
                    px-2 py-0.5 rounded-full font-medium">Activo</span>
                  <span className="text-gray-300 text-sm">›</span>
                </div>
              </button>
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
              <button
                key={enc.uid}
                onClick={() => abrirDetalle(enc)}
                className="w-full px-4 py-3 flex items-center gap-3 text-left opacity-60
                  hover:opacity-80 active:scale-[0.99] transition-all duration-100"
              >
                <div className="w-10 h-10 rounded-full bg-gray-100 flex items-center justify-center
                  text-gray-500 font-bold text-sm flex-shrink-0">
                  {enc.nombre.charAt(0).toUpperCase()}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-gray-600 truncate">{enc.nombre}</p>
                  <p className="text-xs text-gray-400 truncate">{enc.email}</p>
                </div>
                <span className="text-gray-300 text-sm flex-shrink-0">›</span>
              </button>
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

      {/* ── Modal de detalle ── */}
      {detalle && (
        <div
          className="fixed inset-0 bg-black/50 z-50 flex items-end sm:items-center justify-center p-4"
          onClick={() => setDetalle(null)}
        >
          <div
            className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[88vh] flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="flex items-center gap-3 px-5 py-4 border-b flex-shrink-0">
              <div className={`w-12 h-12 rounded-full flex items-center justify-center font-bold text-lg
                flex-shrink-0 ${detalle.enc.activo !== false ? "bg-emerald-100 text-emerald-700" : "bg-gray-100 text-gray-500"}`}>
                {detalle.enc.nombre.charAt(0).toUpperCase()}
              </div>
              <div className="flex-1 min-w-0">
                <h3 className="font-bold text-gray-800 text-base truncate">{detalle.enc.nombre}</h3>
                <span className={`text-xs font-medium px-2 py-0.5 rounded-full border ${
                  detalle.enc.activo !== false
                    ? "bg-green-100 text-green-700 border-green-200"
                    : "bg-red-100 text-red-600 border-red-200"
                }`}>
                  {detalle.enc.activo !== false ? "Activo" : "Dado de baja"}
                </span>
              </div>
              <button
                onClick={() => setDetalle(null)}
                className="text-gray-400 hover:text-gray-600 text-2xl leading-none active:scale-95
                  transition-all flex-shrink-0 w-8 h-8 flex items-center justify-center"
              >
                ×
              </button>
            </div>

            {/* Cuerpo scrolleable */}
            <div className="flex-1 overflow-y-auto p-4 space-y-4">

              {/* Info básica */}
              <div className="space-y-2 text-sm">
                <div className="flex items-center gap-3 bg-gray-50 rounded-xl px-3 py-2.5">
                  <span className="text-gray-400 flex-shrink-0 w-5 text-center">📧</span>
                  <span className="text-gray-700 flex-1 min-w-0 truncate">{detalle.enc.email}</span>
                </div>

                {/* Teléfono (editable) */}
                <div className="bg-gray-50 rounded-xl px-3 py-2.5">
                  {editTel.show ? (
                    <div className="flex items-center gap-2">
                      <span className="text-gray-400 flex-shrink-0 w-5 text-center">📱</span>
                      <input
                        autoFocus
                        type="tel"
                        value={editTel.val}
                        onChange={(e) => setEditTel(p => ({ ...p, val: e.target.value }))}
                        onKeyDown={(e) => e.key === "Enter" && guardarTel()}
                        placeholder="Número de teléfono"
                        className="flex-1 text-sm bg-white border border-gray-300 rounded-lg px-2 py-1
                          focus:outline-none focus:ring-2 focus:ring-emerald-400 min-w-0"
                      />
                      <button
                        onClick={guardarTel}
                        className="text-xs px-2.5 py-1.5 bg-emerald-600 text-white rounded-lg
                          active:scale-95 transition-all duration-100 font-medium whitespace-nowrap"
                      >
                        Guardar
                      </button>
                      <button
                        onClick={() => setEditTel({ show: false, val: detalle.enc.telefono ?? "" })}
                        className="text-xs px-2 py-1.5 text-gray-500 hover:text-gray-700
                          active:scale-95 transition-all duration-100"
                      >
                        ×
                      </button>
                    </div>
                  ) : (
                    <div className="flex items-center gap-3">
                      <span className="text-gray-400 flex-shrink-0 w-5 text-center">📱</span>
                      <span className="text-gray-700 flex-1">
                        {detalle.enc.telefono
                          ? <a href={`tel:${detalle.enc.telefono}`} className="text-emerald-700 font-medium hover:underline">{detalle.enc.telefono}</a>
                          : <span className="text-gray-400 italic">Sin teléfono</span>
                        }
                      </span>
                      <button
                        onClick={() => setEditTel({ show: true, val: detalle.enc.telefono ?? "" })}
                        className="text-xs text-emerald-600 hover:text-emerald-800 active:scale-95
                          transition-all duration-100 font-medium"
                      >
                        ✏️ Editar
                      </button>
                    </div>
                  )}
                </div>

                <div className="flex items-center gap-3 bg-gray-50 rounded-xl px-3 py-2.5">
                  <span className="text-gray-400 flex-shrink-0 w-5 text-center">📅</span>
                  <span className="text-gray-500 text-xs">Creado el</span>
                  <span className="text-gray-700 text-xs">
                    {detalle.enc.createdAt instanceof Date
                      ? detalle.enc.createdAt.toLocaleDateString("es-MX", {
                          day: "2-digit", month: "long", year: "numeric",
                        })
                      : fmtDate(detalle.enc.createdAt as unknown as { seconds: number })
                    }
                  </span>
                </div>
              </div>

              {/* Stats */}
              {detalleStats && (
                <div className="grid grid-cols-3 gap-2">
                  <div className="bg-emerald-50 border border-emerald-100 rounded-xl p-3 text-center">
                    <p className="text-xl font-bold text-emerald-700">{detalleStats.totalLotes}</p>
                    <p className="text-xs text-emerald-500 mt-0.5">Lotes</p>
                  </div>
                  <div className="bg-blue-50 border border-blue-100 rounded-xl p-3 text-center">
                    <p className="text-xl font-bold text-blue-700">{detalleStats.totalUnidades}</p>
                    <p className="text-xs text-blue-500 mt-0.5">Unidades</p>
                  </div>
                  <div className={`rounded-xl p-3 text-center border ${
                    detalleStats.sinFactura > 0
                      ? "bg-amber-50 border-amber-100"
                      : "bg-gray-50 border-gray-100"
                  }`}>
                    <p className={`text-xl font-bold ${detalleStats.sinFactura > 0 ? "text-amber-600" : "text-gray-400"}`}>
                      {detalleStats.sinFactura}
                    </p>
                    <p className={`text-xs mt-0.5 ${detalleStats.sinFactura > 0 ? "text-amber-500" : "text-gray-400"}`}>
                      Sin factura
                    </p>
                  </div>
                </div>
              )}

              {/* Lotes */}
              <div>
                <p className="text-xs font-semibold text-gray-600 mb-2 flex items-center gap-1.5">
                  📦 Lotes registrados
                  {!detalle.cargando && (
                    <span className="text-xs bg-emerald-100 text-emerald-700 border border-emerald-200
                      px-1.5 py-0.5 rounded-full font-medium">
                      {detalle.lotes.length}
                    </span>
                  )}
                </p>

                {detalle.cargando ? (
                  <div className="py-6 text-center">
                    <p className="text-xs text-gray-400 animate-pulse">Cargando lotes…</p>
                  </div>
                ) : detalle.lotes.length === 0 ? (
                  <div className="py-6 text-center bg-gray-50 rounded-xl">
                    <p className="text-2xl mb-1">📭</p>
                    <p className="text-xs text-gray-400">Sin lotes registrados aún.</p>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {detalle.lotes.map(lote => {
                      const totalUds = lote.productos.reduce((s, p) => s + p.total, 0);
                      return (
                        <div key={lote.id}
                          className={`border rounded-xl px-3 py-2.5 text-sm ${
                            lote.facturaEntregada
                              ? "bg-white border-gray-100"
                              : "bg-amber-50 border-amber-200"
                          }`}
                        >
                          <div className="flex items-center justify-between gap-2 mb-1">
                            <div className="flex items-center gap-2">
                              <span className="font-bold text-emerald-700">{lote.numero}</span>
                              <span className={`text-xs px-1.5 py-0.5 rounded-full border font-medium ${
                                lote.facturaEntregada
                                  ? "bg-green-100 text-green-700 border-green-200"
                                  : "bg-amber-100 text-amber-700 border-amber-200"
                              }`}>
                                {lote.facturaEntregada ? "✅" : "⏳"} Factura
                              </span>
                            </div>
                            <div className="text-right">
                              <p className="text-xs text-gray-400">{fmtDate(lote.timestamp)}</p>
                              <p className="text-xs font-semibold text-emerald-700 mt-0.5">
                                +{totalUds} uds
                              </p>
                            </div>
                          </div>
                          {lote.proveedor && (
                            <p className="text-xs text-gray-500 mb-1">🏭 {lote.proveedor}</p>
                          )}
                          <div className="flex gap-1 flex-wrap">
                            {lote.productos.map(p => (
                              <span key={p.producto_id}
                                className="text-xs bg-emerald-50 text-emerald-700 border border-emerald-200
                                  px-2 py-0.5 rounded-full"
                              >
                                {p.nombre.split(" ")[0]}
                                {p.cajas > 0    ? ` ${p.cajas}caj`  : ""}
                                {p.unidades > 0 ? ` ${p.unidades}uds` : ""}
                              </span>
                            ))}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>

            {/* Footer acciones */}
            <div className="flex gap-2 px-5 py-4 border-t flex-shrink-0">
              <button
                onClick={() => toggleActivo(detalle.enc)}
                className={`flex-1 py-2.5 rounded-xl text-sm font-semibold transition-all duration-100 active:scale-95 border ${
                  detalle.enc.activo !== false
                    ? "border-red-200 text-red-600 hover:bg-red-50"
                    : "border-emerald-200 text-emerald-700 hover:bg-emerald-50"
                }`}
              >
                {detalle.enc.activo !== false ? "Dar de baja" : "Activar"}
              </button>
              <button
                onClick={() => setDetalle(null)}
                className="flex-1 py-2.5 rounded-xl bg-gray-800 text-white text-sm font-semibold
                  active:scale-95 transition-all duration-100"
              >
                Cerrar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
