"use client";

import { useState, useEffect } from "react";
import { collection, addDoc, doc, getDoc, Timestamp } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useAuth } from "@/lib/auth-context";
import { FacturaProveedorLinea, FacturaProveedorTotales, PrecioProducto } from "@/lib/types";
import { ImageUploader, AiButton } from "@/components/despachador/shared";

const TOTALES_VACIOS: TotalesEdit = {
  valorBruto: "0", totalDescuento: "0", subtotalGravado: "0", subtotalExento: "0",
  totalItbis: "0", valorTotal: "0", valorAPagar: "0",
};

// Línea/totales en edición: los campos numéricos se guardan como texto MIENTRAS SE
// EDITA (nunca se fuerza a número en cada tecla) — así el campo no se "traba" en "0"
// ni se come el primer dígito al borrar. Solo se convierte a número al calcular
// (sumaLineas, validación) o al guardar. `uid` es una key estable, independiente
// de la posición en el arreglo, para que React nunca pierda el foco al reordenar.
interface LineaEdit {
  uid:                string;
  codigo:             string;
  descripcion:        string;
  cantidad:           string;
  precioUnitario:     string;
  valorTotalConItbis: string;
}

type TotalesEdit = { [K in keyof FacturaProveedorTotales]: string };

function numVal(s: string): number {
  return parseFloat(s) || 0;
}

const CAMPOS_TOTALES: { key: keyof TotalesEdit; label: string }[] = [
  { key: "valorBruto",      label: "Valor bruto"       },
  { key: "totalDescuento",  label: "Total descuento"   },
  { key: "subtotalGravado", label: "Subtotal gravado"  },
  { key: "subtotalExento",  label: "Subtotal exento"   },
  { key: "totalItbis",      label: "Total ITBIS"       },
  { key: "valorTotal",      label: "Valor total"       },
  { key: "valorAPagar",     label: "Valor a pagar"     },
];

function fmtRD(n: number): string {
  return `RD$ ${n.toLocaleString("es-DO", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

// Fila incompleta = código Y descripción en blanco (aunque tenga cantidad/precio/total)
function lineaIncompleta(l: LineaEdit): boolean {
  return !l.codigo.trim() && !l.descripcion.trim();
}

export default function FacturaProveedor() {
  const { profile } = useAuth();

  // Catálogo (config/precios) — solo para sugerir mientras se escribe la
  // descripción (datalist nativo). No ancla ni bloquea nada todavía — eso
  // es alcance de la mejora #36 (reconocido/vincular/registrar nuevo).
  const [catalogoPrecios, setCatalogoPrecios] = useState<PrecioProducto[]>([]);

  useEffect(() => {
    getDoc(doc(db, "config", "precios")).then((snap) => {
      if (snap.exists()) setCatalogoPrecios((snap.data().productos as PrecioProducto[]) ?? []);
    }).catch(() => { /* sin catálogo → el campo sigue siendo texto libre normal */ });
  }, []);

  const [imgFactura,    setImgFactura]    = useState<{ base64: string; mimeType: string } | null>(null);
  const [preview,       setPreview]       = useState<string | null>(null);
  const [analizando,    setAnalizando]    = useState(false);
  const [guardando,     setGuardando]     = useState(false);
  const [msg,           setMsg]           = useState<{ type: "ok" | "err"; text: string } | null>(null);

  const [proveedor,     setProveedor]     = useState("");
  const [numeroFactura, setNumeroFactura] = useState("");
  const [lineas,        setLineas]        = useState<LineaEdit[]>([]);
  const [totales,       setTotales]       = useState<TotalesEdit>(TOTALES_VACIOS);
  const [guardado,      setGuardado]      = useState<{ numeroFactura?: string; revisarManualmente: boolean } | null>(null);

  const sumaLineas = lineas.reduce((s, l) => s + numVal(l.valorTotalConItbis), 0);
  const diferencia = Math.abs(sumaLineas - numVal(totales.valorTotal));
  const revisarManualmente = lineas.length > 0 && diferencia > 1;
  const hayIncompletas = lineas.some(lineaIncompleta);

  const flash = (type: "ok" | "err", text: string) => {
    setMsg({ type, text });
    setTimeout(() => setMsg(null), 5000);
  };

  async function analizar() {
    if (!imgFactura) return;
    setAnalizando(true);
    setMsg(null);
    try {
      const res = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tipo: "factura_proveedor", imageBase64: imgFactura.base64, mimeType: imgFactura.mimeType }),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      const lin: LineaEdit[] = Array.isArray(data.lineas)
        ? data.lineas.map((l: Record<string, unknown>, i: number) => ({
            uid:                `${Date.now()}-${i}`,
            codigo:             String(l.codigo ?? ""),
            descripcion:        String(l.descripcion ?? ""),
            cantidad:           String(Number(l.cantidad) || 0),
            precioUnitario:     String(Number(l.precioUnitario) || 0),
            valorTotalConItbis: String(Number(l.valorTotalConItbis) || 0),
          }))
        : [];
      if (lin.length === 0) {
        flash("err", "No se detectaron líneas. Intenta con otra foto.");
        return;
      }
      const t = data.totales_factura ?? {};
      setLineas(lin);
      setTotales({
        valorBruto:      String(Number(t.valorBruto) || 0),
        totalDescuento:  String(Number(t.totalDescuento) || 0),
        subtotalGravado: String(Number(t.subtotalGravado) || 0),
        subtotalExento:  String(Number(t.subtotalExento) || 0),
        totalItbis:      String(Number(t.totalItbis) || 0),
        valorTotal:      String(Number(t.valorTotal) || 0),
        valorAPagar:     String(Number(t.valorAPagar) || 0),
      });
      if (data.proveedor && typeof data.proveedor === "string" && !proveedor.trim()) setProveedor(data.proveedor);
      if (data.numeroFactura && typeof data.numeroFactura === "string" && !numeroFactura.trim()) setNumeroFactura(data.numeroFactura);
      setImgFactura(null); setPreview(null);
      flash("ok", `Factura analizada: ${lin.length} línea${lin.length !== 1 ? "s" : ""} leídas.`);
    } catch (e) {
      flash("err", e instanceof Error ? e.message : "Error al analizar la factura.");
    } finally {
      setAnalizando(false);
    }
  }

  // Nunca se coacciona a número aquí — se guarda el texto tal cual se escribe,
  // en cualquier campo (texto o numérico). La conversión a número pasa solo al
  // calcular (sumaLineas/validación) o al guardar.
  function editarLinea(uid: string, campo: keyof LineaEdit, valor: string) {
    setLineas(prev => prev.map(l => l.uid === uid ? { ...l, [campo]: valor } : l));
  }

  function quitarLinea(uid: string) {
    setLineas(prev => prev.filter(l => l.uid !== uid));
  }

  function limpiarTodo() {
    if (lineas.length > 0 && !window.confirm("¿Descartar esta factura sin guardar?")) return;
    setLineas([]); setTotales(TOTALES_VACIOS);
    setProveedor(""); setNumeroFactura(""); setMsg(null); setGuardado(null);
  }

  async function guardar() {
    if (lineas.length === 0) {
      flash("err", "Analiza una factura primero.");
      return;
    }
    if (hayIncompletas) {
      flash("err", "Hay líneas incompletas — completa código/descripción antes de guardar.");
      return;
    }
    setGuardando(true);
    setMsg(null);
    try {
      const lineasNumericas: FacturaProveedorLinea[] = lineas.map((l) => ({
        codigo:             l.codigo,
        descripcion:        l.descripcion,
        cantidad:           numVal(l.cantidad),
        precioUnitario:     numVal(l.precioUnitario),
        valorTotalConItbis: numVal(l.valorTotalConItbis),
      }));
      const totalesNumericos: FacturaProveedorTotales = {
        valorBruto:      numVal(totales.valorBruto),
        totalDescuento:  numVal(totales.totalDescuento),
        subtotalGravado: numVal(totales.subtotalGravado),
        subtotalExento:  numVal(totales.subtotalExento),
        totalItbis:      numVal(totales.totalItbis),
        valorTotal:      numVal(totales.valorTotal),
        valorAPagar:     numVal(totales.valorAPagar),
      };
      await addDoc(collection(db, "facturas_proveedor"), {
        ...(proveedor.trim()     ? { proveedor: proveedor.trim() } : {}),
        ...(numeroFactura.trim() ? { numeroFactura: numeroFactura.trim() } : {}),
        lineas: lineasNumericas,
        totales: totalesNumericos,
        sumaLineas,
        diferencia,
        revisarManualmente,
        registradoPor:   profile?.nombre ?? "Encargado",
        registradoPorId: profile?.uid    ?? "",
        timestamp:       Timestamp.now(),
      });
      setGuardado({ numeroFactura: numeroFactura.trim() || undefined, revisarManualmente });
      setLineas([]); setTotales(TOTALES_VACIOS); setProveedor(""); setNumeroFactura("");
      flash("ok", revisarManualmente ? "Factura guardada — ⚠️ marcada para revisar manualmente." : "Factura guardada correctamente.");
    } catch (e) {
      flash("err", e instanceof Error ? e.message : "Error al guardar la factura.");
    } finally {
      setGuardando(false);
    }
  }

  return (
    <div className="space-y-4 max-w-lg mx-auto">
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
        <div className="px-4 py-3 bg-gradient-to-r from-blue-600 to-blue-800">
          <h2 className="text-white font-bold text-sm">🧾 Recepción de factura de proveedor</h2>
          <p className="text-blue-200 text-xs mt-0.5">Registro fiscal — no afecta el stock del Loker</p>
        </div>

        <div className="p-4 space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">
                Proveedor <span className="text-gray-400 font-normal">(opcional)</span>
              </label>
              <input
                value={proveedor} onChange={(e) => setProveedor(e.target.value)}
                placeholder="Ej. Helados Bon"
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm
                  focus:outline-none focus:ring-2 focus:ring-blue-400"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">
                Nº Factura <span className="text-gray-400 font-normal">(opcional)</span>
              </label>
              <input
                value={numeroFactura} onChange={(e) => setNumeroFactura(e.target.value)}
                placeholder="Ej. B1500012345"
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm
                  focus:outline-none focus:ring-2 focus:ring-blue-400"
              />
            </div>
          </div>

          {lineas.length === 0 && (
            <div className="space-y-3">
              <p className="text-xs text-gray-500">
                Toma o sube una foto de la factura del proveedor. La IA extrae las líneas de
                producto y el resumen de totales por separado.
              </p>
              <ImageUploader
                preview={preview}
                onFile={(b, m, p) => { setImgFactura({ base64: b, mimeType: m }); setPreview(p); }}
                onClear={() => { setImgFactura(null); setPreview(null); }}
              />
              <AiButton onClick={analizar} loading={analizando} disabled={!imgFactura} label="Analizar factura" />
            </div>
          )}

          {lineas.length > 0 && (
            <>
              <div className={`text-sm px-3 py-2 rounded-lg font-medium ${
                revisarManualmente
                  ? "bg-red-50 text-red-700 border border-red-200"
                  : "bg-green-50 text-green-700 border border-green-200"
              }`}>
                {revisarManualmente
                  ? `⚠️ Revisar manualmente — Σ líneas ${fmtRD(sumaLineas)} vs. factura ${fmtRD(numVal(totales.valorTotal))} (dif. ${fmtRD(diferencia)})`
                  : `✓ Los totales cuadran — Σ líneas ${fmtRD(sumaLineas)} = factura ${fmtRD(numVal(totales.valorTotal))}`}
              </div>

              <datalist id="fp-sugerencias-producto">
                {catalogoPrecios.map((p) => (
                  <option key={p.producto_id} value={p.nombre} />
                ))}
              </datalist>

              <div className="space-y-2">
                <p className="text-xs font-semibold text-gray-600">
                  Líneas de la factura ({lineas.length}):
                </p>
                {lineas.map((l) => {
                  const incompleta = lineaIncompleta(l);
                  return (
                    <div key={l.uid}
                      className={incompleta
                        ? "bg-red-50 border-2 border-red-300 rounded-xl px-3 py-2.5"
                        : "bg-gray-50 border border-gray-200 rounded-xl px-3 py-2.5"}
                    >
                      <div className="flex gap-1.5 mb-1.5">
                        <input
                          value={l.codigo} onChange={(e) => editarLinea(l.uid, "codigo", e.target.value)}
                          placeholder="Código"
                          className="w-20 border border-gray-300 rounded-lg px-2 py-1.5 text-sm bg-white"
                        />
                        <input
                          value={l.descripcion} onChange={(e) => editarLinea(l.uid, "descripcion", e.target.value)}
                          placeholder="Descripción"
                          list="fp-sugerencias-producto"
                          className="flex-1 border border-gray-300 rounded-lg px-2 py-1.5 text-sm bg-white"
                        />
                        <button
                          onClick={() => quitarLinea(l.uid)}
                          title="Quitar línea"
                          className="text-red-400 hover:text-red-600 active:scale-95 transition-all
                            text-xl leading-none w-7 flex-shrink-0"
                        >
                          ×
                        </button>
                      </div>
                      {incompleta && (
                        <p className="text-[11px] font-bold text-red-700 mb-1.5">
                          ⚠️ Línea incompleta — completa código/descripción
                        </p>
                      )}
                      <div className="flex flex-wrap items-end gap-1.5">
                        <label className="flex flex-col">
                          <span className="text-[10px] text-gray-400 mb-0.5">cantidad</span>
                          <input
                            type="text" inputMode="decimal" value={l.cantidad}
                            onChange={(e) => editarLinea(l.uid, "cantidad", e.target.value)}
                            onFocus={(e) => e.target.select()}
                            className="w-20 border border-gray-300 rounded-lg px-2 py-1.5 text-sm bg-white"
                          />
                        </label>
                        <label className="flex flex-col">
                          <span className="text-[10px] text-gray-400 mb-0.5">precio unit.</span>
                          <input
                            type="text" inputMode="decimal" value={l.precioUnitario}
                            onChange={(e) => editarLinea(l.uid, "precioUnitario", e.target.value)}
                            onFocus={(e) => e.target.select()}
                            className="w-24 border border-gray-300 rounded-lg px-2 py-1.5 text-sm bg-white"
                          />
                        </label>
                        <label className="flex flex-col">
                          <span className="text-[10px] text-gray-400 mb-0.5">total c/ITBIS</span>
                          <input
                            type="text" inputMode="decimal" value={l.valorTotalConItbis}
                            onChange={(e) => editarLinea(l.uid, "valorTotalConItbis", e.target.value)}
                            onFocus={(e) => e.target.select()}
                            className="w-24 border border-gray-300 rounded-lg px-2 py-1.5 text-sm bg-white"
                          />
                        </label>
                      </div>
                    </div>
                  );
                })}
              </div>

              <div className="bg-gray-50 border border-gray-200 rounded-lg p-3">
                <p className="text-xs font-semibold text-gray-600 mb-2">Resumen de totales</p>
                <div className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-sm">
                  {CAMPOS_TOTALES.map(({ key, label }) => (
                    <label key={key} className="flex items-center justify-between gap-2">
                      <span className="text-xs text-gray-500">{label}</span>
                      <input
                        type="text" inputMode="decimal" value={totales[key]}
                        onChange={(e) => setTotales(prev => ({ ...prev, [key]: e.target.value }))}
                        onFocus={(e) => e.target.select()}
                        className="w-24 border border-gray-300 rounded-lg px-2 py-1 text-sm text-right bg-white"
                      />
                    </label>
                  ))}
                </div>
              </div>
            </>
          )}

          {msg && (
            <div className={`text-sm px-3 py-2 rounded-lg ${
              msg.type === "ok"
                ? "bg-green-50 text-green-700 border border-green-200"
                : "bg-red-50 text-red-600 border border-red-200"
            }`}>
              {msg.text}
            </div>
          )}

          <div className="flex items-center gap-2 bg-gray-50 border border-gray-200 rounded-lg px-3 py-2">
            <span className="text-xs text-gray-400">Registrado por:</span>
            <span className="text-sm font-medium text-gray-700">{profile?.nombre ?? "—"}</span>
          </div>

          {lineas.length > 0 && (
            <>
              <button
                onClick={guardar}
                disabled={guardando || hayIncompletas}
                className="w-full bg-gradient-to-r from-emerald-600 to-emerald-800 hover:from-emerald-500
                  hover:to-emerald-700 text-white font-bold py-3 rounded-xl text-sm transition-all
                  duration-100 active:scale-95 disabled:opacity-60"
              >
                {guardando ? "Guardando…" : hayIncompletas ? "Resuelve las líneas incompletas para guardar" : "💾 Guardar factura"}
              </button>
              <button
                type="button"
                onClick={limpiarTodo}
                disabled={guardando}
                className="w-full py-2.5 rounded-xl border border-gray-200 text-sm text-gray-500
                  hover:bg-gray-50 hover:text-red-600 active:scale-95 transition-all duration-100 disabled:opacity-60"
              >
                Descartar
              </button>
            </>
          )}
        </div>
      </div>

      {guardado && (
        <div className="bg-white rounded-xl shadow-sm border border-emerald-200 overflow-hidden">
          <div className="px-4 py-3 bg-emerald-50 border-b border-emerald-100 flex items-center gap-3">
            <span className="text-2xl">✅</span>
            <div>
              <p className="font-bold text-emerald-800">
                Factura{guardado.numeroFactura ? ` ${guardado.numeroFactura}` : ""} registrada
              </p>
              <p className="text-xs text-emerald-600">
                {guardado.revisarManualmente ? "⚠️ Marcada para revisar manualmente" : "Totales cuadraron correctamente"}
              </p>
            </div>
          </div>
          <div className="p-4">
            <button
              onClick={() => setGuardado(null)}
              className="w-full py-2.5 rounded-xl border border-gray-200 text-sm text-gray-600
                hover:bg-gray-50 active:scale-95 transition-all duration-100"
            >
              Registrar otra factura
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
