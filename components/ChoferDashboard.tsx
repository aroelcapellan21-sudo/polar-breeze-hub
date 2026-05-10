"use client";

import { useState, useEffect } from "react";
import { collection, addDoc, onSnapshot, query, orderBy, Timestamp, where } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useAuth } from "@/lib/auth-context";
import { ImbentarioRecord } from "@/lib/types";

export default function ChoferDashboard() {
  const { profile, logout } = useAuth();
  const [records, setRecords] = useState<ImbentarioRecord[]>([]);
  const [form, setForm] = useState({
    vehiculo: "",
    producto: "",
    cantidadCargada: "",
    cantidadEntregada: "",
    cajas: "",
    peso: "",
    monto: "",
    ruta: "",
  });
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);

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
    return unsub;
  }, [profile]);

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
  const totalCargado = records.reduce((s, r) => s + (r.cantidadCargada || 0), 0);

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
          <button onClick={logout} className="bg-white/20 hover:bg-white/30 px-3 py-1.5 rounded-lg text-sm transition">
            Salir
          </button>
        </div>
      </header>

      <div className="max-w-3xl mx-auto px-4 py-6">
        {/* Stats */}
        <div className="grid grid-cols-3 gap-3 mb-6">
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

        {success && (
          <div className="bg-green-100 border border-green-300 text-green-700 rounded-lg px-4 py-3 mb-4 text-sm font-medium">
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
                className="w-full bg-cyan-600 hover:bg-cyan-700 text-white py-2.5 rounded-lg font-medium transition disabled:opacity-60"
              >
                {loading ? "Enviando..." : "Enviar Reporte"}
              </button>
            </form>
          </div>

          {/* History */}
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
