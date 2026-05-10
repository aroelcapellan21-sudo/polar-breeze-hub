"use client";

import { useEffect, useState } from "react";
import { collection, onSnapshot, query, orderBy } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useAuth } from "@/lib/auth-context";
import { SpikinScanRecord, FacturaScanRecord, ImbentarioRecord } from "@/lib/types";

export default function AdminDashboard() {
  const { profile, logout } = useAuth();
  const [spikinData, setSpikinData] = useState<SpikinScanRecord[]>([]);
  const [facturaData, setFacturaData] = useState<FacturaScanRecord[]>([]);
  const [imbentarioData, setImbentarioData] = useState<ImbentarioRecord[]>([]);
  const [activeTab, setActiveTab] = useState<"overview" | "spikinscan" | "facturascan" | "imbentario">("overview");

  useEffect(() => {
    const q1 = query(collection(db, "spikinscan"), orderBy("timestamp", "desc"));
    const unsub1 = onSnapshot(q1, (snap) => {
      setSpikinData(snap.docs.map((d) => ({ id: d.id, ...d.data() } as SpikinScanRecord)));
    });

    const q2 = query(collection(db, "facturascan"), orderBy("timestamp", "desc"));
    const unsub2 = onSnapshot(q2, (snap) => {
      setFacturaData(snap.docs.map((d) => ({ id: d.id, ...d.data() } as FacturaScanRecord)));
    });

    const q3 = query(collection(db, "imbentario"), orderBy("timestamp", "desc"));
    const unsub3 = onSnapshot(q3, (snap) => {
      setImbentarioData(snap.docs.map((d) => ({ id: d.id, ...d.data() } as ImbentarioRecord)));
    });

    return () => { unsub1(); unsub2(); unsub3(); };
  }, []);

  const totalMonto = facturaData.reduce((s, f) => s + (f.monto || 0), 0);
  const totalEntregado = imbentarioData.reduce((s, i) => s + (i.cantidadEntregada || 0), 0);
  const pendientesSpikin = spikinData.filter((s) => s.estado === "pendiente").length;

  return (
    <div className="min-h-screen bg-gray-100">
      {/* Header */}
      <header className="bg-gradient-to-r from-purple-700 to-purple-900 text-white shadow-lg">
        <div className="max-w-7xl mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-white/20 rounded-full flex items-center justify-center font-bold text-lg">PB</div>
            <div>
              <h1 className="font-bold text-lg leading-tight">Polar Breeze Hub</h1>
              <p className="text-purple-200 text-xs">Panel Admin — Tiempo Real</p>
            </div>
          </div>
          <div className="flex items-center gap-4">
            <div className="text-right hidden sm:block">
              <p className="font-medium text-sm">{profile?.nombre}</p>
              <span className="bg-purple-500 text-xs px-2 py-0.5 rounded-full">Admin</span>
            </div>
            <button onClick={logout} className="bg-white/20 hover:bg-white/30 px-3 py-1.5 rounded-lg text-sm transition">
              Salir
            </button>
          </div>
        </div>
      </header>

      <div className="max-w-7xl mx-auto px-4 py-6">
        {/* Stats cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
          <StatCard label="Despachos Hoy" value={spikinData.length} color="blue" icon="📦" />
          <StatCard label="Pendientes" value={pendientesSpikin} color="yellow" icon="⏳" />
          <StatCard label="Facturado Total" value={`$${totalMonto.toLocaleString()}`} color="green" icon="💰" />
          <StatCard label="Unidades Entregadas" value={totalEntregado} color="cyan" icon="🚚" />
        </div>

        {/* Tabs */}
        <div className="flex gap-2 mb-4 flex-wrap">
          {[
            { key: "overview", label: "Resumen" },
            { key: "spikinscan", label: "SPIKINSCAN" },
            { key: "facturascan", label: "FACTURASCAN" },
            { key: "imbentario", label: "IMBENTARIO" },
          ].map((tab) => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key as typeof activeTab)}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition ${
                activeTab === tab.key
                  ? "bg-purple-700 text-white shadow"
                  : "bg-white text-gray-600 hover:bg-purple-50"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {activeTab === "overview" && (
          <div className="grid md:grid-cols-3 gap-4">
            <RecentList title="Últimos Despachos" color="blue" items={spikinData.slice(0, 5).map((s) => ({
              primary: s.producto,
              secondary: `${s.despachadorNombre} → ${s.destino}`,
              badge: s.estado,
            }))} />
            <RecentList title="Últimas Facturas" color="green" items={facturaData.slice(0, 5).map((f) => ({
              primary: `#${f.facturaNumero} — ${f.cliente}`,
              secondary: `$${f.monto?.toLocaleString()} | ${f.despachadorNombre}`,
              badge: f.estado,
            }))} />
            <RecentList title="Reportes Choferes" color="cyan" items={imbentarioData.slice(0, 5).map((i) => ({
              primary: i.choferNombre,
              secondary: `${i.producto}: ${i.cantidadEntregada}/${i.cantidadCargada} (${i.ruta})`,
              badge: i.vehiculo,
            }))} />
          </div>
        )}

        {activeTab === "spikinscan" && (
          <DataTable
            title="SPIKINSCAN — Todos los Registros"
            headers={["Producto", "Despachador", "Destino", "Cantidad", "Estado", "Fecha"]}
            rows={spikinData.map((s) => [
              s.producto,
              s.despachadorNombre,
              s.destino,
              s.cantidad,
              <Badge key="estado" text={s.estado} />,
              formatDate(s.timestamp),
            ])}
          />
        )}

        {activeTab === "facturascan" && (
          <DataTable
            title="FACTURASCAN — Todas las Facturas"
            headers={["# Factura", "Cliente", "Monto", "Despachador", "Estado", "Fecha"]}
            rows={facturaData.map((f) => [
              `#${f.facturaNumero}`,
              f.cliente,
              `$${f.monto?.toLocaleString()}`,
              f.despachadorNombre,
              <Badge key="estado" text={f.estado} />,
              formatDate(f.timestamp),
            ])}
          />
        )}

        {activeTab === "imbentario" && (
          <DataTable
            title="IMBENTARIO — Reportes de Choferes"
            headers={["Chofer", "Vehículo", "Producto", "Cargado", "Entregado", "Ruta", "Fecha"]}
            rows={imbentarioData.map((i) => [
              i.choferNombre,
              i.vehiculo,
              i.producto,
              i.cantidadCargada,
              i.cantidadEntregada,
              i.ruta,
              formatDate(i.timestamp),
            ])}
          />
        )}
      </div>
    </div>
  );
}

function StatCard({ label, value, color, icon }: { label: string; value: string | number; color: string; icon: string }) {
  const colors: Record<string, string> = {
    blue: "from-blue-500 to-blue-600",
    yellow: "from-yellow-500 to-orange-500",
    green: "from-green-500 to-emerald-600",
    cyan: "from-cyan-500 to-teal-600",
  };
  return (
    <div className={`bg-gradient-to-br ${colors[color]} text-white rounded-xl p-4 shadow-md`}>
      <div className="text-2xl mb-1">{icon}</div>
      <div className="text-2xl font-bold">{value}</div>
      <div className="text-sm opacity-90">{label}</div>
    </div>
  );
}

function RecentList({ title, color, items }: { title: string; color: string; items: { primary: string; secondary: string; badge: string }[] }) {
  const colors: Record<string, string> = { blue: "text-blue-600", green: "text-green-600", cyan: "text-cyan-600" };
  return (
    <div className="bg-white rounded-xl shadow-sm p-4">
      <h3 className={`font-semibold ${colors[color]} mb-3`}>{title}</h3>
      {items.length === 0 ? (
        <p className="text-gray-400 text-sm text-center py-4">Sin registros</p>
      ) : (
        <div className="space-y-2">
          {items.map((item, i) => (
            <div key={i} className="border-b border-gray-100 pb-2 last:border-0">
              <p className="text-sm font-medium text-gray-800">{item.primary}</p>
              <p className="text-xs text-gray-500">{item.secondary}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function DataTable({ title, headers, rows }: { title: string; headers: string[]; rows: (string | number | React.ReactNode)[][] }) {
  return (
    <div className="bg-white rounded-xl shadow-sm overflow-hidden">
      <div className="px-4 py-3 border-b">
        <h3 className="font-semibold text-gray-800">{title}</h3>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-gray-50">
            <tr>
              {headers.map((h) => (
                <th key={h} className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {rows.length === 0 ? (
              <tr><td colSpan={headers.length} className="px-4 py-8 text-center text-gray-400">Sin registros</td></tr>
            ) : (
              rows.map((row, i) => (
                <tr key={i} className="hover:bg-gray-50">
                  {row.map((cell, j) => (
                    <td key={j} className="px-4 py-3 text-gray-700">{cell}</td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Badge({ text }: { text: string }) {
  const colors: Record<string, string> = {
    pendiente: "bg-yellow-100 text-yellow-700",
    despachado: "bg-blue-100 text-blue-700",
    entregado: "bg-green-100 text-green-700",
    procesada: "bg-blue-100 text-blue-700",
    pagada: "bg-green-100 text-green-700",
  };
  return (
    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${colors[text] || "bg-gray-100 text-gray-600"}`}>
      {text}
    </span>
  );
}

function formatDate(ts: Date | { seconds: number } | undefined): string {
  if (!ts) return "—";
  const date = ts instanceof Date ? ts : new Date((ts as { seconds: number }).seconds * 1000);
  return date.toLocaleDateString("es-MX", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
}
