"use client";

/**
 * ScannerBar — Barra de escáner HID para Despachador
 *
 * Muestra el estado del escáner, el último producto detectado,
 * un campo para la cantidad de cajas/unidades, y el botón "Agregar".
 * Si el código no existe en Firestore → modal "Nombrar código".
 */

import { useState, useCallback } from "react";
import { useSpikinScanner, ProductoEscaneado } from "@/lib/useSpikinScanner";
import { useAuth } from "@/lib/auth-context";

interface ScannerBarProps {
  /** Callback para agregar el producto al listado del componente padre */
  onAgregar: (nombre: string, cajas: number, unidades: number) => void;
  /** Texto del botón agregar (opcional) */
  labelAgregar?: string;
}

interface ModalNombrarProps {
  codigo: string;
  onGuardar: (nombre: string, unidsPorCaja: number, pesoKg: number | null) => void;
  onCancelar: () => void;
}

function ModalNombrar({ codigo, onGuardar, onCancelar }: ModalNombrarProps) {
  const [nombre, setNombre] = useState("");
  const [unids,  setUnids]  = useState(24);
  const [peso,   setPeso]   = useState("");
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    if (!nombre.trim()) return;
    setSaving(true);
    try {
      await onGuardar(nombre.trim(), unids, peso ? parseFloat(peso) : null);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[9998] flex items-center justify-center bg-black/50 p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6 space-y-4">
        <div>
          <p className="text-xs text-gray-400 mb-0.5">Código escaneado</p>
          <p className="font-mono font-bold text-gray-800 text-lg tracking-widest">{codigo}</p>
        </div>
        <p className="text-sm font-semibold text-gray-700">
          Código no encontrado. ¿Cómo se llama este producto?
        </p>
        <div className="space-y-3">
          <div>
            <label className="text-xs font-medium text-gray-500 mb-1 block">Nombre del producto *</label>
            <input
              autoFocus
              value={nombre}
              onChange={(e) => setNombre(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && submit()}
              placeholder="Ej. Paleta Chocolate 90ml"
              className="w-full px-3 py-2.5 border border-gray-300 rounded-xl text-sm
                text-gray-800 outline-none focus:ring-2 focus:ring-[#F5C800]"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium text-gray-500 mb-1 block">Unidades / caja</label>
              <input
                type="number" min={1} value={unids}
                onChange={(e) => setUnids(parseInt(e.target.value) || 1)}
                className="w-full px-3 py-2 border border-gray-300 rounded-xl text-sm
                  text-gray-800 outline-none focus:ring-2 focus:ring-[#F5C800]"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-gray-500 mb-1 block">Peso / caja (kg)</label>
              <input
                type="number" step="0.1" value={peso}
                onChange={(e) => setPeso(e.target.value)}
                placeholder="Opcional"
                className="w-full px-3 py-2 border border-gray-300 rounded-xl text-sm
                  text-gray-800 outline-none focus:ring-2 focus:ring-[#F5C800]"
              />
            </div>
          </div>
        </div>
        <div className="flex gap-2 pt-1">
          <button onClick={onCancelar}
            className="flex-1 py-2.5 rounded-xl border border-gray-200 text-sm text-gray-600
              hover:bg-gray-50 transition">
            Cancelar
          </button>
          <button onClick={submit} disabled={!nombre.trim() || saving}
            className="flex-1 py-2.5 rounded-xl bg-[#F5C800] text-[#1A1A1A] text-sm font-bold
              hover:brightness-95 active:scale-95 transition-all disabled:opacity-50">
            {saving ? "Guardando…" : "💾 Guardar"}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function ScannerBar({ onAgregar, labelAgregar = "Agregar" }: ScannerBarProps) {
  const { profile } = useAuth();
  const [ultimo,    setUltimo]    = useState<ProductoEscaneado | null>(null);
  const [cajas,     setCajas]     = useState(1);
  const [unidades,  setUnidades]  = useState(0);
  const [codDesc,   setCodDesc]   = useState<string | null>(null);
  const [addedMsg,  setAddedMsg]  = useState<string | null>(null);

  const handleProducto = useCallback((p: ProductoEscaneado) => {
    setUltimo(p);
    setCajas(1);
    setUnidades(0);
  }, []);

  const handleDesconocido = useCallback((codigo: string) => {
    setCodDesc(codigo);
  }, []);

  const { inputRef, handleKeyDown, handleChange, buscando, focused, setFocused, refocus, guardarCodigo } =
    useSpikinScanner({ onProducto: handleProducto, onCodigoDesconocido: handleDesconocido });

  const agregar = () => {
    if (!ultimo) return;
    const unidsTotal = cajas * ultimo.unidadesPorCaja + unidades;
    onAgregar(ultimo.producto, cajas, unidsTotal);
    const msg = `✅ ${ultimo.producto} — ${cajas} caj · ${unidsTotal} uds`;
    setAddedMsg(msg);
    setTimeout(() => setAddedMsg(null), 3000);
    setUltimo(null);
    setCajas(1);
    setUnidades(0);
    setTimeout(() => refocus(), 50);
  };

  const handleGuardar = async (nombre: string, unidsPorCaja: number, pesoKg: number | null) => {
    if (!codDesc) return;
    await guardarCodigo(codDesc, nombre, unidsPorCaja, pesoKg, profile?.nombre ?? "Sistema");
    setCodDesc(null);
    setTimeout(() => refocus(), 50);
  };

  return (
    <>
      {/* ── Modal Nombrar código ── */}
      {codDesc && (
        <ModalNombrar
          codigo={codDesc}
          onGuardar={handleGuardar}
          onCancelar={() => { setCodDesc(null); setTimeout(() => refocus(), 50); }}
        />
      )}

      <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4 space-y-3">
        {/* ── Header ── */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-lg">🔲</span>
            <span className="font-bold text-[#1A1A1A] text-sm">Escáner HID</span>
            <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
              buscando  ? "bg-yellow-100 text-yellow-700" :
              focused   ? "bg-green-100 text-green-700" :
              "bg-gray-100 text-gray-500"
            }`}>
              {buscando ? "Buscando…" : focused ? "Listo ●" : "Sin foco"}
            </span>
          </div>
          {!focused && (
            <button onClick={refocus}
              className="text-xs px-3 py-1.5 rounded-lg bg-[#F5C800] text-[#1A1A1A] font-semibold
                hover:brightness-95 active:scale-95 transition-all">
              Activar escáner
            </button>
          )}
        </div>

        {/* ── Input oculto que captura el escáner ── */}
        <input
          ref={inputRef}
          autoFocus
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          onKeyDown={handleKeyDown}
          onChange={handleChange}
          className="opacity-0 absolute w-0 h-0 pointer-events-none"
          tabIndex={-1}
          aria-label="Escáner HID"
        />

        {/* ── Último producto escaneado ── */}
        {ultimo ? (
          <div className="bg-[#F5C800]/10 border-2 border-[#F5C800] rounded-xl p-3 space-y-3">
            <div>
              <p className="text-xs text-gray-500">Producto detectado</p>
              <p className="font-bold text-[#1A1A1A] text-base leading-tight">{ultimo.producto}</p>
              <p className="text-xs text-gray-400 font-mono">{ultimo.codigo} · {ultimo.unidadesPorCaja} uds/caja</p>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-xs font-medium text-gray-500 block mb-1">Cajas</label>
                <div className="flex items-center gap-1.5">
                  <button onClick={() => setCajas(Math.max(0, cajas - 1))}
                    className="w-8 h-8 rounded-lg bg-gray-100 font-bold text-gray-600 hover:bg-gray-200 transition text-lg leading-none">
                    −
                  </button>
                  <input
                    type="number" min={0} value={cajas}
                    onChange={(e) => setCajas(Math.max(0, parseInt(e.target.value) || 0))}
                    className="flex-1 text-center border border-gray-200 rounded-lg py-1.5 text-sm
                      font-bold text-gray-800 outline-none focus:ring-2 focus:ring-[#F5C800]"
                  />
                  <button onClick={() => setCajas(cajas + 1)}
                    className="w-8 h-8 rounded-lg bg-gray-100 font-bold text-gray-600 hover:bg-gray-200 transition text-lg leading-none">
                    +
                  </button>
                </div>
              </div>
              <div>
                <label className="text-xs font-medium text-gray-500 block mb-1">
                  Unidades sueltas
                </label>
                <div className="flex items-center gap-1.5">
                  <button onClick={() => setUnidades(Math.max(0, unidades - 1))}
                    className="w-8 h-8 rounded-lg bg-gray-100 font-bold text-gray-600 hover:bg-gray-200 transition text-lg leading-none">
                    −
                  </button>
                  <input
                    type="number" min={0} value={unidades}
                    onChange={(e) => setUnidades(Math.max(0, parseInt(e.target.value) || 0))}
                    className="flex-1 text-center border border-gray-200 rounded-lg py-1.5 text-sm
                      font-bold text-gray-800 outline-none focus:ring-2 focus:ring-[#F5C800]"
                  />
                  <button onClick={() => setUnidades(unidades + 1)}
                    className="w-8 h-8 rounded-lg bg-gray-100 font-bold text-gray-600 hover:bg-gray-200 transition text-lg leading-none">
                    +
                  </button>
                </div>
              </div>
            </div>
            <div className="flex items-center justify-between">
              <p className="text-xs text-gray-500">
                Total: <span className="font-bold text-gray-800">
                  {cajas * ultimo.unidadesPorCaja + unidades} uds
                </span>
              </p>
              <div className="flex gap-2">
                <button onClick={() => setUltimo(null)}
                  className="px-3 py-1.5 rounded-lg border border-gray-200 text-xs text-gray-500
                    hover:bg-gray-50 transition">
                  Cancelar
                </button>
                <button onClick={agregar}
                  className="px-4 py-1.5 rounded-lg bg-[#1E8C3A] text-white text-xs font-bold
                    hover:bg-green-700 active:scale-95 transition-all">
                  {labelAgregar} ➕
                </button>
              </div>
            </div>
          </div>
        ) : (
          <p className="text-sm text-gray-400 text-center py-2">
            {buscando
              ? "🔄 Consultando base de códigos…"
              : focused
              ? "⚡ Apunta el escáner y presiona el gatillo"
              : "Toca «Activar escáner» y apunta el lector"}
          </p>
        )}

        {/* ── Flash: producto añadido ── */}
        {addedMsg && (
          <div className="text-xs text-green-700 font-medium bg-green-50 rounded-lg px-3 py-2 text-center animate-pulse">
            {addedMsg}
          </div>
        )}
      </div>
    </>
  );
}
