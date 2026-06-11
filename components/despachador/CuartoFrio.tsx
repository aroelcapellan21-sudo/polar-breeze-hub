"use client";

import { useState, useEffect } from "react";
import { doc, setDoc, addDoc, collection, Timestamp, getDoc, onSnapshot, query, where } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useAuth } from "@/lib/auth-context";
import { ProductoItem, PuntoProducto, toProductoId } from "@/lib/types";
import { pbHeader, pbFooter } from "@/lib/wa-format";
import { pbPrintDoc, pbTable } from "@/lib/print-template";
import {
  ImageUploader, ModeToggle, AiButton,
  WhatsAppPrint, ProgressSteps,
} from "./shared";
import ScannerBar from "./ScannerBar";

interface Props {
  despachadorActivo?: string;
}

interface HistorialCFEntry {
  id: string;
  timestamp: { seconds: number } | Date;
  despachadorNombre: string;
  productos: ProductoItem[];
  totalUnidades: number;
  totalCajas?: number | null;
  observaciones?: string | null;
  estados?: Record<string, { estado: "pendiente" | "recibido" | "no_recibido"; motivo: string }>;
}

const STEPS_FOTO   = [{ label: "Foto" }, { label: "Analizar IA" }, { label: "Revisar" }, { label: "Guardar" }];
const STEPS_MANUAL = [{ label: "Seleccionar" }, { label: "Revisar" }, { label: "Guardar" }];

export default function CuartoFrio({ despachadorActivo }: Props) {
  const { profile } = useAuth();
  const [mode,          setMode]          = useState<"foto" | "manual">("foto");
  const [preview,       setPreview]       = useState<string | null>(null);
  const [imgData,       setImgData]       = useState<{ base64: string; mimeType: string } | null>(null);
  const [texto,         setTexto]         = useState("");
  const [productos,     setProductos]     = useState<ProductoItem[]>([]);
  const [observaciones, setObservaciones] = useState("");
  const [analizando,    setAnalizando]    = useState(false);
  const [guardando,     setGuardando]     = useState(false);
  const [msg,           setMsg]           = useState<{ type: "ok" | "err"; text: string } | null>(null);

  // Catálogo para modo manual
  const [catalogo,      setCatalogo]      = useState<PuntoProducto[]>([]);
  const [manualProd,    setManualProd]    = useState("");
  const [manualCajas,   setManualCajas]   = useState(0);
  const [manualUnids,   setManualUnids]   = useState(0);

  // Estado de recepción por producto (todos los modos: foto IA, escáner y manual)
  type EstadoRecepcion = { estado: "pendiente" | "recibido" | "no_recibido"; motivo: string };
  const [estados,       setEstados]       = useState<Record<string, EstadoRecepcion>>({});
  const [motivoAbierto, setMotivoAbierto] = useState<string | null>(null);
  const [motivoTemp,    setMotivoTemp]    = useState("");
  const [editando,      setEditando]      = useState<string | null>(null);
  const [editNombre,    setEditNombre]    = useState("");
  const [editCajas,     setEditCajas]     = useState(0);
  const [editUnids,     setEditUnids]     = useState(0);

  const [historial,    setHistorial]    = useState<HistorialCFEntry[]>([]);
  const [histAbierto,  setHistAbierto]  = useState(false);
  const [scannerActivo, setScannerActivo] = useState(false);

  useEffect(() => {
    const unsub = onSnapshot(
      query(collection(db, "history"), where("tipo", "==", "cuarto_frio")),
      (snap) => {
        setHistorial(
          snap.docs
            .map((d) => ({ id: d.id, ...d.data() } as HistorialCFEntry))
            .sort((a, b) => {
              const ta = a.timestamp && "seconds" in a.timestamp ? a.timestamp.seconds : 0;
              const tb = b.timestamp && "seconds" in b.timestamp ? b.timestamp.seconds : 0;
              return tb - ta;
            })
            .slice(0, 15)
        );
      }
    );
    return () => unsub();
  }, []);

  useEffect(() => {
    getDoc(doc(db, "config", "puntos")).then((snap) => {
      if (snap.exists()) {
        const pd = snap.data();
        setCatalogo(pd.productos ?? []);
        if ((pd.productos as PuntoProducto[] ?? []).length > 0) {
          setManualProd((pd.productos as PuntoProducto[])[0].nombre);
        }
      }
    });
  }, []);

  const flash = (type: "ok" | "err", text: string) => {
    setMsg({ type, text });
    setTimeout(() => setMsg(null), 4000);
  };

  const despNombre = despachadorActivo || profile?.nombre || "Despachador";

  // Modo foto
  const canAnalyze = mode === "foto" ? !!imgData : texto.trim().length > 10;
  const currentStepFoto = !canAnalyze ? 0 : analizando ? 1 : productos.length === 0 ? 1 : 2;
  const currentStepManual = productos.length > 0 ? 1 : 0;

  const analizar = async () => {
    setAnalizando(true);
    try {
      const body = imgData
        ? { tipo: "cuarto_frio", imageBase64: imgData.base64, mimeType: imgData.mimeType }
        : { tipo: "cuarto_frio", texto };
      const res  = await fetch("/api/analyze", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      if (Array.isArray(data.productos) && data.productos.length > 0) {
        setProductos(data.productos);
        flash("ok", `IA detectó ${data.productos.length} productos`);
      } else {
        flash("err", "No se detectaron productos. Edita manualmente.");
      }
    } catch (e) {
      flash("err", e instanceof Error ? e.message : "Error al analizar");
    } finally {
      setAnalizando(false);
    }
  };

  // Agregar producto en modo manual
  const addManual = () => {
    if (!manualProd) return;
    setProductos((prev) => {
      const idx = prev.findIndex((p) => p.nombre === manualProd);
      if (idx >= 0) {
        const next = [...prev];
        next[idx] = {
          ...next[idx],
          cajas:    (next[idx].cajas    ?? 0) + manualCajas,
          cantidad: (next[idx].cantidad ?? 0) + manualUnids,
        };
        return next;
      }
      return [...prev, { nombre: manualProd, cantidad: manualUnids, cajas: manualCajas, unidad: "pz" }];
    });
    setManualCajas(0);
    setManualUnids(0);
  };

  const guardar = async () => {
    if (!profile || productos.length === 0) return;
    setGuardando(true);
    try {
      const totalUnidades = productos.reduce((s, p) => s + (p.cantidad ?? 0), 0);
      const totalCajas    = productos.reduce((s, p) => s + (p.cajas    ?? 0), 0);
      const totalPeso     = productos.reduce((s, p) => s + (p.peso     ?? 0), 0);
      const ts            = Timestamp.now();

      await setDoc(doc(db, "session", "despacho"), {
        cuartoFrio:        productos,
        totalProductos:    productos.length,
        totalUnidades,
        totalCajas:        totalCajas || null,
        totalPeso:         totalPeso  || null,
        despachadorId:     profile.uid,
        despachadorNombre: despNombre,
        despachador:       despNombre,
        observaciones:     observaciones || null,
        fecha:             ts,
        estado:            "activa",
        totalDespachos:    0,
        totalMonto:        0,
      });

      await addDoc(collection(db, "history"), {
        tipo:              "cuarto_frio",
        productos,
        totalUnidades,
        totalCajas:        totalCajas || null,
        observaciones:     observaciones || null,
        despachadorId:     profile.uid,
        despachadorNombre: despNombre,
        timestamp:         ts,
        ...(mode === "manual" && Object.keys(estados).length > 0 ? { estados } : {}),
      });

      // Movimientos al loker — solo en modo manual con estados confirmados
      if (mode === "manual") {
        for (const p of productos) {
          const est     = estados[p.nombre];
          const cantidad = (p.cajas ?? 0) + (p.cantidad ?? 0);
          if (!est || est.estado === "pendiente") continue;

          if (est.estado === "recibido" && cantidad > 0) {
            await addDoc(collection(db, "movimientos_loker"), {
              tipo:        "entrada_interior",
              producto_id: toProductoId(p.nombre),
              nombre:      p.nombre,
              cantidad,
              responsable: despNombre,
              timestamp:   ts,
              notas:       "Cuarto frío — despachado ✅",
            });
          } else if (est.estado === "no_recibido") {
            await addDoc(collection(db, "movimientos_loker"), {
              tipo:        "recepcion_pendiente",
              producto_id: toProductoId(p.nombre),
              nombre:      p.nombre,
              cantidad:    0,
              responsable: despNombre,
              timestamp:   ts,
              notas:       est.motivo ? `No recibido: ${est.motivo}` : "No recibido ❌",
            });
          }
        }
      }

      flash("ok", `Cuarto frío guardado — ${totalUnidades} uds · ${totalCajas} cajas · ${productos.length} productos`);
    } catch (e) {
      flash("err", e instanceof Error ? e.message : "Error al guardar");
    } finally {
      setGuardando(false);
    }
  };

  const totalUnid  = productos.reduce((s, p) => s + (p.cantidad ?? 0), 0);
  const totalCajas = productos.reduce((s, p) => s + (p.cajas    ?? 0), 0);

  const getWhatsAppMsg = () => {
    const lines = [pbHeader(), `🥶 *Cuarto Frío — ${despNombre}*`, ""];
    productos.forEach((p) => {
      const partes: string[] = [];
      if (p.cajas)    partes.push(`${p.cajas} caj`);
      if (p.cantidad) partes.push(`${p.cantidad} uds`);
      lines.push(`• ${p.nombre}: ${partes.join(" / ") || "—"}`);
    });
    lines.push(`\n📦 Total: ${totalCajas} cajas · ${totalUnid} uds`);
    if (observaciones) lines.push(`\n📝 ${observaciones}`);
    lines.push("", pbFooter());
    return lines.join("\n");
  };

  const getPrintHtml = () => {
    const rows = productos.map((p) => [p.nombre, p.cajas ?? 0, p.cantidad ?? 0]);
    const body = pbTable(
      ["Producto", "Cajas", "Unidades"],
      rows,
      ["TOTAL", totalCajas, totalUnid],
    ) + (observaciones ? `<div class="obs-box">📝 ${observaciones}</div>` : "");
    return pbPrintDoc("CUARTO FRÍO", `Despachador: ${despNombre}`, body);
  };

  const marcarRecibido = (nombre: string) => {
    setEstados(prev => ({ ...prev, [nombre]: { estado: "recibido", motivo: "" } }));
    if (motivoAbierto === nombre) setMotivoAbierto(null);
  };

  const toggleMotivoInput = (nombre: string) => {
    if (motivoAbierto === nombre) { setMotivoAbierto(null); return; }
    setEditando(null);
    setMotivoAbierto(nombre);
    setMotivoTemp(estados[nombre]?.motivo ?? "");
  };

  const confirmarEdicion = (nombreOriginal: string) => {
    const nuevoNombre = editNombre.trim() || nombreOriginal;
    // Evitar fusionar accidentalmente con otro producto ya existente en la lista
    const colision = nuevoNombre !== nombreOriginal &&
      productos.some((p) => p.nombre === nuevoNombre);
    const nombreFinal = colision ? nombreOriginal : nuevoNombre;

    setProductos((prev) =>
      prev.map((p) =>
        p.nombre === nombreOriginal
          ? { ...p, nombre: nombreFinal, cajas: editCajas, cantidad: editUnids }
          : p
      )
    );

    // Si cambió el nombre, mover el estado de recepción a la nueva clave
    if (nombreFinal !== nombreOriginal) {
      setEstados((prev) => {
        if (!(nombreOriginal in prev)) return prev;
        const n = { ...prev };
        n[nombreFinal] = n[nombreOriginal];
        delete n[nombreOriginal];
        return n;
      });
    }

    if (colision) flash("err", `Ya existe "${nuevoNombre}" en la lista — se conservó el nombre original`);
    setEditando(null);
  };

  const confirmarNoRecibido = (nombre: string) => {
    setEstados(prev => ({ ...prev, [nombre]: { estado: "no_recibido", motivo: motivoTemp } }));
    setMotivoAbierto(null);
    setMotivoTemp("");
  };

  const resetMode = (m: "foto" | "manual") => {
    setMode(m);
    setPreview(null); setImgData(null); setTexto("");
    setProductos([]); setObservaciones("");
    setManualCajas(0); setManualUnids(0);
    setEstados({}); setMotivoAbierto(null); setMotivoTemp("");
    setEditando(null);
  };

  return (
    <div className="space-y-4">
      <ProgressSteps
        steps={mode === "foto" ? STEPS_FOTO : STEPS_MANUAL}
        current={mode === "foto" ? currentStepFoto : currentStepManual}
      />

      <div className="grid lg:grid-cols-2 gap-5">

        {/* ── Panel izquierdo: entrada ── */}
        <div className="bg-white rounded-xl shadow-sm p-5 space-y-4">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <h2 className="font-bold text-[#D42B2B]">🥶 Cuarto Frío</h2>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setScannerActivo((v) => !v)}
                className={`text-xs px-3 py-1.5 rounded-lg font-semibold transition-all active:scale-95 ${
                  scannerActivo
                    ? "bg-[#F5C800] text-[#1A1A1A]"
                    : "bg-gray-100 text-gray-500 hover:bg-gray-200"
                }`}
              >
                🔲 Escáner
              </button>
              <ModeToggle mode={mode} onChange={resetMode} />
            </div>
          </div>

          {/* ── Modo Escáner HID ── */}
          {scannerActivo && (
            <ScannerBar
              labelAgregar="Agregar al Cuarto Frío"
              onAgregar={(nombre, cajas, unidades) => {
                setProductos((prev) => {
                  const idx = prev.findIndex((p) => p.nombre === nombre);
                  if (idx >= 0) {
                    const next = [...prev];
                    next[idx] = {
                      ...next[idx],
                      cajas:    (next[idx].cajas    ?? 0) + cajas,
                      cantidad: (next[idx].cantidad ?? 0) + unidades,
                    };
                    return next;
                  }
                  return [...prev, { nombre, cantidad: unidades, cajas, unidad: "pz" }];
                });
              }}
            />
          )}

          {/* ── Modo Foto ── */}
          {mode === "foto" && (
            <>
              <ImageUploader
                preview={preview}
                onFile={(b, m, p) => { setImgData({ base64: b, mimeType: m }); setPreview(p); }}
                onClear={() => { setPreview(null); setImgData(null); }}
              />
              <AiButton onClick={analizar} loading={analizando} disabled={!canAnalyze} />
            </>
          )}

          {/* ── Modo Manual — lista desplegable ── */}
          {mode === "manual" && (
            <div className="space-y-4">
              {catalogo.length === 0 ? (
                <div className="text-center py-8 text-gray-400 text-sm">
                  <p className="text-2xl mb-2">📋</p>
                  <p>Sin productos configurados.</p>
                  <p className="text-xs mt-1">El Admin debe agregar productos en<br/>Gestión Choferes → Puntos.</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {/* Selector de producto */}
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">Producto</label>
                    <select
                      value={manualProd}
                      onChange={(e) => setManualProd(e.target.value)}
                      className="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm text-gray-800 outline-none focus:ring-2 focus:ring-[#F5C800] bg-white"
                    >
                      {catalogo.map((p) => (
                        <option key={p.nombre} value={p.nombre}>{p.nombre}</option>
                      ))}
                    </select>
                  </div>

                  {/* Cajas + Unidades */}
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-medium text-gray-600 mb-1">📦 Cajas</label>
                      <input
                        type="number" min={0}
                        value={manualCajas || ""}
                        onChange={(e) => setManualCajas(Math.max(0, Number(e.target.value)))}
                        placeholder="0"
                        className="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm text-gray-800 outline-none focus:ring-2 focus:ring-[#F5C800] text-center"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-600 mb-1">🔢 Unidades</label>
                      <input
                        type="number" min={0}
                        value={manualUnids || ""}
                        onChange={(e) => setManualUnids(Math.max(0, Number(e.target.value)))}
                        placeholder="0"
                        className="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm text-gray-800 outline-none focus:ring-2 focus:ring-[#F5C800] text-center"
                      />
                    </div>
                  </div>

                  <button
                    onClick={addManual}
                    disabled={!manualProd || (manualCajas === 0 && manualUnids === 0)}
                    className="w-full py-2.5 bg-[#D42B2B] hover:bg-[#b82424] active:scale-95 text-white rounded-lg text-sm font-semibold transition-all duration-100 disabled:opacity-50"
                  >
                    + Agregar a lista
                  </button>
                </div>
              )}
            </div>
          )}

          {msg && (
            <div className={`text-sm px-3 py-2 rounded-lg ${
              msg.type === "ok"
                ? "bg-green-50 text-green-700 border border-green-200"
                : "bg-red-50 text-red-700 border border-red-200"
            }`}>{msg.text}</div>
          )}
        </div>

        {/* ── Panel derecho: lista + guardar ── */}
        <div className="bg-white rounded-xl shadow-sm p-5 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="font-bold text-gray-700">
              {mode === "manual" ? "Lista de productos" : "Inventario detectado"}
              {productos.length > 0 && (
                <span className="ml-2 text-sm font-normal text-gray-400">
                  {productos.length} productos · {totalCajas ? `${totalCajas} caj · ` : ""}{totalUnid} uds
                </span>
              )}
            </h3>
            {productos.length > 0 && (
              <button
                type="button"
                onClick={() => { setProductos([]); setEstados({}); setMotivoAbierto(null); }}
                className="text-xs text-gray-400 hover:text-red-400 active:scale-95 transition-all duration-100"
              >
                Limpiar
              </button>
            )}
          </div>

          {productos.length === 0 ? (
            <div className="text-center py-12 text-gray-400 text-sm">
              <p className="text-3xl mb-2">📋</p>
              {mode === "foto" ? (
                <>
                  <p>Agrega una foto y presiona</p>
                  <p className="font-medium">✨ Analizar con IA</p>
                </>
              ) : (
                <p>Selecciona productos y toca<br/><strong>+ Agregar a lista</strong></p>
              )}
            </div>
          ) : (
            /* Lista de despacho editable — para foto IA, escáner y manual */
            <div className="space-y-2 max-h-96 overflow-y-auto">
              {productos.map((p, i) => {
                const est = estados[p.nombre] ?? { estado: "pendiente", motivo: "" };
                const bgCls =
                  est.estado === "recibido"    ? "bg-green-50 border-green-300" :
                  est.estado === "no_recibido" ? "bg-red-50 border-red-300"    :
                                                  "bg-[#FFFBE6] border-[#F5C800]/50";
                return (
                  <div key={i}>
                    <div className={`flex items-center gap-2 px-3 py-2.5 rounded-xl border transition-colors duration-200 ${bgCls}`}>
                      {/* Ícono de estado */}
                      <span className="text-base flex-shrink-0 w-5 text-center">
                        {est.estado === "recibido" ? "✅" : est.estado === "no_recibido" ? "❌" : "⏳"}
                      </span>

                      {/* Info del producto */}
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold text-gray-800 truncate">{p.nombre}</p>
                        <div className="flex gap-3 mt-0.5 text-xs text-gray-500">
                          <span>📦 {p.cajas ?? 0} cajas</span>
                          <span>🔢 {p.cantidad ?? 0} uds</span>
                        </div>
                        {est.estado === "no_recibido" && est.motivo && (
                          <p className="text-xs text-red-600 mt-0.5 italic truncate">💬 {est.motivo}</p>
                        )}
                      </div>

                      {/* Acciones */}
                      <div className="flex gap-1 flex-shrink-0 items-center">
                        {/* ✏️ Editar inline */}
                        {est.estado !== "recibido" && (
                          <button
                            onClick={() => {
                              if (editando === p.nombre) { setEditando(null); return; }
                              setMotivoAbierto(null);
                              setEditNombre(p.nombre);
                              setEditCajas(p.cajas ?? 0);
                              setEditUnids(p.cantidad ?? 0);
                              setEditando(p.nombre);
                            }}
                            className={`w-7 h-7 rounded-lg flex items-center justify-center text-sm transition-all active:scale-95 ${
                              editando === p.nombre
                                ? "bg-[#F5C800] text-[#1A1A1A] shadow-sm"
                                : "bg-white border border-[#F5C800]/40 text-[#D42B2B] hover:bg-[#FFFBE6]"
                            }`}
                            title="Editar cantidad y cajas"
                          >✏️</button>
                        )}

                        {/* ✅ Recibido */}
                        <button
                          onClick={() => marcarRecibido(p.nombre)}
                          title="Marcar como despachado"
                          className={`w-7 h-7 rounded-lg flex items-center justify-center font-bold text-sm transition-all active:scale-95 ${
                            est.estado === "recibido"
                              ? "bg-green-500 text-white shadow-sm"
                              : "bg-white border border-green-300 text-green-600 hover:bg-green-50"
                          }`}
                        >✓</button>

                        {/* ❌ No recibido */}
                        <button
                          onClick={() => toggleMotivoInput(p.nombre)}
                          title="Marcar como no recibido"
                          className={`w-7 h-7 rounded-lg flex items-center justify-center font-bold text-sm transition-all active:scale-95 ${
                            est.estado === "no_recibido"
                              ? "bg-red-500 text-white shadow-sm"
                              : "bg-white border border-red-300 text-red-500 hover:bg-red-50"
                          }`}
                        >✕</button>

                        {/* × Eliminar de lista */}
                        <button
                          onClick={() => {
                            setProductos((prev) => prev.filter((_, idx) => idx !== i));
                            setEstados((prev) => { const n = { ...prev }; delete n[p.nombre]; return n; });
                            if (motivoAbierto === p.nombre) setMotivoAbierto(null);
                            if (editando === p.nombre) setEditando(null);
                          }}
                          className="w-7 h-7 rounded-lg flex items-center justify-center border border-red-200 text-red-400 hover:bg-red-50 hover:border-red-400 active:scale-95 transition-all text-base font-bold leading-none"
                          title="Eliminar de la lista"
                        >×</button>
                      </div>
                    </div>

                    {/* Campo de motivo inline */}
                    {motivoAbierto === p.nombre && (
                      <div className="mt-1 mb-1 flex gap-2 pl-8 pr-1">
                        <input
                          type="text"
                          value={motivoTemp}
                          onChange={(e) => setMotivoTemp(e.target.value)}
                          onKeyDown={(e) => e.key === "Enter" && confirmarNoRecibido(p.nombre)}
                          placeholder="Motivo del rechazo (opcional)…"
                          autoFocus
                          className="flex-1 px-3 py-1.5 border border-red-300 rounded-lg text-xs text-gray-700 outline-none focus:ring-2 focus:ring-red-300"
                        />
                        <button
                          onClick={() => confirmarNoRecibido(p.nombre)}
                          className="px-3 py-1.5 bg-red-500 hover:bg-red-600 text-white text-xs rounded-lg font-semibold active:scale-95 transition-all"
                        >
                          Confirmar
                        </button>
                      </div>
                    )}

                    {/* Edición inline de nombre, cajas y unidades */}
                    {editando === p.nombre && (
                      <div className="mt-1 mb-1 pl-8 pr-1 space-y-1.5">
                        <div>
                          <label className="block text-xs text-gray-500 mb-0.5">🏷️ Producto</label>
                          <input
                            type="text"
                            value={editNombre}
                            onChange={(e) => setEditNombre(e.target.value)}
                            onKeyDown={(e) => e.key === "Enter" && confirmarEdicion(p.nombre)}
                            placeholder="Nombre del producto"
                            autoFocus
                            className="w-full px-2 py-1.5 border border-[#F5C800]/50 rounded-lg text-xs text-gray-700 outline-none focus:ring-2 focus:ring-[#F5C800]"
                          />
                        </div>
                        <div className="flex gap-2">
                          <div className="flex-1">
                            <label className="block text-xs text-gray-500 mb-0.5">📦 Cajas</label>
                            <input
                              type="number" min={0}
                              value={editCajas || ""}
                              onChange={(e) => setEditCajas(Math.max(0, Number(e.target.value)))}
                              placeholder="0"
                              className="w-full px-2 py-1.5 border border-[#F5C800]/50 rounded-lg text-xs text-gray-700 outline-none focus:ring-2 focus:ring-[#F5C800] text-center"
                            />
                          </div>
                          <div className="flex-1">
                            <label className="block text-xs text-gray-500 mb-0.5">🔢 Unidades</label>
                            <input
                              type="number" min={0}
                              value={editUnids || ""}
                              onChange={(e) => setEditUnids(Math.max(0, Number(e.target.value)))}
                              onKeyDown={(e) => e.key === "Enter" && confirmarEdicion(p.nombre)}
                              placeholder="0"
                              className="w-full px-2 py-1.5 border border-[#F5C800]/50 rounded-lg text-xs text-gray-700 outline-none focus:ring-2 focus:ring-[#F5C800] text-center"
                            />
                          </div>
                          <button
                            onClick={() => confirmarEdicion(p.nombre)}
                            className="self-end px-3 py-1.5 bg-[#D42B2B] hover:bg-[#b82424] text-white text-xs rounded-lg font-semibold active:scale-95 transition-all whitespace-nowrap"
                          >
                            Guardar
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {/* Observaciones — todos los modos (foto IA, escáner y manual) */}
          {productos.length > 0 && (
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">
                📝 Observaciones — sobrantes y faltantes
              </label>
              <textarea
                value={observaciones}
                onChange={(e) => setObservaciones(e.target.value)}
                placeholder="Ej: 3 cajas de leche sobrantes, falta queso fresco..."
                rows={2}
                className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm text-gray-800
                  focus:ring-2 focus:ring-[#F5C800] outline-none resize-none"
              />
            </div>
          )}

          <button
            type="button"
            onClick={guardar}
            disabled={guardando || productos.length === 0}
            className="w-full py-3 bg-[#D42B2B] hover:bg-[#b82424] active:scale-95 text-white
              rounded-xl font-semibold transition-all duration-100 disabled:opacity-50"
          >
            {guardando ? "Guardando sesión..." : "💾 Guardar sesión de cuarto frío"}
          </button>

          {productos.length > 0 && (
            <WhatsAppPrint getMessage={getWhatsAppMsg} getPrintHtml={getPrintHtml} />
          )}
        </div>
      </div>

      {/* ── Historial de cuarto frío ── */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
        <button
          onClick={() => setHistAbierto((v) => !v)}
          className="w-full flex items-center justify-between px-4 py-3 bg-gray-50 hover:bg-gray-100 transition-colors duration-100"
        >
          <div className="flex items-center gap-2">
            <span className="text-sm font-bold text-gray-700">📋 Historial de cuarto frío</span>
            {historial.length > 0 && (
              <span className="text-xs bg-gray-200 text-gray-600 px-2 py-0.5 rounded-full font-bold">
                {historial.length}
              </span>
            )}
          </div>
          <span className="text-gray-400 text-sm">{histAbierto ? "▲" : "▼"}</span>
        </button>

        {histAbierto && (
          <div className="divide-y divide-gray-50 max-h-[520px] overflow-y-auto">
            {historial.length === 0 ? (
              <p className="text-sm text-gray-400 text-center py-6">Sin registros previos</p>
            ) : historial.map((h) => {
              const ts = h.timestamp && "seconds" in h.timestamp
                ? new Date((h.timestamp as { seconds: number }).seconds * 1000)
                : h.timestamp instanceof Date ? h.timestamp : new Date(0);
              return (
                <div key={h.id} className="px-4 py-3">
                  <div className="flex items-center justify-between mb-2 flex-wrap gap-1">
                    <div>
                      <p className="text-xs font-semibold text-gray-700">
                        {ts.toLocaleDateString("es-DO", { day: "2-digit", month: "2-digit", year: "2-digit" })}
                        {" · "}
                        {ts.toLocaleTimeString("es-DO", { hour: "2-digit", minute: "2-digit" })}
                      </p>
                      <p className="text-xs text-gray-400">{h.despachadorNombre}</p>
                    </div>
                    <span className="text-xs bg-[#FFFBE6] text-[#D42B2B] px-2 py-0.5 rounded-full font-medium">
                      {h.totalUnidades} uds{h.totalCajas ? ` · ${h.totalCajas} caj` : ""}
                    </span>
                  </div>
                  <div className="space-y-1">
                    {h.productos.map((p, i) => {
                      const est = h.estados?.[p.nombre];
                      const estadoLabel =
                        est?.estado === "recibido"    ? "✅ Despachado" :
                        est?.estado === "no_recibido" ? "❌ No despachado" :
                        est?.estado === "pendiente"   ? "⏳ Pendiente" : null;
                      const estadoColor =
                        est?.estado === "recibido"    ? "text-green-600" :
                        est?.estado === "no_recibido" ? "text-red-600"   : "text-gray-400";
                      return (
                        <div key={i} className="flex items-center gap-2 text-xs px-2 py-1.5 bg-gray-50 rounded-lg">
                          <span className="text-gray-700 font-medium flex-1 truncate min-w-0">{p.nombre}</span>
                          <span className="text-gray-400 flex-shrink-0">
                            {p.cajas ? `${p.cajas}caj · ` : ""}{p.cantidad ?? 0}uds
                          </span>
                          {estadoLabel && (
                            <span className={`flex-shrink-0 font-semibold ${estadoColor}`}>
                              {estadoLabel}
                            </span>
                          )}
                          {est?.estado === "no_recibido" && est.motivo && (
                            <span className="text-red-400 italic truncate max-w-[80px] flex-shrink-0" title={est.motivo}>
                              · {est.motivo}
                            </span>
                          )}
                        </div>
                      );
                    })}
                  </div>
                  {h.observaciones && (
                    <p className="mt-1.5 text-xs text-gray-400 italic px-2">📝 {h.observaciones}</p>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
