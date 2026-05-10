"use client";

import { useState, useEffect } from "react";
import { collection, addDoc, onSnapshot, query, orderBy, Timestamp, where } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useAuth } from "@/lib/auth-context";
import { SpikinScanRecord, FacturaScanRecord } from "@/lib/types";

export default function DespachadorDashboard() {
  const { profile, logout } = useAuth();
  const [activeApp, setActiveApp] = useState<"spikinscan" | "facturascan">("spikinscan");
  const [spikinRecords, setSpikinRecords] = useState<SpikinScanRecord[]>([]);
  const [facturaRecords, setFacturaRecords] = useState<FacturaScanRecord[]>([]);

  // SPIKINSCAN form
  const [spForm, setSpForm] = useState({ producto: "", cantidad: "", destino: "" });
  const [spLoading, setSpLoading] = useState(false);

  // FACTURASCAN form
  const [facForm, setFacForm] = useState({ facturaNumero: "", cliente: "", monto: "" });
  const [facLoading, setFacLoading] = useState(false);

  useEffect(() => {
    if (!profile) return;
    const q1 = query(
      collection(db, "spikinscan"),
      where("despachadorId", "==", profile.uid),
      orderBy("timestamp", "desc")
    );
    const unsub1 = onSnapshot(q1, (snap) => {
      setSpikinRecords(snap.docs.map((d) => ({ id: d.id, ...d.data() } as SpikinScanRecord)));
    });

    const q2 = query(
      collection(db, "facturascan"),
      where("despachadorId", "==", profile.uid),
      orderBy("timestamp", "desc")
    );
    const unsub2 = onSnapshot(q2, (snap) => {
      setFacturaRecords(snap.docs.map((d) => ({ id: d.id, ...d.data() } as FacturaScanRecord)));
    });

    return () => { unsub1(); unsub2(); };
  }, [profile]);

  const handleSpikinSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!profile) return;
    setSpLoading(true);
    try {
      await addDoc(collection(db, "spikinscan"), {
        despachadorId: profile.uid,
        despachadorNombre: profile.nombre,
        producto: spForm.producto,
        cantidad: Number(spForm.cantidad),
        destino: spForm.destino,
        timestamp: Timestamp.now(),
        estado: "pendiente",
      });
      setSpForm({ producto: "", cantidad: "", destino: "" });
    } finally {
      setSpLoading(false);
    }
  };

  const handleFacturaSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!profile) return;
    setFacLoading(true);
    try {
      await addDoc(collection(db, "facturascan"), {
        despachadorId: profile.uid,
        despachadorNombre: profile.nombre,
        facturaNumero: facForm.facturaNumero,
        cliente: facForm.cliente,
        monto: Number(facForm.monto),
        timestamp: Timestamp.now(),
        estado: "pendiente",
      });
      setFacForm({ facturaNumero: "", cliente: "", monto: "" });
    } finally {
      setFacLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-100">
      <header className="bg-gradient-to-r from-blue-600 to-blue-800 text-white shadow-lg">
        <div className="max-w-5xl mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-white/20 rounded-full flex items-center justify-center font-bold">PB</div>
            <div>
              <h1 className="font-bold text-lg">Polar Breeze Hub</h1>
              <p className="text-blue-200 text-xs">Despachador</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-sm hidden sm:block">{profile?.nombre}</span>
            <button onClick={logout} className="bg-white/20 hover:bg-white/30 px-3 py-1.5 rounded-lg text-sm transition">
              Salir
            </button>
          </div>
        </div>
      </header>

      <div className="max-w-5xl mx-auto px-4 py-6">
        {/* App selector */}
        <div className="flex gap-3 mb-6">
          <AppCard
            active={activeApp === "spikinscan"}
            onClick={() => setActiveApp("spikinscan")}
            title="SPIKINSCAN"
            description="Registro de despachos"
            icon="📦"
            color="blue"
          />
          <AppCard
            active={activeApp === "facturascan"}
            onClick={() => setActiveApp("facturascan")}
            title="FACTURASCAN"
            description="Gestión de facturas"
            icon="🧾"
            color="indigo"
          />
        </div>

        <div className="grid md:grid-cols-2 gap-6">
          {activeApp === "spikinscan" ? (
            <>
              <div className="bg-white rounded-xl shadow-sm p-5">
                <h2 className="text-lg font-semibold text-blue-700 mb-4">📦 Nuevo Despacho</h2>
                <form onSubmit={handleSpikinSubmit} className="space-y-4">
                  <FormField label="Producto" value={spForm.producto} onChange={(v) => setSpForm((p) => ({ ...p, producto: v }))} placeholder="Nombre del producto" />
                  <FormField label="Cantidad" type="number" value={spForm.cantidad} onChange={(v) => setSpForm((p) => ({ ...p, cantidad: v }))} placeholder="0" />
                  <FormField label="Destino" value={spForm.destino} onChange={(v) => setSpForm((p) => ({ ...p, destino: v }))} placeholder="Dirección o ruta" />
                  <button type="submit" disabled={spLoading} className="w-full bg-blue-600 hover:bg-blue-700 text-white py-2.5 rounded-lg font-medium transition disabled:opacity-60">
                    {spLoading ? "Registrando..." : "Registrar Despacho"}
                  </button>
                </form>
              </div>
              <div className="bg-white rounded-xl shadow-sm p-5">
                <h3 className="font-semibold text-gray-700 mb-3">Mis despachos recientes</h3>
                <div className="space-y-2 max-h-80 overflow-y-auto">
                  {spikinRecords.length === 0 ? (
                    <p className="text-gray-400 text-sm text-center py-8">Sin registros aún</p>
                  ) : spikinRecords.map((r) => (
                    <div key={r.id} className="border border-gray-100 rounded-lg p-3">
                      <div className="flex justify-between items-start">
                        <div>
                          <p className="font-medium text-sm text-gray-800">{r.producto}</p>
                          <p className="text-xs text-gray-500">Cant: {r.cantidad} → {r.destino}</p>
                        </div>
                        <span className="text-xs bg-yellow-100 text-yellow-700 px-2 py-0.5 rounded-full">{r.estado}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </>
          ) : (
            <>
              <div className="bg-white rounded-xl shadow-sm p-5">
                <h2 className="text-lg font-semibold text-indigo-700 mb-4">🧾 Nueva Factura</h2>
                <form onSubmit={handleFacturaSubmit} className="space-y-4">
                  <FormField label="# Factura" value={facForm.facturaNumero} onChange={(v) => setFacForm((p) => ({ ...p, facturaNumero: v }))} placeholder="001-2024" />
                  <FormField label="Cliente" value={facForm.cliente} onChange={(v) => setFacForm((p) => ({ ...p, cliente: v }))} placeholder="Nombre del cliente" />
                  <FormField label="Monto" type="number" value={facForm.monto} onChange={(v) => setFacForm((p) => ({ ...p, monto: v }))} placeholder="0.00" />
                  <button type="submit" disabled={facLoading} className="w-full bg-indigo-600 hover:bg-indigo-700 text-white py-2.5 rounded-lg font-medium transition disabled:opacity-60">
                    {facLoading ? "Registrando..." : "Registrar Factura"}
                  </button>
                </form>
              </div>
              <div className="bg-white rounded-xl shadow-sm p-5">
                <h3 className="font-semibold text-gray-700 mb-3">Mis facturas recientes</h3>
                <div className="space-y-2 max-h-80 overflow-y-auto">
                  {facturaRecords.length === 0 ? (
                    <p className="text-gray-400 text-sm text-center py-8">Sin facturas aún</p>
                  ) : facturaRecords.map((r) => (
                    <div key={r.id} className="border border-gray-100 rounded-lg p-3">
                      <div className="flex justify-between items-start">
                        <div>
                          <p className="font-medium text-sm text-gray-800">#{r.facturaNumero} — {r.cliente}</p>
                          <p className="text-xs text-gray-500">${r.monto?.toLocaleString()}</p>
                        </div>
                        <span className="text-xs bg-yellow-100 text-yellow-700 px-2 py-0.5 rounded-full">{r.estado}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function AppCard({ active, onClick, title, description, icon, color }: {
  active: boolean; onClick: () => void; title: string; description: string; icon: string; color: string;
}) {
  const colors: Record<string, string> = {
    blue: "border-blue-500 bg-blue-50 text-blue-700",
    indigo: "border-indigo-500 bg-indigo-50 text-indigo-700",
  };
  return (
    <button
      onClick={onClick}
      className={`flex-1 p-4 rounded-xl border-2 text-left transition ${active ? colors[color] : "border-gray-200 bg-white text-gray-600 hover:border-gray-300"}`}
    >
      <span className="text-2xl">{icon}</span>
      <p className="font-bold mt-1">{title}</p>
      <p className="text-xs opacity-75">{description}</p>
    </button>
  );
}

function FormField({ label, value, onChange, placeholder, type = "text" }: {
  label: string; value: string; onChange: (v: string) => void; placeholder: string; type?: string;
}) {
  return (
    <div>
      <label className="block text-sm font-medium text-gray-700 mb-1">{label}</label>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        required
        placeholder={placeholder}
        className="w-full px-3 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none text-sm text-gray-800"
      />
    </div>
  );
}
