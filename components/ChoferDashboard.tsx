"use client";

import { useState, useEffect, useMemo } from "react";
import { collection, onSnapshot, query, where, getDoc, doc } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useAuth } from "@/lib/auth-context";
import {
  ImbentarioRecord, PuntosConfig, PuntoProducto,
  MovimientoLoker, TalonarioDoc, toDate,
} from "@/lib/types";
import SobrantesChofer from "@/components/chofer/SobrantesChofer";

function getTodayStart() {
  const d = new Date(); d.setHours(0, 0, 0, 0); return d;
}

function getQuincena() {
  const now = new Date();
  const day = now.getDate(), month = now.getMonth(), year = now.getFullYear();
  if (day <= 15) {
    return {
      start: new Date(year, month, 1),
      end:   new Date(year, month, 15, 23, 59, 59),
      label: "1ª quincena",
    };
  }
  const lastDay = new Date(year, month + 1, 0).getDate();
  return {
    start: new Date(year, month, 16),
    end:   new Date(year, month, lastDay, 23, 59, 59),
    label: "2ª quincena",
  };
}

type SemaforoColor = "verde" | "amarillo" | "rojo";

export default function ChoferDashboard() {
  const { profile, logout } = useAuth();

  const [records,      setRecords]      = useState<ImbentarioRecord[]>([]);
  const [puntosConfig, setPuntosConfig] = useState<PuntosConfig | null>(null);
  const [movimientos,  setMovimientos]  = useState<MovimientoLoker[]>([]);
  const [talonarios,   setTalonarios]   = useState<TalonarioDoc[]>([]);
  const [cargando,     setCargando]     = useState(true);

  const todayStart = useMemo(() => getTodayStart(), []);

  useEffect(() => {
    if (!profile) return;

    let movLoaded = false, imbLoaded = false;
    const checkLoaded = () => { if (movLoaded && imbLoaded) setCargando(false); };

    const unsubImb = onSnapshot(
      query(collection(db, "imbentario"), where("choferId", "==", profile.uid)),
      (snap) => {
        setRecords(snap.docs.map((d) => ({ id: d.id, ...d.data() } as ImbentarioRecord)));
        imbLoaded = true; checkLoaded();
      },
    );

    getDoc(doc(db, "config", "puntos")).then((snap) => {
      if (snap.exists()) setPuntosConfig(snap.data() as PuntosConfig);
    });

    const unsubMov = onSnapshot(
      query(collection(db, "movimientos_loker"), where("choferId", "==", profile.uid)),
      (snap) => {
        setMovimientos(snap.docs.map((d) => ({ id: d.id, ...d.data() } as MovimientoLoker)));
        movLoaded = true; checkLoaded();
      },
    );

    const unsubTal = onSnapshot(
      query(collection(db, "talonario"), where("choferId", "==", profile.uid)),
      (snap) => setTalonarios(snap.docs.map((d) => ({ id: d.id, ...d.data() } as TalonarioDoc))),
      () => setTalonarios([]),
    );

    return () => { unsubImb(); unsubMov(); unsubTal(); };
  }, [profile]);

  // ── Puntos quincena ──────────────────────────────────────────────────────────
  const quincena = useMemo(() => getQuincena(), []);

  const puntosMap = useMemo(() => {
    const map: Record<string, number> = {};
    (puntosConfig?.productos ?? []).forEach((p: PuntoProducto) => {
      map[p.nombre.toLowerCase().trim()] = p.puntos;
    });
    return map;
  }, [puntosConfig]);

  const puntosTotal = useMemo(() => {
    const recQ = records.filter((r) => {
      const d = toDate(r.timestamp);
      return d >= quincena.start && d <= quincena.end;
    });
    return recQ.reduce(
      (sum, r) => sum + (puntosMap[r.producto.toLowerCase().trim()] ?? 0) * (r.cantidadEntregada ?? 0),
      0,
    );
  }, [records, quincena, puntosMap]);

  const meta = puntosConfig?.meta ?? 100;
  const pct  = Math.min((puntosTotal / meta) * 100, 100);

  // ── Estado del día ───────────────────────────────────────────────────────────
  const movHoy = useMemo(
    () => movimientos.filter((m) => toDate(m.timestamp) >= todayStart),
    [movimientos, todayStart],
  );

  const despachados = useMemo(() => {
    const map = new Map<string, string>();
    movHoy.filter((m) => m.tipo === "salida_despacho").forEach((m) => {
      map.set(m.producto_id, m.nombre);
    });
    return Array.from(map.entries()).map(([pid, nombre]) => ({ pid, nombre }));
  }, [movHoy]);

  const productosConSobrante = useMemo(() => {
    const set = new Set<string>();
    movHoy.filter((m) => m.tipo === "devolucion_chofer").forEach((m) => set.add(m.producto_id));
    return set;
  }, [movHoy]);

  const hayDespacho = despachados.length > 0;
  const yaReporto   = productosConSobrante.size > 0;

  // ── Monto del día ────────────────────────────────────────────────────────────
  const montoHoy = useMemo(() => {
    const talHoy = talonarios.filter(
      (t) => toDate(t.timestamp) >= todayStart && t.tipo === "retirada",
    );
    let total = 0, hayPrecios = false;
    for (const t of talHoy) {
      for (const p of t.productos) {
        if (p.precio != null && p.precio > 0) {
          total += p.precio * (p.cantidad ?? 0);
          hayPrecios = true;
        }
      }
    }
    return { total, hayPrecios };
  }, [talonarios, todayStart]);

  // ── Semáforo personal ────────────────────────────────────────────────────────
  const semaforo: SemaforoColor = !hayDespacho ? "rojo" : yaReporto ? "verde" : "amarillo";

  // ── Render ────────────────────────────────────────────────────────────────────
  if (cargando) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <p className="text-gray-400 text-sm animate-pulse">Cargando…</p>
      </div>
    );
  }

  const fechaHoy = new Date().toLocaleDateString("es-MX", {
    weekday: "long", day: "numeric", month: "long",
  });

  return (
    <div className="min-h-screen bg-gray-50">

      {/* Header */}
      <header className="bg-gradient-to-r from-cyan-600 to-teal-700 text-white shadow-lg sticky top-0 z-10">
        <div className="max-w-lg mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 bg-white/20 rounded-lg flex items-center justify-center
              font-bold text-sm flex-shrink-0">
              PB
            </div>
            <div>
              <p className="font-semibold text-sm leading-tight">{profile?.nombre}</p>
              <p className="text-cyan-200 text-xs">Polar Breeze · Chofer</p>
            </div>
          </div>
          <button
            onClick={logout}
            className="bg-white/15 hover:bg-white/25 active:scale-95 px-3 py-1.5
              rounded-lg text-xs transition-all duration-100 font-medium"
          >
            Salir
          </button>
        </div>
      </header>

      <div className="max-w-lg mx-auto px-4 py-5 space-y-4">

        {/* 1. Semáforo personal */}
        <SemaforoCard semaforo={semaforo} fecha={fechaHoy} />

        {/* 2. Puntos quincena */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-4">
          <div className="flex items-center justify-between mb-3">
            <span className="font-semibold text-sm text-gray-800">
              ⭐ Puntos — {quincena.label}
            </span>
            <span className="font-bold text-teal-700">
              {puntosTotal}{" "}
              <span className="text-gray-400 font-normal text-sm">/ {meta}</span>
            </span>
          </div>
          <div className="h-3.5 bg-gray-100 rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full transition-all duration-700 ${
                pct >= 80 ? "bg-green-500" : pct >= 50 ? "bg-yellow-500" : "bg-teal-500"
              }`}
              style={{ width: `${pct}%` }}
            />
          </div>
          <p className="text-xs text-gray-400 mt-1.5 text-right">{pct.toFixed(0)}% de la meta</p>
        </div>

        {/* 3. Despacho del día */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
          <div className="px-4 py-3 flex items-center justify-between border-b border-gray-100">
            <span className="font-semibold text-sm text-gray-800">📦 Despacho de hoy</span>
            <span className={`text-xs font-semibold px-2 py-1 rounded-full ${
              yaReporto   ? "bg-green-100 text-green-700" :
              hayDespacho ? "bg-amber-100 text-amber-700" :
                            "bg-gray-100 text-gray-400"
            }`}>
              {yaReporto ? "✅ Reportado" : hayDespacho ? "⏳ Pendiente" : "Sin actividad"}
            </span>
          </div>

          {!hayDespacho ? (
            <div className="px-4 py-5 text-center">
              <p className="text-sm text-gray-400">Sin despachos registrados hoy</p>
              <p className="text-xs text-gray-300 mt-1">
                El despachador debe registrar tu salida
              </p>
            </div>
          ) : (
            <ul className="divide-y divide-gray-50">
              {despachados.map(({ pid, nombre }) => (
                <li key={pid} className="px-4 py-2.5 flex items-center justify-between">
                  <span className="text-sm text-gray-700 font-medium">{nombre}</span>
                  <span className="text-base leading-none">
                    {productosConSobrante.has(pid) ? "✅" : "⏳"}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* 4. Monto estimado del día */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-4
          flex items-center justify-between">
          <span className="font-semibold text-sm text-gray-800">💰 Monto estimado</span>
          {montoHoy.hayPrecios ? (
            <span className="font-bold text-lg text-gray-900">
              ${montoHoy.total.toLocaleString("es-MX")}
            </span>
          ) : (
            <span className="text-sm text-gray-400">—</span>
          )}
        </div>

        {/* Formulario de sobrantes — solo si hay despacho y no ha reportado */}
        {hayDespacho && !yaReporto && <SobrantesChofer />}

        {/* Confirmación de cierre del día */}
        {hayDespacho && yaReporto && (
          <div className="bg-green-50 border border-green-200 rounded-xl p-4 text-center">
            <p className="text-green-700 font-semibold text-sm">✅ Día completado</p>
            <p className="text-green-500 text-xs mt-0.5">Sobrantes entregados y registrados</p>
          </div>
        )}

      </div>
    </div>
  );
}

// ─── Semáforo ─────────────────────────────────────────────────────────────────

const SEMAFORO_CFG = {
  verde: {
    dot:    "bg-green-500",
    ring:   "ring-4 ring-green-200",
    bg:     "bg-green-50",
    border: "border-green-200",
    text:   "text-green-700",
    label:  "Todo en orden",
  },
  amarillo: {
    dot:    "bg-amber-400",
    ring:   "ring-4 ring-amber-200",
    bg:     "bg-amber-50",
    border: "border-amber-200",
    text:   "text-amber-700",
    label:  "Reporte pendiente",
  },
  rojo: {
    dot:    "bg-red-500",
    ring:   "ring-4 ring-red-200",
    bg:     "bg-red-50",
    border: "border-red-200",
    text:   "text-red-600",
    label:  "Sin actividad hoy",
  },
} as const;

function SemaforoCard({ semaforo, fecha }: { semaforo: SemaforoColor; fecha: string }) {
  const cfg = SEMAFORO_CFG[semaforo];
  return (
    <div className={`rounded-xl border-2 ${cfg.bg} ${cfg.border} p-4 flex items-center gap-4`}>
      <div className={`w-11 h-11 rounded-full flex-shrink-0 ${cfg.dot} ${cfg.ring}`} />
      <div>
        <p className={`font-bold text-base ${cfg.text}`}>{cfg.label}</p>
        <p className="text-xs text-gray-400 mt-0.5 capitalize">{fecha}</p>
      </div>
    </div>
  );
}
