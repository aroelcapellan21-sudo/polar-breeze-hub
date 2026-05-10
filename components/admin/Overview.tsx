"use client";

import { useEffect, useMemo, useState } from "react";
import {
  collection, query, orderBy, onSnapshot, limit, where,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import {
  SpikinScanRecord, FacturaScanRecord, ImbentarioRecord,
  WeightAlert, UserProfile,
  calcSemaforo, Semaforo, toDate, fmtDate,
} from "@/lib/types";

interface Props {
  onVerChofer: (c: UserProfile) => void;
}

const SEM: Record<Semaforo, { icon: string; ring: string; bg: string; label: string }> = {
  verde:    { icon: "✅", ring: "ring-green-300",  bg: "bg-green-50",  label: "Normal"   },
  amarillo: { icon: "⚠️", ring: "ring-yellow-300", bg: "bg-yellow-50", label: "Revisar"  },
  rojo:     { icon: "🚨", ring: "ring-red-300",    bg: "bg-red-50",    label: "Crítico"  },
};

export default function Overview({ onVerChofer }: Props) {
  const [choferes,  setChoferes]  = useState<UserProfile[]>([]);
  const [spikin,    setSpikin]    = useState<SpikinScanRecord[]>([]);
  const [factura,   setFactura]   = useState<FacturaScanRecord[]>([]);
  const [imb,       setImb]       = useState<ImbentarioRecord[]>([]);
  const [alerts,    setAlerts]    = useState<WeightAlert[]>([]);

  useEffect(() => {
    const u0 = onSnapshot(
      query(collection(db, "usuarios"), where("role", "==", "chofer")),
      (s) => setChoferes(s.docs.map((d) => d.data() as UserProfile))
    );
    const u1 = onSnapshot(
      query(collection(db, "spikinscan"),    orderBy("timestamp", "desc"), limit(40)),
      (s) => setSpikin(s.docs.map((d) => ({ id: d.id, ...d.data() } as SpikinScanRecord)))
    );
    const u2 = onSnapshot(
      query(collection(db, "facturascan"),   orderBy("timestamp", "desc"), limit(40)),
      (s) => setFactura(s.docs.map((d) => ({ id: d.id, ...d.data() } as FacturaScanRecord)))
    );
    const u3 = onSnapshot(
      query(collection(db, "imbentario"),    orderBy("timestamp", "desc"), limit(100)),
      (s) => setImb(s.docs.map((d) => ({ id: d.id, ...d.data() } as ImbentarioRecord)))
    );
    const u4 = onSnapshot(
      query(collection(db, "weight_alerts"), orderBy("timestamp", "desc"), limit(20)),
      (s) => setAlerts(s.docs.map((d) => ({ id: d.id, ...d.data() } as WeightAlert)))
    );
    return () => { u0(); u1(); u2(); u3(); u4(); };
  }, []);

  const hoy = useMemo(() => { const d = new Date(); d.setHours(0,0,0,0); return d; }, []);

  const spikinHoy      = spikin.filter((r) => toDate(r.timestamp) >= hoy);
  const facturaHoy     = factura.filter((r) => toDate(r.timestamp) >= hoy);
  const imbHoy         = imb.filter((r) => toDate(r.timestamp) >= hoy);
  const totalFacturado = facturaHoy.reduce((s, f) => s + (f.monto ?? 0), 0);
  const alertasCrit    = alerts.filter((a) => a.severity === "critical").length;
  const chofActivos    = choferes.filter((c) => c.activo !== false).length;

  // Semáforo por chofer (últimos 15 días)
  const hace15 = useMemo(() => { const d = new Date(); d.setDate(d.getDate() - 15); return d; }, []);
  const imbPorChofer = useMemo(() => {
    const map: Record<string, ImbentarioRecord[]> = {};
    imb.forEach((r) => {
      if (toDate(r.timestamp) < hace15) return;
      if (!map[r.choferId]) map[r.choferId] = [];
      map[r.choferId].push(r);
    });
    return map;
  }, [imb, hace15]);

  const imbHoyPorChofer = useMemo(() => {
    const map: Record<string, ImbentarioRecord[]> = {};
    imbHoy.forEach((r) => {
      if (!map[r.choferId]) map[r.choferId] = [];
      map[r.choferId].push(r);
    });
    return map;
  }, [imbHoy]);

  return (
    <div className="space-y-6">

      {/* ── KPI Cards ── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <KpiCard icon="👥" label="Choferes activos" value={chofActivos}
          sub={`${choferes.length} total`} color="from-purple-600 to-purple-800" />
        <KpiCard icon="📦" label="Despachos hoy" value={spikinHoy.length}
          sub={`${spikin.length} total`} color="from-blue-500 to-blue-700" />
        <KpiCard icon="💰" label="Facturado hoy" value={`$${totalFacturado.toLocaleString()}`}
          sub={`${facturaHoy.length} facturas`} color="from-green-500 to-emerald-700" />
        <KpiCard icon={alertasCrit > 0 ? "🚨" : "✅"} label="Alertas peso"
          value={alertasCrit > 0 ? alertasCrit : "OK"}
          sub={alertasCrit > 0 ? "Atención requerida" : "Sin alertas críticas"}
          color={alertasCrit > 0 ? "from-red-500 to-red-700" : "from-gray-500 to-gray-700"} />
      </div>

      {/* ── Semáforo de choferes ── */}
      <div className="bg-white rounded-xl shadow-sm p-5">
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-bold text-gray-800">
            Semáforo de choferes
            <span className="ml-2 text-xs font-normal text-gray-400">últimos 15 días</span>
          </h2>
          <div className="flex gap-3 text-xs text-gray-500">
            <span>✅ &lt;5% diff</span>
            <span>⚠️ 5–15%</span>
            <span>🚨 &gt;15%</span>
          </div>
        </div>

        {choferes.filter((c) => c.activo !== false).length === 0 ? (
          <p className="text-center text-gray-400 py-8 text-sm">
            Sin choferes activos — crea uno en la pestaña Choferes
          </p>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
            {choferes
              .filter((c) => c.activo !== false)
              .map((chofer) => {
                const registros15 = imbPorChofer[chofer.uid] ?? [];
                const registrosHoy = imbHoyPorChofer[chofer.uid] ?? [];
                const sem = calcSemaforo(registros15);
                const cfg = SEM[sem];
                const entregadoHoy = registrosHoy.reduce((s, r) => s + (r.cantidadEntregada ?? 0), 0);
                const cargadoHoy   = registrosHoy.reduce((s, r) => s + (r.cantidadCargada ?? 0), 0);

                return (
                  <button
                    key={chofer.uid}
                    onClick={() => onVerChofer(chofer)}
                    className={`${cfg.bg} ring-2 ${cfg.ring} rounded-xl p-3 text-left
                      hover:scale-[1.02] transition-transform active:scale-[0.98]`}
                  >
                    <div className="flex items-center justify-between mb-2">
                      <div className="w-8 h-8 bg-cyan-500 rounded-full flex items-center
                        justify-center text-white font-bold text-sm">
                        {chofer.nombre.charAt(0).toUpperCase()}
                      </div>
                      <span className="text-xl">{cfg.icon}</span>
                    </div>
                    <p className="font-semibold text-sm text-gray-800 truncate">{chofer.nombre}</p>
                    <p className="text-xs text-gray-400">Ficha {chofer.ficha ?? "—"}</p>
                    {registrosHoy.length > 0 ? (
                      <div className="mt-2 pt-2 border-t border-white/60">
                        <p className="text-xs font-medium text-gray-600">
                          Hoy: {entregadoHoy}/{cargadoHoy} uds
                        </p>
                        {/* barra de progreso del día */}
                        <div className="mt-1 h-1 bg-white/70 rounded-full overflow-hidden">
                          <div
                            className={`h-full rounded-full ${
                              sem === "verde" ? "bg-green-500"
                                : sem === "amarillo" ? "bg-yellow-500"
                                : "bg-red-500"
                            }`}
                            style={{ width: cargadoHoy > 0
                              ? `${Math.min((entregadoHoy / cargadoHoy) * 100, 100)}%`
                              : "0%" }}
                          />
                        </div>
                      </div>
                    ) : (
                      <p className="text-xs text-gray-400 mt-2">Sin actividad hoy</p>
                    )}
                  </button>
                );
              })}
          </div>
        )}
      </div>

      {/* ── Alertas de peso ── */}
      {alerts.length > 0 && (
        <div className="bg-white rounded-xl shadow-sm p-4">
          <h3 className="font-bold text-red-600 mb-3">⚖️ Polar Breeze Weight — Alertas</h3>
          <div className="space-y-2 max-h-44 overflow-y-auto">
            {alerts.map((a) => (
              <div key={a.id}
                className={`flex items-center gap-3 px-3 py-2 rounded-lg border ${
                  a.severity === "critical"
                    ? "bg-red-50 border-red-200"
                    : "bg-yellow-50 border-yellow-200"
                }`}
              >
                <span className="text-lg flex-shrink-0">
                  {a.severity === "critical" ? "🚨" : "⚠️"}
                </span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-gray-800">{a.producto}</p>
                  <p className="text-xs text-gray-500 truncate">
                    {a.choferNombre} · {a.pesoCargado}kg → {a.pesoEntregado}kg ·
                    <strong className="text-red-600 ml-1">
                      Diff {a.diferencia.toFixed(1)}kg ({a.porcentaje.toFixed(0)}%)
                    </strong>
                  </p>
                </div>
                <span className="text-xs text-gray-400 flex-shrink-0">{fmtDate(a.timestamp)}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Feeds en tiempo real ── */}
      <div className="grid lg:grid-cols-3 gap-4">
        <Feed
          title="📦 SPIKINSCAN"
          accent="blue"
          badgeHoy={spikinHoy.length}
          items={spikin.slice(0, 20).map((r) => ({
            key: r.id!,
            top:     r.producto,
            sub:     `${r.despachadorNombre} → ${r.destino} · ×${r.cantidad}`,
            status:  r.estado,
            ts:      r.timestamp,
            isToday: toDate(r.timestamp) >= hoy,
          }))}
        />
        <Feed
          title="🧾 FACTURASCAN"
          accent="indigo"
          badgeHoy={facturaHoy.length}
          items={factura.slice(0, 20).map((r) => ({
            key:     r.id!,
            top:     `#${r.facturaNumero} — ${r.cliente}`,
            sub:     `$${(r.monto ?? 0).toLocaleString()} · ${r.despachadorNombre}`,
            status:  r.estado,
            ts:      r.timestamp,
            isToday: toDate(r.timestamp) >= hoy,
          }))}
        />
        <Feed
          title="🚚 IMBENTARIO"
          accent="cyan"
          badgeHoy={imbHoy.length}
          items={imb.slice(0, 20).map((r) => ({
            key:     r.id!,
            top:     r.choferNombre,
            sub:     `${r.producto} · ${r.cantidadEntregada}/${r.cantidadCargada} uds · ${r.ruta}`,
            status:  r.vehiculo,
            ts:      r.timestamp,
            isToday: toDate(r.timestamp) >= hoy,
          }))}
        />
      </div>

    </div>
  );
}

// ─── Sub-componentes locales ──────────────────────────────────────────────────

function KpiCard({ icon, label, value, sub, color }: {
  icon: string; label: string; value: string | number; sub: string; color: string;
}) {
  return (
    <div className={`bg-gradient-to-br ${color} text-white rounded-xl p-4 shadow-sm`}>
      <p className="text-2xl mb-1">{icon}</p>
      <p className="text-2xl font-bold leading-tight">{value}</p>
      <p className="text-xs opacity-80 mt-0.5">{label}</p>
      <p className="text-xs opacity-60 mt-0.5">{sub}</p>
    </div>
  );
}

type FeedItem = {
  key: string; top: string; sub: string;
  status: string; ts: Date | { seconds: number } | undefined; isToday: boolean;
};

const ACCENT_CLASSES: Record<string, { header: string; dot: string; pulse: string; badge: string }> = {
  blue:  { header: "text-blue-700",   dot: "bg-blue-500",   pulse: "bg-blue-400",   badge: "bg-blue-50 text-blue-700 border-blue-200"   },
  indigo:{ header: "text-indigo-700", dot: "bg-indigo-500", pulse: "bg-indigo-400", badge: "bg-indigo-50 text-indigo-700 border-indigo-200" },
  cyan:  { header: "text-cyan-700",   dot: "bg-cyan-500",   pulse: "bg-cyan-400",   badge: "bg-cyan-50 text-cyan-700 border-cyan-200"   },
};

function Feed({ title, accent, badgeHoy, items }: {
  title: string; accent: string; badgeHoy: number; items: FeedItem[];
}) {
  const c = ACCENT_CLASSES[accent];
  return (
    <div className="bg-white rounded-xl shadow-sm flex flex-col overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3 border-b">
        <h3 className={`font-bold text-sm ${c.header}`}>{title}</h3>
        <span className={`text-xs font-semibold px-2 py-0.5 rounded-full border ${c.badge}`}>
          {badgeHoy} hoy
        </span>
      </div>

      <div className="flex-1 overflow-y-auto max-h-64 divide-y divide-gray-50">
        {items.length === 0 ? (
          <p className="text-center text-gray-400 text-sm py-10">Sin registros</p>
        ) : items.map((item) => (
          <div key={item.key} className={`px-4 py-2.5 ${item.isToday ? "" : "opacity-50"}`}>
            <div className="flex items-start gap-2">
              <span className={`w-1.5 h-1.5 rounded-full mt-1.5 flex-shrink-0 ${c.dot}`} />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-gray-800 truncate">{item.top}</p>
                <p className="text-xs text-gray-400 truncate">{item.sub}</p>
              </div>
              <span className="text-xs text-gray-400 whitespace-nowrap">{fmtDate(item.ts)}</span>
            </div>
          </div>
        ))}
      </div>

      <div className="px-4 py-2 border-t flex items-center gap-1.5">
        <span className={`w-2 h-2 rounded-full animate-pulse ${c.pulse}`} />
        <span className="text-xs text-gray-400">En tiempo real</span>
      </div>
    </div>
  );
}
