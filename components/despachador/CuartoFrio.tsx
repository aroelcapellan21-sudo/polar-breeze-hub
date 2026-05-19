"use client";

import { useState, useEffect } from "react";
import { doc, setDoc, addDoc, collection, Timestamp, getDoc } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useAuth } from "@/lib/auth-context";
import { ProductoItem, PuntoProducto } from "@/lib/types";
import { pbHeader, pbFooter } from "@/lib/wa-format";
import {
  ImageUploader, ProductTable, ModeToggle, AiButton,
  WhatsAppPrint, ProgressSteps,
} from "./shared";

interface Props {
  despachadorActivo?: string;
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
        fecha:             Timestamp.now(),
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
        timestamp:         Timestamp.now(),
      });

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

  const resetMode = (m: "foto" | "manual") => {
    setMode(m);
    setPreview(null); setImgData(null); setTexto("");
    setProductos([]); setObservaciones("");
    setManualCajas(0); setManualUnids(0);
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
          <div className="flex items-center justify-between">
            <h2 className="font-bold text-blue-700">🥶 Cuarto Frío</h2>
            <ModeToggle mode={mode} onChange={resetMode} />
          </div>

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
                      className="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm text-gray-800 outline-none focus:ring-2 focus:ring-blue-400 bg-white"
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
                        className="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm text-gray-800 outline-none focus:ring-2 focus:ring-blue-400 text-center"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-600 mb-1">🔢 Unidades</label>
                      <input
                        type="number" min={0}
                        value={manualUnids || ""}
                        onChange={(e) => setManualUnids(Math.max(0, Number(e.target.value)))}
                        placeholder="0"
                        className="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm text-gray-800 outline-none focus:ring-2 focus:ring-blue-400 text-center"
                      />
                    </div>
                  </div>

                  <button
                    onClick={addManual}
                    disabled={!manualProd || (manualCajas === 0 && manualUnids === 0)}
                    className="w-full py-2.5 bg-blue-600 hover:bg-blue-700 active:scale-95 text-white rounded-lg text-sm font-semibold transition-all duration-100 disabled:opacity-50"
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
                onClick={() => setProductos([])}
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
          ) : mode === "manual" ? (
            /* Vista especial para modo manual: cajas + unidades separados */
            <div className="space-y-2 max-h-72 overflow-y-auto">
              {productos.map((p, i) => (
                <div key={i} className="flex items-center gap-2 px-3 py-2.5 bg-blue-50 rounded-xl border border-blue-100">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-gray-800 truncate">{p.nombre}</p>
                    <div className="flex gap-3 mt-0.5 text-xs text-gray-500">
                      <span>📦 {p.cajas ?? 0} cajas</span>
                      <span>🔢 {p.cantidad ?? 0} uds</span>
                    </div>
                  </div>
                  <div className="flex gap-2 flex-shrink-0">
                    {/* Quick edit inline */}
                    <button
                      onClick={() => {
                        setManualProd(p.nombre);
                        setProductos((prev) => prev.filter((_, idx) => idx !== i));
                        setManualCajas(p.cajas ?? 0);
                        setManualUnids(p.cantidad ?? 0);
                      }}
                      className="text-xs text-blue-500 hover:text-blue-700 active:scale-95 transition-all px-1"
                    >✏️</button>
                    <button
                      onClick={() => setProductos((prev) => prev.filter((_, idx) => idx !== i))}
                      className="text-gray-300 hover:text-red-400 active:scale-95 transition-all text-lg leading-none"
                    >×</button>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <>
              <ProductTable productos={productos} onChange={setProductos} showPrecio={false} />
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
                    focus:ring-2 focus:ring-blue-400 outline-none resize-none"
                />
              </div>
            </>
          )}

          {/* Observaciones para modo manual también */}
          {mode === "manual" && productos.length > 0 && (
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">
                📝 Observaciones
              </label>
              <textarea
                value={observaciones}
                onChange={(e) => setObservaciones(e.target.value)}
                placeholder="Ej: 3 cajas sobrantes de leche..."
                rows={2}
                className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm text-gray-800
                  focus:ring-2 focus:ring-blue-400 outline-none resize-none"
              />
            </div>
          )}

          <button
            type="button"
            onClick={guardar}
            disabled={guardando || productos.length === 0}
            className="w-full py-3 bg-blue-600 hover:bg-blue-700 active:scale-95 text-white
              rounded-xl font-semibold transition-all duration-100 disabled:opacity-50"
          >
            {guardando ? "Guardando sesión..." : "💾 Guardar sesión de cuarto frío"}
          </button>

          {productos.length > 0 && (
            <WhatsAppPrint getMessage={getWhatsAppMsg} />
          )}
        </div>
      </div>
    </div>
  );
}
