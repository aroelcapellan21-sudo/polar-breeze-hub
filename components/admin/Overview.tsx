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
import { ShareBar } from "@/components/shared/ShareButtons";
import { pbHeader, pbFooter } from "@/lib/wa-format";
import { pbPrintDoc, pbTable } from "@/lib/print-template";
import SalesChart from "@/components/admin/SalesChart";

interface Props {
  onVerChofer: (c: UserProfile) => void;
}

const SEM: Record<Semaforo, { icon: string; ring: string; bg: string; label: string }> = {
  verde:    { icon: "✅", ring: "ring-green-300",  bg: "bg-green-50",  label: "Normal"  },
  amarillo: { icon: "⚠️", ring: "ring-yellow-300", bg: "bg-yellow-50", label: "Revisar" },
  rojo:     { icon: "🚨", ring: "ring-red-300",    bg: "bg-red-50",    label: "Crítico" },
};

type KpiModal = "choferes" | "despachos" | "facturado" | "alertas" | null;

// ── Colección alertas (Encargado + sistema) ───────────────────────────────────
interface AlertaDoc {
  id?: string;
  tipo:         string;          // "stock_bajo" | "alerta_peso" | "sistema" | …
  severidad:    "info" | "warning" | "critical";
  mensaje:      string;
  chofer_ficha?: string;
  leida:        boolean;
  creada_en:    Date | { seconds: number };
}

type HistItem = {
  key: string; ts: Date; label: string;
  top: string; sub: string; source: "facturascan" | "hub-sp" | "hub-fac" | "hub-imb";
};

type ItemModal = { type: "alerta"; data: WeightAlert } | { type: "hist"; data: HistItem } | { type: "feed"; top: string; sub: string } | null;

export default function Overview({ onVerChofer }: Props) {
  const [kpiModal,       setKpiModal]       = useState<KpiModal>(null);
  const [itemModal,      setItemModal]      = useState<ItemModal>(null);
  const [rankingExpand,  setRankingExpand]  = useState(false);

  // ── Listeners existentes del Hub (sin cambios) ────────────────────────────
  const [choferes,    setChoferes]    = useState<UserProfile[]>([]);
  const [spikin,      setSpikin]      = useState<SpikinScanRecord[]>([]);
  const [factura,     setFactura]     = useState<FacturaScanRecord[]>([]);
  const [imb,         setImb]         = useState<ImbentarioRecord[]>([]);
  const [alerts,      setAlerts]      = useState<WeightAlert[]>([]);
  const [alertasVivo, setAlertasVivo] = useState<AlertaDoc[]>([]);

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

    // ── Alertas del Encargado (colección alertas) ─────────────────────────
    const uAlertasVivo = onSnapshot(
      query(collection(db, "alertas"), orderBy("creada_en", "desc"), limit(30)),
      (s) => setAlertasVivo(s.docs.map((d) => ({ id: d.id, ...d.data() } as AlertaDoc)))
    );

    return () => {
      uChof(); uSp(); uFac(); uImb(); uAl();
      uSess(); uDrv(); uHist(); uCfg();
      uAlertasVivo();
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

  // ── Ranking de choferes por rendimiento (últimos 15d) ───────────────────
  const rankingChoferes = useMemo(() => {
    return choferes
      .filter((c) => c.activo !== false)
      .map((chofer) => {
        const recs = imbPorChofer[chofer.uid] ?? [];
        const totalEntregado = recs.reduce((s, r) => s + (r.cantidadEntregada ?? 0), 0);
        const totalMonto     = recs.reduce((s, r) => s + (r.monto ?? 0), 0);
        const sem            = calcSemaforo(recs);
        return { chofer, totalEntregado, totalMonto, sem };
      })
      .filter((x) => x.totalEntregado > 0)
      .sort((a, b) => {
        if (a.totalMonto > 0 || b.totalMonto > 0) return b.totalMonto - a.totalMonto;
        return b.totalEntregado - a.totalEntregado;
      });
  }, [choferes, imbPorChofer]);

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

  // ── Distribución de inventario (imbentario — últimos 15d) ────────────────
  const distribInv = useMemo(() => {
    const map: Record<string, number> = {};
    imb.filter(r => toDate(r.timestamp) >= hace15).forEach((r) => {
      const cat =
        /paleta/i.test(r.producto)  ? "Paletas"  :
        /helado|sundae/i.test(r.producto) ? "Helados"  :
        /agua|refresc/i.test(r.producto) ? "Aguas"    :
        "Otros";
      map[cat] = (map[cat] ?? 0) + (r.cantidadEntregada ?? 0);
    });
    const total = Object.values(map).reduce((s, v) => s + v, 0);
    const COLORS = ["#F5C800", "#D42B2B", "#1E8C3A", "#6366f1"];
    return Object.entries(map)
      .sort((a, b) => b[1] - a[1])
      .map(([label, val], i) => ({
        label, val,
        pct: total > 0 ? (val / total) * 100 : 0,
        color: COLORS[i % COLORS.length],
      }));
  }, [imb, hace15]);

  // ── Alertas unificadas: colección alertas + weight_alerts ────────────────
  const todasAlertas = useMemo(() => {
    const base = alertasVivo.map((a) => ({
      id:  a.id ?? "",
      sev: a.severidad === "critical" ? "critical" : a.severidad === "warning" ? "warning" : "info",
      msg: a.mensaje,
      sub: a.tipo ?? "",
      ts:  a.creada_en,
      leida: a.leida,
      source: "alertas" as const,
    }));
    const weight = alerts.map((a) => ({
      id:  a.id ?? "",
      sev: a.severity as "warning" | "critical",
      msg: `${a.producto} — diferencia ${a.diferencia.toFixed(1)}kg (${a.porcentaje.toFixed(0)}%)`,
      sub: a.choferNombre,
      ts:  a.timestamp,
      leida: false,
      source: "weight" as const,
    }));
    return [...base, ...weight]
      .sort((a, b) => toDate(b.ts).getTime() - toDate(a.ts).getTime())
      .slice(0, 25);
  }, [alertasVivo, alerts]);

  const alertasSinLeer = todasAlertas.filter((a) => !a.leida).length;

  // ── Mapa de rutas activas hoy ─────────────────────────────────────────────
  const rutasHoy = useMemo(() => {
    const map: Record<string, {
      ruta: string;
      choferes: { nombre: string; entr: number; carg: number; }[];
      totalEntr: number; totalCarg: number;
    }> = {};
    imbHoy.forEach((r) => {
      const key = r.ruta || "Sin ruta";
      if (!map[key]) map[key] = { ruta: key, choferes: [], totalEntr: 0, totalCarg: 0 };
      const zona = map[key];
      const ch   = zona.choferes.find(c => c.nombre === r.choferNombre);
      if (ch) {
        ch.entr += r.cantidadEntregada ?? 0;
        ch.carg += r.cantidadCargada ?? 0;
      } else {
        zona.choferes.push({ nombre: r.choferNombre, entr: r.cantidadEntregada ?? 0, carg: r.cantidadCargada ?? 0 });
      }
      zona.totalEntr += r.cantidadEntregada ?? 0;
      zona.totalCarg += r.cantidadCargada ?? 0;
    });
    return Object.values(map).sort((a, b) => b.totalEntr - a.totalEntr);
  }, [imbHoy]);

  // ── Métricas clave ─────────────────────────────────────────────────────────
  const tasaCumplimiento = useMemo(() => {
    const recs15 = imb.filter(r => toDate(r.timestamp) >= hace15);
    const carg   = recs15.reduce((s, r) => s + (r.cantidadCargada ?? 0), 0);
    const entr   = recs15.reduce((s, r) => s + (r.cantidadEntregada ?? 0), 0);
    return carg > 0 ? (entr / carg) * 100 : null;
  }, [imb, hace15]);

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

      {/* ── Compartir ── */}
      <div className="flex justify-end">
        <ShareBar
          getMessage={() => [
            pbHeader(),
            `📊 *Resumen Admin Polar Breeze*`,
            `• Choferes activos: ${chofActivos}`,
            `• Despachos hoy: ${kpiDespachos}`,
            `• Facturado hoy: RD$${kpiFacturado.toLocaleString("es-DO")}`,
            `• Alertas críticas: ${alertasCrit}`,
            `• Peso total: ${kpiPeso.toFixed(1)} kg`,
            "",
            pbFooter(),
          ].join("\n")}
          getPrintHtml={() => pbPrintDoc(
            "RESUMEN ADMIN",
            new Date().toLocaleDateString("es-DO", { weekday: "long", day: "numeric", month: "long", year: "numeric" }),
            pbTable(
              ["Indicador", "Valor"],
              [
                ["Choferes activos", chofActivos],
                ["Despachos hoy",    kpiDespachos],
                ["Facturado hoy",    `RD$${kpiFacturado.toLocaleString("es-DO")}`],
                ["Alertas críticas", alertasCrit],
                ["Peso total (kg)",  kpiPeso.toFixed(1)],
              ],
            ),
          )}
        />
      </div>

      {/* ── KPI Cards — Hub + FacturaScan session/despacho ── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <KpiCard
          icon="👥" label="Choferes activos"
          value={chofActivos}
          sub={`${choferes.length} Hub · ${fsDrivers.filter(d => d.activo !== false).length} FacturaScan`}
          color="from-[#D42B2B] to-[#8B0000]"
          onClick={() => setKpiModal("choferes")}
        />
        <KpiCard
          icon="📦" label="Despachos"
          value={kpiDespachos}
          sub={`${spikinHoy.length} SPIKIN${fsSession?.totalDespachos ? ` + ${fsSession.totalDespachos} sesión` : ""}`}
          color="from-blue-500 to-blue-700"
          onClick={() => setKpiModal("despachos")}
        />
        <KpiCard
          icon="💰" label="Facturado"
          value={`$${kpiFacturado.toLocaleString()}`}
          sub={`${facturaHoy.length} facturas${fsSession?.totalMonto ? ` + $${fsSession.totalMonto.toLocaleString()} sesión` : ""}`}
          color="from-green-500 to-emerald-700"
          onClick={() => setKpiModal("facturado")}
        />
        {kpiPeso > 0 ? (
          <KpiCard
            icon="⚖️" label="Peso total"
            value={`${kpiPeso.toFixed(1)} kg`}
            sub={`${kpiUnidades} uds entregadas`}
            color="from-teal-500 to-teal-700"
            onClick={() => setKpiModal("alertas")}
          />
        ) : (
          <KpiCard
            icon={alertasCrit > 0 ? "🚨" : "✅"} label="Alertas peso"
            value={alertasCrit > 0 ? alertasCrit : "OK"}
            sub={alertasCrit > 0 ? "Atención requerida" : "Sin alertas críticas"}
            color={alertasCrit > 0 ? "from-red-500 to-red-700" : "from-gray-500 to-gray-700"}
            onClick={() => setKpiModal("alertas")}
          />
        )}
      </div>

      {/* ── Gráfico de ventas — últimos 7 días ── */}
      <SalesChart />

      {/* ── Mapa de rutas activas hoy ── */}
      {rutasHoy.length > 0 && (
        <div className="bg-white rounded-xl shadow-sm overflow-hidden">
          <div className="px-5 py-3 border-b border-gray-100 flex items-center justify-between">
            <div>
              <h3 className="font-bold text-gray-800 text-sm">🗺️ Rutas activas hoy</h3>
              <p className="text-xs text-gray-400 mt-0.5">
                {rutasHoy.length} zona{rutasHoy.length !== 1 ? "s" : ""} · {imbHoy.length} registros
              </p>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-[#1E8C3A] animate-pulse" />
              <span className="text-xs text-gray-400">En tiempo real</span>
            </div>
          </div>
          <div className="p-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {rutasHoy.map((zona) => {
              const pct    = zona.totalCarg > 0 ? (zona.totalEntr / zona.totalCarg) * 100 : 0;
              const color  = pct >= 85 ? "#1E8C3A" : pct >= 60 ? "#F5C800" : "#D42B2B";
              const bgCls  = pct >= 85 ? "border-green-200 bg-green-50/30"
                           : pct >= 60 ? "border-yellow-200 bg-yellow-50/30"
                           : "border-red-200 bg-red-50/30";
              return (
                <div key={zona.ruta} className={`rounded-xl border p-3 ${bgCls}`}>
                  {/* Header zona */}
                  <div className="flex items-center justify-between mb-2">
                    <p className="text-sm font-bold text-gray-800 truncate">{zona.ruta}</p>
                    <span className="text-xs font-bold flex-shrink-0 ml-2" style={{ color }}>
                      {pct.toFixed(0)}%
                    </span>
                  </div>

                  {/* Barra de progreso */}
                  <div className="h-1.5 bg-white/70 rounded-full overflow-hidden mb-2">
                    <div
                      className="h-full rounded-full transition-all duration-500"
                      style={{ width: `${Math.min(pct, 100)}%`, background: color }}
                    />
                  </div>

                  {/* Stats */}
                  <div className="flex items-center justify-between text-xs text-gray-500 mb-2">
                    <span>{zona.totalEntr}/{zona.totalCarg} uds</span>
                    <span>{zona.choferes.length} chofer{zona.choferes.length !== 1 ? "es" : ""}</span>
                  </div>

                  {/* Lista de choferes */}
                  <div className="space-y-1">
                    {zona.choferes.slice(0, 3).map((ch) => {
                      const chPct = ch.carg > 0 ? (ch.entr / ch.carg) * 100 : 0;
                      return (
                        <div key={ch.nombre} className="flex items-center gap-2">
                          <div className="w-5 h-5 rounded-full bg-cyan-500 flex items-center justify-center text-white text-[9px] font-bold flex-shrink-0">
                            {ch.nombre.charAt(0).toUpperCase()}
                          </div>
                          <p className="text-xs text-gray-700 truncate flex-1">{ch.nombre}</p>
                          <span className="text-[10px] text-gray-400 flex-shrink-0">
                            {ch.entr}/{ch.carg}
                          </span>
                          <span
                            className="text-[10px] font-bold flex-shrink-0"
                            style={{ color: chPct >= 85 ? "#1E8C3A" : chPct >= 60 ? "#b45309" : "#D42B2B" }}
                          >
                            {chPct.toFixed(0)}%
                          </span>
                        </div>
                      );
                    })}
                    {zona.choferes.length > 3 && (
                      <p className="text-xs text-gray-400 pl-7">+{zona.choferes.length - 3} más…</p>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ── Métricas clave ── */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {/* Tasa de cumplimiento */}
        <div className={`rounded-xl p-4 border text-center ${
          tasaCumplimiento === null ? "bg-gray-50 border-gray-200"
          : tasaCumplimiento >= 85  ? "bg-green-50 border-green-200"
          : tasaCumplimiento >= 70  ? "bg-yellow-50 border-yellow-200"
          : "bg-red-50 border-red-200"
        }`}>
          <p className="text-2xl font-black leading-tight">
            {tasaCumplimiento !== null ? `${tasaCumplimiento.toFixed(0)}%` : "—"}
          </p>
          <p className="text-xs font-medium text-gray-600 mt-1">Cumplimiento</p>
          <p className="text-xs text-gray-400">15 días</p>
        </div>

        {/* Alertas sin leer */}
        <div className={`rounded-xl p-4 border text-center ${
          alertasSinLeer === 0 ? "bg-green-50 border-green-200" : "bg-red-50 border-red-200"
        }`}>
          <p className="text-2xl font-black leading-tight">
            {alertasSinLeer > 0 ? alertasSinLeer : "✅"}
          </p>
          <p className="text-xs font-medium text-gray-600 mt-1">Alertas s/leer</p>
          <p className="text-xs text-gray-400">total sistema</p>
        </div>

        {/* Choferes sin actividad hoy */}
        <div className="rounded-xl p-4 border bg-blue-50 border-blue-200 text-center">
          <p className="text-2xl font-black leading-tight text-blue-700">
            {choferes.filter(c => c.activo !== false && !imbHoyPorChofer[c.uid]).length}
          </p>
          <p className="text-xs font-medium text-gray-600 mt-1">Sin actividad</p>
          <p className="text-xs text-gray-400">hoy</p>
        </div>

        {/* Despachos por chofer promedio */}
        <div className="rounded-xl p-4 border bg-[#F5C800]/10 border-[#F5C800]/40 text-center">
          <p className="text-2xl font-black leading-tight text-[#1A1A1A]">
            {chofActivos > 0
              ? (kpiDespachos / chofActivos).toFixed(1)
              : "—"}
          </p>
          <p className="text-xs font-medium text-gray-600 mt-1">Despachos/chofer</p>
          <p className="text-xs text-gray-400">hoy prom.</p>
        </div>
      </div>

      {/* ── Distribución de inventario (dona) ── */}
      {distribInv.length > 0 && (
        <div className="bg-white rounded-xl shadow-sm overflow-hidden">
          <div className="px-5 py-3 border-b border-gray-100">
            <h3 className="font-bold text-gray-800 text-sm">🍦 Distribución de inventario</h3>
            <p className="text-xs text-gray-400 mt-0.5">Unidades entregadas por categoría — últimos 15 días</p>
          </div>
          <div className="p-4 flex items-center gap-6 flex-wrap">
            {/* Dona SVG */}
            <DonaChart segmentos={distribInv} />

            {/* Leyenda */}
            <div className="flex flex-col gap-2 flex-1 min-w-[120px]">
              {distribInv.map((seg) => (
                <div key={seg.label} className="flex items-center gap-2">
                  <span className="w-3 h-3 rounded-full flex-shrink-0" style={{ background: seg.color }} />
                  <span className="text-xs text-gray-700 font-medium flex-1">{seg.label}</span>
                  <span className="text-xs text-gray-500">{seg.val.toLocaleString()} uds</span>
                  <span className="text-xs font-bold" style={{ color: seg.color }}>
                    {seg.pct.toFixed(0)}%
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ── KPI Detail Modal ── */}
      {kpiModal && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[80vh] flex flex-col">
            <div className="flex items-center justify-between px-5 py-4 border-b flex-shrink-0">
              <h3 className="font-bold text-gray-800">
                {kpiModal === "choferes"  && "👥 Choferes activos — detalle"}
                {kpiModal === "despachos" && "📦 Despachos del día — detalle"}
                {kpiModal === "facturado" && "💰 Facturado hoy — detalle"}
                {kpiModal === "alertas"   && "⚖️ Alertas de peso — detalle"}
              </h3>
              <button
                onClick={() => setKpiModal(null)}
                className="text-gray-400 hover:text-gray-600 text-2xl active:scale-95 transition-all duration-100 leading-none"
              >×</button>
            </div>
            <div className="flex-1 overflow-y-auto p-4 space-y-2">
              {kpiModal === "choferes" && choferes.filter(c => c.activo !== false).map((c) => (
                <div key={c.uid} className="flex items-center gap-3 px-3 py-2 bg-[#F5C800]/10 rounded-lg">
                  <div className="w-8 h-8 bg-cyan-500 rounded-full flex items-center justify-center text-white text-sm font-bold">
                    {c.nombre.charAt(0)}
                  </div>
                  <div>
                    <p className="text-sm font-medium text-gray-800">{c.nombre}</p>
                    <p className="text-xs text-gray-400">Ficha {c.ficha ?? "—"}</p>
                  </div>
                  <span className="ml-auto text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded-full">✅ activo</span>
                </div>
              ))}
              {kpiModal === "despachos" && (
                <>
                  {spikinHoy.map((r) => (
                    <div key={r.id} className="px-3 py-2 bg-blue-50 rounded-lg text-sm">
                      <p className="font-medium text-gray-800">{r.producto}</p>
                      <p className="text-xs text-gray-500">{r.despachadorNombre} → {r.destino} · ×{r.cantidad}</p>
                      <p className="text-xs text-gray-400">{fmtDate(r.timestamp)}</p>
                    </div>
                  ))}
                  {fsHistory.filter(h => h.tipo === "entrega_chofer").slice(0, 10).map((h) => (
                    <div key={h.id} className="px-3 py-2 bg-orange-50 rounded-lg text-sm">
                      <p className="font-medium text-gray-800">{h.choferNombre ?? "—"}</p>
                      <p className="text-xs text-gray-500">{h.despachadorNombre} · FacturaScan</p>
                      <p className="text-xs text-gray-400">{fmtDate(h.timestamp)}</p>
                    </div>
                  ))}
                  {spikinHoy.length === 0 && <p className="text-gray-400 text-sm text-center py-6">Sin despachos hoy</p>}
                </>
              )}
              {kpiModal === "facturado" && (
                <>
                  {facturaHoy.map((r) => (
                    <div key={r.id} className="px-3 py-2 bg-green-50 rounded-lg text-sm">
                      <div className="flex justify-between">
                        <p className="font-medium text-gray-800">#{r.facturaNumero} — {r.cliente}</p>
                        <p className="font-bold text-green-700">${(r.monto ?? 0).toLocaleString()}</p>
                      </div>
                      <p className="text-xs text-gray-400">{r.despachadorNombre} · {fmtDate(r.timestamp)}</p>
                    </div>
                  ))}
                  {facturaHoy.length === 0 && <p className="text-gray-400 text-sm text-center py-6">Sin facturas hoy</p>}
                </>
              )}
              {kpiModal === "alertas" && (
                <>
                  {alerts.map((a) => (
                    <div key={a.id} className={`px-3 py-2 rounded-lg text-sm border ${a.severity === "critical" ? "bg-red-50 border-red-200" : "bg-yellow-50 border-yellow-200"}`}>
                      <p className="font-medium text-gray-800">{a.producto}</p>
                      <p className="text-xs text-gray-600">{a.choferNombre} · {a.pesoCargado}kg → {a.pesoEntregado}kg</p>
                      <p className="text-xs font-bold text-red-600">Diferencia: {a.diferencia.toFixed(1)}kg ({a.porcentaje.toFixed(0)}%)</p>
                    </div>
                  ))}
                  {alerts.length === 0 && <p className="text-gray-400 text-sm text-center py-6">Sin alertas de peso</p>}
                </>
              )}
            </div>
          </div>
        </div>
      )}

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

      {/* ── Ranking de choferes — TOP 5 ── */}
      {rankingChoferes.length > 0 && (
        <div className="bg-white rounded-xl shadow-sm overflow-hidden">
          <div className="px-5 py-4 bg-gradient-to-r from-amber-50 to-yellow-50 border-b border-amber-100 flex items-center justify-between">
            <div>
              <h2 className="font-bold text-amber-900">🏆 TOP 5 — Ranking de Choferes</h2>
              <p className="text-xs text-amber-600 mt-0.5">
                Últimos 15 días · {rankingChoferes[0]?.totalMonto > 0 ? "monto vendido" : "unidades entregadas"}
              </p>
            </div>
            {rankingChoferes.length > 5 && (
              <button
                onClick={() => setRankingExpand(v => !v)}
                className="text-xs text-amber-600 hover:text-amber-800 font-medium transition-colors"
              >
                {rankingExpand ? "ver TOP 5 ↑" : `ver todos (${rankingChoferes.length}) ↓`}
              </button>
            )}
          </div>
          <div className="divide-y divide-gray-50">
            {(rankingExpand ? rankingChoferes : rankingChoferes.slice(0, 5)).map(({ chofer, totalEntregado, totalMonto, sem }, i) => {
              const isPrimero = i === 0;
              return (
                <button
                  key={chofer.uid}
                  onClick={() => onVerChofer(chofer)}
                  className={`w-full flex items-center gap-3 px-5 py-3 text-left active:scale-[0.99] transition-all duration-100 ${
                    isPrimero ? "bg-yellow-50 hover:bg-yellow-100" : "hover:bg-gray-50"
                  }`}
                >
                  {/* Posición */}
                  <span className="w-8 text-center flex-shrink-0">
                    {isPrimero
                      ? <span className="text-xl">🥇</span>
                      : <span className="text-xs font-bold text-gray-400">#{i + 1}</span>}
                  </span>

                  {/* Avatar */}
                  <div
                    className={`w-9 h-9 rounded-full flex items-center justify-center text-white font-bold text-sm flex-shrink-0 ${
                      isPrimero ? "bg-yellow-500" : "bg-cyan-500"
                    }`}
                  >
                    {chofer.nombre.charAt(0).toUpperCase()}
                  </div>

                  {/* Info */}
                  <div className="flex-1 min-w-0">
                    <p className={`font-semibold text-sm truncate ${isPrimero ? "text-yellow-900" : "text-gray-800"}`}>
                      {chofer.nombre}
                    </p>
                    {isPrimero ? (
                      <p className="text-xs text-yellow-600 font-medium">🎉 ¡Mejor rendimiento del período!</p>
                    ) : (
                      <p className="text-xs text-gray-400">Ficha {chofer.ficha ?? "—"}</p>
                    )}
                  </div>

                  {/* Métricas */}
                  <div className="text-right flex-shrink-0">
                    {totalMonto > 0 ? (
                      <>
                        <p className={`font-bold text-sm ${isPrimero ? "text-yellow-700" : "text-green-700"}`}>
                          RD${totalMonto.toLocaleString()}
                        </p>
                        <p className="text-xs text-gray-400">{totalEntregado} uds</p>
                      </>
                    ) : (
                      <p className={`font-bold text-sm ${isPrimero ? "text-yellow-700" : "text-gray-700"}`}>
                        {totalEntregado} uds
                      </p>
                    )}
                  </div>

                  {/* Semáforo */}
                  <span className="text-xl flex-shrink-0">{SEM[sem].icon}</span>
                </button>
              );
            })}
          </div>
          <div className="px-5 py-2 border-t flex items-center justify-between">
            <div className="flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
              <span className="text-xs text-gray-400">Toca un chofer para ver su detalle</span>
            </div>
            {rankingChoferes.length > 5 && !rankingExpand && (
              <span className="text-xs text-amber-500">
                +{rankingChoferes.length - 5} más
              </span>
            )}
          </div>
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

      {/* ── Alertas en tiempo real (sistema + peso) ── */}
      {todasAlertas.length > 0 && (
        <div className="bg-white rounded-xl shadow-sm overflow-hidden">
          <div className="px-5 py-3 border-b border-gray-100 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <h3 className="font-bold text-red-600 text-sm">🔔 Alertas en tiempo real</h3>
              {alertasSinLeer > 0 && (
                <span className="text-xs bg-red-500 text-white px-2 py-0.5 rounded-full font-bold">
                  {alertasSinLeer} sin leer
                </span>
              )}
            </div>
            <div className="flex items-center gap-3 text-xs text-gray-400">
              <span className="flex items-center gap-1">
                <span className="w-2 h-2 rounded-full bg-[#D42B2B]" /> sistema
              </span>
              <span className="flex items-center gap-1">
                <span className="w-2 h-2 rounded-full bg-orange-400" /> peso
              </span>
            </div>
          </div>
          <div className="divide-y divide-gray-50 max-h-56 overflow-y-auto">
            {todasAlertas.map((a) => (
              <div
                key={`${a.source}-${a.id}`}
                className={`flex items-start gap-3 px-4 py-2.5 ${
                  a.leida ? "opacity-60" : ""
                } ${a.sev === "critical" ? "bg-red-50/40" : a.sev === "warning" ? "bg-yellow-50/40" : ""}`}
              >
                <span className="text-base flex-shrink-0 mt-0.5">
                  {a.sev === "critical" ? "🚨" : a.sev === "warning" ? "⚠️" : "ℹ️"}
                </span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-gray-800 truncate">{a.msg}</p>
                  <p className="text-xs text-gray-400 truncate">
                    {a.sub}
                    {a.source === "weight" && (
                      <span className="ml-1 text-orange-500">· Weight</span>
                    )}
                  </p>
                </div>
                <div className="flex flex-col items-end gap-1 flex-shrink-0">
                  <span className="text-xs text-gray-400 whitespace-nowrap">{fmtDate(a.ts)}</span>
                  {!a.leida && (
                    <span className="w-2 h-2 rounded-full bg-red-400" />
                  )}
                </div>
              </div>
            ))}
          </div>
          <div className="px-4 py-2 border-t flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-red-400 animate-pulse" />
            <span className="text-xs text-gray-400">
              {todasAlertas.length} alertas · {alertasSinLeer} sin leer
            </span>
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
                <button key={item.key} onClick={() => setItemModal({ type: "hist", data: item })} className="w-full flex items-start gap-3 px-5 py-2.5 hover:bg-gray-50 active:scale-[0.99] transition-all duration-100 text-left">
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
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* ── 3 Feeds en tiempo real (intactos) ── */}
      <div className="grid lg:grid-cols-3 gap-4">
        <Feed
          title="📦 SPIKINSCAN" accent="blue" badgeHoy={spikinHoy.length}
          onClickItem={(top, sub) => setItemModal({ type: "feed", top, sub })}
          items={spikin.slice(0, 20).map((r) => ({
            key:     r.id!, top: r.producto,
            sub:     `${r.despachadorNombre} → ${r.destino} · ×${r.cantidad}`,
            ts:      r.timestamp, isToday: toDate(r.timestamp) >= hoy,
          }))}
        />
        <Feed
          title="🧾 FACTURASCAN" accent="indigo" badgeHoy={facturaHoy.length}
          onClickItem={(top, sub) => setItemModal({ type: "feed", top, sub })}
          items={factura.slice(0, 20).map((r) => ({
            key:     r.id!, top: `#${r.facturaNumero} — ${r.cliente}`,
            sub:     `$${(r.monto ?? 0).toLocaleString()} · ${r.despachadorNombre}`,
            ts:      r.timestamp, isToday: toDate(r.timestamp) >= hoy,
          }))}
        />
        <Feed
          title="🚚 IMBENTARIO" accent="cyan" badgeHoy={imbHoy.length}
          onClickItem={(top, sub) => setItemModal({ type: "feed", top, sub })}
          items={imb.slice(0, 20).map((r) => ({
            key:     r.id!, top: r.choferNombre,
            sub:     `${r.producto} · ${r.cantidadEntregada}/${r.cantidadCargada} uds · ${r.ruta}`,
            ts:      r.timestamp, isToday: toDate(r.timestamp) >= hoy,
          }))}
        />
      </div>

      {/* ── Item detail modal ── */}
      {itemModal && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-end sm:items-center justify-center p-4" onClick={() => setItemModal(null)}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 py-4 border-b">
              <h3 className="font-bold text-gray-800">
                {itemModal.type === "alerta" && (itemModal.data.severity === "critical" ? "🚨 Alerta crítica" : "⚠️ Alerta de peso")}
                {itemModal.type === "hist"   && "📋 Detalle de registro"}
                {itemModal.type === "feed"   && "📋 Detalle de registro"}
              </h3>
              <button onClick={() => setItemModal(null)} className="text-gray-400 hover:text-gray-600 text-2xl leading-none active:scale-95">×</button>
            </div>
            <div className="p-5 space-y-3">
              {itemModal.type === "alerta" && (() => {
                const a = itemModal.data;
                return (
                  <>
                    <div className={`rounded-xl p-4 border ${a.severity === "critical" ? "bg-red-50 border-red-200" : "bg-yellow-50 border-yellow-200"}`}>
                      <p className="font-bold text-gray-800 text-lg">{a.producto}</p>
                      <p className="text-sm text-gray-600 mt-1">{a.choferNombre}</p>
                    </div>
                    <div className="grid grid-cols-3 gap-3">
                      <div className="bg-blue-50 rounded-xl p-3 text-center">
                        <p className="text-lg font-bold text-blue-700">{a.pesoCargado} kg</p>
                        <p className="text-xs text-blue-500">Cargado</p>
                      </div>
                      <div className="bg-green-50 rounded-xl p-3 text-center">
                        <p className="text-lg font-bold text-green-700">{a.pesoEntregado} kg</p>
                        <p className="text-xs text-green-500">Entregado</p>
                      </div>
                      <div className="bg-red-50 rounded-xl p-3 text-center">
                        <p className="text-lg font-bold text-red-700">{a.diferencia.toFixed(1)} kg</p>
                        <p className="text-xs text-red-500">{a.porcentaje.toFixed(0)}% dif.</p>
                      </div>
                    </div>
                    <p className="text-xs text-gray-400">{fmtDate(a.timestamp)}</p>
                  </>
                );
              })()}
              {(itemModal.type === "hist" || itemModal.type === "feed") && (() => {
                const top = itemModal.type === "hist" ? itemModal.data.top : itemModal.top;
                const sub = itemModal.type === "hist" ? itemModal.data.sub : itemModal.sub;
                const label = itemModal.type === "hist" ? itemModal.data.label : "";
                const ts    = itemModal.type === "hist" ? itemModal.data.ts   : null;
                return (
                  <div className="space-y-3">
                    <div className="bg-gray-50 rounded-xl p-4">
                      <p className="font-bold text-gray-800">{top}</p>
                      {label && <span className="text-xs text-gray-500 bg-white border border-gray-200 px-2 py-0.5 rounded-full mt-1 inline-block">{label}</span>}
                      <p className="text-sm text-gray-500 mt-2">{sub}</p>
                    </div>
                    {ts && <p className="text-xs text-gray-400">{fmtDate(ts)}</p>}
                  </div>
                );
              })()}
            </div>
          </div>
        </div>
      )}

    </div>
  );
}

// ─── DonaChart ────────────────────────────────────────────────────────────────

interface SegDona { label: string; val: number; pct: number; color: string; }

function DonaChart({ segmentos }: { segmentos: SegDona[] }) {
  const R = 52, r = 28, cx = 64, cy = 64, total = segmentos.reduce((s, g) => s + g.val, 0);
  if (total === 0) return null;

  let acum = -Math.PI / 2;
  const slices = segmentos.map((seg) => {
    const angle = (seg.pct / 100) * 2 * Math.PI;
    const x1o = cx + R * Math.cos(acum);
    const y1o = cy + R * Math.sin(acum);
    const x1i = cx + r * Math.cos(acum);
    const y1i = cy + r * Math.sin(acum);
    acum += angle;
    const x2o = cx + R * Math.cos(acum);
    const y2o = cy + R * Math.sin(acum);
    const x2i = cx + r * Math.cos(acum);
    const y2i = cy + r * Math.sin(acum);
    const large = angle > Math.PI ? 1 : 0;
    return {
      d: [
        `M ${x1o.toFixed(2)} ${y1o.toFixed(2)}`,
        `A ${R} ${R} 0 ${large} 1 ${x2o.toFixed(2)} ${y2o.toFixed(2)}`,
        `L ${x2i.toFixed(2)} ${y2i.toFixed(2)}`,
        `A ${r} ${r} 0 ${large} 0 ${x1i.toFixed(2)} ${y1i.toFixed(2)}`,
        "Z",
      ].join(" "),
      color: seg.color,
    };
  });

  return (
    <svg width={128} height={128} viewBox="0 0 128 128" className="flex-shrink-0">
      {slices.map((sl, i) => (
        <path key={i} d={sl.d} fill={sl.color} opacity={0.88} />
      ))}
      <circle cx={cx} cy={cy} r={r - 2} fill="white" />
      <text x={cx} y={cy + 5} textAnchor="middle" fontSize={14} fontWeight="800" fill="#1A1A1A">
        {total.toLocaleString()}
      </text>
      <text x={cx} y={cy + 18} textAnchor="middle" fontSize={8} fill="#9ca3af">
        uds total
      </text>
    </svg>
  );
}

// ─── Sub-componentes ──────────────────────────────────────────────────────────

function KpiCard({
  icon, label, value, sub, color, onClick,
}: {
  icon: string; label: string; value: string | number; sub: string; color: string;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`bg-gradient-to-br ${color} text-white rounded-xl p-4 shadow-sm text-left
        w-full active:scale-95 transition-transform duration-100 ${onClick ? "cursor-pointer hover:brightness-110" : "cursor-default"}`}
    >
      <p className="text-2xl mb-1">{icon}</p>
      <p className="text-2xl font-bold leading-tight">{value}</p>
      <p className="text-xs opacity-80 mt-0.5">{label}</p>
      <p className="text-xs opacity-60 mt-0.5 truncate">{sub}</p>
      {onClick && <p className="text-xs opacity-50 mt-1">Toca para ver detalle →</p>}
    </button>
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

function Feed({ title, accent, badgeHoy, items, onClickItem }: {
  title: string; accent: string; badgeHoy: number; items: FeedItem[];
  onClickItem?: (top: string, sub: string) => void;
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
          <button key={item.key} onClick={() => onClickItem?.(item.top, item.sub)} className={`w-full px-4 py-2.5 text-left active:scale-[0.99] transition-all duration-100 hover:bg-gray-50 ${item.isToday ? "" : "opacity-50"}`}>
            <div className="flex items-start gap-2">
              <span className={`w-1.5 h-1.5 rounded-full mt-1.5 flex-shrink-0 ${c.dot}`} />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-gray-800 truncate">{item.top}</p>
                <p className="text-xs text-gray-400 truncate">{item.sub}</p>
              </div>
              <span className="text-xs text-gray-400 whitespace-nowrap">{fmtDate(item.ts)}</span>
            </div>
          </button>
        ))}
      </div>
      <div className="px-4 py-2 border-t flex items-center gap-1.5">
        <span className={`w-2 h-2 rounded-full animate-pulse ${c.pulse}`} />
        <span className="text-xs text-gray-400">En tiempo real</span>
      </div>
    </div>
  );
}
