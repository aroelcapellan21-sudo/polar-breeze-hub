"use client";

import { useEffect, useState } from "react";
import { collection, query, orderBy, onSnapshot, limit } from "firebase/firestore";
import { db } from "@/lib/firebase";
import {
  SpikinScanRecord, FacturaScanRecord, ImbentarioRecord, WeightAlert,
  fmtDate, toDate,
} from "@/lib/types";

export default function TiempoReal() {
  const [spikin,   setSpikin]   = useState<SpikinScanRecord[]>([]);
  const [factura,  setFactura]  = useState<FacturaScanRecord[]>([]);
  const [imb,      setImb]      = useState<ImbentarioRecord[]>([]);
  const [alerts,   setAlerts]   = useState<WeightAlert[]>([]);

  useEffect(() => {
    const q1 = query(collection(db, "spikinscan"),   orderBy("timestamp", "desc"), limit(50));
    const q2 = query(collection(db, "facturascan"),  orderBy("timestamp", "desc"), limit(50));
    const q3 = query(collection(db, "imbentario"),   orderBy("timestamp", "desc"), limit(50));
    const q4 = query(collection(db, "weight_alerts"),orderBy("timestamp", "desc"), limit(20));

    const u1 = onSnapshot(q1, (s) => setSpikin(s.docs.map((d) => ({ id: d.id, ...d.data() } as SpikinScanRecord))));
    const u2 = onSnapshot(q2, (s) => setFactura(s.docs.map((d) => ({ id: d.id, ...d.data() } as FacturaScanRecord))));
    const u3 = onSnapshot(q3, (s) => setImb(s.docs.map((d)     => ({ id: d.id, ...d.data() } as ImbentarioRecord))));
    const u4 = onSnapshot(q4, (s) => setAlerts(s.docs.map((d)  => ({ id: d.id, ...d.data() } as WeightAlert))));

    return () => { u1(); u2(); u3(); u4(); };
  }, []);

  // Stats resumen
  const hoy = new Date(); hoy.setHours(0, 0, 0, 0);
  const spikinHoy  = spikin.filter((r) => toDate(r.timestamp) >= hoy);
  const facturaHoy = factura.filter((r) => toDate(r.timestamp) >= hoy);
  const imbHoy     = imb.filter((r) => toDate(r.timestamp) >= hoy);

  const totalFacturado = facturaHoy.reduce((s, f) => s + (f.monto ?? 0), 0);
  const alertasCrit    = alerts.filter((a) => a.severity === "critical").length;

  return (
    <div className="space-y-5">
      {/* ── Stats superiores ── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Stat icon="📦" label="Despachos hoy"   value={spikinHoy.length}              color="from-blue-500 to-blue-700" />
        <Stat icon="🧾" label="Facturas hoy"    value={facturaHoy.length}             color="from-indigo-500 to-indigo-700" />
        <Stat icon="💰" label="Facturado hoy"   value={`$${totalFacturado.toLocaleString()}`} color="from-green-500 to-emerald-700" />
        <Stat icon="⚖️" label="Alertas peso"    value={alertasCrit > 0 ? `🚨 ${alertasCrit}` : "0"} color={alertasCrit > 0 ? "from-red-500 to-red-700" : "from-gray-400 to-gray-600"} />
      </div>

      {/* ── Alertas de peso ── */}
      {alerts.length > 0 && (
        <div className="bg-white rounded-xl shadow-sm p-4">
          <h3 className="font-bold text-red-600 mb-3 flex items-center gap-2">
            ⚖️ Polar Breeze Weight — Alertas de diferencia
          </h3>
          <div className="space-y-2 max-h-48 overflow-y-auto">
            {alerts.map((a) => (
              <div key={a.id}
                className={`flex items-center gap-3 px-3 py-2 rounded-lg ${
                  a.severity === "critical"
                    ? "bg-red-50 border border-red-200"
                    : "bg-yellow-50 border border-yellow-200"
                }`}
              >
                <span className="text-lg">{a.severity === "critical" ? "🚨" : "⚠️"}</span>
                <div className="flex-1">
                  <p className="text-sm font-medium text-gray-800">{a.producto}</p>
                  <p className="text-xs text-gray-500">
                    {a.choferNombre} · Cargado {a.pesoCargado} kg → Entregado {a.pesoEntregado} kg
                    · Diff: <strong className="text-red-600">{a.diferencia.toFixed(1)} kg ({a.porcentaje.toFixed(1)}%)</strong>
                  </p>
                </div>
                <span className="text-xs text-gray-400 flex-shrink-0">{fmtDate(a.timestamp)}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Tres columnas en tiempo real ── */}
      <div className="grid lg:grid-cols-3 gap-4">
        {/* SPIKINSCAN */}
        <LiveFeed
          title="📦 SPIKINSCAN"
          color="blue"
          badge={spikinHoy.length}
          empty="Sin despachos hoy"
          items={spikin.slice(0, 20).map((r) => ({
            key: r.id!,
            top: r.producto,
            sub: `${r.despachadorNombre} → ${r.destino} | Cant: ${r.cantidad}`,
            badge: r.estado,
            ts: r.timestamp,
            isToday: toDate(r.timestamp) >= hoy,
          }))}
        />

        {/* FACTURASCAN */}
        <LiveFeed
          title="🧾 FACTURASCAN"
          color="indigo"
          badge={facturaHoy.length}
          empty="Sin facturas hoy"
          items={factura.slice(0, 20).map((r) => ({
            key: r.id!,
            top: `#${r.facturaNumero} — ${r.cliente}`,
            sub: `$${r.monto?.toLocaleString()} · ${r.despachadorNombre}`,
            badge: r.estado,
            ts: r.timestamp,
            isToday: toDate(r.timestamp) >= hoy,
          }))}
        />

        {/* IMBENTARIO */}
        <LiveFeed
          title="🚚 IMBENTARIO"
          color="cyan"
          badge={imbHoy.length}
          empty="Sin reportes hoy"
          items={imb.slice(0, 20).map((r) => ({
            key: r.id!,
            top: r.choferNombre,
            sub: `${r.producto} · ${r.cantidadEntregada}/${r.cantidadCargada} uds · ${r.ruta}`,
            badge: r.vehiculo,
            ts: r.timestamp,
            isToday: toDate(r.timestamp) >= hoy,
          }))}
        />
      </div>
    </div>
  );
}

// ─── Sub-componentes ──────────────────────────────────────────────────────────

function Stat({ icon, label, value, color }: { icon: string; label: string; value: string | number; color: string }) {
  return (
    <div className={`bg-gradient-to-br ${color} text-white rounded-xl p-4 shadow-sm`}>
      <div className="text-2xl mb-1">{icon}</div>
      <div className="text-2xl font-bold leading-tight">{value}</div>
      <div className="text-xs opacity-80 mt-0.5">{label}</div>
    </div>
  );
}

type FeedItem = {
  key: string; top: string; sub: string;
  badge: string; ts: Date | { seconds: number } | undefined; isToday: boolean;
};

function LiveFeed({ title, color, badge, empty, items }: {
  title: string; color: string; badge: number; empty: string; items: FeedItem[];
}) {
  const colors: Record<string, string> = {
    blue: "text-blue-700 border-blue-200 bg-blue-50",
    indigo: "text-indigo-700 border-indigo-200 bg-indigo-50",
    cyan: "text-cyan-700 border-cyan-200 bg-cyan-50",
  };
  const dotColors: Record<string, string> = {
    blue: "bg-blue-500", indigo: "bg-indigo-500", cyan: "bg-cyan-500",
  };

  return (
    <div className="bg-white rounded-xl shadow-sm flex flex-col">
      <div className="flex items-center justify-between px-4 py-3 border-b">
        <h3 className={`font-bold text-sm ${colors[color].split(" ")[0]}`}>{title}</h3>
        <span className={`text-xs font-bold px-2 py-0.5 rounded-full border ${colors[color]}`}>
          {badge} hoy
        </span>
      </div>

      <div className="flex-1 overflow-y-auto max-h-72 divide-y divide-gray-50">
        {items.length === 0 ? (
          <p className="text-center text-gray-400 text-sm py-8">{empty}</p>
        ) : items.map((item) => (
          <div key={item.key} className={`px-4 py-2.5 ${item.isToday ? "" : "opacity-60"}`}>
            <div className="flex items-start gap-2">
              <span className={`w-1.5 h-1.5 rounded-full mt-1.5 flex-shrink-0 ${dotColors[color]}`}></span>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-gray-800 truncate">{item.top}</p>
                <p className="text-xs text-gray-500 truncate">{item.sub}</p>
              </div>
              <span className="text-xs text-gray-400 flex-shrink-0">{fmtDate(item.ts)}</span>
            </div>
          </div>
        ))}
      </div>

      {/* Indicador en vivo */}
      <div className="px-4 py-2 border-t flex items-center gap-1.5">
        <span className={`w-2 h-2 rounded-full animate-pulse ${dotColors[color]}`}></span>
        <span className="text-xs text-gray-400">En tiempo real</span>
      </div>
    </div>
  );
}
