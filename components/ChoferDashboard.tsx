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
    return { start: new Date(year, month, 1), end: new Date(year, month, 15, 23, 59, 59), label: "1ª quincena" };
  }
  const lastDay = new Date(year, month + 1, 0).getDate();
  return { start: new Date(year, month, 16), end: new Date(year, month, lastDay, 23, 59, 59), label: "2ª quincena" };
}

type SemaforoColor = "verde" | "amarillo" | "rojo";

export default function ChoferDashboard() {
  const { profile, logout } = useAuth();

  const [records,      setRecords]      = useState<ImbentarioRecord[]>([]);
  const [puntosConfig, setPuntosConfig] = useState<PuntosConfig | null>(null);
  const [movimientos,  setMovimientos]  = useState<MovimientoLoker[]>([]);
  const [talonarios,   setTalonarios]   = useState<TalonarioDoc[]>([]);
  const [cargando,     setCargando]     = useState(true);
  const [whatsappNum,  setWhatsappNum]  = useState<string | null>(null);
  const [waLoading,    setWaLoading]    = useState(false);
  const [waErr,        setWaErr]        = useState<string | null>(null);

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

    // Número de WhatsApp del bot — leído de config/main, no se muestra en UI
    getDoc(doc(db, "config", "main")).then((snap) => {
      if (snap.exists()) {
        const num = snap.data()?.whatsappBot as string | undefined;
        setWhatsappNum(num?.replace(/\s/g, "") || null);
      }
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
      const d = toDate(r.timestamp); return d >= quincena.start && d <= quincena.end;
    });
    return recQ.reduce(
      (sum, r) => sum + (puntosMap[r.producto.toLowerCase().trim()] ?? 0) * (r.cantidadEntregada ?? 0), 0,
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
    movHoy.filter((m) => m.tipo === "salida_despacho").forEach((m) => map.set(m.producto_id, m.nombre));
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
    const talHoy = talonarios.filter((t) => toDate(t.timestamp) >= todayStart && t.tipo === "retirada");
    let total = 0, hayPrecios = false;
    for (const t of talHoy) {
      for (const p of t.productos) {
        if (p.precio != null && p.precio > 0) { total += p.precio * (p.cantidad ?? 0); hayPrecios = true; }
      }
    }
    return { total, hayPrecios };
  }, [talonarios, todayStart]);

  // ── Semáforo ─────────────────────────────────────────────────────────────────
  const semaforo: SemaforoColor = !hayDespacho ? "rojo" : yaReporto ? "verde" : "amarillo";

  // ── Reporte completo (para mensaje WhatsApp) ──────────────────────────────────
  const reporteCompleto = useMemo(() => {
    const despMap = new Map<string, { nombre: string; desp: number }>();
    movHoy.filter((m) => m.tipo === "salida_despacho").forEach((m) => {
      const prev = despMap.get(m.producto_id) ?? { nombre: m.nombre, desp: 0 };
      despMap.set(m.producto_id, { nombre: m.nombre, desp: prev.desp + Math.abs(m.cantidad) });
    });
    const sobrMap = new Map<string, number>();
    movHoy.filter((m) => m.tipo === "devolucion_chofer").forEach((m) => {
      sobrMap.set(m.producto_id, (sobrMap.get(m.producto_id) ?? 0) + m.cantidad);
    });
    return Array.from(despMap.entries()).map(([pid, { nombre, desp }]) => {
      const sobrante = sobrMap.get(pid) ?? 0;
      return { pid, nombre, sobrante, vendido: desp - sobrante };
    });
  }, [movHoy]);

  // ── WhatsApp ──────────────────────────────────────────────────────────────────
  const buildMsg = () => {
    const fecha = new Date().toLocaleDateString("es-MX", {
      weekday: "long", day: "numeric", month: "long",
    });
    const lines = [
      `📦 *REPORTE DE SOBRANTES*`,
      `🚛 ${profile?.nombre ?? "Chofer"}`,
      `📅 ${fecha}`,
      ``,
    ];
    reporteCompleto.forEach(({ nombre, sobrante, vendido }) => {
      lines.push(`• *${nombre}* — sobrante: ${sobrante} · vendido: ${vendido}`);
    });
    if (reporteCompleto.length === 0) lines.push("Sin productos registrados");
    lines.push(``, `✅ Polar Breeze Hub`);
    return lines.join("\n");
  };

  const handleWhatsApp = () => {
    if (!whatsappNum) return;
    setWaErr(null);
    setWaLoading(true);
    try {
      const clean = whatsappNum.replace(/\D/g, "");
      const url = `https://wa.me/${clean}?text=${encodeURIComponent(buildMsg())}`;
      window.open(url, "_blank");
    } catch {
      setWaErr("No se pudo abrir WhatsApp");
    } finally {
      setWaLoading(false);
    }
  };

  // ── Render: pantalla de carga ─────────────────────────────────────────────────
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

  // ── Render: sin despacho activo ───────────────────────────────────────────────
  if (!hayDespacho) {
    return (
      <div className="min-h-screen bg-gray-50 flex flex-col">
        <header className="bg-gradient-to-r from-cyan-600 to-teal-700 text-white shadow-lg">
          <div className="max-w-lg mx-auto px-4 py-3 flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 bg-white/20 rounded-lg flex items-center justify-center font-bold text-sm">PB</div>
              <div>
                <p className="font-semibold text-sm leading-tight">{profile?.nombre}</p>
                <p className="text-cyan-200 text-xs">Polar Breeze · Chofer</p>
              </div>
            </div>
            <button onClick={logout} className="bg-white/15 hover:bg-white/25 active:scale-95 px-3 py-1.5 rounded-lg text-xs transition-all duration-100 font-medium">
              Salir
            </button>
          </div>
        </header>

        <div className="flex-1 flex items-center justify-center p-8">
          <div className="text-center max-w-xs w-full space-y-5">

            {/* Icono de espera animado */}
            <div className="relative mx-auto w-24 h-24">
              <div className="absolute inset-0 rounded-full bg-amber-100 animate-ping opacity-40" />
              <div className="relative w-24 h-24 bg-amber-50 border-2 border-amber-200 rounded-full
                flex items-center justify-center">
                <span className="text-4xl leading-none">⏳</span>
              </div>
            </div>

            {/* Mensaje principal */}
            <div>
              <p className="font-bold text-gray-800 text-xl">Sin despacho activo</p>
              <p className="text-sm text-gray-500 mt-1 capitalize">{fechaHoy}</p>
            </div>

            {/* Instrucción */}
            <div className="bg-white rounded-xl border border-gray-200 shadow-sm px-5 py-4">
              <p className="text-sm text-gray-600 leading-relaxed">
                Tu ruta de hoy aún no ha sido registrada.
              </p>
              <p className="text-sm text-gray-600 mt-1 leading-relaxed">
                Espera a que el despachador registre tu salida.
              </p>
            </div>

            {/* Indicador en tiempo real */}
            <div className="flex items-center justify-center gap-2 text-xs text-gray-400">
              <span className="w-2 h-2 bg-green-400 rounded-full animate-pulse flex-shrink-0" />
              Actualizando en tiempo real
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ── Render: dashboard activo / solo lectura ───────────────────────────────────
  return (
    <div className="min-h-screen bg-gray-50">

      <header className="bg-gradient-to-r from-cyan-600 to-teal-700 text-white shadow-lg sticky top-0 z-10">
        <div className="max-w-lg mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 bg-white/20 rounded-lg flex items-center justify-center font-bold text-sm flex-shrink-0">PB</div>
            <div>
              <p className="font-semibold text-sm leading-tight">{profile?.nombre}</p>
              <p className="text-cyan-200 text-xs">
                Polar Breeze · Chofer{yaReporto ? " · 🔒 Solo lectura" : ""}
              </p>
            </div>
          </div>
          <button onClick={logout} className="bg-white/15 hover:bg-white/25 active:scale-95 px-3 py-1.5 rounded-lg text-xs transition-all duration-100 font-medium">
            Salir
          </button>
        </div>
      </header>

      <div className="max-w-lg mx-auto px-4 py-5 space-y-4 pb-8">

        {/* 1. Semáforo */}
        <SemaforoCard semaforo={semaforo} fecha={fechaHoy} />

        {/* 2. Puntos quincena */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-4">
          <div className="flex items-center justify-between mb-3">
            <span className="font-semibold text-sm text-gray-800">⭐ Puntos — {quincena.label}</span>
            <span className="font-bold text-teal-700">
              {puntosTotal} <span className="text-gray-400 font-normal text-sm">/ {meta}</span>
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
            <span className={`text-xs font-semibold px-2.5 py-1 rounded-full ${
              yaReporto ? "bg-green-100 text-green-700" : "bg-amber-100 text-amber-700"
            }`}>
              {yaReporto ? "✅ Reportado" : "⏳ Pendiente"}
            </span>
          </div>
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
        </div>

        {/* 4. Monto estimado */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-4 flex items-center justify-between">
          <span className="font-semibold text-sm text-gray-800">💰 Monto estimado</span>
          {montoHoy.hayPrecios ? (
            <span className="font-bold text-lg text-gray-900">
              ${montoHoy.total.toLocaleString("es-MX")}
            </span>
          ) : (
            <span className="text-sm text-gray-400">—</span>
          )}
        </div>

        {/* Formulario de sobrantes — solo cuando hay pendiente */}
        {!yaReporto && <SobrantesChofer />}

        {/* ── Modo solo lectura: día completado + WhatsApp ── */}
        {yaReporto && (
          <div className="space-y-3">

            {/* Banner de completado */}
            <div className="bg-green-50 border border-green-200 rounded-xl px-4 py-4 text-center">
              <p className="text-green-700 font-bold text-base">✅ Día completado</p>
              <p className="text-green-600 text-xs mt-0.5">
                Sobrantes entregados y registrados · modo solo lectura
              </p>
            </div>

            {/* Botón WhatsApp — solo si está configurado */}
            {whatsappNum && (
              <div className="space-y-2">
                <button
                  onClick={handleWhatsApp}
                  disabled={waLoading}
                  className="w-full flex items-center justify-center gap-3 bg-green-500
                    hover:bg-green-600 active:scale-[0.98] disabled:opacity-60 text-white
                    font-bold text-base py-4 rounded-xl shadow-md shadow-green-200
                    transition-all duration-100"
                >
                  <span className="text-2xl leading-none">📱</span>
                  <span>{waLoading ? "Abriendo WhatsApp…" : "Enviar reporte por WhatsApp"}</span>
                </button>

                {waErr && (
                  <p className="text-xs text-red-600 text-center">{waErr}</p>
                )}
              </div>
            )}

          </div>
        )}

      </div>
    </div>
  );
}

// ─── Semáforo ─────────────────────────────────────────────────────────────────

const SEMAFORO_CFG = {
  verde:    { dot: "bg-green-500", ring: "ring-4 ring-green-200",  bg: "bg-green-50",  border: "border-green-200",  text: "text-green-700",  label: "Todo en orden"     },
  amarillo: { dot: "bg-amber-400", ring: "ring-4 ring-amber-200",  bg: "bg-amber-50",  border: "border-amber-200",  text: "text-amber-700",  label: "Reporte pendiente" },
  rojo:     { dot: "bg-red-500",   ring: "ring-4 ring-red-200",    bg: "bg-red-50",    border: "border-red-200",    text: "text-red-600",    label: "Sin actividad hoy" },
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
