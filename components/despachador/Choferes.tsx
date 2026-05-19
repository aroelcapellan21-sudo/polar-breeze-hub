"use client";

import { useState, useEffect } from "react";
import {
  collection, query, where, onSnapshot,
  doc, setDoc, addDoc, updateDoc, increment, Timestamp, getDoc, getDocs,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useAuth } from "@/lib/auth-context";
import { ProductoItem, UserProfile, FsDriver, FsSession, MovimientoLoker, PrecioProducto, toProductoId } from "@/lib/types";
import { pbHeader, pbFooter } from "@/lib/wa-format";
import { pbPrintDoc, pbTable } from "@/lib/print-template";
import { ShareBar } from "@/components/shared/ShareButtons";
import {
  ImageUploader, ProductTable, ModeToggle, AiButton,
  WhatsAppPrint, ProgressSteps,
} from "./shared";

const STEPS = [
  { label: "Seleccionar" },
  { label: "Factura" },
  { label: "Analizar IA" },
  { label: "Revisar" },
  { label: "Guardar" },
];

const norm = (s: string) => s.toLowerCase().trim().replace(/\s+/g, " ");

interface ExtraLoker {
  id: string;
  nombre: string;
  cantidad: number;
  motivo?: string;
  categoria: "retiro_despacho" | "agregado_1" | "agregado_0";
  timestamp: Date | { seconds: number };
}

interface Props {
  onChoferSelect?: (c: UserProfile | null) => void;
  despachadorActivo?: string;
}

export default function Choferes({ onChoferSelect, despachadorActivo }: Props) {
  const { profile } = useAuth();
  const [choferes,      setChoferes]      = useState<UserProfile[]>([]);
  const [drivers,       setDrivers]       = useState<FsDriver[]>([]);
  const [session,       setSession]       = useState<FsSession | null>(null);
  const [sel,           setSel]           = useState<UserProfile | null>(null);
  const [mode,          setMode]          = useState<"foto" | "manual">("foto");
  const [preview,       setPreview]       = useState<string | null>(null);
  const [imgData,       setImgData]       = useState<{ base64: string; mimeType: string } | null>(null);
  const [texto,         setTexto]         = useState("");
  const [productos,     setProductos]     = useState<ProductoItem[]>([]);
  const [observaciones, setObservaciones] = useState("");
  const [analizando,    setAnalizando]    = useState(false);
  const [guardando,     setGuardando]     = useState(false);
  const [msg,           setMsg]           = useState<{ type: "ok" | "err"; text: string } | null>(null);
  const [stockAlerta,   setStockAlerta]   = useState<{ nombre: string; necesita: number; disponible: number }[] | null>(null);
  const [precios,       setPrecios]       = useState<PrecioProducto[]>([]);

  // ─── Extras por factura ──────────────────────────────────────────────────────
  const [extrasHoy,    setExtrasHoy]    = useState<ExtraLoker[]>([]);
  const [retiroForm,   setRetiroForm]   = useState({ nombre: "", cantidad: 1, nota: "" });
  const [agr1Form,     setAgr1Form]     = useState({ nombre: "", cantidad: 1, nota: "" });
  const [agr0Form,     setAgr0Form]     = useState({ nombre: "", cantidad: 1, nota: "" });
  const [savingRetiro, setSavingRetiro] = useState(false);
  const [savingAgr1,   setSavingAgr1]   = useState(false);
  const [savingAgr0,   setSavingAgr0]   = useState(false);

  // Consignación acumulada del chofer seleccionado
  const [consigChofer, setConsigChofer] = useState<{ nombre: string; cantidad: number }[]>([]);
  const [consigAbierto, setConsigAbierto] = useState(true);

  // Confrontar modal
  const [showConfronta,  setShowConfronta]  = useState(false);

  type ChofModal =
    | { type: "entrega"; item: ProductoItem }
    | { type: "extra"; item: ExtraLoker }
    | null;
  const [chofModal, setChofModal] = useState<ChofModal>(null);

  useEffect(() => {
    const uChof = onSnapshot(
      query(collection(db, "usuarios"), where("role", "==", "chofer"), where("activo", "!=", false)),
      (s) => setChoferes(s.docs.map((d) => d.data() as UserProfile))
    );
    const uDrv = onSnapshot(
      collection(db, "drivers"),
      (s) => setDrivers(s.docs.map((d) => ({ id: d.id, ...d.data() } as FsDriver)))
    );
    const uSess = onSnapshot(doc(db, "session", "despacho"), (snap) => {
      setSession(snap.exists() ? (snap.data() as FsSession) : null);
    });
    // Cargar precios de venta desde config/precios
    getDoc(doc(db, "config", "precios")).then((snap) => {
      if (snap.exists()) {
        setPrecios((snap.data().productos as PrecioProducto[]) ?? []);
      }
    });
    return () => { uChof(); uDrv(); uSess(); };
  }, []);

  // Cargar movimientos del chofer seleccionado (extras hoy + consignación total)
  useEffect(() => {
    if (!sel) { setExtrasHoy([]); setConsigChofer([]); return; }
    const q = query(collection(db, "movimientos_loker"), where("choferId", "==", sel.uid));
    const unsub = onSnapshot(q, (snap) => {
      const hoy = new Date(); hoy.setHours(0, 0, 0, 0);
      const docs: ExtraLoker[] = [];
      const consigMap = new Map<string, { nombre: string; cantidad: number }>();

      snap.docs.forEach((d) => {
        const data = d.data();
        const ts = data.timestamp?.seconds
          ? new Date(data.timestamp.seconds * 1000)
          : data.timestamp instanceof Date ? data.timestamp : new Date(0);

        // Extras de hoy (con categoría)
        if (data.categoria && ts >= hoy) {
          docs.push({ id: d.id, nombre: data.nombre, cantidad: data.cantidad,
            motivo: data.motivo, categoria: data.categoria, timestamp: data.timestamp });
        }

        // Consignación acumulada (salida_despacho y devolucion_chofer)
        if (data.tipo === "salida_despacho" || data.tipo === "devolucion_chofer") {
          const delta = -(data.cantidad as number); // salida negativa → delta positivo
          const prev  = consigMap.get(data.producto_id) ?? { nombre: data.nombre, cantidad: 0 };
          consigMap.set(data.producto_id, { nombre: data.nombre, cantidad: prev.cantidad + delta });
        }
      });

      setExtrasHoy(docs);
      setConsigChofer(
        Array.from(consigMap.values())
          .filter((p) => p.cantidad > 0)
          .sort((a, b) => b.cantidad - a.cantidad)
      );
    });
    return () => unsub();
  }, [sel?.uid]);

  const flash = (type: "ok" | "err", text: string) => {
    setMsg({ type, text });
    setTimeout(() => setMsg(null), 4000);
  };

  // Busca el precio de un producto en el catálogo (por producto_id normalizado o parcial)
  const buscarPrecio = (nombre: string): number | null => {
    if (precios.length === 0) return null;
    const pid = toProductoId(nombre);
    // Búsqueda exacta
    const exacto = precios.find((p) => p.producto_id === pid);
    if (exacto) return exacto.precio;
    // Búsqueda parcial: el pid del catálogo contiene el pid del nombre buscado
    const parcial = precios.find(
      (p) => p.producto_id.includes(pid) || pid.includes(p.producto_id)
    );
    return parcial?.precio ?? null;
  };

  const resetEntrada = () => {
    setPreview(null); setImgData(null); setTexto(""); setProductos([]); setObservaciones("");
    setStockAlerta(null);
    setRetiroForm({ nombre: "", cantidad: 1, nota: "" });
    setAgr1Form({ nombre: "", cantidad: 1, nota: "" });
    setAgr0Form({ nombre: "", cantidad: 1, nota: "" });
  };

  const selectChofer = (c: UserProfile) => {
    setSel(c); resetEntrada(); setMode("foto");
    onChoferSelect?.(c);
  };

  const analizar = async () => {
    setAnalizando(true);
    try {
      const body = imgData
        ? { tipo: "factura", imageBase64: imgData.base64, mimeType: imgData.mimeType }
        : { tipo: "factura", texto };
      const res  = await fetch("/api/analyze", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      if (Array.isArray(data.productos) && data.productos.length > 0) {
        // Aplicar precios del catálogo si la IA no los detectó
        const conPrecios = (data.productos as ProductoItem[]).map((p) => ({
          ...p,
          precio: p.precio ?? buscarPrecio(p.nombre),
        }));
        setProductos(conPrecios);
        flash("ok", `IA detectó ${conPrecios.length} productos`);
      } else {
        flash("err", "Sin productos detectados. Edita manualmente.");
      }
    } catch (e) {
      flash("err", e instanceof Error ? e.message : "Error");
    } finally {
      setAnalizando(false);
    }
  };

  const guardar = async () => {
    if (!profile || !sel || productos.length === 0) return;
    setGuardando(true);
    setStockAlerta(null);
    try {
      // ── Verificar stock en loker ────────────────────────────────────────────
      const lokerSnap = await getDocs(collection(db, "movimientos_loker"));
      const saldoMap  = new Map<string, number>();
      lokerSnap.docs.forEach((d) => {
        const m    = d.data() as MovimientoLoker;
        const prev = saldoMap.get(m.producto_id) ?? 0;
        saldoMap.set(m.producto_id, prev + m.cantidad);
      });

      const faltantes = productos
        .filter((p) => (p.cantidad ?? 0) > 0)
        .map((p) => ({
          nombre:     p.nombre,
          necesita:   p.cantidad ?? 0,
          disponible: saldoMap.get(toProductoId(p.nombre)) ?? 0,
        }))
        .filter((f) => f.disponible < f.necesita);

      if (faltantes.length > 0) {
        setStockAlerta(faltantes);
        setGuardando(false);
        return;
      }

      // ── Guardar despacho (flujo existente) ─────────────────────────────────
      const totalEntregado = productos.reduce((s, p) => s + (p.cantidad ?? 0), 0);
      const totalMonto     = productos.reduce((s, p) => s + ((p.precio ?? 0) * (p.cantidad ?? 0)), 0);

      await setDoc(doc(db, "drivers", sel.uid), {
        uid: sel.uid, nombre: sel.nombre, ficha: sel.ficha ?? "",
        entregas: productos, observaciones: observaciones || null,
        totalEntregado, totalMonto: totalMonto || null,
        updatedAt: Timestamp.now(), activo: true,
      });

      try {
        await updateDoc(doc(db, "session", "despacho"), {
          totalDespachos: increment(1),
          totalMonto:     increment(totalMonto),
          totalUnidades:  increment(totalEntregado),
        });
      } catch { /* sesión no existe aún */ }

      await addDoc(collection(db, "history"), {
        tipo:              "entrega_chofer",
        choferId:          sel.uid, choferNombre: sel.nombre,
        productos, observaciones: observaciones || null,
        totalEntregado, totalMonto: totalMonto || null,
        despachadorId:     profile.uid, despachadorNombre: despNombre,
        timestamp:         Timestamp.now(),
      });

      await addDoc(collection(db, "talonario"), {
        choferId:          sel.uid, choferNombre: sel.nombre, choferFicha: sel.ficha ?? "",
        productos, observaciones: observaciones || null,
        tipo: "retirada", fuente: "despacho",
        despachadorId: profile.uid, despachadorNombre: despNombre,
        timestamp: Timestamp.now(),
      });

      await addDoc(collection(db, "facturascan"), {
        despachadorId:     profile.uid, despachadorNombre: despNombre,
        facturaNumero:     `FS-${sel.ficha ?? sel.uid.slice(0, 4)}-${Date.now().toString().slice(-5)}`,
        cliente:           sel.nombre, monto: totalMonto,
        timestamp:         Timestamp.now(), estado: "procesada",
      });

      // ── Registrar salidas en loker (una entrada por producto) ───────────────
      const notaBase = `Despacho → ${sel.nombre}${sel.ficha ? ` · ficha ${sel.ficha}` : ""}`;
      for (const p of productos) {
        await addDoc(collection(db, "movimientos_loker"), {
          tipo:         "salida_despacho",
          producto_id:  toProductoId(p.nombre),
          nombre:       p.nombre,
          cantidad:     -(p.cantidad ?? 0),
          responsable:  despNombre,
          choferId:     sel.uid,
          choferNombre: sel.nombre,
          timestamp:    Timestamp.now(),
          notas:        notaBase,
        });
      }

      flash("ok", `Entrega de ${sel.nombre} guardada — ${totalEntregado} unidades`);
      resetEntrada();
    } catch (e) {
      flash("err", e instanceof Error ? e.message : "Error al guardar");
    } finally {
      setGuardando(false);
    }
  };

  const guardarExtra = async (
    categoria: "retiro_despacho" | "agregado_1" | "agregado_0",
    form: { nombre: string; cantidad: number; nota: string }
  ) => {
    if (!profile || !sel || !form.nombre.trim() || form.cantidad <= 0) return;
    const setSaving = categoria === "retiro_despacho" ? setSavingRetiro
                    : categoria === "agregado_1"       ? setSavingAgr1
                    :                                    setSavingAgr0;
    setSaving(true);
    const esRetiro = categoria === "retiro_despacho";
    const nota     = form.nota.trim();
    try {
      // Stock check para salidas
      if (!esRetiro) {
        const lokerSnap = await getDocs(collection(db, "movimientos_loker"));
        const pid    = toProductoId(form.nombre);
        const saldo  = lokerSnap.docs.reduce((s, d) => {
          const m = d.data() as MovimientoLoker;
          return m.producto_id === pid ? s + m.cantidad : s;
        }, 0);
        if (saldo < form.cantidad) {
          flash("err", `Stock insuficiente — ${form.nombre}: disponible ${saldo}`);
          setSaving(false);
          return;
        }
      }
      await addDoc(collection(db, "movimientos_loker"), {
        tipo:         esRetiro ? "devolucion_chofer" : "salida_despacho",
        categoria,
        ...(categoria !== "retiro_despacho" && { generaPuntos: categoria === "agregado_1" }),
        producto_id:  toProductoId(form.nombre),
        nombre:       form.nombre.trim(),
        cantidad:     esRetiro ? form.cantidad : -(form.cantidad),
        responsable:  despNombre,
        choferId:     sel.uid,
        choferNombre: sel.nombre,
        timestamp:    Timestamp.now(),
        ...(nota && { motivo: nota }),
        notas: esRetiro
          ? `Retiro despacho${nota ? `: ${nota}` : ""}`
          : categoria === "agregado_1"
            ? `Agregado c/puntos${nota ? `: ${nota}` : ""}`
            : `Agregado s/puntos${nota ? `: ${nota}` : ""}`,
      });
      if (categoria === "retiro_despacho") setRetiroForm({ nombre: "", cantidad: 1, nota: "" });
      else if (categoria === "agregado_1") setAgr1Form({ nombre: "", cantidad: 1, nota: "" });
      else                                 setAgr0Form({ nombre: "", cantidad: 1, nota: "" });
      flash("ok", `${esRetiro ? "Retiro" : "Agregado"} registrado — ${form.nombre.trim()}`);
    } catch (e) {
      flash("err", e instanceof Error ? e.message : "Error al guardar");
    } finally {
      setSaving(false);
    }
  };

  const driverMap: Record<string, FsDriver> = {};
  drivers.forEach((d) => { if (d.id) driverMap[d.id] = d; });

  const canAnalyze  = mode === "foto" ? !!imgData : texto.trim().length > 10;
  const totalUnid   = productos.reduce((s, p) => s + (p.cantidad ?? 0), 0);
  const currentStep = !sel ? 0
    : !canAnalyze && productos.length === 0 ? 1
    : analizando ? 2
    : productos.length === 0 ? 2 : 3;

  const despNombre = despachadorActivo || profile?.nombre || "Despachador";

  const getWhatsAppMsg = () => {
    if (!sel) return "";
    const totalMonto = productos.reduce((s, p) => s + ((p.precio ?? 0) * (p.cantidad ?? 0)), 0);
    const lines = [
      pbHeader(),
      `🚛 *Entrega — ${sel.nombre}* (Ficha ${sel.ficha ?? "—"})`,
      `👤 Despachador: ${despNombre}`,
      "",
    ];
    productos.forEach((p) => {
      const visto  = p.visto === "ok" ? "✅" : p.visto === "mal" ? "❌" : "•";
      const precio = p.precio != null ? ` · RD$${p.precio}` : "";
      lines.push(`${visto} ${p.nombre}: ${p.cantidad} ${p.unidad ?? ""}${precio}`);
    });
    lines.push(`\n📦 Total: ${totalUnid} uds`);
    if (totalMonto > 0) lines.push(`💰 Monto: RD$${totalMonto.toLocaleString("es-DO")}`);
    if (observaciones) lines.push(`\n📝 ${observaciones}`);
    lines.push("", pbFooter());
    return lines.join("\n");
  };

  const getPrintHtml = () => {
    if (!sel) return "";
    const totalMonto = productos.reduce((s, p) => s + ((p.precio ?? 0) * (p.cantidad ?? 0)), 0);
    const rows = productos.map((p) => {
      const estado = p.visto === "ok" ? "✓ OK" : p.visto === "mal" ? "✗ Mal" : "—";
      const precio = p.precio != null ? `RD$${p.precio}` : "—";
      return [p.nombre, p.cantidad ?? 0, p.unidad ?? "", precio, estado];
    });
    const table = pbTable(
      ["Producto", "Cant.", "Unidad", "Precio u.", "Estado"],
      rows,
      ["TOTAL", totalUnid, "", totalMonto > 0 ? `RD$${totalMonto.toLocaleString("es-DO")}` : "—", ""],
    );
    const body = table + (observaciones ? `<div class="obs-box">📝 ${observaciones}</div>` : "");
    return pbPrintDoc(
      `ENTREGA — ${sel.nombre}`,
      `Ficha: ${sel.ficha ?? "—"} · Despachador: ${despNombre}`,
      body,
    );
  };

  // Confrontar: cuarto frío vs suma de entregas por producto
  const cuartoFrio: ProductoItem[] = Array.isArray(session?.cuartoFrio)
    ? (session!.cuartoFrio as ProductoItem[])
    : [];

  const entregaMap: Record<string, number> = {};
  drivers.forEach((d) => {
    const entregas = Array.isArray(d.entregas) ? (d.entregas as ProductoItem[]) : [];
    entregas.forEach((e) => {
      const key = norm(e.nombre ?? "");
      entregaMap[key] = (entregaMap[key] ?? 0) + (e.cantidad ?? 0);
    });
  });

  const confrontaFilas = cuartoFrio.map((p) => {
    const key     = norm(p.nombre ?? "");
    const entr    = entregaMap[key] ?? 0;
    const diff    = (p.cantidad ?? 0) - entr;
    return { nombre: p.nombre, cf: p.cantidad ?? 0, entr, diff };
  });

  // Products only in deliveries (not in cold room)
  Object.keys(entregaMap).forEach((key) => {
    const yaEsta = cuartoFrio.some((p) => norm(p.nombre ?? "") === key);
    if (!yaEsta) {
      const nombreReal = drivers
        .flatMap((d) => (Array.isArray(d.entregas) ? (d.entregas as ProductoItem[]) : []))
        .find((e) => norm(e.nombre ?? "") === key)?.nombre ?? key;
      confrontaFilas.push({ nombre: nombreReal, cf: 0, entr: entregaMap[key], diff: -entregaMap[key] });
    }
  });

  const retiros = extrasHoy.filter((e) => e.categoria === "retiro_despacho");
  const agr1    = extrasHoy.filter((e) => e.categoria === "agregado_1");
  const agr0    = extrasHoy.filter((e) => e.categoria === "agregado_0");

  const selDriver = sel ? driverMap[sel.uid] : null;
  const selEntregas: ProductoItem[] = Array.isArray(selDriver?.entregas)
    ? (selDriver!.entregas as ProductoItem[])
    : [];

  // ── Mensajes para modales ─────────────────────────────────────────────────
  const buildChofModalMsg = () => {
    if (!chofModal) return "";
    const chofer = sel?.nombre ?? "Chofer";
    const lines = [pbHeader(), ""];
    if (chofModal.type === "entrega") {
      const e = chofModal.item;
      lines.push(`📋 *PRODUCTO EN LISTA*`, `🚛 ${chofer}`, "", `• ${e.nombre}: *${e.cantidad} ${e.unidad ?? "uds"}*`);
      if ((e.precio ?? 0) > 0) lines.push(`  Precio: $${e.precio!.toLocaleString()}`);
      if (e.visto) lines.push(`  Estado: ${e.visto === "ok" ? "✅ Verificado" : e.visto === "mal" ? "❌ Problema" : "⏳ Sin verificar"}`);
    } else {
      const r = chofModal.item;
      const cat = r.categoria === "retiro_despacho" ? "📦 Producto Retirado" : r.categoria === "agregado_1" ? "✅ Con Puntos" : "⚪ Sin Puntos";
      lines.push(`${cat}`, `🚛 ${chofer}`, "", `• ${r.nombre}: *${r.categoria === "retiro_despacho" ? `+${r.cantidad}` : `×${Math.abs(r.cantidad)}`}*`);
      if (r.motivo) lines.push(`  Motivo: ${r.motivo}`);
    }
    lines.push("", pbFooter());
    return lines.join("\n");
  };

  const buildConfrMsg = () => {
    const lines = [pbHeader(), "", "⚖️ *CONFRONTA — Cuarto Frío vs. Facturas*", ""];
    const totalCF   = cuartoFrio.reduce((s, p) => s + (p.cantidad ?? 0), 0);
    const totalEntr = Object.values(entregaMap).reduce((s, v) => s + v, 0);
    lines.push(`Total C.Frío: *${totalCF}* · Total Facturas: *${totalEntr}*`, "");
    confrontaFilas.forEach((f) => {
      const icon = f.diff === 0 ? "✅" : f.diff > 0 ? "🟡" : "🚨";
      const dif  = f.diff === 0 ? "justo" : f.diff > 0 ? `+${f.diff} sobra` : `${f.diff} falta`;
      lines.push(`${icon} ${f.nombre}: CF=${f.cf} / Fact=${f.entr} → *${dif}*`);
    });
    lines.push("", pbFooter());
    return lines.join("\n");
  };

  const buildConfrHtml = () => {
    const rows = confrontaFilas.map((f) => {
      const icon = f.diff === 0 ? "✅" : f.diff > 0 ? "🟡" : "🚨";
      const dif  = f.diff === 0 ? "justo" : f.diff > 0 ? `+${f.diff} sobra` : `${f.diff} falta`;
      return [f.nombre, f.cf, f.entr, `<b>${dif}</b>`, icon];
    });
    const totalCF   = cuartoFrio.reduce((s, p) => s + (p.cantidad ?? 0), 0);
    const totalEntr = Object.values(entregaMap).reduce((s, v) => s + v, 0);
    const total: (string|number)[] = ["<b>Total</b>", `<b>${totalCF}</b>`, `<b>${totalEntr}</b>`, "", ""];
    return pbPrintDoc(
      "Confronta — Cuarto Frío vs. Facturas",
      "Verificación antes del despacho",
      pbTable(["Producto", "C.Frío", "Facturas", "Diferencia", "Estado"], rows, total),
    );
  };

  return (
    <div className="space-y-4">
      {/* Progreso */}
      <ProgressSteps steps={STEPS} current={currentStep} />

      {/* Confrontar button */}
      <div className="flex justify-end">
        <button
          onClick={() => setShowConfronta(true)}
          className="flex items-center gap-2 px-4 py-2 bg-orange-500 hover:bg-orange-600 active:scale-95 text-white rounded-lg text-sm font-medium transition-all duration-100"
        >
          ⚖️ Confrontar antes de despachar
        </button>
      </div>

      <div className="grid lg:grid-cols-3 gap-5">

        {/* ── Lista de choferes ── */}
        <div className="bg-white rounded-xl shadow-sm p-5">
          <h2 className="font-bold text-blue-700 mb-3">
            👥 Choferes ({choferes.length})
          </h2>
          {choferes.length === 0 ? (
            <p className="text-sm text-gray-400 text-center py-8">
              Sin choferes activos.<br />Crea uno desde el Admin.
            </p>
          ) : (
            <div className="space-y-2">
              {choferes.map((c) => {
                const driver     = driverMap[c.uid];
                const tieneDatos = !!driver?.entregas;
                return (
                  <button
                    key={c.uid}
                    onClick={() => selectChofer(c)}
                    className={`w-full flex items-center gap-3 p-3 rounded-xl border-2 text-left
                      transition-all duration-100 active:scale-95 ${
                      sel?.uid === c.uid
                        ? "border-blue-500 bg-blue-50"
                        : "border-gray-100 hover:border-gray-200 bg-white"
                    }`}
                  >
                    <div className="w-9 h-9 rounded-full flex items-center justify-center
                      text-white font-bold text-sm flex-shrink-0 bg-cyan-500">
                      {c.nombre.charAt(0).toUpperCase()}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-semibold text-sm text-gray-800 truncate">{c.nombre}</p>
                      <p className="text-xs text-gray-400">Ficha {c.ficha ?? "—"}</p>
                    </div>
                    <span className={`text-lg flex-shrink-0 ${tieneDatos ? "" : "opacity-20"}`}>
                      {tieneDatos ? "✅" : "○"}
                    </span>
                  </button>
                );
              })}
            </div>
          )}

          {/* Lista del día del chofer seleccionado */}
          {sel && selEntregas.length > 0 && (
            <div className="mt-4 pt-4 border-t border-gray-100">
              <p className="text-xs font-semibold text-blue-600 mb-2">
                📋 Lista actual — {sel.nombre.split(" ")[0]}
              </p>
              <div className="space-y-1.5 max-h-48 overflow-y-auto">
                {selEntregas.map((e, i) => (
                  <button key={i} onClick={() => setChofModal({ type: "entrega", item: e })} className="w-full flex items-center justify-between text-xs px-2 py-1.5 bg-blue-50 rounded-lg active:scale-[0.99] transition-all duration-100 hover:bg-blue-100 text-left">
                    <span className="text-gray-700 truncate mr-2">{e.nombre}</span>
                    <span className="font-semibold text-blue-700 flex-shrink-0">
                      {e.cantidad} {e.unidad ?? ""}
                    </span>
                  </button>
                ))}
              </div>
              {typeof selDriver?.observaciones === "string" && selDriver.observaciones && (
                <p className="mt-2 text-xs text-gray-500 bg-gray-50 rounded px-2 py-1">
                  📝 {selDriver.observaciones}
                </p>
              )}
            </div>
          )}
        </div>

        {/* ── Panel de entrada ── */}
        <div className="bg-white rounded-xl shadow-sm p-5 space-y-4">
          {!sel ? (
            <div className="flex flex-col items-center justify-center h-full py-16 text-gray-400">
              <p className="text-3xl mb-2">👈</p>
              <p className="text-sm">Selecciona un chofer para<br />registrar su entrega</p>
            </div>
          ) : (
            <>
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="font-bold text-blue-700">{sel.nombre}</h3>
                  <p className="text-xs text-gray-400">Ficha {sel.ficha ?? "—"}</p>
                </div>
                <ModeToggle mode={mode} onChange={(m) => { setMode(m); resetEntrada(); }} />
              </div>

              {mode === "foto" ? (
                <ImageUploader
                  preview={preview}
                  onFile={(b, m, p) => { setImgData({ base64: b, mimeType: m }); setPreview(p); }}
                  onClear={() => { setPreview(null); setImgData(null); }}
                />
              ) : (
                <textarea
                  value={texto}
                  onChange={(e) => setTexto(e.target.value)}
                  placeholder={"Pega o escribe la factura / lista.\nEjemplo:\n- Leche 12 cajas $120\n- Queso 6 piezas"}
                  className="w-full h-44 px-3 py-2 border border-gray-300 rounded-lg text-sm
                    text-gray-800 focus:ring-2 focus:ring-blue-400 outline-none resize-none"
                />
              )}

              <AiButton onClick={analizar} loading={analizando} disabled={!canAnalyze} label="Leer factura con IA" />

              {msg && (
                <div className={`text-sm px-3 py-2 rounded-lg ${
                  msg.type === "ok"
                    ? "bg-green-50 text-green-700 border border-green-200"
                    : "bg-red-50 text-red-700 border border-red-200"
                }`}>{msg.text}</div>
              )}
            </>
          )}
        </div>

        {/* ── Tabla + observaciones + guardar ── */}
        <div className="bg-white rounded-xl shadow-sm p-5 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="font-bold text-gray-700">
              Productos entregados
              {productos.length > 0 && (
                <span className="ml-2 text-sm font-normal text-gray-400">{totalUnid} uds</span>
              )}
            </h3>
            {productos.length > 0 && (
              <button
                onClick={() => setProductos([])}
                className="text-xs text-gray-400 hover:text-red-400 active:scale-95 transition-all duration-100"
              >Limpiar</button>
            )}
          </div>

          {!sel ? (
            <p className="text-sm text-gray-400 text-center py-10">Selecciona un chofer primero</p>
          ) : productos.length === 0 ? (
            <div className="text-center py-10 text-gray-400 text-sm">
              <p className="text-3xl mb-2">🧾</p>
              <p>Agrega foto de factura y presiona</p>
              <p className="font-medium">✨ Leer factura con IA</p>
            </div>
          ) : (
            <>
              <ProductTable
                productos={productos}
                onChange={setProductos}
                showVisto={true}
                showPrecio={true}
              />
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">
                  📝 Observaciones — sobrantes y faltantes
                </label>
                <textarea
                  value={observaciones}
                  onChange={(e) => setObservaciones(e.target.value)}
                  placeholder="Ej: 2 cajas sobrantes de leche, cliente rechazó queso..."
                  rows={2}
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm
                    text-gray-800 focus:ring-2 focus:ring-blue-400 outline-none resize-none"
                />
              </div>
            </>
          )}

          {/* ── Alerta de stock insuficiente ── */}
          {stockAlerta && (
            <div className="bg-red-50 border border-red-200 rounded-xl p-3">
              <div className="flex items-center justify-between mb-2">
                <span className="text-red-700 font-semibold text-sm">
                  ⚠️ Stock insuficiente en el loker
                </span>
                <button
                  onClick={() => setStockAlerta(null)}
                  className="text-red-400 hover:text-red-600 text-xl leading-none active:scale-95"
                >×</button>
              </div>
              <div className="space-y-1 mb-2">
                {stockAlerta.map((f) => (
                  <div
                    key={f.nombre}
                    className="flex items-center justify-between text-xs bg-white
                      border border-red-200 rounded-lg px-2.5 py-1.5"
                  >
                    <span className="text-red-800 font-medium truncate mr-2">{f.nombre}</span>
                    <span className="text-red-600 flex-shrink-0 whitespace-nowrap">
                      necesita&nbsp;{f.necesita} · disponible&nbsp;{f.disponible}
                      <span className="ml-1 font-bold">({f.disponible - f.necesita})</span>
                    </span>
                  </div>
                ))}
              </div>
              <p className="text-xs text-red-500">
                Registra entradas en Inventario › Loker (Admin) antes de despachar.
              </p>
            </div>
          )}

          {(() => {
            const totalMonto = productos.reduce((s, p) => s + ((p.precio ?? 0) * (p.cantidad ?? 0)), 0);
            return totalMonto > 0 ? (
              <div className="flex items-center justify-between bg-green-50 border border-green-200
                rounded-xl px-4 py-2.5">
                <span className="text-sm font-semibold text-green-800">💰 Total a cobrar:</span>
                <span className="text-lg font-bold text-green-700">
                  RD${totalMonto.toLocaleString("es-DO")}
                </span>
              </div>
            ) : null;
          })()}

          <button
            type="button"
            onClick={guardar}
            disabled={guardando || !sel || productos.length === 0}
            className="w-full py-3 bg-blue-600 hover:bg-blue-700 active:scale-95 text-white
              rounded-xl font-semibold transition-all duration-100 disabled:opacity-50"
          >
            {guardando ? "Verificando stock…" : `💾 Guardar entrega${sel ? ` — ${sel.nombre}` : ""}`}
          </button>

          {productos.length > 0 && sel && (
            <WhatsAppPrint getMessage={getWhatsAppMsg} getPrintHtml={getPrintHtml} />
          )}
        </div>
      </div>

      {/* ── Consignación actual del chofer ── */}
      {sel && (
        <div className="bg-white rounded-xl shadow-sm border border-cyan-100 overflow-hidden">
          <button
            onClick={() => setConsigAbierto((v) => !v)}
            className="w-full flex items-center justify-between px-4 py-3
              bg-gradient-to-r from-cyan-50 to-cyan-100 hover:from-cyan-100
              hover:to-cyan-150 transition-colors duration-100"
          >
            <div className="flex items-center gap-2">
              <span className="text-sm font-bold text-cyan-800">📦 Consignación actual</span>
              <span className="text-xs bg-cyan-200 text-cyan-800 px-2 py-0.5 rounded-full font-bold">
                {consigChofer.reduce((s, p) => s + p.cantidad, 0)} uds
              </span>
              <span className="text-xs text-cyan-500">{sel.nombre.split(" ")[0]}</span>
            </div>
            <span className="text-cyan-600 text-sm">{consigAbierto ? "▲" : "▼"}</span>
          </button>

          {consigAbierto && (
            <div className="p-3">
              {consigChofer.length === 0 ? (
                <p className="text-xs text-gray-400 text-center py-3">
                  Sin productos en consignación para {sel.nombre.split(" ")[0]}
                </p>
              ) : (
                <div className="space-y-1.5">
                  {consigChofer.map((p) => (
                    <div key={p.nombre}
                      className="flex items-center justify-between bg-cyan-50
                        border border-cyan-100 rounded-lg px-3 py-2"
                    >
                      <span className="text-sm text-gray-800 flex-1 truncate mr-2">{p.nombre}</span>
                      <span className="text-sm font-bold text-cyan-700 flex-shrink-0">{p.cantidad} uds</span>
                    </div>
                  ))}
                  <p className="text-xs text-gray-400 text-center pt-1">
                    Total acumulado histórico — incluye todos los despachos menos devoluciones
                  </p>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* ── Secciones extras por factura ── */}
      {sel && (
        <div className="space-y-3">

          {/* PRODUCTOS RETIRADOS */}
          <div className="bg-white rounded-xl shadow-sm border border-orange-100">
            <div className="flex items-center gap-2 px-4 py-3 bg-orange-50 rounded-t-xl flex-wrap">
              <span className="text-sm font-bold text-orange-700">📦 PRODUCTOS RETIRADOS</span>
              {retiros.length > 0 && (
                <span className="bg-orange-200 text-orange-700 text-xs px-1.5 py-0.5 rounded-full font-bold">
                  {retiros.length}
                </span>
              )}
              <span className="text-xs text-orange-400 ml-auto">loker sube</span>
            </div>
            <div className="p-4 space-y-3">
              {retiros.length === 0 ? (
                <p className="text-xs text-gray-400 text-center py-1">Sin retiros registrados hoy</p>
              ) : (
                <div className="space-y-1.5">
                  {retiros.map((r) => (
                    <button key={r.id} onClick={() => setChofModal({ type: "extra", item: r })} className="w-full flex items-center gap-2 text-sm bg-orange-50 rounded-lg px-3 py-2 active:scale-[0.99] transition-all duration-100 hover:bg-orange-100 text-left">
                      <span className="font-medium text-orange-800 flex-1 truncate">{r.nombre}</span>
                      <span className="text-orange-600 font-bold flex-shrink-0">+{r.cantidad}</span>
                      {r.motivo && <span className="text-gray-400 text-xs truncate max-w-[120px]">{r.motivo}</span>}
                    </button>
                  ))}
                </div>
              )}
              <div className="space-y-2">
                <div className="grid grid-cols-2 gap-2">
                  <input
                    type="text"
                    placeholder="Producto"
                    value={retiroForm.nombre}
                    onChange={(e) => setRetiroForm((f) => ({ ...f, nombre: e.target.value }))}
                    className="px-3 py-2 border border-gray-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-orange-300"
                  />
                  <input
                    type="number" min={1}
                    placeholder="Cant."
                    value={retiroForm.cantidad}
                    onChange={(e) => setRetiroForm((f) => ({ ...f, cantidad: Math.max(1, Number(e.target.value)) }))}
                    className="px-3 py-2 border border-gray-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-orange-300"
                  />
                </div>
                <input
                  type="text"
                  placeholder="Motivo del retiro"
                  value={retiroForm.nota}
                  onChange={(e) => setRetiroForm((f) => ({ ...f, nota: e.target.value }))}
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-orange-300"
                />
                <button
                  onClick={() => guardarExtra("retiro_despacho", retiroForm)}
                  disabled={savingRetiro || !retiroForm.nombre.trim()}
                  className="w-full py-2.5 bg-orange-500 hover:bg-orange-600 active:scale-95 text-white rounded-lg text-sm font-semibold transition-all duration-100 disabled:opacity-50"
                >
                  {savingRetiro ? "Guardando…" : "↩ Registrar retiro"}
                </button>
              </div>
            </div>
          </div>

          {/* AGREGADO 1 — Con Puntos */}
          <div className="bg-white rounded-xl shadow-sm border border-green-100">
            <div className="flex items-center gap-2 px-4 py-3 bg-green-50 rounded-t-xl flex-wrap">
              <span className="text-sm font-bold text-green-700">✅ AGREGADO 1 — Con Puntos</span>
              {agr1.length > 0 && (
                <span className="bg-green-200 text-green-700 text-xs px-1.5 py-0.5 rounded-full font-bold">
                  {agr1.length}
                </span>
              )}
              <span className="text-xs text-green-400 ml-auto">loker baja · cuenta en beneficios</span>
            </div>
            <div className="p-4 space-y-3">
              {agr1.length === 0 ? (
                <p className="text-xs text-gray-400 text-center py-1">Sin agregados registrados hoy</p>
              ) : (
                <div className="space-y-1.5">
                  {agr1.map((r) => (
                    <button key={r.id} onClick={() => setChofModal({ type: "extra", item: r })} className="w-full flex items-center gap-2 text-sm bg-green-50 rounded-lg px-3 py-2 active:scale-[0.99] transition-all duration-100 hover:bg-green-100 text-left">
                      <span className="font-medium text-green-800 flex-1 truncate">{r.nombre}</span>
                      <span className="text-green-600 font-bold flex-shrink-0">×{Math.abs(r.cantidad)}</span>
                      {r.motivo && <span className="text-gray-400 text-xs truncate max-w-[120px]">{r.motivo}</span>}
                    </button>
                  ))}
                </div>
              )}
              <div className="space-y-2">
                <div className="grid grid-cols-2 gap-2">
                  <input
                    type="text"
                    placeholder="Producto"
                    value={agr1Form.nombre}
                    onChange={(e) => setAgr1Form((f) => ({ ...f, nombre: e.target.value }))}
                    className="px-3 py-2 border border-gray-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-green-300"
                  />
                  <input
                    type="number" min={1}
                    placeholder="Cant."
                    value={agr1Form.cantidad}
                    onChange={(e) => setAgr1Form((f) => ({ ...f, cantidad: Math.max(1, Number(e.target.value)) }))}
                    className="px-3 py-2 border border-gray-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-green-300"
                  />
                </div>
                <input
                  type="text"
                  placeholder="Descripción"
                  value={agr1Form.nota}
                  onChange={(e) => setAgr1Form((f) => ({ ...f, nota: e.target.value }))}
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-green-300"
                />
                <button
                  onClick={() => guardarExtra("agregado_1", agr1Form)}
                  disabled={savingAgr1 || !agr1Form.nombre.trim()}
                  className="w-full py-2.5 bg-green-600 hover:bg-green-700 active:scale-95 text-white rounded-lg text-sm font-semibold transition-all duration-100 disabled:opacity-50"
                >
                  {savingAgr1 ? "Guardando…" : "⭐ Registrar Agregado 1"}
                </button>
              </div>
            </div>
          </div>

          {/* AGREGADO 0 — Sin Puntos */}
          <div className="bg-white rounded-xl shadow-sm border border-slate-200">
            <div className="flex items-center gap-2 px-4 py-3 bg-slate-50 rounded-t-xl flex-wrap">
              <span className="text-sm font-bold text-slate-600">⚪ AGREGADO 0 — Sin Puntos</span>
              {agr0.length > 0 && (
                <span className="bg-slate-200 text-slate-600 text-xs px-1.5 py-0.5 rounded-full font-bold">
                  {agr0.length}
                </span>
              )}
              <span className="text-xs text-slate-400 ml-auto">loker baja · solo informativo</span>
            </div>
            <div className="p-4 space-y-3">
              {agr0.length === 0 ? (
                <p className="text-xs text-gray-400 text-center py-1">Sin agregados registrados hoy</p>
              ) : (
                <div className="space-y-1.5">
                  {agr0.map((r) => (
                    <button key={r.id} onClick={() => setChofModal({ type: "extra", item: r })} className="w-full flex items-center gap-2 text-sm bg-slate-50 rounded-lg px-3 py-2 active:scale-[0.99] transition-all duration-100 hover:bg-slate-100 text-left">
                      <span className="font-medium text-slate-700 flex-1 truncate">{r.nombre}</span>
                      <span className="text-slate-500 font-bold flex-shrink-0">×{Math.abs(r.cantidad)}</span>
                      <span className="text-xs bg-slate-200 text-slate-500 px-1.5 py-0.5 rounded flex-shrink-0">Sin pts</span>
                      {r.motivo && <span className="text-gray-400 text-xs truncate max-w-[80px]">{r.motivo}</span>}
                    </button>
                  ))}
                </div>
              )}
              <div className="space-y-2">
                <div className="grid grid-cols-2 gap-2">
                  <input
                    type="text"
                    placeholder="Producto"
                    value={agr0Form.nombre}
                    onChange={(e) => setAgr0Form((f) => ({ ...f, nombre: e.target.value }))}
                    className="px-3 py-2 border border-gray-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-slate-300"
                  />
                  <input
                    type="number" min={1}
                    placeholder="Cant."
                    value={agr0Form.cantidad}
                    onChange={(e) => setAgr0Form((f) => ({ ...f, cantidad: Math.max(1, Number(e.target.value)) }))}
                    className="px-3 py-2 border border-gray-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-slate-300"
                  />
                </div>
                <input
                  type="text"
                  placeholder="Descripción"
                  value={agr0Form.nota}
                  onChange={(e) => setAgr0Form((f) => ({ ...f, nota: e.target.value }))}
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-slate-300"
                />
                <p className="text-xs text-slate-400">⚠️ No cuenta en puntos ni beneficios del chofer.</p>
                <button
                  onClick={() => guardarExtra("agregado_0", agr0Form)}
                  disabled={savingAgr0 || !agr0Form.nombre.trim()}
                  className="w-full py-2.5 bg-slate-500 hover:bg-slate-600 active:scale-95 text-white rounded-lg text-sm font-semibold transition-all duration-100 disabled:opacity-50"
                >
                  {savingAgr0 ? "Guardando…" : "○ Registrar Agregado 0"}
                </button>
              </div>
            </div>
          </div>

        </div>
      )}

      {/* ── Modal detalle de ítem ── */}
      {chofModal && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-end sm:items-center justify-center p-4" onClick={() => setChofModal(null)}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center gap-2 px-5 py-4 border-b">
              <h3 className="font-bold text-gray-800 flex-1 min-w-0 truncate">
                {chofModal.type === "entrega" ? "📋 Producto en lista" : (
                  chofModal.item.categoria === "retiro_despacho" ? "📦 Producto Retirado"
                  : chofModal.item.categoria === "agregado_1"    ? "✅ Agregado 1 — Con Puntos"
                  :                                                "⚪ Agregado 0 — Sin Puntos"
                )}
              </h3>
              <ShareBar getMessage={buildChofModalMsg} className="flex-shrink-0" />
              <button onClick={() => setChofModal(null)} className="text-gray-400 hover:text-gray-600 text-2xl leading-none active:scale-95 flex-shrink-0">×</button>
            </div>
            <div className="p-5 space-y-3">
              {chofModal.type === "entrega" && (() => {
                const e = chofModal.item;
                return (
                  <div className="space-y-3">
                    <div className="bg-blue-50 rounded-xl p-4">
                      <p className="font-bold text-gray-800 text-lg">{e.nombre}</p>
                      <p className="text-sm text-gray-500 mt-1">{sel?.nombre}</p>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div className="bg-blue-50 rounded-xl p-3 text-center">
                        <p className="text-2xl font-bold text-blue-700">{e.cantidad}</p>
                        <p className="text-xs text-blue-500">{e.unidad ?? "unidades"}</p>
                      </div>
                      {(e.precio ?? 0) > 0 && (
                        <div className="bg-green-50 rounded-xl p-3 text-center">
                          <p className="text-2xl font-bold text-green-700">${(e.precio ?? 0).toLocaleString()}</p>
                          <p className="text-xs text-green-500">precio</p>
                        </div>
                      )}
                    </div>
                    {e.visto && (
                      <p className="text-sm text-center">
                        {e.visto === "ok" ? "✅ Verificado" : e.visto === "mal" ? "❌ Problema detectado" : "⏳ Sin verificar"}
                      </p>
                    )}
                  </div>
                );
              })()}
              {chofModal.type === "extra" && (() => {
                const r = chofModal.item;
                const esRetiro = r.categoria === "retiro_despacho";
                return (
                  <div className="space-y-3">
                    <div className={`rounded-xl p-4 ${esRetiro ? "bg-orange-50" : r.categoria === "agregado_1" ? "bg-green-50" : "bg-slate-50"}`}>
                      <p className="font-bold text-gray-800 text-lg">{r.nombre}</p>
                      <p className="text-sm text-gray-500 mt-1">{sel?.nombre}</p>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div className={`rounded-xl p-3 text-center ${esRetiro ? "bg-orange-50" : "bg-gray-50"}`}>
                        <p className={`text-2xl font-bold ${esRetiro ? "text-orange-700" : "text-gray-700"}`}>
                          {esRetiro ? `+${r.cantidad}` : `×${Math.abs(r.cantidad)}`}
                        </p>
                        <p className={`text-xs ${esRetiro ? "text-orange-500" : "text-gray-400"}`}>
                          {esRetiro ? "devuelto al loker" : "despachado del loker"}
                        </p>
                      </div>
                      <div className={`rounded-xl p-3 text-center ${r.categoria === "agregado_1" ? "bg-green-50" : "bg-slate-50"}`}>
                        <p className={`text-sm font-bold ${r.categoria === "agregado_1" ? "text-green-700" : "text-slate-500"}`}>
                          {r.categoria === "retiro_despacho" ? "Retiro" : r.categoria === "agregado_1" ? "⭐ Con puntos" : "Sin puntos"}
                        </p>
                        <p className="text-xs text-gray-400">categoría</p>
                      </div>
                    </div>
                    {r.motivo && (
                      <div className="bg-gray-50 rounded-lg px-3 py-2">
                        <p className="text-xs text-gray-500">📝 {r.motivo}</p>
                      </div>
                    )}
                  </div>
                );
              })()}
            </div>
          </div>
        </div>
      )}

      {/* ── Modal Confrontar ── */}
      {showConfronta && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={() => setShowConfronta(false)}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[85vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center gap-2 px-5 py-4 border-b flex-shrink-0">
              <div className="flex-1 min-w-0">
                <h2 className="font-bold text-gray-800 text-lg">⚖️ Confrontar antes de despachar</h2>
                <p className="text-xs text-gray-500">Cuarto Frío vs. facturas registradas de choferes</p>
              </div>
              <ShareBar getMessage={buildConfrMsg} getPrintHtml={buildConfrHtml} className="flex-shrink-0" />
              <button onClick={() => setShowConfronta(false)} className="text-gray-400 hover:text-gray-600 text-2xl leading-none active:scale-95 flex-shrink-0">×</button>
            </div>
            <div className="flex-1 overflow-y-auto p-5">
              {cuartoFrio.length === 0 && Object.keys(entregaMap).length === 0 ? (
                <div className="text-center py-12 text-gray-400">
                  <p className="text-3xl mb-3">⚖️</p>
                  <p className="font-medium">Sin datos para confrontar</p>
                  <p className="text-sm mt-1">Registra el inventario en Cuarto Frío primero</p>
                </div>
              ) : (
                <div className="space-y-4">
                  {/* Resumen */}
                  <div className="grid grid-cols-3 gap-3">
                    <div className="bg-blue-50 rounded-xl p-3 text-center">
                      <p className="text-xl font-bold text-blue-700">{cuartoFrio.reduce((s, p) => s + (p.cantidad ?? 0), 0)}</p>
                      <p className="text-xs text-blue-500">Total Cuarto Frío</p>
                    </div>
                    <div className="bg-green-50 rounded-xl p-3 text-center">
                      <p className="text-xl font-bold text-green-700">{Object.values(entregaMap).reduce((s, v) => s + v, 0)}</p>
                      <p className="text-xs text-green-500">Total Facturas</p>
                    </div>
                    <div className="bg-orange-50 rounded-xl p-3 text-center">
                      <p className="text-xl font-bold text-orange-700">
                        {confrontaFilas.reduce((s, f) => s + f.diff, 0)}
                      </p>
                      <p className="text-xs text-orange-500">Diferencia neta</p>
                    </div>
                  </div>

                  {/* Tabla */}
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead className="bg-gray-50">
                        <tr className="text-xs text-gray-500">
                          <th className="text-left px-3 py-2.5">Producto</th>
                          <th className="text-right px-3 py-2.5">C.Frío</th>
                          <th className="text-right px-3 py-2.5">Facturas</th>
                          <th className="text-right px-3 py-2.5">Diferencia</th>
                          <th className="px-3 py-2.5 text-center">Estado</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-50">
                        {confrontaFilas.map((f) => {
                          const alcanza = f.diff >= 0;
                          const icon = f.diff === 0 ? "✅" : f.diff > 0 ? "🟡" : "🚨";
                          return (
                            <tr key={f.nombre} className="hover:bg-gray-50">
                              <td className="px-3 py-2.5 font-medium text-gray-800">{f.nombre}</td>
                              <td className="px-3 py-2.5 text-right text-blue-600">{f.cf}</td>
                              <td className="px-3 py-2.5 text-right text-green-600">{f.entr}</td>
                              <td className={`px-3 py-2.5 text-right font-semibold ${
                                f.diff > 0 ? "text-yellow-600" : f.diff < 0 ? "text-red-600" : "text-gray-400"
                              }`}>
                                {f.diff > 0 ? `+${f.diff} sobra` : f.diff < 0 ? `${f.diff} falta` : "justo"}
                              </td>
                              <td className="px-3 py-2.5 text-center text-xl">{icon}</td>
                            </tr>
                          );
                        })}
                        {confrontaFilas.length === 0 && (
                          <tr><td colSpan={5} className="text-center py-6 text-gray-400 text-sm">Sin productos registrados</td></tr>
                        )}
                      </tbody>
                    </table>
                  </div>

                  {/* Leyenda */}
                  <div className="flex flex-wrap gap-3 text-xs text-gray-500">
                    <span>✅ = cantidad exacta</span>
                    <span>🟡 = sobra en cuarto frío</span>
                    <span>🚨 = falta en cuarto frío</span>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
