"use client";

import { useState, useEffect, useMemo } from "react";
import {
  collection, addDoc, onSnapshot, query, orderBy,
  Timestamp, where, getDoc, doc,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useAuth } from "@/lib/auth-context";
import { ImbentarioRecord, PuntosConfig, PuntoProducto } from "@/lib/types";
import { ShareBar } from "@/components/shared/ShareButtons";
import SobrantesChofer from "@/components/chofer/SobrantesChofer";

// today's midnight for filtering
function getTodayStart() {
  const d = new Date(); d.setHours(0, 0, 0, 0); return d;
}

function getQuincena() {
  const now = new Date();
  const day = now.getDate();
  const month = now.getMonth();
  const year  = now.getFullYear();
  if (day <= 15) {
    return {
      start: new Date(year, month, 1),
      end:   new Date(year, month, 15, 23, 59, 59),
      label: `1ª quincena de ${now.toLocaleDateString("es-MX", { month: "long" })} ${year}`,
    };
  }
  const lastDay = new Date(year, month + 1, 0).getDate();
  return {
    start: new Date(year, month, 16),
    end:   new Date(year, month, lastDay, 23, 59, 59),
    label: `2ª quincena de ${now.toLocaleDateString("es-MX", { month: "long" })} ${year}`,
  };
}

export default function ChoferDashboard() {
  const { profile, logout } = useAuth();
  const [records,       setRecords]       = useState<ImbentarioRecord[]>([]);
  const [puntosConfig,  setPuntosConfig]  = useState<PuntosConfig | null>(null);
  const [form, setForm] = useState({
    vehiculo: "", producto: "", cantidadCargada: "",
    cantidadEntregada: "", cajas: "", peso: "", monto: "", ruta: "",
  });
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);

  // Restablecer state
  const [showReset,    setShowReset]    = useState(false);
  const [resetPwd,     setResetPwd]     = useState("");
  const [resetLoading, setResetLoading] = useState(false);
  const [resetMsg,     setResetMsg]     = useState<{ type: "ok"|"err"; text: string }|null>(null);
  const [todayOnly,    setTodayOnly]    = useState(false);

  useEffect(() => {
    if (!profile) return;
    const q = query(
      collection(db, "imbentario"),
      where("choferId", "==", profile.uid),
      orderBy("timestamp", "desc")
    );
    const unsub = onSnapshot(q, (snap) => {
      setRecords(snap.docs.map((d) => ({ id: d.id, ...d.data() } as ImbentarioRecord)));
    });
    // Load points config
    getDoc(doc(db, "config", "puntos")).then((snap) => {
      if (snap.exists()) setPuntosConfig(snap.data() as PuntosConfig);
    });
    return unsub;
  }, [profile]);

  const handleReset = async () => {
    if (!resetPwd) return;
    setResetLoading(true);
    try {
      const cfgSnap = await getDoc(doc(db, "config", "main"));
      const storedPwd = cfgSnap.exists() ? cfgSnap.data()?.resetPassword : null;
      if (!storedPwd || storedPwd !== resetPwd) {
        setResetMsg({ type: "err", text: "Clave de Restablecer incorrecta" });
        setTimeout(() => setResetMsg(null), 3000);
        setResetLoading(false);
        return;
      }
      setTodayOnly(false);
      setForm({ vehiculo: "", producto: "", cantidadCargada: "", cantidadEntregada: "", cajas: "", peso: "", monto: "", ruta: "" });
      setSuccess(false);
      setResetMsg({ type: "ok", text: "Vista restablecida ✓ — historial conservado en Firebase" });
      setResetPwd("");
      setTimeout(() => { setShowReset(false); setResetMsg(null); }, 2000);
    } catch (e) {
      setResetMsg({ type: "err", text: e instanceof Error ? e.message : "Error" });
    } finally {
      setResetLoading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!profile) return;
    setLoading(true);
    try {
      await addDoc(collection(db, "imbentario"), {
        choferId:          profile.uid,
        choferNombre:      profile.nombre,
        vehiculo:          form.vehiculo,
        producto:          form.producto,
        cantidadCargada:   Number(form.cantidadCargada),
        cantidadEntregada: Number(form.cantidadEntregada),
        ...(form.cajas && { cajas: Number(form.cajas) }),
        ...(form.peso  && { peso:  Number(form.peso)  }),
        ...(form.monto && { monto: Number(form.monto) }),
        ruta:              form.ruta,
        timestamp:         Timestamp.now(),
      });
      setForm({ vehiculo: "", producto: "", cantidadCargada: "", cantidadEntregada: "", cajas: "", peso: "", monto: "", ruta: "" });
      setSuccess(true);
      setTimeout(() => setSuccess(false), 3000);
    } finally {
      setLoading(false);
    }
  };

  const totalEntregado = records.reduce((s, r) => s + (r.cantidadEntregada || 0), 0);
  const totalCargado   = records.reduce((s, r) => s + (r.cantidadCargada || 0), 0);

  // ── Quincena ─────────────────────────────────────────────────────────────────
  const quincena = useMemo(() => getQuincena(), []);

  const recQuincena = records.filter((r) => {
    const d = r.timestamp instanceof Date ? r.timestamp
      : new Date((r.timestamp as { seconds: number }).seconds * 1000);
    return d >= quincena.start && d <= quincena.end;
  });

  const porProductoQ = recQuincena.reduce<Record<string, { cargado: number; entregado: number; monto: number }>>((acc, r) => {
    if (!acc[r.producto]) acc[r.producto] = { cargado: 0, entregado: 0, monto: 0 };
    acc[r.producto].cargado   += r.cantidadCargada ?? 0;
    acc[r.producto].entregado += r.cantidadEntregada ?? 0;
    acc[r.producto].monto     += r.monto ?? 0;
    return acc;
  }, {});

  // ── Puntos quincena ───────────────────────────────────────────────────────────
  const puntosMap: Record<string, number> = {};
  (puntosConfig?.productos ?? []).forEach((p: PuntoProducto) => {
    puntosMap[p.nombre.toLowerCase().trim()] = p.puntos;
  });

  const puntosTotal = recQuincena.reduce((sum, r) => {
    const key = r.producto.toLowerCase().trim();
    const pts  = puntosMap[key] ?? 0;
    return sum + pts * (r.cantidadEntregada ?? 0);
  }, 0);

  const meta     = puntosConfig?.meta ?? 100;
  const pct      = Math.min((puntosTotal / meta) * 100, 100);
  const pctColor = pct >= 80 ? "bg-green-500" : pct >= 50 ? "bg-yellow-500" : "bg-blue-500";

  return (
    <div className="min-h-screen bg-gray-100">
      <header className="bg-gradient-to-r from-cyan-600 to-teal-700 text-white shadow-lg">
        <div className="max-w-3xl mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-white/20 rounded-full flex items-center justify-center font-bold">PB</div>
            <div>
              <h1 className="font-bold text-lg">IMBENTARIO</h1>
              <p className="text-cyan-200 text-xs">Chofer — {profile?.nombre}</p>
            </div>
          </div>
          <button
            onClick={() => { setShowReset(true); setResetPwd(""); setResetMsg(null); }}
            className="bg-white/20 hover:bg-white/30 active:scale-95 px-2 py-1.5
              rounded-lg text-xs transition-all duration-100 font-medium"
          >
            🔄 Restablecer
          </button>
          <button
            onClick={logout}
            className="bg-white/20 hover:bg-white/30 active:scale-95 px-3 py-1.5
              rounded-lg text-sm transition-all duration-100"
          >
            Salir
          </button>
        </div>
      </header>

      <div className="max-w-3xl mx-auto px-4 py-6 space-y-6">
        {/* ── Sobrantes del día ── */}
        <SobrantesChofer />

        {/* Stats globales */}
        <div className="grid grid-cols-3 gap-3">
          <div className="bg-cyan-600 text-white rounded-xl p-4 text-center shadow">
            <p className="text-2xl font-bold">{records.length}</p>
            <p className="text-xs opacity-90">Reportes</p>
          </div>
          <div className="bg-teal-600 text-white rounded-xl p-4 text-center shadow">
            <p className="text-2xl font-bold">{totalCargado}</p>
            <p className="text-xs opacity-90">Unid. Cargadas</p>
          </div>
          <div className="bg-emerald-600 text-white rounded-xl p-4 text-center shadow">
            <p className="text-2xl font-bold">{totalEntregado}</p>
            <p className="text-xs opacity-90">Unid. Entregadas</p>
          </div>
        </div>

        {/* ── Progreso quincena ── */}
        <div className="bg-white rounded-xl shadow-sm p-5 space-y-3">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <h2 className="font-bold text-teal-700 text-sm">⭐ Puntos — {quincena.label}</h2>
            <div className="flex items-center gap-3">
              <span className="text-lg font-bold text-teal-700">{puntosTotal} / {meta}</span>
              <ShareBar getMessage={() => {
                const lines = [
                  `📦 Mi reporte — ${profile?.nombre ?? "Chofer"}`,
                  quincena.label,
                  `Puntos: ${puntosTotal} / ${meta} (${pct.toFixed(0)}%)`,
                ];
                if (Object.keys(porProductoQ).length) {
                  lines.push("Ventas:");
                  Object.entries(porProductoQ).forEach(([prod, dat]) => {
                    const pts = (puntosMap[prod.toLowerCase().trim()] ?? 0) * dat.entregado;
                    lines.push(`  • ${prod}: ${dat.entregado}/${dat.cargado}${dat.monto > 0 ? ` — $${dat.monto.toLocaleString()}` : ""}${pts > 0 ? ` ⭐${pts}` : ""}`);
                  });
                }
                return lines.join("\n");
              }} />
            </div>
          </div>
          <div className="h-4 bg-gray-100 rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full transition-all duration-500 ${pctColor}`}
              style={{ width: `${pct}%` }}
            />
          </div>
          <p className="text-xs text-gray-400 text-right">{pct.toFixed(0)}% de la meta</p>
        </div>

        {/* ── Tabla de ventas quincena ── */}
        {Object.keys(porProductoQ).length > 0 && (
          <div className="bg-white rounded-xl shadow-sm p-5">
            <h3 className="font-bold text-gray-700 mb-3 text-sm">📊 Ventas de la quincena</h3>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-xs text-gray-500 border-b">
                    <th className="text-left pb-2 pr-3">Producto</th>
                    <th className="text-right pb-2 pr-3">Cargado</th>
                    <th className="text-right pb-2 pr-3">Entregado</th>
                    <th className="text-right pb-2 pr-3">Monto</th>
                    <th className="text-right pb-2">Puntos</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {Object.entries(porProductoQ).map(([prod, dat]) => {
                    const key = prod.toLowerCase().trim();
                    const pts = (puntosMap[key] ?? 0) * dat.entregado;
                    const efic = dat.cargado > 0 ? (dat.entregado / dat.cargado) * 100 : 100;
                    return (
                      <tr key={prod} className="hover:bg-gray-50">
                        <td className="py-2 pr-3">
                          <p className="font-medium text-gray-800">{prod}</p>
                          <div className="mt-0.5 h-1 bg-gray-100 rounded-full overflow-hidden w-20">
                            <div
                              className={`h-full rounded-full ${efic >= 95 ? "bg-green-400" : efic >= 85 ? "bg-yellow-400" : "bg-red-400"}`}
                              style={{ width: `${Math.min(efic, 100)}%` }}
                            />
                          </div>
                        </td>
                        <td className="py-2 pr-3 text-right text-blue-600">{dat.cargado}</td>
                        <td className="py-2 pr-3 text-right text-green-600">{dat.entregado}</td>
                        <td className="py-2 pr-3 text-right text-gray-600">
                          {dat.monto > 0 ? `$${dat.monto.toLocaleString()}` : "—"}
                        </td>
                        <td className="py-2 text-right">
                          <span className={`text-xs font-semibold ${pts > 0 ? "text-yellow-600" : "text-gray-300"}`}>
                            {pts > 0 ? `⭐ ${pts}` : "—"}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {success && (
          <div className="bg-green-100 border border-green-300 text-green-700 rounded-lg px-4 py-3 text-sm font-medium">
            Reporte registrado exitosamente
          </div>
        )}

        <div className="grid md:grid-cols-2 gap-6">
          {/* Form */}
          <div className="bg-white rounded-xl shadow-sm p-5">
            <h2 className="text-lg font-semibold text-cyan-700 mb-4">🚚 Nuevo Reporte</h2>
            <form onSubmit={handleSubmit} className="space-y-3">
              <Field label="Vehículo / Placa" value={form.vehiculo} onChange={(v) => setForm((p) => ({ ...p, vehiculo: v }))} placeholder="ABC-123" />
              <Field label="Producto" value={form.producto} onChange={(v) => setForm((p) => ({ ...p, producto: v }))} placeholder="Nombre del producto" />
              <div className="grid grid-cols-2 gap-3">
                <Field label="Cant. Cargada"   type="number" value={form.cantidadCargada}   onChange={(v) => setForm((p) => ({ ...p, cantidadCargada: v }))}   placeholder="0" />
                <Field label="Cant. Entregada" type="number" value={form.cantidadEntregada} onChange={(v) => setForm((p) => ({ ...p, cantidadEntregada: v }))} placeholder="0" />
              </div>
              <div className="grid grid-cols-3 gap-3">
                <Field label="Cajas"     type="number" value={form.cajas}  onChange={(v) => setForm((p) => ({ ...p, cajas: v }))}  placeholder="0" />
                <Field label="Peso (kg)" type="number" value={form.peso}   onChange={(v) => setForm((p) => ({ ...p, peso: v }))}   placeholder="0.0" />
                <Field label="Monto $"   type="number" value={form.monto}  onChange={(v) => setForm((p) => ({ ...p, monto: v }))}  placeholder="0" />
              </div>
              <Field label="Ruta / Destino" value={form.ruta} onChange={(v) => setForm((p) => ({ ...p, ruta: v }))} placeholder="Ruta o dirección" />
              <button
                type="submit"
                disabled={loading}
                className="w-full bg-cyan-600 hover:bg-cyan-700 active:scale-95 text-white
                  py-2.5 rounded-lg font-medium transition-all duration-100 disabled:opacity-60"
              >
                {loading ? "Enviando..." : "Enviar Reporte"}
              </button>
            </form>
          </div>

          {/* Historial */}
          <div className="bg-white rounded-xl shadow-sm p-5">
            <h3 className="font-semibold text-gray-700 mb-3">Mis reportes</h3>
            <div className="space-y-3 max-h-96 overflow-y-auto">
              {records.length === 0 ? (
                <p className="text-gray-400 text-sm text-center py-8">Sin reportes aún</p>
              ) : records.map((r) => (
                <div key={r.id} className="border border-gray-100 rounded-lg p-3">
                  <div className="flex justify-between items-start mb-1">
                    <p className="font-medium text-sm text-gray-800">{r.producto}</p>
                    <span className="text-xs text-gray-400">{r.vehiculo}</span>
                  </div>
                  <p className="text-xs text-gray-500">{r.ruta}</p>
                  <div className="flex gap-4 mt-2">
                    <div className="text-center">
                      <p className="text-xs text-gray-400">Cargado</p>
                      <p className="font-bold text-sm text-teal-600">{r.cantidadCargada}</p>
                    </div>
                    <div className="text-center">
                      <p className="text-xs text-gray-400">Entregado</p>
                      <p className="font-bold text-sm text-emerald-600">{r.cantidadEntregada}</p>
                    </div>
                    <div className="text-center">
                      <p className="text-xs text-gray-400">Diferencia</p>
                      <p className={`font-bold text-sm ${(r.cantidadCargada - r.cantidadEntregada) > 0 ? "text-orange-500" : "text-gray-500"}`}>
                        {r.cantidadCargada - r.cantidadEntregada}
                      </p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
      {/* ── Modal Restablecer ── */}
      {showReset && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6 space-y-4">
            <div className="text-center">
              <p className="text-3xl mb-2">🔄</p>
              <h3 className="font-bold text-gray-800 text-lg">Restablecer vista</h3>
              <p className="text-sm text-gray-500 mt-1">
                Limpia el formulario y la vista del día.<br />
                <strong>Tus reportes en Firebase se conservan.</strong>
              </p>
            </div>
            <input
              type="password" value={resetPwd} autoFocus
              onChange={(e) => setResetPwd(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && resetPwd && handleReset()}
              placeholder="Clave de Restablecer"
              className="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm outline-none focus:ring-2 focus:ring-cyan-400"
            />
            {resetMsg && (
              <div className={`text-sm px-3 py-2 rounded-lg text-center ${
                resetMsg.type === "ok"
                  ? "bg-green-50 text-green-700 border border-green-200"
                  : "bg-red-50 text-red-700 border border-red-200"
              }`}>{resetMsg.text}</div>
            )}
            <div className="flex gap-2">
              <button
                onClick={() => { setShowReset(false); setResetPwd(""); setResetMsg(null); }}
                disabled={resetLoading}
                className="flex-1 py-2.5 rounded-xl border border-gray-200 text-sm text-gray-600 hover:bg-gray-50 transition disabled:opacity-60"
              >
                Cancelar
              </button>
              <button
                onClick={handleReset}
                disabled={resetLoading || !resetPwd}
                className="flex-1 py-2.5 rounded-xl bg-cyan-600 hover:bg-cyan-700 active:scale-95 text-white text-sm font-bold transition-all duration-100 disabled:opacity-60"
              >
                {resetLoading ? "Restableciendo..." : "Restablecer"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Field({ label, value, onChange, placeholder, type = "text" }: {
  label: string; value: string; onChange: (v: string) => void; placeholder: string; type?: string;
}) {
  return (
    <div>
      <label className="block text-xs font-medium text-gray-600 mb-1">{label}</label>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        required
        placeholder={placeholder}
        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-cyan-500 outline-none text-sm text-gray-800"
      />
    </div>
  );
}
