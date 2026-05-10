"use client";

import { useState } from "react";
import { doc, setDoc, addDoc, collection, Timestamp } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useAuth } from "@/lib/auth-context";
import { ProductoItem } from "@/lib/types";
import {
  ImageUploader, ProductTable, ModeToggle, AiButton,
  WhatsAppPrint, ProgressSteps,
} from "./shared";

const STEPS = [
  { label: "Entrada" },
  { label: "Analizar IA" },
  { label: "Revisar" },
  { label: "Observaciones" },
  { label: "Guardar" },
];

export default function CuartoFrio() {
  const { profile } = useAuth();
  const [mode,         setMode]         = useState<"foto" | "manual">("foto");
  const [preview,      setPreview]      = useState<string | null>(null);
  const [imgData,      setImgData]      = useState<{ base64: string; mimeType: string } | null>(null);
  const [texto,        setTexto]        = useState("");
  const [productos,    setProductos]    = useState<ProductoItem[]>([]);
  const [observaciones, setObservaciones] = useState("");
  const [analizando,   setAnalizando]   = useState(false);
  const [guardando,    setGuardando]    = useState(false);
  const [msg,          setMsg]          = useState<{ type: "ok" | "err"; text: string } | null>(null);

  const flash = (type: "ok" | "err", text: string) => {
    setMsg({ type, text });
    setTimeout(() => setMsg(null), 4000);
  };

  const handleFile = (base64: string, mimeType: string, prev: string) => {
    setImgData({ base64, mimeType });
    setPreview(prev);
  };

  // Determinar paso actual
  const canAnalyze = mode === "foto" ? !!imgData : texto.trim().length > 10;
  const currentStep = !canAnalyze ? 0
    : analizando ? 1
    : productos.length === 0 ? 1
    : observaciones !== undefined && productos.length > 0 ? 3
    : 2;

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

  const guardar = async () => {
    if (!profile || productos.length === 0) return;
    setGuardando(true);
    try {
      const totalUnidades = productos.reduce((s, p) => s + (p.cantidad ?? 0), 0);
      const totalPeso     = productos.reduce((s, p) => s + (p.peso ?? 0), 0);

      await setDoc(doc(db, "session", "despacho"), {
        cuartoFrio:        productos,
        totalProductos:    productos.length,
        totalUnidades,
        totalPeso:         totalPeso || null,
        despachadorId:     profile.uid,
        despachadorNombre: profile.nombre,
        despachador:       profile.nombre,
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
        observaciones:     observaciones || null,
        despachadorId:     profile.uid,
        despachadorNombre: profile.nombre,
        timestamp:         Timestamp.now(),
      });

      flash("ok", `Cuarto frío guardado — ${totalUnidades} unidades en ${productos.length} productos`);
    } catch (e) {
      flash("err", e instanceof Error ? e.message : "Error al guardar");
    } finally {
      setGuardando(false);
    }
  };

  const totalUnid = productos.reduce((s, p) => s + (p.cantidad ?? 0), 0);

  const getWhatsAppMsg = () => {
    const lines = [`🥶 *Cuarto Frío — ${profile?.nombre}*`, `📅 ${new Date().toLocaleString("es-MX")}`, ""];
    productos.forEach((p) => lines.push(`• ${p.nombre}: ${p.cantidad} ${p.unidad ?? ""}`));
    lines.push(`\nTotal: ${totalUnid} uds`);
    if (observaciones) lines.push(`\n📝 ${observaciones}`);
    return lines.join("\n");
  };

  return (
    <div className="space-y-4">
      {/* Progreso */}
      <ProgressSteps steps={STEPS} current={currentStep} />

      <div className="grid lg:grid-cols-2 gap-5">
        {/* ── Panel izquierdo: entrada ── */}
        <div className="bg-white rounded-xl shadow-sm p-5 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="font-bold text-blue-700">🥶 Cuarto Frío</h2>
            <ModeToggle mode={mode} onChange={(m) => { setMode(m); setPreview(null); setImgData(null); setTexto(""); }} />
          </div>

          {mode === "foto" ? (
            <ImageUploader
              preview={preview}
              onFile={handleFile}
              onClear={() => { setPreview(null); setImgData(null); }}
            />
          ) : (
            <textarea
              value={texto}
              onChange={(e) => setTexto(e.target.value)}
              placeholder={"Pega o escribe la lista del cuarto frío.\nEjemplo:\n- Leche entera 24 cajas\n- Queso fresco 12 piezas"}
              className="w-full h-48 px-3 py-2 border border-gray-300 rounded-lg text-sm text-gray-800
                focus:ring-2 focus:ring-blue-400 outline-none resize-none"
            />
          )}

          <AiButton onClick={analizar} loading={analizando} disabled={!canAnalyze} />

          {msg && (
            <div className={`text-sm px-3 py-2 rounded-lg ${
              msg.type === "ok"
                ? "bg-green-50 text-green-700 border border-green-200"
                : "bg-red-50 text-red-700 border border-red-200"
            }`}>{msg.text}</div>
          )}
        </div>

        {/* ── Panel derecho: tabla editable + observaciones + guardar ── */}
        <div className="bg-white rounded-xl shadow-sm p-5 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="font-bold text-gray-700">
              Inventario detectado
              {productos.length > 0 && (
                <span className="ml-2 text-sm font-normal text-gray-400">
                  {productos.length} productos · {totalUnid} uds
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
              <p>Agrega una foto o texto y presiona</p>
              <p className="font-medium">✨ Analizar con IA</p>
              <p className="mt-3 text-xs text-gray-300">O agrega productos manualmente</p>
            </div>
          ) : (
            <>
              <ProductTable productos={productos} onChange={setProductos} showPrecio={false} />

              {/* Observaciones — sobrantes y faltantes */}
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
