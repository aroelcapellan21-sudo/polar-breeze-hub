"use client";

import { useState, useEffect, useMemo, useRef } from "react";
import { collection, doc, getDoc, onSnapshot, addDoc, Timestamp } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useAuth } from "@/lib/auth-context";
import { ProductoItem, FsSession, FsDriver, MovimientoLoker, toDate } from "@/lib/types";

// ─── Types ────────────────────────────────────────────────────────────────────

interface FaltanteRow { _id: string; producto: string; cantFaltante: number; choferAfectado: string; }
interface DanadoRow   { _id: string; producto: string; cantidad: number; choferRechazo: string; motivo: string; }
interface SobranteRow { producto: string; cantidad: number; fuente: string; }
interface CfNoEntrRow { _id: string; producto: string; cantidad: number; motivo: string; persona: string; }
interface SubProd     { _id: string; nombre: string; cantidad: number; }
interface ChoferCierre {
  choferId:  string;
  nombre:    string;
  ficha:     string;
  retirados: ProductoItem[];
  agregado1: SubProd[];
  agregado0: SubProd[];
  faltantes: SubProd[];
}

let _seq = 0;
const nid = () => `r${++_seq}`;
const norm = (s: string) => s.toLowerCase().trim().replace(/\s+/g, " ");

// ─── Helpers de tabla editables ───────────────────────────────────────────────

function TablaHeader({ children }: { children: React.ReactNode }) {
  return (
    <div className="px-3 py-1.5 bg-gray-100 border-b border-gray-200 grid text-xs font-semibold text-gray-500 uppercase tracking-wide">
      {children}
    </div>
  );
}

// ─── Component ────────────────────────────────────────────────────────────────

interface Empresa { nombre: string; rnc: string; direccion: string; telefono: string; }

export default function InformeCierre() {
  const { profile } = useAuth();
  const printRef = useRef<HTMLDivElement>(null);

  const [empresa,  setEmpresa]  = useState<Empresa | null>(null);
  const [session,  setSession]  = useState<FsSession | null>(null);
  const [drivers,  setDrivers]  = useState<FsDriver[]>([]);
  const [movsHoy,  setMovsHoy]  = useState<MovimientoLoker[]>([]);
  const [cargando, setCargando] = useState(true);

  // Tablas editables
  const [faltantesRows, setFaltantesRows] = useState<FaltanteRow[]>([]);
  const [danadosRows,   setDanadosRows]   = useState<DanadoRow[]>([]);
  const [cfNoEntrRows,  setCfNoEntrRows]  = useState<CfNoEntrRow[]>([]);
  const [choferData,    setChoferData]    = useState<ChoferCierre[]>([]);
  const [obsGenerales,  setObsGenerales]  = useState("");

  // UI
  const [abiertos, setAbiertos] = useState({ t1: true, t2: true, t3: true, t4: true });
  const [choferAbierto, setChoferAbierto] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);
  const [cerrado,   setCerrado]   = useState(false);
  const [msg, setMsg] = useState<{ type: "ok" | "err"; text: string } | null>(null);

  const initedFaltantes = useRef(false);
  const initedDanados   = useRef(false);
  const initedChoferes  = useRef(false);

  // ── Empresa ───────────────────────────────────────────────────────────────────
  useEffect(() => {
    getDoc(doc(db, "config", "empresa")).then((snap) => {
      if (snap.exists()) setEmpresa(snap.data() as Empresa);
    });
  }, []);

  // ── Listeners ────────────────────────────────────────────────────────────────
  useEffect(() => {
    const u1 = onSnapshot(doc(db, "session", "despacho"), (s) =>
      setSession(s.exists() ? (s.data() as FsSession) : null)
    );
    const u2 = onSnapshot(collection(db, "drivers"), (s) => {
      setDrivers(s.docs.map((d) => ({ id: d.id, ...d.data() } as FsDriver)));
      setCargando(false);
    });
    const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
    const u3 = onSnapshot(collection(db, "movimientos_loker"), (s) => {
      const hoy = s.docs
        .map((d) => ({ id: d.id, ...d.data() } as MovimientoLoker))
        .filter((m) => toDate(m.timestamp) >= todayStart);
      setMovsHoy(hoy);
    });
    return () => { u1(); u2(); u3(); };
  }, []);

  const cuartoFrio: ProductoItem[] = useMemo(
    () => (Array.isArray(session?.cuartoFrio) ? (session!.cuartoFrio as ProductoItem[]) : []),
    [session],
  );

  // ── Mapa entregas por producto ────────────────────────────────────────────
  const entregaMap = useMemo(() => {
    const map: Record<string, { total: number; choferes: string[] }> = {};
    drivers.forEach((d) => {
      (Array.isArray(d.entregas) ? (d.entregas as ProductoItem[]) : []).forEach((e) => {
        const key = norm(e.nombre ?? "");
        if (!map[key]) map[key] = { total: 0, choferes: [] };
        map[key].total += e.cantidad ?? 0;
        const nombre = (d.nombre as string) ?? "?";
        if (!map[key].choferes.includes(nombre)) map[key].choferes.push(nombre);
      });
    });
    return map;
  }, [drivers]);

  // ── Sobrantes auto (cuartoFrío - dispatched, cuando diff > 0) ────────────
  const sobrantesAuto = useMemo((): SobranteRow[] => {
    return cuartoFrio
      .map((p) => {
        const key  = norm(p.nombre ?? "");
        const entr = entregaMap[key]?.total ?? 0;
        const diff = (p.cantidad ?? 0) - entr;
        return { producto: p.nombre ?? "", cantidad: diff, fuente: "Cuarto Frío" };
      })
      .filter((r) => r.cantidad > 0);
  }, [cuartoFrio, entregaMap]);

  // Sobrantes de devoluciones de choferes hoy
  const sobrantesLoker = useMemo((): SobranteRow[] => {
    const map: Record<string, number> = {};
    movsHoy
      .filter((m) => m.tipo === "devolucion_chofer")
      .forEach((m) => { map[m.nombre] = (map[m.nombre] ?? 0) + m.cantidad; });
    return Object.entries(map).map(([producto, cantidad]) => ({
      producto, cantidad, fuente: "Devolución chofer",
    }));
  }, [movsHoy]);

  const sobrantesTotal = useMemo((): SobranteRow[] => {
    // Consolidar por nombre (puede haber overlap)
    const map: Record<string, SobranteRow> = {};
    [...sobrantesAuto, ...sobrantesLoker].forEach((s) => {
      const key = norm(s.producto);
      if (!map[key]) map[key] = { ...s };
      else {
        map[key].cantidad += s.cantidad;
        if (!map[key].fuente.includes(s.fuente)) map[key].fuente += ` + ${s.fuente}`;
      }
    });
    return Object.values(map);
  }, [sobrantesAuto, sobrantesLoker]);

  // ── Init faltantes (solo 1a vez) ──────────────────────────────────────────
  useEffect(() => {
    if (initedFaltantes.current || cerrado) return;
    const sugeridos = cuartoFrio
      .filter((p) => {
        const key = norm(p.nombre ?? "");
        const entr = entregaMap[key]?.total ?? 0;
        return (p.cantidad ?? 0) > entr;
      })
      .map((p) => {
        const key    = norm(p.nombre ?? "");
        const entr   = entregaMap[key]?.total ?? 0;
        const diff   = (p.cantidad ?? 0) - entr;
        const chofers = (entregaMap[key]?.choferes ?? []).join(", ") || "Sin asignar";
        return { _id: nid(), producto: p.nombre ?? "", cantFaltante: diff, choferAfectado: chofers };
      });
    if (sugeridos.length > 0) {
      setFaltantesRows(sugeridos);
      initedFaltantes.current = true;
    }
  }, [cuartoFrio, entregaMap, cerrado]);

  // ── Init dañados (solo 1a vez) ────────────────────────────────────────────
  useEffect(() => {
    if (initedDanados.current || cerrado) return;
    const detectados: DanadoRow[] = [];
    drivers.forEach((d) => {
      (Array.isArray(d.entregas) ? (d.entregas as ProductoItem[]) : [])
        .filter((e) => e.visto === "mal")
        .forEach((e) => {
          detectados.push({
            _id:          nid(),
            producto:     e.nombre,
            cantidad:     e.cantidad ?? 0,
            choferRechazo: (d.nombre as string) ?? "?",
            motivo:       "",
          });
        });
    });
    if (detectados.length > 0) {
      setDanadosRows(detectados);
      initedDanados.current = true;
    }
  }, [drivers, cerrado]);

  // ── Init choferes (solo 1a vez) ───────────────────────────────────────────
  useEffect(() => {
    if (initedChoferes.current || cerrado || drivers.length === 0) return;
    const withEntregas = drivers.filter(
      (d) => Array.isArray(d.entregas) && (d.entregas as ProductoItem[]).length > 0
    );
    if (withEntregas.length === 0) return;
    setChoferData(withEntregas.map((d) => ({
      choferId:  d.id ?? "",
      nombre:    (d.nombre as string) ?? "Chofer",
      ficha:     (d.ficha as string) ?? "",
      retirados: Array.isArray(d.entregas) ? (d.entregas as ProductoItem[]) : [],
      agregado1: [],
      agregado0: [],
      faltantes: [],
    })));
    initedChoferes.current = true;
  }, [drivers, cerrado]);

  // ── Mutators ──────────────────────────────────────────────────────────────

  // Faltantes
  const addFaltante   = () => setFaltantesRows((p) => [...p, { _id: nid(), producto: "", cantFaltante: 0, choferAfectado: "" }]);
  const remFaltante   = (id: string) => setFaltantesRows((p) => p.filter((r) => r._id !== id));
  const setFaltante   = (id: string, key: keyof Omit<FaltanteRow, "_id">, val: string | number) =>
    setFaltantesRows((p) => p.map((r) => r._id === id ? { ...r, [key]: val } : r));

  // Dañados
  const addDanado  = () => setDanadosRows((p) => [...p, { _id: nid(), producto: "", cantidad: 0, choferRechazo: "", motivo: "" }]);
  const remDanado  = (id: string) => setDanadosRows((p) => p.filter((r) => r._id !== id));
  const setDanado  = (id: string, key: keyof Omit<DanadoRow, "_id">, val: string | number) =>
    setDanadosRows((p) => p.map((r) => r._id === id ? { ...r, [key]: val } : r));

  // CF no entregados
  const addCfNoEntr = () => setCfNoEntrRows((p) => [...p, { _id: nid(), producto: "", cantidad: 0, motivo: "", persona: "" }]);
  const remCfNoEntr = (id: string) => setCfNoEntrRows((p) => p.filter((r) => r._id !== id));
  const setCfNoEntr = (id: string, key: keyof Omit<CfNoEntrRow, "_id">, val: string | number) =>
    setCfNoEntrRows((p) => p.map((r) => r._id === id ? { ...r, [key]: val } : r));

  // Chofer sub-sections
  const addSubProd = (choferId: string, section: "agregado1" | "agregado0" | "faltantes") =>
    setChoferData((prev) => prev.map((c) =>
      c.choferId === choferId ? { ...c, [section]: [...c[section], { _id: nid(), nombre: "", cantidad: 0 }] } : c
    ));
  const remSubProd = (choferId: string, section: "agregado1" | "agregado0" | "faltantes", id: string) =>
    setChoferData((prev) => prev.map((c) =>
      c.choferId === choferId ? { ...c, [section]: c[section].filter((r) => r._id !== id) } : c
    ));
  const setSubProd = (choferId: string, section: "agregado1" | "agregado0" | "faltantes", id: string, key: "nombre" | "cantidad", val: string | number) =>
    setChoferData((prev) => prev.map((c) =>
      c.choferId === choferId ? { ...c, [section]: c[section].map((r) => r._id === id ? { ...r, [key]: val } : r) } : c
    ));

  // ── Guardar informe ───────────────────────────────────────────────────────
  const guardar = async () => {
    if (!profile) return;
    setGuardando(true);
    try {
      await addDoc(collection(db, "informes_cierre"), {
        fecha:              Timestamp.now(),
        despachadorId:      profile.uid,
        despachadorNombre:  profile.nombre,
        faltantesDespacho:  faltantesRows.map(({ _id: _, ...r }) => r),
        danadosNoRecibidos: danadosRows.map(({ _id: _, ...r }) => r),
        sobrantesDespacho:  sobrantesTotal,
        cfNoEntregados:     cfNoEntrRows.map(({ _id: _, ...r }) => r),
        choferes:           choferData.map((c) => ({
          ...c,
          agregado1: c.agregado1.map(({ _id: _, ...r }) => r),
          agregado0: c.agregado0.map(({ _id: _, ...r }) => r),
          faltantes: c.faltantes.map(({ _id: _, ...r }) => r),
        })),
        observacionesGenerales: obsGenerales || null,
        cerradoAt:          Timestamp.now(),
      });
      setCerrado(true);
      setMsg({ type: "ok", text: "Informe guardado correctamente." });
      setTimeout(() => setMsg(null), 5000);
    } catch (e) {
      setMsg({ type: "err", text: e instanceof Error ? e.message : "Error al guardar" });
    } finally {
      setGuardando(false);
    }
  };

  // ── Imprimir ──────────────────────────────────────────────────────────────
  const handlePrint = () => {
    const fecha = new Date().toLocaleDateString("es-MX", {
      weekday: "long", day: "numeric", month: "long", year: "numeric",
    });

    const choferRows = choferData.map((c) => `
      <h3 style="margin:12px 0 6px;background:#e8f0fe;padding:4px 8px;border-radius:4px">
        🚛 ${c.nombre}${c.ficha ? ` — Ficha ${c.ficha}` : ""}
      </h3>
      <p style="font-weight:600;margin:8px 0 4px">Productos Retirados:</p>
      <table>
        <thead><tr><th>Producto</th><th>Cant.</th><th>Unidad</th></tr></thead>
        <tbody>
          ${c.retirados.map((p) => `<tr><td>${p.nombre}</td><td>${p.cantidad ?? 0}</td><td>${p.unidad ?? ""}</td></tr>`).join("")}
        </tbody>
      </table>
      ${c.agregado1.length > 0 ? `
        <p style="font-weight:600;margin:8px 0 4px">Agregado 1 (con puntos):</p>
        <table>
          <thead><tr><th>Producto</th><th>Cant.</th></tr></thead>
          <tbody>${c.agregado1.map((p) => `<tr><td>${p.nombre}</td><td>${p.cantidad}</td></tr>`).join("")}</tbody>
        </table>` : ""}
      ${c.agregado0.length > 0 ? `
        <p style="font-weight:600;margin:8px 0 4px">Agregado 0 (informativo):</p>
        <table>
          <thead><tr><th>Producto</th><th>Cant.</th></tr></thead>
          <tbody>${c.agregado0.map((p) => `<tr><td>${p.nombre}</td><td>${p.cantidad}</td></tr>`).join("")}</tbody>
        </table>` : ""}
      ${c.faltantes.length > 0 ? `
        <p style="font-weight:600;margin:8px 0 4px;color:#c0392b">Faltantes del chofer (Agr. 1):</p>
        <table>
          <thead><tr><th>Producto</th><th>Cant.</th></tr></thead>
          <tbody>${c.faltantes.map((p) => `<tr><td>${p.nombre}</td><td>${p.cantidad}</td></tr>`).join("")}</tbody>
        </table>` : ""}
    `).join("");

    const emp = empresa;
    const html = `<!DOCTYPE html>
    <html><head><title>Informe de Cierre — ${emp?.nombre ?? "Polar Breeze"}</title>
    <style>
      body  { font-family: Arial, sans-serif; font-size: 11px; margin: 20px; color: #222; }
      .co   { border-bottom: 2px solid #374151; padding-bottom: 10px; margin-bottom: 14px; }
      .co-n { font-size: 17px; font-weight: bold; margin: 0 0 3px; }
      .co-i { font-size: 9.5px; color: #6b7280; margin: 0; }
      h1    { font-size: 14px; margin: 0 0 4px; }
      h2    { font-size: 13px; background: #374151; color: white; padding: 5px 8px;
              margin: 16px 0 8px; border-radius: 3px; }
      h3    { font-size: 12px; margin: 10px 0 4px; }
      table { width: 100%; border-collapse: collapse; margin-bottom: 8px; }
      th, td { border: 1px solid #d1d5db; padding: 5px 7px; text-align: left; }
      th    { background: #f3f4f6; font-weight: 600; }
      tr:nth-child(even) { background: #f9fafb; }
      .meta { color: #6b7280; font-size: 10px; margin-bottom: 16px; }
      .obs  { border: 1px solid #d1d5db; border-radius: 4px; padding: 8px;
              background: #f9fafb; font-style: italic; margin-top: 12px; }
    </style></head><body>
      <div class="co">
        <p class="co-n">${emp?.nombre ?? "Polar Breeze E.I.R.L."}</p>
        <p class="co-i">RNC: ${emp?.rnc ?? ""} &nbsp;·&nbsp; ${emp?.direccion ?? ""} &nbsp;·&nbsp; Tel: ${emp?.telefono ?? ""}</p>
      </div>
      <h1>📋 INFORME DE CIERRE DEL DÍA</h1>
      <p class="meta">${fecha} — Despachador: ${profile?.nombre ?? "—"}</p>

      <h2>1. Productos Faltantes del Despacho</h2>
      ${faltantesRows.length === 0
        ? "<p>Sin faltantes registrados.</p>"
        : `<table><thead><tr><th>Producto</th><th>Cant. Faltante</th><th>Chofer Afectado</th></tr></thead>
           <tbody>${faltantesRows.map((r) => `<tr><td>${r.producto}</td><td>${r.cantFaltante}</td><td>${r.choferAfectado}</td></tr>`).join("")}</tbody></table>`}

      <h2>2. Productos Dañados No Recibidos por Heladeros</h2>
      ${danadosRows.length === 0
        ? "<p>Sin dañados registrados.</p>"
        : `<table><thead><tr><th>Producto</th><th>Cant.</th><th>Chofer que rechazó</th><th>Motivo</th></tr></thead>
           <tbody>${danadosRows.map((r) => `<tr><td>${r.producto}</td><td>${r.cantidad}</td><td>${r.choferRechazo}</td><td>${r.motivo || "—"}</td></tr>`).join("")}</tbody></table>`}

      <h2>3. Productos Sobrantes del Despacho</h2>
      ${sobrantesTotal.length === 0
        ? "<p>Sin sobrantes.</p>"
        : `<table><thead><tr><th>Producto</th><th>Cant. Sobrante</th><th>Fuente</th></tr></thead>
           <tbody>${sobrantesTotal.map((r) => `<tr><td>${r.producto}</td><td>+${r.cantidad}</td><td>${r.fuente}</td></tr>`).join("")}</tbody></table>`}

      <h2>4. Productos Cuarto Frío No Entregados a Despacho</h2>
      ${cfNoEntrRows.length === 0
        ? "<p>Sin registros.</p>"
        : `<table><thead><tr><th>Producto</th><th>Cant.</th><th>Persona</th><th>Motivo</th></tr></thead>
           <tbody>${cfNoEntrRows.map((r) => `<tr><td>${r.producto}</td><td>${r.cantidad}</td><td>${r.persona || "—"}</td><td>${r.motivo || "—"}</td></tr>`).join("")}</tbody></table>`}

      <h2>5. Facturas por Chofer</h2>
      ${choferRows || "<p>Sin choferes con entregas.</p>"}

      ${obsGenerales ? `<div class="obs">📝 Observaciones: ${obsGenerales}</div>` : ""}
    </body></html>`;

    const win = window.open("", "_blank");
    if (!win) return;
    win.document.write(html);
    win.document.close();
    win.onload = () => win.print();
  };

  // ── WhatsApp text ─────────────────────────────────────────────────────────
  const getWhatsAppMsg = () => {
    const fecha = new Date().toLocaleDateString("es-MX", { day: "2-digit", month: "short" });
    const lines = [
      `🧊 *${empresa?.nombre ?? "Polar Breeze E.I.R.L."}*`,
      `📋 *INFORME DE CIERRE — ${fecha}*`,
      `👤 Despachador: ${profile?.nombre}`, "",
    ];
    lines.push("🔴 *1. Faltantes del Despacho*");
    if (faltantesRows.length === 0) lines.push("  Sin faltantes");
    else faltantesRows.forEach((r) => lines.push(`  • ${r.producto}: ${r.cantFaltante} u — ${r.choferAfectado}`));
    lines.push("");

    lines.push("💥 *2. Dañados No Recibidos*");
    if (danadosRows.length === 0) lines.push("  Sin dañados");
    else danadosRows.forEach((r) => lines.push(`  • ${r.producto}: ${r.cantidad} u — ${r.choferRechazo} — ${r.motivo || "s/m"}`));
    lines.push("");

    lines.push("📦 *3. Sobrantes del Despacho*");
    if (sobrantesTotal.length === 0) lines.push("  Sin sobrantes");
    else sobrantesTotal.forEach((r) => lines.push(`  • ${r.producto}: +${r.cantidad} (${r.fuente})`));
    lines.push("");

    lines.push("🥶 *4. Cuarto Frío No Entregado*");
    if (cfNoEntrRows.length === 0) lines.push("  Sin registros");
    else cfNoEntrRows.forEach((r) => lines.push(`  • ${r.producto}: ${r.cantidad} u${r.persona ? ` — ${r.persona}` : ""}${r.motivo ? ` — ${r.motivo}` : ""}`));
    lines.push("");

    if (obsGenerales) lines.push(`📝 ${obsGenerales}`);
    return lines.join("\n");
  };

  const sendWhatsApp = () => {
    const text = encodeURIComponent(getWhatsAppMsg());
    window.open(`https://wa.me/?text=${text}`, "_blank");
  };

  // ── Render ────────────────────────────────────────────────────────────────

  const fecha = new Date().toLocaleDateString("es-MX", {
    weekday: "long", day: "numeric", month: "long",
  });

  if (cargando) {
    return (
      <div className="flex items-center justify-center py-20">
        <p className="text-gray-400 animate-pulse text-sm">Cargando datos del día…</p>
      </div>
    );
  }

  return (
    <div className="space-y-4 pb-10" ref={printRef}>

      {/* ── Cabecera ── */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
        <div className="px-4 py-3 bg-gradient-to-r from-gray-800 to-gray-900">
          <div className="flex items-start justify-between gap-3 flex-wrap">
            <div>
              {empresa && (
                <p className="text-emerald-300 text-xs font-semibold mb-0.5 tracking-wide">
                  {empresa.nombre}
                </p>
              )}
              <h2 className="text-white font-bold">📋 Informe de Cierre</h2>
              <p className="text-gray-300 text-xs capitalize mt-0.5">{fecha}</p>
              <p className="text-gray-400 text-xs">Despachador: {profile?.nombre}</p>
            </div>
            <div className="flex gap-2 flex-wrap">
              <button
                onClick={handlePrint}
                className="flex items-center gap-1.5 bg-white/10 hover:bg-white/20 active:scale-95
                  text-white text-xs px-3 py-1.5 rounded-lg transition-all duration-100 font-medium"
              >
                🖨️ Imprimir
              </button>
              <button
                onClick={sendWhatsApp}
                className="flex items-center gap-1.5 bg-green-600 hover:bg-green-700 active:scale-95
                  text-white text-xs px-3 py-1.5 rounded-lg transition-all duration-100 font-medium"
              >
                📱 WhatsApp
              </button>
            </div>
          </div>
        </div>

        {/* Estado + cerrar */}
        <div className="px-4 py-3 flex items-center justify-between gap-3 flex-wrap">
          {cerrado ? (
            <span className="text-xs bg-green-100 text-green-700 border border-green-200
              px-3 py-1.5 rounded-full font-semibold">
              ✅ Informe guardado en Firebase
            </span>
          ) : (
            <span className="text-xs text-gray-400">
              Completa los datos y cierra el día
            </span>
          )}

          {!cerrado && (
            <button
              onClick={guardar}
              disabled={guardando}
              className="flex items-center gap-2 bg-gradient-to-r from-gray-800 to-gray-900
                hover:from-gray-700 hover:to-gray-800 active:scale-95 text-white font-semibold
                text-sm px-4 py-2 rounded-lg transition-all duration-100 disabled:opacity-60"
            >
              {guardando ? "Guardando…" : "🔒 Cerrar informe del día"}
            </button>
          )}
        </div>

        {msg && (
          <div className={`mx-4 mb-3 px-3 py-2 rounded-lg text-xs border ${
            msg.type === "ok"
              ? "bg-green-50 text-green-700 border-green-200"
              : "bg-red-50 text-red-700 border-red-200"
          }`}>
            {msg.text}
          </div>
        )}
      </div>

      {/* ── TABLA 1: Faltantes del despacho ───────────────────────────────────── */}
      <SeccionTabla
        titulo="1. Productos Faltantes del Despacho"
        icon="🔴"
        abierta={abiertos.t1}
        onToggle={() => setAbiertos((p) => ({ ...p, t1: !p.t1 }))}
        badge={faltantesRows.length}
        badgeColor="red"
      >
        <div className="p-3 space-y-2">
          {faltantesRows.map((r) => (
            <div key={r._id} className="grid grid-cols-[1fr_80px_1fr_28px] gap-1.5 items-center">
              <input
                className={inputCls} placeholder="Producto" value={r.producto}
                onChange={(e) => setFaltante(r._id, "producto", e.target.value)}
                disabled={cerrado}
              />
              <input
                type="number" className={inputCls} placeholder="0" min={0} value={r.cantFaltante || ""}
                onChange={(e) => setFaltante(r._id, "cantFaltante", parseFloat(e.target.value) || 0)}
                disabled={cerrado}
              />
              <input
                className={inputCls} placeholder="Chofer afectado" value={r.choferAfectado}
                onChange={(e) => setFaltante(r._id, "choferAfectado", e.target.value)}
                disabled={cerrado}
              />
              {!cerrado && (
                <button onClick={() => remFaltante(r._id)} className={btnRemCls}>×</button>
              )}
            </div>
          ))}

          {faltantesRows.length === 0 && (
            <p className="text-xs text-gray-400 text-center py-2">Sin faltantes registrados</p>
          )}

          {!cerrado && (
            <button onClick={addFaltante} className={btnAddCls}>+ Agregar fila</button>
          )}
        </div>
        <div className="px-3 pb-2">
          <p className="text-xs text-gray-400">
            Columnas: <span className="font-medium">Producto</span> ·{" "}
            <span className="font-medium">Cant. faltante</span> ·{" "}
            <span className="font-medium">Chofer afectado</span>
          </p>
        </div>
      </SeccionTabla>

      {/* ── TABLA 2: Dañados no recibidos ─────────────────────────────────────── */}
      <SeccionTabla
        titulo="2. Productos Dañados No Recibidos por Heladeros"
        icon="💥"
        abierta={abiertos.t2}
        onToggle={() => setAbiertos((p) => ({ ...p, t2: !p.t2 }))}
        badge={danadosRows.length}
        badgeColor="orange"
      >
        <div className="p-3 space-y-2">
          {danadosRows.map((r) => (
            <div key={r._id} className="space-y-1.5">
              <div className="grid grid-cols-[1fr_60px_1fr_28px] gap-1.5 items-center">
                <input
                  className={inputCls} placeholder="Producto" value={r.producto}
                  onChange={(e) => setDanado(r._id, "producto", e.target.value)}
                  disabled={cerrado}
                />
                <input
                  type="number" className={inputCls} placeholder="0" min={0} value={r.cantidad || ""}
                  onChange={(e) => setDanado(r._id, "cantidad", parseFloat(e.target.value) || 0)}
                  disabled={cerrado}
                />
                <input
                  className={inputCls} placeholder="Chofer que rechazó" value={r.choferRechazo}
                  onChange={(e) => setDanado(r._id, "choferRechazo", e.target.value)}
                  disabled={cerrado}
                />
                {!cerrado && (
                  <button onClick={() => remDanado(r._id)} className={btnRemCls}>×</button>
                )}
              </div>
              <input
                className={inputCls} placeholder="Motivo del rechazo" value={r.motivo}
                onChange={(e) => setDanado(r._id, "motivo", e.target.value)}
                disabled={cerrado}
              />
            </div>
          ))}

          {danadosRows.length === 0 && (
            <p className="text-xs text-gray-400 text-center py-2">Sin dañados registrados</p>
          )}

          {!cerrado && (
            <button onClick={addDanado} className={btnAddCls}>+ Agregar fila</button>
          )}
        </div>
        <div className="px-3 pb-2">
          <p className="text-xs text-gray-400">
            Columnas: <span className="font-medium">Producto · Cant. · Chofer · Motivo</span>
          </p>
        </div>
      </SeccionTabla>

      {/* ── TABLA 3: Sobrantes (auto-calculado) ──────────────────────────────── */}
      <SeccionTabla
        titulo="3. Productos Sobrantes del Despacho"
        icon="📦"
        abierta={abiertos.t3}
        onToggle={() => setAbiertos((p) => ({ ...p, t3: !p.t3 }))}
        badge={sobrantesTotal.length}
        badgeColor="blue"
      >
        <div className="p-3">
          {sobrantesTotal.length === 0 ? (
            <p className="text-xs text-gray-400 text-center py-2">Sin sobrantes</p>
          ) : (
            <div className="overflow-x-auto rounded-lg border border-gray-100">
              <table className="w-full text-xs">
                <thead>
                  <tr className="bg-gray-50 text-gray-500">
                    <th className="text-left px-3 py-2 font-medium">Producto</th>
                    <th className="text-right px-3 py-2 font-medium">Sobrante</th>
                    <th className="text-left px-3 py-2 font-medium">Fuente</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {sobrantesTotal.map((r) => (
                    <tr key={r.producto} className="hover:bg-gray-50/50">
                      <td className="px-3 py-2 font-medium text-gray-700">{r.producto}</td>
                      <td className="px-3 py-2 text-right text-blue-700 font-semibold">+{r.cantidad}</td>
                      <td className="px-3 py-2 text-gray-400">{r.fuente}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className="text-xs text-gray-400 mt-2">
            ✨ Calculado automáticamente desde Cuarto Frío y devoluciones de choferes.
          </p>
        </div>
      </SeccionTabla>

      {/* ── TABLA 4: CF no entregados ──────────────────────────────────────────── */}
      <SeccionTabla
        titulo="4. Productos Cuarto Frío No Entregados a Despacho"
        icon="🥶"
        abierta={abiertos.t4}
        onToggle={() => setAbiertos((p) => ({ ...p, t4: !p.t4 }))}
        badge={cfNoEntrRows.length}
        badgeColor="cyan"
      >
        <div className="p-3 space-y-2">
          <p className="text-xs text-blue-600 bg-blue-50 border border-blue-100 rounded-lg px-3 py-2">
            📌 Estos productos suman al reporte de despacho del siguiente día.
          </p>

          {cfNoEntrRows.map((r) => (
            <div key={r._id} className="space-y-1.5">
              <div className="grid grid-cols-[1fr_60px_28px] gap-1.5 items-center">
                <input
                  className={inputCls} placeholder="Producto" value={r.producto}
                  onChange={(e) => setCfNoEntr(r._id, "producto", e.target.value)}
                  disabled={cerrado}
                />
                <input
                  type="number" className={inputCls} placeholder="0" min={0} value={r.cantidad || ""}
                  onChange={(e) => setCfNoEntr(r._id, "cantidad", parseFloat(e.target.value) || 0)}
                  disabled={cerrado}
                />
                {!cerrado && (
                  <button onClick={() => remCfNoEntr(r._id)} className={btnRemCls}>×</button>
                )}
              </div>
              <div className="grid grid-cols-2 gap-1.5">
                <input
                  className={inputCls} placeholder="Persona responsable" value={r.persona}
                  onChange={(e) => setCfNoEntr(r._id, "persona", e.target.value)}
                  disabled={cerrado}
                />
                <input
                  className={inputCls} placeholder="Motivo" value={r.motivo}
                  onChange={(e) => setCfNoEntr(r._id, "motivo", e.target.value)}
                  disabled={cerrado}
                />
              </div>
            </div>
          ))}

          {cfNoEntrRows.length === 0 && (
            <p className="text-xs text-gray-400 text-center py-2">Sin registros</p>
          )}

          {!cerrado && (
            <button onClick={addCfNoEntr} className={btnAddCls}>+ Agregar fila</button>
          )}
        </div>
      </SeccionTabla>

      {/* ── CHOFERES: factura individual ──────────────────────────────────────── */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
        <div className="px-4 py-3 bg-gradient-to-r from-cyan-700 to-cyan-900 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-lg">🚛</span>
            <span className="text-white font-semibold text-sm">Facturas por Chofer</span>
            {choferData.length > 0 && (
              <span className="text-xs bg-cyan-600 text-white px-2 py-0.5 rounded-full">
                {choferData.length}
              </span>
            )}
          </div>
        </div>

        {choferData.length === 0 ? (
          <div className="px-4 py-6 text-center">
            <p className="text-sm text-gray-400">Sin choferes con entregas registradas hoy.</p>
          </div>
        ) : (
          <div className="divide-y divide-gray-100">
            {choferData.map((ch) => (
              <div key={ch.choferId}>
                {/* Cabecera del chofer */}
                <button
                  onClick={() => setChoferAbierto(choferAbierto === ch.choferId ? null : ch.choferId)}
                  className="w-full px-4 py-3 flex items-center justify-between hover:bg-gray-50
                    transition-colors text-left"
                >
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 bg-cyan-500 rounded-full flex items-center justify-center
                      text-white font-bold text-sm flex-shrink-0">
                      {ch.nombre.charAt(0).toUpperCase()}
                    </div>
                    <div>
                      <p className="font-semibold text-sm text-gray-800">{ch.nombre}</p>
                      <p className="text-xs text-gray-400">
                        Ficha {ch.ficha || "—"} · {ch.retirados.length} productos retirados
                        {ch.agregado1.length > 0 && ` · ${ch.agregado1.length} Agr. 1`}
                        {ch.agregado0.length > 0 && ` · ${ch.agregado0.length} Agr. 0`}
                        {ch.faltantes.length > 0 && ` · ${ch.faltantes.length} faltantes`}
                      </p>
                    </div>
                  </div>
                  <span className="text-gray-400 text-sm flex-shrink-0">
                    {choferAbierto === ch.choferId ? "▲" : "▼"}
                  </span>
                </button>

                {choferAbierto === ch.choferId && (
                  <div className="px-4 pb-4 space-y-4">

                    {/* Productos retirados (auto) */}
                    <SubSeccion titulo="Productos Retirados" color="blue">
                      {ch.retirados.length === 0 ? (
                        <p className="text-xs text-gray-400 px-3 py-2">Sin productos</p>
                      ) : (
                        <div className="overflow-x-auto">
                          <table className="w-full text-xs">
                            <thead>
                              <tr className="bg-blue-50 text-blue-700">
                                <th className="text-left px-3 py-1.5 font-medium">Producto</th>
                                <th className="text-right px-3 py-1.5 font-medium">Cant.</th>
                                <th className="text-left px-3 py-1.5 font-medium">Unidad</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-50">
                              {ch.retirados.map((p, i) => (
                                <tr key={i} className="hover:bg-blue-50/30">
                                  <td className="px-3 py-1.5 text-gray-700">{p.nombre}</td>
                                  <td className="px-3 py-1.5 text-right font-semibold text-blue-700">{p.cantidad ?? 0}</td>
                                  <td className="px-3 py-1.5 text-gray-400">{p.unidad ?? ""}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </SubSeccion>

                    {/* Agregado 1 */}
                    <SubSeccion titulo="Agregado 1 — Cuenta en puntos y beneficios" color="green">
                      <div className="px-3 pb-2 space-y-1.5">
                        {ch.agregado1.map((p) => (
                          <div key={p._id} className="grid grid-cols-[1fr_70px_28px] gap-1.5 items-center">
                            <input
                              className={inputCls} placeholder="Producto" value={p.nombre}
                              onChange={(e) => setSubProd(ch.choferId, "agregado1", p._id, "nombre", e.target.value)}
                              disabled={cerrado}
                            />
                            <input
                              type="number" className={inputCls} placeholder="0" min={0} value={p.cantidad || ""}
                              onChange={(e) => setSubProd(ch.choferId, "agregado1", p._id, "cantidad", parseFloat(e.target.value) || 0)}
                              disabled={cerrado}
                            />
                            {!cerrado && (
                              <button onClick={() => remSubProd(ch.choferId, "agregado1", p._id)} className={btnRemCls}>×</button>
                            )}
                          </div>
                        ))}
                        {ch.agregado1.length === 0 && (
                          <p className="text-xs text-gray-400">Sin Agregado 1</p>
                        )}
                        {!cerrado && (
                          <button onClick={() => addSubProd(ch.choferId, "agregado1")} className={btnAddCls}>
                            + Agregar 1
                          </button>
                        )}
                      </div>
                    </SubSeccion>

                    {/* Agregado 0 */}
                    <SubSeccion titulo="Agregado 0 — Solo informativo, no genera puntos" color="gray">
                      <div className="px-3 pb-2 space-y-1.5">
                        {ch.agregado0.map((p) => (
                          <div key={p._id} className="grid grid-cols-[1fr_70px_28px] gap-1.5 items-center">
                            <input
                              className={inputCls} placeholder="Producto" value={p.nombre}
                              onChange={(e) => setSubProd(ch.choferId, "agregado0", p._id, "nombre", e.target.value)}
                              disabled={cerrado}
                            />
                            <input
                              type="number" className={inputCls} placeholder="0" min={0} value={p.cantidad || ""}
                              onChange={(e) => setSubProd(ch.choferId, "agregado0", p._id, "cantidad", parseFloat(e.target.value) || 0)}
                              disabled={cerrado}
                            />
                            {!cerrado && (
                              <button onClick={() => remSubProd(ch.choferId, "agregado0", p._id)} className={btnRemCls}>×</button>
                            )}
                          </div>
                        ))}
                        {ch.agregado0.length === 0 && (
                          <p className="text-xs text-gray-400">Sin Agregado 0</p>
                        )}
                        {!cerrado && (
                          <button onClick={() => addSubProd(ch.choferId, "agregado0")} className={btnAddCls}>
                            + Agregar 0
                          </button>
                        )}
                      </div>
                    </SubSeccion>

                    {/* Faltantes del chofer */}
                    <SubSeccion titulo="Faltantes del Chofer — Cuenta como Agregado 1" color="red">
                      <div className="px-3 pb-2 space-y-1.5">
                        {ch.faltantes.map((p) => (
                          <div key={p._id} className="grid grid-cols-[1fr_70px_28px] gap-1.5 items-center">
                            <input
                              className={inputCls} placeholder="Producto" value={p.nombre}
                              onChange={(e) => setSubProd(ch.choferId, "faltantes", p._id, "nombre", e.target.value)}
                              disabled={cerrado}
                            />
                            <input
                              type="number" className={inputCls} placeholder="0" min={0} value={p.cantidad || ""}
                              onChange={(e) => setSubProd(ch.choferId, "faltantes", p._id, "cantidad", parseFloat(e.target.value) || 0)}
                              disabled={cerrado}
                            />
                            {!cerrado && (
                              <button onClick={() => remSubProd(ch.choferId, "faltantes", p._id)} className={btnRemCls}>×</button>
                            )}
                          </div>
                        ))}
                        {ch.faltantes.length === 0 && (
                          <p className="text-xs text-gray-400">Sin faltantes del chofer</p>
                        )}
                        {!cerrado && (
                          <button onClick={() => addSubProd(ch.choferId, "faltantes")} className={btnAddCls}>
                            + Agregar faltante
                          </button>
                        )}
                      </div>
                    </SubSeccion>

                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── Observaciones generales ───────────────────────────────────────────── */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-4">
        <label className="block text-xs font-semibold text-gray-600 mb-2">
          📝 Observaciones generales del día
        </label>
        <textarea
          value={obsGenerales}
          onChange={(e) => setObsGenerales(e.target.value)}
          disabled={cerrado}
          rows={3}
          placeholder="Cualquier observación relevante del día de despacho…"
          className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm
            text-gray-800 focus:ring-2 focus:ring-gray-400 outline-none resize-none
            disabled:bg-gray-50 disabled:text-gray-500"
        />
      </div>

      {/* ── Botón final ───────────────────────────────────────────────────────── */}
      {!cerrado && (
        <button
          onClick={guardar}
          disabled={guardando}
          className="w-full py-3 bg-gradient-to-r from-gray-800 to-gray-900 hover:from-gray-700
            hover:to-gray-800 active:scale-95 text-white font-bold rounded-xl text-sm
            transition-all duration-100 disabled:opacity-60 shadow-sm"
        >
          {guardando ? "Guardando informe…" : "🔒 Cerrar informe del día y guardar en Firebase"}
        </button>
      )}

    </div>
  );
}

// ─── Componentes auxiliares ───────────────────────────────────────────────────

function SeccionTabla({
  titulo, icon, abierta, onToggle, badge, badgeColor, children,
}: {
  titulo:     string;
  icon:       string;
  abierta:    boolean;
  onToggle:   () => void;
  badge:      number;
  badgeColor: "red" | "orange" | "blue" | "cyan";
  children:   React.ReactNode;
}) {
  const badgeBg = {
    red:    "bg-red-100 text-red-700 border-red-200",
    orange: "bg-orange-100 text-orange-700 border-orange-200",
    blue:   "bg-blue-100 text-blue-700 border-blue-200",
    cyan:   "bg-cyan-100 text-cyan-700 border-cyan-200",
  }[badgeColor];

  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
      <button
        onClick={onToggle}
        className="w-full flex items-center justify-between px-4 py-3
          bg-gray-50 hover:bg-gray-100 transition-colors duration-100"
      >
        <div className="flex items-center gap-2">
          <span>{icon}</span>
          <span className="font-semibold text-gray-800 text-sm text-left">{titulo}</span>
          <span className={`text-xs px-2 py-0.5 rounded-full border font-medium ${badgeBg}`}>
            {badge}
          </span>
        </div>
        <span className="text-gray-400 text-sm flex-shrink-0">{abierta ? "▲" : "▼"}</span>
      </button>
      {abierta && children}
    </div>
  );
}

function SubSeccion({
  titulo, color, children,
}: {
  titulo:   string;
  color:    "blue" | "green" | "gray" | "red";
  children: React.ReactNode;
}) {
  const hdr = {
    blue:  "bg-blue-50 text-blue-700 border-blue-100",
    green: "bg-green-50 text-green-700 border-green-100",
    gray:  "bg-gray-50 text-gray-600 border-gray-200",
    red:   "bg-red-50 text-red-700 border-red-100",
  }[color];

  return (
    <div className="rounded-lg border border-gray-100 overflow-hidden">
      <div className={`px-3 py-1.5 border-b text-xs font-semibold ${hdr}`}>{titulo}</div>
      {children}
    </div>
  );
}

// Estilos comunes reutilizables
const inputCls = `w-full border border-gray-200 rounded-lg px-2 py-1.5 text-xs
  focus:outline-none focus:ring-1 focus:ring-blue-400 text-gray-800
  disabled:bg-gray-50 disabled:text-gray-400 placeholder:text-gray-300`;

const btnRemCls = `w-7 h-7 flex items-center justify-center text-gray-300 hover:text-red-500
  hover:bg-red-50 rounded-lg text-base transition-colors active:scale-95 flex-shrink-0`;

const btnAddCls = `w-full text-xs text-blue-600 hover:text-blue-700 hover:bg-blue-50
  border border-dashed border-blue-200 rounded-lg py-1.5 transition-colors active:scale-95 font-medium`;
