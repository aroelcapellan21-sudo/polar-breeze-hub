"use client";

import { useState, useEffect, useMemo } from "react";
import { collection, onSnapshot, query, where, getDoc, doc } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useAuth } from "@/lib/auth-context";
import {
  ImbentarioRecord, PuntosConfig, PuntoProducto,
  MovimientoLoker, TalonarioDoc, toDate,
} from "@/lib/types";
import SobrantesChofer       from "@/components/chofer/SobrantesChofer";
import FloatingFAB           from "@/components/shared/FloatingFAB";
import PWAInstallBanner       from "@/components/shared/PWAInstallBanner";
import ConsultarTablaModal   from "@/components/shared/ConsultarTablaModal";
import { ShareBar }          from "@/components/shared/ShareButtons";
import { useRegisterModal } from "@/components/shared/ModalShareContext";
import { pbHeader, pbFooter } from "@/lib/wa-format";
import { pbPrintDoc, pbTable, pbQrSection } from "@/lib/print-template";
import WelcomeBanner from "@/components/shared/WelcomeBanner";

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

  type ChoferModal = "semaforo" | "puntos" | "monto" | { pid: string; nombre: string } | null;
  const [modal,        setModal]        = useState<ChoferModal>(null);
  const [showTablas,   setShowTablas]   = useState(false);
  const [qrDataUrl,    setQrDataUrl]    = useState("");
  const [barcodeUrl,   setBarcodeUrl]   = useState("");

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

  // ── QR y código de barras para facturas impresas ─────────────────────────────
  useEffect(() => {
    if (!profile?.ficha) return;
    const ficha = profile.ficha;
    const appUrl = `${window.location.origin}?ficha=${encodeURIComponent(ficha)}`;

    import("qrcode").then((mod) => {
      mod.default.toDataURL(appUrl, { margin: 1, width: 120, color: { dark: "#1e3a5f", light: "#ffffff" } })
        .then(setQrDataUrl);
    });

    import("jsbarcode").then((mod) => {
      const canvas = document.createElement("canvas");
      mod.default(canvas, ficha, {
        format: "CODE128", width: 2, height: 45,
        fontSize: 12, displayValue: true, margin: 4,
        lineColor: "#1e3a5f",
      });
      setBarcodeUrl(canvas.toDataURL());
    });
  }, [profile?.ficha]);

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

  const puntosDetalle = useMemo(() => {
    const recQ = records.filter((r) => {
      const d = toDate(r.timestamp);
      return d >= quincena.start && d <= quincena.end;
    });
    const map: Record<string, { nombre: string; cantidad: number; pts: number; total: number }> = {};
    recQ.forEach((r) => {
      const key = r.producto.toLowerCase().trim();
      const p   = puntosMap[key] ?? 0;
      if (!map[key]) map[key] = { nombre: r.producto, cantidad: 0, pts: p, total: 0 };
      map[key].cantidad += r.cantidadEntregada ?? 0;
      map[key].total    += p * (r.cantidadEntregada ?? 0);
    });
    return Object.values(map).sort((a, b) => b.total - a.total);
  }, [records, quincena, puntosMap]);

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
      return { pid, nombre, desp, sobrante, vendido: desp - sobrante };
    });
  }, [movHoy]);

  // ── WhatsApp ──────────────────────────────────────────────────────────────────
  const buildMsg = () => {
    const lines = [
      pbHeader(),
      `📦 *REPORTE DE SOBRANTES*`,
      `🚛 ${profile?.nombre ?? "Chofer"}`,
      ``,
    ];
    reporteCompleto.forEach(({ nombre, sobrante, vendido }) => {
      lines.push(`• *${nombre}* — sobrante: ${sobrante} · vendido: ${vendido}`);
    });
    if (reporteCompleto.length === 0) lines.push("Sin productos registrados");
    lines.push("", pbFooter());
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

  // ── Mensajes para modales ────────────────────────────────────────────────────
  const buildPuntosMsg = () => {
    const lines = [pbHeader(), "", `⭐ *PUNTOS QUINCENA*`, `🚛 ${profile?.nombre ?? "Chofer"}`, `📅 ${quincena.label}`, ""];
    lines.push(`Total: *${puntosTotal} / ${meta} pts* (${pct.toFixed(0)}%)`);
    if (puntosDetalle.length > 0) {
      lines.push("");
      puntosDetalle.forEach((d) => lines.push(`• ${d.nombre}: ${d.cantidad} uds × ${d.pts} pts = *${d.total} pts*`));
    }
    lines.push("", pbFooter());
    return lines.join("\n");
  };

  const buildPuntosHtml = () => {
    const rows = puntosDetalle.map((d) => [d.nombre, d.cantidad, d.pts, `<b>${d.total}</b>`]);
    const total: (string|number)[] = ["<b>Total</b>", "", "", `<b>${puntosTotal} / ${meta} pts</b>`];
    const qr = pbQrSection(qrDataUrl, barcodeUrl, profile?.ficha ?? "", profile?.nombre ?? "");
    return pbPrintDoc(
      `Puntos — ${quincena.label}`,
      `${profile?.nombre ?? "Chofer"} · ${pct.toFixed(0)}% de la meta`,
      pbTable(["Producto", "Cantidad", "Pts/ud", "Total"], rows, total) + qr,
    );
  };

  const buildMontoMsg = () => {
    const talHoy = talonarios.filter((t) => toDate(t.timestamp) >= todayStart && t.tipo === "retirada");
    const items  = talHoy.flatMap((t) =>
      t.productos.filter((p) => p.precio != null && p.precio! > 0).map((p) => ({
        nombre: p.nombre, cantidad: p.cantidad ?? 0, precio: p.precio!,
        subtotal: p.precio! * (p.cantidad ?? 0),
      }))
    );
    const lines = [pbHeader(), "", "💰 *MONTO ESTIMADO DEL DÍA*", `🚛 ${profile?.nombre ?? "Chofer"}`, ""];
    if (items.length === 0) {
      lines.push("Sin precios configurados.");
    } else {
      items.forEach((it) => lines.push(`• ${it.nombre}: ${it.cantidad} × $${it.precio} = *$${it.subtotal.toLocaleString("es-MX")}*`));
      lines.push("", `Total: *$${montoHoy.total.toLocaleString("es-MX")}*`);
    }
    lines.push("", pbFooter());
    return lines.join("\n");
  };

  const buildMontoHtml = () => {
    const talHoy = talonarios.filter((t) => toDate(t.timestamp) >= todayStart && t.tipo === "retirada");
    const items  = talHoy.flatMap((t) =>
      t.productos.filter((p) => p.precio != null && p.precio! > 0).map((p) => ({
        nombre: p.nombre, cantidad: p.cantidad ?? 0, precio: p.precio!,
        subtotal: p.precio! * (p.cantidad ?? 0),
      }))
    );
    const rows  = items.map((it) => [it.nombre, it.cantidad, `$${it.precio.toLocaleString()}`, `<b>$${it.subtotal.toLocaleString("es-MX")}</b>`]);
    const total: (string|number)[] = ["<b>Total estimado</b>", "", "", `<b>$${montoHoy.total.toLocaleString("es-MX")}</b>`];
    const qr = pbQrSection(qrDataUrl, barcodeUrl, profile?.ficha ?? "", profile?.nombre ?? "");
    return pbPrintDoc(
      "Monto Estimado del Día",
      profile?.nombre ?? "Chofer",
      (rows.length > 0 ? pbTable(["Producto", "Cantidad", "Precio", "Subtotal"], rows, total) : "<p>Sin precios configurados.</p>") + qr,
    );
  };

  // ── Registra modal activo en el FAB flotante (antes de cualquier return) ──────
  const modalHasShare = modal === "puntos" || modal === "monto";
  useRegisterModal(
    modalHasShare,
    modal === "puntos" ? buildPuntosMsg : buildMontoMsg,
    modal === "puntos" ? buildPuntosHtml : buildMontoHtml,
  );

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
        <header className="text-white shadow-lg" style={{ background: "linear-gradient(90deg, rgba(245,200,0,0.55) 0% 33.33%, rgba(212,43,43,0.55) 33.33% 66.66%, rgba(30,140,58,0.55) 66.66% 100%), #1A1A1A" }}>
          <div className="max-w-lg mx-auto px-4 py-3 flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-lg flex items-center justify-center shadow ring-1 ring-white/20 flex-shrink-0"
                   style={{ background: "linear-gradient(135deg, #F5C800 33%, #D42B2B 33% 66%, #1E8C3A 66%)" }}>
                <span className="text-sm">🧊</span>
              </div>
              <div>
                <p className="font-semibold text-sm leading-tight">{profile?.nombre}</p>
                <p className="text-white/60 text-xs">Polar Breeze · Chofer</p>
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

      <header className="text-white shadow-lg sticky top-0 z-10" style={{ background: "linear-gradient(90deg, rgba(245,200,0,0.55) 0% 33.33%, rgba(212,43,43,0.55) 33.33% 66.66%, rgba(30,140,58,0.55) 66.66% 100%), #1A1A1A" }}>
        <div className="max-w-lg mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg flex items-center justify-center shadow ring-1 ring-white/20 flex-shrink-0"
                 style={{ background: "linear-gradient(135deg, #F5C800 33%, #D42B2B 33% 66%, #1E8C3A 66%)" }}>
              <span className="text-sm">🧊</span>
            </div>
            <div>
              <p className="font-semibold text-sm leading-tight">{profile?.nombre}</p>
              <p className="text-white/60 text-xs">
                Polar Breeze · Chofer{yaReporto ? " · 🔒 Solo lectura" : ""}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-1.5">
            <button
              onClick={() => setShowTablas(true)}
              title="Consultar tablas"
              className="bg-white/15 hover:bg-white/25 active:scale-95 w-8 h-8 rounded-lg
                flex items-center justify-center text-base transition-all duration-100"
            >
              📋
            </button>
            <button onClick={logout} className="bg-white/15 hover:bg-white/25 active:scale-95 px-3 py-1.5 rounded-lg text-xs transition-all duration-100 font-medium">
              Salir
            </button>
          </div>
        </div>
      </header>

      <WelcomeBanner nombre={profile?.nombre ?? ""} area="Ruta del día" acento="#1A1A1A" />

      <div className="max-w-lg mx-auto px-4 py-5 space-y-4 pb-8">

        {/* 1. Semáforo */}
        <SemaforoCard semaforo={semaforo} fecha={fechaHoy} onClick={() => setModal("semaforo")} />

        {/* 2. Puntos quincena */}
        <button
          onClick={() => setModal("puntos")}
          className="w-full bg-white rounded-xl shadow-sm border border-gray-200 p-4 active:scale-95 transition-all duration-100 text-left hover:shadow-md"
        >
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
          <p className="text-xs text-gray-400 mt-1.5 text-right">{pct.toFixed(0)}% de la meta · Toca para desglose ›</p>
        </button>

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
          <div className="divide-y divide-gray-50">
            {despachados.map(({ pid, nombre }) => (
              <button
                key={pid}
                onClick={() => setModal({ pid, nombre })}
                className="w-full px-4 py-2.5 flex items-center justify-between hover:bg-gray-50 active:scale-[0.99] transition-all duration-100 text-left"
              >
                <span className="text-sm text-gray-700 font-medium">{nombre}</span>
                <div className="flex items-center gap-2">
                  <span className="text-base leading-none">
                    {productosConSobrante.has(pid) ? "✅" : "⏳"}
                  </span>
                  <span className="text-gray-300 text-sm">›</span>
                </div>
              </button>
            ))}
          </div>
        </div>

        {/* 4. Monto estimado */}
        <button
          onClick={() => setModal("monto")}
          className="w-full bg-white rounded-xl shadow-sm border border-gray-200 p-4 flex items-center justify-between active:scale-95 transition-all duration-100 hover:shadow-md text-left"
        >
          <span className="font-semibold text-sm text-gray-800">💰 Monto estimado</span>
          <div className="flex items-center gap-2">
            {montoHoy.hayPrecios ? (
              <span className="font-bold text-lg text-gray-900">
                ${montoHoy.total.toLocaleString("es-MX")}
              </span>
            ) : (
              <span className="text-sm text-gray-400">— Toca para ver</span>
            )}
            <span className="text-gray-300 text-sm">›</span>
          </div>
        </button>

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

      {/* ── Modal global ── */}
      {modal !== null && (
        <div
          className="fixed inset-0 bg-black/50 z-50 flex items-end sm:items-center justify-center p-4"
          onClick={() => setModal(null)}
        >
          <div
            className="bg-white rounded-2xl shadow-2xl w-full max-w-md max-h-[80vh] flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="flex items-center gap-2 px-5 py-4 border-b flex-shrink-0">
              <h3 className="font-bold text-gray-800 flex-1 min-w-0 truncate">
                {modal === "semaforo" ? "🚦 Estado del semáforo"
                 : modal === "puntos" ? `⭐ Puntos — ${quincena.label}`
                 : modal === "monto"  ? "💰 Monto estimado"
                 : `📦 ${typeof modal === "object" ? modal.nombre : ""}`}
              </h3>
              {modal === "puntos" && (
                <ShareBar getMessage={buildPuntosMsg} getPrintHtml={buildPuntosHtml} className="flex-shrink-0" />
              )}
              {modal === "monto" && (
                <ShareBar getMessage={buildMontoMsg} getPrintHtml={buildMontoHtml} className="flex-shrink-0" />
              )}
              <button
                onClick={() => setModal(null)}
                className="text-gray-400 hover:text-gray-600 text-2xl leading-none active:scale-95 transition-all flex-shrink-0"
              >×</button>
            </div>

            {/* Body */}
            <div className="flex-1 overflow-y-auto p-5 space-y-3">

              {/* Semáforo */}
              {modal === "semaforo" && (
                <div className="space-y-3">
                  {(Object.entries(SEMAFORO_CFG) as [SemaforoColor, typeof SEMAFORO_CFG[SemaforoColor]][]).map(([key, cfg]) => (
                    <div key={key} className={`flex items-center gap-3 p-3 rounded-xl border ${
                      semaforo === key ? `${cfg.border} ${cfg.bg}` : "border-gray-100 bg-gray-50"
                    }`}>
                      <div className={`w-4 h-4 rounded-full flex-shrink-0 ${cfg.dot}`} />
                      <div className="flex-1">
                        <p className={`text-sm font-semibold ${semaforo === key ? cfg.text : "text-gray-500"}`}>{cfg.label}</p>
                        <p className="text-xs text-gray-400 mt-0.5">
                          {key === "verde"    ? "Sobrantes entregados · día completado ✓"
                           : key === "amarillo" ? "Despacho activo · sobrantes pendientes de reportar"
                           :                     "Sin despacho registrado hoy"}
                        </p>
                      </div>
                      {semaforo === key && <span className="text-xs font-bold text-[#D42B2B] flex-shrink-0">← Actual</span>}
                    </div>
                  ))}
                </div>
              )}

              {/* Puntos */}
              {modal === "puntos" && (
                <div className="space-y-3">
                  <div className="flex justify-between items-center bg-teal-50 border border-teal-200 rounded-xl px-4 py-3">
                    <span className="text-sm font-bold text-teal-700">Total quincena</span>
                    <span className="text-lg font-bold text-teal-700">{puntosTotal} / {meta} pts</span>
                  </div>
                  {puntosDetalle.length === 0 ? (
                    <div className="text-center py-6">
                      <p className="text-3xl mb-2">⭐</p>
                      <p className="text-sm text-gray-500 font-medium">Sin entregas con puntos en esta quincena</p>
                      <p className="text-xs text-gray-400 mt-1">Los puntos se configuran en Admin → Configuración</p>
                    </div>
                  ) : puntosDetalle.map((d, i) => (
                    <div key={i} className="flex items-center justify-between border border-gray-100 rounded-xl px-3 py-2.5">
                      <div>
                        <p className="text-sm font-medium text-gray-800">{d.nombre}</p>
                        <p className="text-xs text-gray-400">{d.cantidad} uds × {d.pts} pts/ud</p>
                      </div>
                      <span className="font-bold text-teal-700">+{d.total} pts</span>
                    </div>
                  ))}
                </div>
              )}

              {/* Producto individual */}
              {typeof modal === "object" && modal !== null && "pid" in modal && (() => {
                const prod     = reporteCompleto.find((r) => r.pid === (modal as {pid:string}).pid);
                const reportado = productosConSobrante.has((modal as {pid:string}).pid);
                return (
                  <div className="space-y-3">
                    <div className="grid grid-cols-3 gap-3">
                      <div className="bg-blue-50 rounded-xl p-3 text-center">
                        <p className="text-2xl font-bold text-blue-700">{prod?.desp ?? 0}</p>
                        <p className="text-xs text-blue-500 mt-0.5">Despachado</p>
                      </div>
                      <div className="bg-teal-50 rounded-xl p-3 text-center">
                        <p className="text-2xl font-bold text-teal-700">{reportado ? (prod?.sobrante ?? 0) : "—"}</p>
                        <p className="text-xs text-teal-500 mt-0.5">Sobrante</p>
                      </div>
                      <div className="bg-green-50 rounded-xl p-3 text-center">
                        <p className="text-2xl font-bold text-green-700">{reportado ? (prod?.vendido ?? 0) : "—"}</p>
                        <p className="text-xs text-green-500 mt-0.5">Vendido</p>
                      </div>
                    </div>
                    {!reportado && (
                      <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 text-center">
                        <p className="text-sm font-medium text-amber-700">⏳ Sobrante pendiente</p>
                        <p className="text-xs text-amber-500 mt-0.5">Registra tus sobrantes para ver los números finales</p>
                      </div>
                    )}
                  </div>
                );
              })()}

              {/* Monto */}
              {modal === "monto" && (() => {
                const talHoy = talonarios.filter((t) => toDate(t.timestamp) >= todayStart && t.tipo === "retirada");
                const items  = talHoy.flatMap((t) =>
                  t.productos
                    .filter((p) => p.precio != null && p.precio! > 0)
                    .map((p) => ({
                      nombre: p.nombre, cantidad: p.cantidad ?? 0,
                      precio: p.precio!, subtotal: p.precio! * (p.cantidad ?? 0),
                    }))
                );
                return items.length === 0 ? (
                  <div className="text-center py-6">
                    <p className="text-3xl mb-2">💰</p>
                    <p className="text-sm text-gray-500 font-medium">Sin precios configurados</p>
                    <p className="text-xs text-gray-400 mt-1">El despachador asigna precios al registrar tu talonario</p>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {items.map((it, i) => (
                      <div key={i} className="flex items-center justify-between border border-gray-100 rounded-xl px-3 py-2">
                        <div>
                          <p className="text-sm font-medium text-gray-800">{it.nombre}</p>
                          <p className="text-xs text-gray-400">{it.cantidad} × ${it.precio.toLocaleString()}</p>
                        </div>
                        <span className="font-bold text-green-700">${it.subtotal.toLocaleString()}</span>
                      </div>
                    ))}
                    <div className="flex justify-between bg-green-50 border border-green-200 rounded-xl px-4 py-3">
                      <span className="font-bold text-green-700">Total estimado</span>
                      <span className="font-bold text-green-700">${montoHoy.total.toLocaleString("es-MX")}</span>
                    </div>
                  </div>
                );
              })()}

            </div>
          </div>
        </div>
      )}

      {/* ── Modal Tablas ── */}
      {showTablas && <ConsultarTablaModal onClose={() => setShowTablas(false)} />}

      {/* ── Botón flotante ── */}
      <FloatingFAB getMessage={buildMsg} />

      {/* ── Banner de instalación PWA ── */}
      <PWAInstallBanner appName="App Chofer" appIcon="🚚" />
    </div>
  );
}

// ─── Semáforo ─────────────────────────────────────────────────────────────────

const SEMAFORO_CFG = {
  verde:    { dot: "bg-green-500", ring: "ring-4 ring-green-200",  bg: "bg-green-50",  border: "border-green-200",  text: "text-green-700",  label: "Todo en orden"     },
  amarillo: { dot: "bg-amber-400", ring: "ring-4 ring-amber-200",  bg: "bg-amber-50",  border: "border-amber-200",  text: "text-amber-700",  label: "Reporte pendiente" },
  rojo:     { dot: "bg-red-500",   ring: "ring-4 ring-red-200",    bg: "bg-red-50",    border: "border-red-200",    text: "text-red-600",    label: "Sin actividad hoy" },
} as const;

function SemaforoCard({ semaforo, fecha, onClick }: { semaforo: SemaforoColor; fecha: string; onClick?: () => void }) {
  const cfg = SEMAFORO_CFG[semaforo];
  return (
    <button
      onClick={onClick}
      className={`w-full rounded-xl border-2 ${cfg.bg} ${cfg.border} p-4 flex items-center gap-4 active:scale-95 transition-all duration-100 text-left hover:shadow-md`}
    >
      <div className={`w-11 h-11 rounded-full flex-shrink-0 ${cfg.dot} ${cfg.ring}`} />
      <div className="flex-1">
        <p className={`font-bold text-base ${cfg.text}`}>{cfg.label}</p>
        <p className="text-xs text-gray-400 mt-0.5 capitalize">{fecha}</p>
      </div>
      <span className="text-gray-300 text-lg flex-shrink-0">›</span>
    </button>
  );
}
