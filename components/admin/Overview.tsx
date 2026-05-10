"use client";

import { useEffect, useMemo, useState } from "react";
import {
  collection, doc, query, orderBy,
  onSnapshot, limit, where,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import {
  SpikinScanRecord, FacturaScanRecord, ImbentarioRecord,
  WeightAlert, UserProfile,
  FsSession, FsDriver, FsHistory, FsConfig,
  calcSemaforo, Semaforo, toDate, fmtDate,
} from "@/lib/types";

interface Props {
  onVerChofer: (c: UserProfile) => void;
}

const SEM: Record<Semaforo, { icon: string; ring: string; bg: string; label: string }> = {
  verde:    { icon: "✅", ring: "ring-green-300",  bg: "bg-green-50",  label: "Normal"  },
  amarillo: { icon: "⚠️", ring: "ring-yellow-300", bg: "bg-yellow-50", label: "Revisar" },
  rojo:     { icon: "🚨", ring: "ring-red-300",    bg: "bg-red-50",    label: "Crítico" },
};

export default function Overview({ onVerChofer }: Props) {

  // ── Listeners existentes del Hub (sin cambios) ────────────────────────────
  const [choferes, setChoferes] = useState<UserProfile[]>([]);
  const [spikin,   setSpikin]   = useState<SpikinScanRecord[]>([]);
  const [factura,  setFactura]  = useState<FacturaScanRecord[]>([]);
  const [imb,      setImb]      = useState<ImbentarioRecord[]>([]);
  const [alerts,   setAlerts]   = useState<WeightAlert[]>([]);

  // ── Listeners adicionales de FacturaScan ─────────────────────────────────
  const [fsSession, setFsSession] = useState<FsSession | null>(null);
  const [fsDrivers, setFsDrivers] = useState<FsDriver[]>([]);
  const [fsHistory, setFsHistory] = useState<FsHistory[]>([]);
  const [fsConfig,  setFsConfig]  = useState<FsConfig | null>(null);

  useEffect(() => {
    // ── Hub (intactos) ────────────────────────────────────────────────────
    const uChof = onSnapshot(
      query(collection(db, "usuarios"), where("role", "==", "chofer")),
      (s) => setChoferes(s.docs.map((d) => d.data() as UserProfile))
    );
    const uSp = onSnapshot(
      query(collection(db, "spikinscan"),  orderBy("timestamp", "desc"), limit(40)),
      (s) => setSpikin(s.docs.map((d) => ({ id: d.id, ...d.data() } as SpikinScanRecord)))
    );
    const uFac = onSnapshot(
      query(collection(db, "facturascan"), orderBy("timestamp", "desc"), limit(40)),
      (s) => setFactura(s.docs.map((d) => ({ id: d.id, ...d.data() } as FacturaScanRecord)))
    );
    const uImb = onSnapshot(
      query(collection(db, "imbentario"),  orderBy("timestamp", "desc"), limit(100)),
      (s) => setImb(s.docs.map((d) => ({ id: d.id, ...d.data() } as ImbentarioRecord)))
    );
    const uAl = onSnapshot(
      query(collection(db, "weight_alerts"), orderBy("timestamp", "desc"), limit(20)),
      (s) => setAlerts(s.docs.map((d) => ({ id: d.id, ...d.data() } as WeightAlert)))
    );

    // ── FacturaScan — documento session/despacho ──────────────────────────
    const uSess = onSnapshot(doc(db, "session", "despacho"), (snap) => {
      setFsSession(snap.exists() ? (snap.data() as FsSession) : null);
    });

    // ── FacturaScan — colección drivers ───────────────────────────────────
    const uDrv = onSnapshot(
      query(collection(db, "drivers"), orderBy("nombre")),
      (s) => setFsDrivers(s.docs.map((d) => ({ id: d.id, ...d.data() } as FsDriver)))
    );

    // ── FacturaScan — colección history ───────────────────────────────────
    const uHist = onSnapshot(
      query(collection(db, "history"), orderBy("timestamp", "desc"), limit(60)),
      (s) => setFsHistory(s.docs.map((d) => ({ id: d.id, ...d.data() } as FsHistory)))
    );

    // ── FacturaScan — documento config/main ──────────────────────────────
    const uCfg = onSnapshot(doc(db, "config", "main"), (snap) => {
      setFsConfig(snap.exists() ? (snap.data() as FsConfig) : null);
    });

    return () => {
      uChof(); uSp(); uFac(); uImb(); uAl();
      uSess(); uDrv(); uHist(); uCfg();
    };
  }, []);

  // ── Tiempo ───────────────────────────────────────────────────────────────
  const hoy = useMemo(() => {
    const d = new Date(); d.setHours(0, 0, 0, 0); return d;
  }, []);
  const hace15 = useMemo(() => {
    const d = new Date(); d.setDate(d.getDate() - 15); return d;
  }, []);

  // ── Datos del Hub filtrados por fecha ────────────────────────────────────
  const spikinHoy  = spikin.filter((r) => toDate(r.timestamp) >= hoy);
  const facturaHoy = factura.filter((r) => toDate(r.timestamp) >= hoy);
  const imbHoy     = imb.filter((r) => toDate(r.timestamp) >= hoy);

  // ── KPIs combinados: Hub + FacturaScan session/despacho ─────────────────
  const kpiDespachos = spikinHoy.length + (fsSession?.totalDespachos ?? 0);
  const kpiFacturado =
    facturaHoy.reduce((s, f) => s + (f.monto ?? 0), 0) + (fsSession?.totalMonto ?? 0);
  const kpiUnidades  =
    imbHoy.reduce((s, r) => s + (r.cantidadEntregada ?? 0), 0) +
    (fsSession?.totalUnidades ?? 0);
  const kpiPeso      =
    imbHoy.reduce((s, r) => s + (r.peso ?? 0), 0) + (fsSession?.totalPeso ?? 0);
  const alertasCrit  = alerts.filter((a) => a.severity === "critical").length;
  const chofActivos  = choferes.filter((c) => c.activo !== false).length;

  // ── Semáforo por chofer (imbentario últimos 15d) ─────────────────────────
  const imbPorChofer = useMemo(() => {
    const map: Record<string, ImbentarioRecord[]> = {};
    imb.forEach((r) => {
      if (toDate(r.timestamp) < hace15) return;
      (map[r.choferId] ??= []).push(r);
    });
    return map;
  }, [imb, hace15]);

  const imbHoyPorChofer = useMemo(() => {
    const map: Record<string, ImbentarioRecord[]> = {};
    imbHoy.forEach((r) => { (map[r.choferId] ??= []).push(r); });
    return map;
  }, [imbHoy]);

  // ── Enriquecer choferes con datos de drivers de FacturaScan ─────────────
  // Intenta hacer match por ficha, luego por nombre (case-insensitive)
  const driverPorChofer = useMemo(() => {
    const map: Record<string, FsDriver> = {};
    choferes.forEach((ch) => {
      const match = fsDrivers.find(
        (d) =>
          (ch.ficha && d.ficha && d.ficha === ch.ficha) ||
          (d.nombre?.toLowerCase().trim() === ch.nombre.toLowerCase().trim())
      );
      if (match) map[ch.uid] = match;
    });
    return map;
  }, [choferes, fsDrivers]);

  // ── Historial cruzado: combina history de FacturaScan + feeds del Hub ───
  type HistItem = {
    key: string; ts: Date; label: string;
    top: string; sub: string; source: "facturascan" | "hub-sp" | "hub-fac" | "hub-imb";
  };

  const historialCruzado = useMemo((): HistItem[] => {
    const items: HistItem[] = [];

    // history de FacturaScan
    fsHistory.forEach((h) => {
      const ts = toDate(h.timestamp);
      items.push({
        key:    `fs-${h.id}`,
        ts,
        source: "facturascan",
        label:  h.tipo ?? "registro",
        top:    h.producto ?? h.cliente ?? h.choferNombre ?? "FacturaScan",
        sub:    [
          h.cantidad   ? `×${h.cantidad}`       : null,
          h.monto      ? `$${h.monto.toLocaleString()}` : null,
          h.peso       ? `${h.peso}kg`           : null,
          h.despachadorNombre ?? h.choferNombre  ?? null,
        ].filter(Boolean).join(" · "),
      });
    });

    // SPIKINSCAN (últimos 20)
    spikin.slice(0, 20).forEach((r) => {
      items.push({
        key:    `sp-${r.id}`,
        ts:     toDate(r.timestamp),
        source: "hub-sp",
        label:  "despacho",
        top:    r.producto,
        sub:    `${r.despachadorNombre} → ${r.destino} · ×${r.cantidad}`,
      });
    });

    // FACTURASCAN del Hub (últimos 20)
    factura.slice(0, 20).forEach((r) => {
      items.push({
        key:    `fac-${r.id}`,
        ts:     toDate(r.timestamp),
        source: "hub-fac",
        label:  "factura",
        top:    `#${r.facturaNumero} — ${r.cliente}`,
        sub:    `$${(r.monto ?? 0).toLocaleString()} · ${r.despachadorNombre}`,
      });
    });

    // IMBENTARIO (últimos 20)
    imb.slice(0, 20).forEach((r) => {
      items.push({
        key:    `imb-${r.id}`,
        ts:     toDate(r.timestamp),
        source: "hub-imb",
        label:  "inventario",
        top:    r.choferNombre,
        sub:    `${r.producto} · ${r.cantidadEntregada}/${r.cantidadCargada} uds`,
      });
    });

    return items
      .filter((i) => i.ts.getTime() > 0)
      .sort((a, b) => b.ts.getTime() - a.ts.getTime())
      .slice(0, 40);
  }, [fsHistory, spikin, factura, imb]);

  const SOURCE_CFG = {
    "facturascan": { dot: "bg-orange-400",  badge: "bg-orange-50 text-orange-700 border-orange-200",  label: "FacturaScan" },
    "hub-sp":      { dot: "bg-blue-500",    badge: "bg-blue-50   text-blue-700   border-blue-200",    label: "SPIKINSCAN"  },
    "hub-fac":     { dot: "bg-indigo-500",  badge: "bg-indigo-50 text-indigo-700 border-indigo-200",  label: "FACTURASCAN" },
    "hub-imb":     { dot: "bg-cyan-500",    badge: "bg-cyan-50   text-cyan-700   border-cyan-200",    label: "IMBENTARIO"  },
  };

  // Umbrales de alerta desde config/main (con defaults)
  const umbralWarn = fsConfig?.alertaWarning  ?? 5;
  const umbralCrit = fsConfig?.alertaCritical ?? 15;

  return (
    <div className="space-y-6">

      {/* ── Empresa desde config/main ── */}
      {fsConfig?.nombreEmpresa && (
        <div className="flex items-center gap-2 text-sm text-gray-500">
          <span className="font-medium text-gray-700">{fsConfig.nombreEmpresa}</span>
          <span className="text-gray-300">·</span>
          <span>Alertas: ⚠️ &gt;{umbralWarn}% · 🚨 &gt;{umbralCrit}%</span>
          {fsConfig.moneda && <span className="text-gray-300">· {fsConfig.moneda}</span>}
        </div>
      )}

      {/* ── KPI Cards — Hub + FacturaScan session/despacho ── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <KpiCard
          icon="👥" label="Choferes activos"
          value={chofActivos}
          sub={`${choferes.length} Hub · ${fsDrivers.filter(d => d.activo !== false).length} FacturaScan`}
          color="from-purple-600 to-purple-800"
        />
        <KpiCard
          icon="📦" label="Despachos"
          value={kpiDespachos}
          sub={`${spikinHoy.length} SPIKIN${fsSession?.totalDespachos ? ` + ${fsSession.totalDespachos} sesión` : ""}`}
          color="from-blue-500 to-blue-700"
        />
        <KpiCard
          icon="💰" label="Facturado"
          value={`$${kpiFacturado.toLocaleString()}`}
          sub={`${facturaHoy.length} facturas${fsSession?.totalMonto ? ` + $${fsSession.totalMonto.toLocaleString()} sesión` : ""}`}
          color="from-green-500 to-emerald-700"
        />
        {kpiPeso > 0 ? (
          <KpiCard
            icon="⚖️" label="Peso total"
            value={`${kpiPeso.toFixed(1)} kg`}
            sub={`${kpiUnidades} uds entregadas`}
            color="from-teal-500 to-teal-700"
          />
        ) : (
          <KpiCard
            icon={alertasCrit > 0 ? "🚨" : "✅"} label="Alertas peso"
            value={alertasCrit > 0 ? alertasCrit : "OK"}
            sub={alertasCrit > 0 ? "Atención requerida" : "Sin alertas críticas"}
            color={alertasCrit > 0 ? "from-red-500 to-red-700" : "from-gray-500 to-gray-700"}
          />
        )}
      </div>

      {/* ── Sesión activa de FacturaScan ── */}
      {fsSession && (
        <div className="bg-orange-50 border border-orange-200 rounded-xl px-4 py-3
          flex flex-wrap items-center gap-x-6 gap-y-1">
          <span className="text-sm font-bold text-orange-700">
            🧾 Sesión FacturaScan
            {fsSession.estado && (
              <span className={`ml-2 text-xs px-2 py-0.5 rounded-full font-medium ${
                fsSession.estado === "activa"
                  ? "bg-green-100 text-green-700"
                  : "bg-gray-100 text-gray-600"
              }`}>{fsSession.estado}</span>
            )}
          </span>
          {fsSession.despachador && (
            <span className="text-xs text-orange-600">👤 {fsSession.despachador}</span>
          )}
          {fsSession.totalDespachos != null && (
            <span className="text-xs text-orange-600">📦 {fsSession.totalDespachos} despachos</span>
          )}
          {fsSession.totalMonto != null && (
            <span className="text-xs text-orange-600">💰 ${fsSession.totalMonto.toLocaleString()}</span>
          )}
          {fsSession.totalUnidades != null && (
            <span className="text-xs text-orange-600">📊 {fsSession.totalUnidades} unidades</span>
          )}
          {fsSession.totalPeso != null && (
            <span className="text-xs text-orange-600">⚖️ {fsSession.totalPeso} kg</span>
          )}
          {fsSession.fecha && (
            <span className="text-xs text-orange-400 ml-auto">{fmtDate(fsSession.fecha)}</span>
          )}
        </div>
      )}

      {/* ── Semáforo de choferes (Hub + drivers de FacturaScan) ── */}
      <div className="bg-white rounded-xl shadow-sm p-5">
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-bold text-gray-800">
            Semáforo de choferes
            <span className="ml-2 text-xs font-normal text-gray-400">últimos 15 días</span>
          </h2>
          <div className="flex items-center gap-3 text-xs text-gray-400">
            <span>✅ &lt;{umbralWarn}%</span>
            <span>⚠️ {umbralWarn}–{umbralCrit}%</span>
            <span>🚨 &gt;{umbralCrit}%</span>
          </div>
        </div>

        {/* Choferes del Hub */}
        {choferes.filter((c) => c.activo !== false).length === 0 &&
         fsDrivers.length === 0 ? (
          <p className="text-center text-gray-400 py-8 text-sm">
            Sin choferes registrados
          </p>
        ) : (
          <>
            {choferes.filter((c) => c.activo !== false).length > 0 && (
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
                {choferes
                  .filter((c) => c.activo !== false)
                  .map((chofer) => {
                    const rec15   = imbPorChofer[chofer.uid] ?? [];
                    const recHoy  = imbHoyPorChofer[chofer.uid] ?? [];
                    const sem     = calcSemaforo(rec15);
                    const cfg     = SEM[sem];
                    const entr    = recHoy.reduce((s, r) => s + (r.cantidadEntregada ?? 0), 0);
                    const carg    = recHoy.reduce((s, r) => s + (r.cantidadCargada ?? 0), 0);
                    const driver  = driverPorChofer[chofer.uid];

                    return (
                      <button
                        key={chofer.uid}
                        onClick={() => onVerChofer(chofer)}
                        className={`${cfg.bg} ring-2 ${cfg.ring} rounded-xl p-3 text-left
                          hover:scale-[1.02] active:scale-[0.98] transition-transform`}
                      >
                        <div className="flex items-center justify-between mb-2">
                          <div className="w-8 h-8 bg-cyan-500 rounded-full flex items-center
                            justify-center text-white font-bold text-sm">
                            {chofer.nombre.charAt(0).toUpperCase()}
                          </div>
                          <span className="text-xl">{cfg.icon}</span>
                        </div>
                        <p className="font-semibold text-sm text-gray-800 truncate">{chofer.nombre}</p>
                        <p className="text-xs text-gray-400">
                          Ficha {chofer.ficha ?? "—"}
                          {driver?.vehiculo && ` · ${driver.vehiculo}`}
                        </p>
                        {recHoy.length > 0 ? (
                          <div className="mt-2 pt-2 border-t border-white/60">
                            <p className="text-xs font-medium text-gray-600">
                              Hoy: {entr}/{carg} uds
                            </p>
                            <div className="mt-1 h-1 bg-white/70 rounded-full overflow-hidden">
                              <div
                                className={`h-full rounded-full ${
                                  sem === "verde"   ? "bg-green-500"
                                  : sem === "amarillo" ? "bg-yellow-500"
                                  : "bg-red-500"
                                }`}
                                style={{
                                  width: carg > 0
                                    ? `${Math.min((entr / carg) * 100, 100)}%`
                                    : "0%",
                                }}
                              />
                            </div>
                            {/* Datos extra de FacturaScan drivers */}
                            {driver?.totalEntregado != null && (
                              <p className="text-xs text-gray-400 mt-1">
                                FS: {driver.totalEntregado} total
                              </p>
                            )}
                          </div>
                        ) : (
                          <p className="text-xs text-gray-400 mt-2">Sin actividad hoy</p>
                        )}
                      </button>
                    );
                  })}
              </div>
            )}

            {/* Drivers de FacturaScan sin match en Hub */}
            {fsDrivers.filter(
              (d) => !choferes.some(
                (ch) =>
                  (ch.ficha && d.ficha && ch.ficha === d.ficha) ||
                  ch.nombre.toLowerCase().trim() === (d.nombre ?? "").toLowerCase().trim()
              )
            ).length > 0 && (
              <div className="mt-4">
                <p className="text-xs text-gray-400 mb-2">
                  Solo en FacturaScan (sin cuenta Hub)
                </p>
                <div className="flex flex-wrap gap-2">
                  {fsDrivers
                    .filter(
                      (d) => !choferes.some(
                        (ch) =>
                          (ch.ficha && d.ficha && ch.ficha === d.ficha) ||
                          ch.nombre.toLowerCase().trim() === (d.nombre ?? "").toLowerCase().trim()
                      )
                    )
                    .map((d) => (
                      <div
                        key={d.id}
                        className="bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-xs"
                      >
                        <p className="font-medium text-gray-700">{d.nombre ?? "—"}</p>
                        <p className="text-gray-400">
                          {d.vehiculo ?? d.placa ?? ""}
                          {d.totalEntregado != null ? ` · ${d.totalEntregado} entregado` : ""}
                        </p>
                      </div>
                    ))}
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {/* ── Alertas de peso ── */}
      {alerts.length > 0 && (
        <div className="bg-white rounded-xl shadow-sm p-4">
          <h3 className="font-bold text-red-600 mb-3">⚖️ Polar Breeze Weight — Alertas</h3>
          <div className="space-y-2 max-h-44 overflow-y-auto">
            {alerts.map((a) => (
              <div
                key={a.id}
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

      {/* ── Historial cruzado — FacturaScan + Hub feeds ── */}
      {historialCruzado.length > 0 && (
        <div className="bg-white rounded-xl shadow-sm overflow-hidden">
          <div className="flex items-center justify-between px-5 py-3 border-b">
            <h3 className="font-bold text-gray-800">
              Historial cruzado
              <span className="ml-2 text-xs font-normal text-gray-400">
                FacturaScan + Hub · {historialCruzado.length} registros
              </span>
            </h3>
            <div className="flex gap-2 flex-wrap justify-end">
              {(Object.keys(SOURCE_CFG) as (keyof typeof SOURCE_CFG)[]).map((src) => (
                <span
                  key={src}
                  className={`text-xs px-2 py-0.5 rounded-full border ${SOURCE_CFG[src].badge}`}
                >
                  {SOURCE_CFG[src].label}
                </span>
              ))}
            </div>
          </div>
          <div className="divide-y divide-gray-50 max-h-80 overflow-y-auto">
            {historialCruzado.map((item) => {
              const sc = SOURCE_CFG[item.source];
              return (
                <div key={item.key} className="flex items-start gap-3 px-5 py-2.5 hover:bg-gray-50">
                  <span className={`w-2 h-2 rounded-full mt-1.5 flex-shrink-0 ${sc.dot}`} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-medium text-gray-800 truncate">{item.top}</p>
                      <span className={`text-xs px-1.5 py-0.5 rounded-full border flex-shrink-0 ${sc.badge}`}>
                        {item.label}
                      </span>
                    </div>
                    <p className="text-xs text-gray-400 truncate">{item.sub}</p>
                  </div>
                  <span className="text-xs text-gray-400 flex-shrink-0 whitespace-nowrap">
                    {fmtDate(item.ts)}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ── 3 Feeds en tiempo real (intactos) ── */}
      <div className="grid lg:grid-cols-3 gap-4">
        <Feed
          title="📦 SPIKINSCAN" accent="blue" badgeHoy={spikinHoy.length}
          items={spikin.slice(0, 20).map((r) => ({
            key:     r.id!, top: r.producto,
            sub:     `${r.despachadorNombre} → ${r.destino} · ×${r.cantidad}`,
            ts:      r.timestamp, isToday: toDate(r.timestamp) >= hoy,
          }))}
        />
        <Feed
          title="🧾 FACTURASCAN" accent="indigo" badgeHoy={facturaHoy.length}
          items={factura.slice(0, 20).map((r) => ({
            key:     r.id!, top: `#${r.facturaNumero} — ${r.cliente}`,
            sub:     `$${(r.monto ?? 0).toLocaleString()} · ${r.despachadorNombre}`,
            ts:      r.timestamp, isToday: toDate(r.timestamp) >= hoy,
          }))}
        />
        <Feed
          title="🚚 IMBENTARIO" accent="cyan" badgeHoy={imbHoy.length}
          items={imb.slice(0, 20).map((r) => ({
            key:     r.id!, top: r.choferNombre,
            sub:     `${r.producto} · ${r.cantidadEntregada}/${r.cantidadCargada} uds · ${r.ruta}`,
            ts:      r.timestamp, isToday: toDate(r.timestamp) >= hoy,
          }))}
        />
      </div>

    </div>
  );
}

// ─── Sub-componentes ──────────────────────────────────────────────────────────

function KpiCard({
  icon, label, value, sub, color,
}: {
  icon: string; label: string; value: string | number; sub: string; color: string;
}) {
  return (
    <div className={`bg-gradient-to-br ${color} text-white rounded-xl p-4 shadow-sm`}>
      <p className="text-2xl mb-1">{icon}</p>
      <p className="text-2xl font-bold leading-tight">{value}</p>
      <p className="text-xs opacity-80 mt-0.5">{label}</p>
      <p className="text-xs opacity-60 mt-0.5 truncate">{sub}</p>
    </div>
  );
}

const ACCENT: Record<string, { header: string; dot: string; pulse: string; badge: string }> = {
  blue:  { header:"text-blue-700",   dot:"bg-blue-500",   pulse:"bg-blue-400",   badge:"bg-blue-50   text-blue-700   border-blue-200"   },
  indigo:{ header:"text-indigo-700", dot:"bg-indigo-500", pulse:"bg-indigo-400", badge:"bg-indigo-50 text-indigo-700 border-indigo-200" },
  cyan:  { header:"text-cyan-700",   dot:"bg-cyan-500",   pulse:"bg-cyan-400",   badge:"bg-cyan-50   text-cyan-700   border-cyan-200"   },
};

type FeedItem = {
  key: string; top: string; sub: string;
  ts: Date | { seconds: number } | undefined; isToday: boolean;
};

function Feed({ title, accent, badgeHoy, items }: {
  title: string; accent: string; badgeHoy: number; items: FeedItem[];
}) {
  const c = ACCENT[accent];
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
