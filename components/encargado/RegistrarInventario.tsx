"use client";

/**
 * RegistrarInventario — panel para cerrar el inventario diario de un chofer.
 *
 * - Lee movimientos_loker (salida_despacho) del chofer en el día de hoy.
 * - Lee precios desde config/precios.
 * - Si ya existe un inventario guardado (bloqueado), muestra vista de solo lectura.
 * - Si no existe, muestra el formulario de registro.
 * - Guarda en: inventarios/{YYYY-MM-DD}/choferes/{ficha}
 */

import { useState, useEffect, useMemo } from "react";
import {
  collection, query, where, onSnapshot,
  getDoc, doc, setDoc, Timestamp,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useAuth } from "@/lib/auth-context";
import { MovimientoLoker, PrecioProducto, toDate } from "@/lib/types";

// ─── Tipos locales ─────────────────────────────────────────────────────────────

interface ProductoRow {
  producto_id: string;
  nombre:      string;
  despachado:  number;   // cuánto salió del loker para este chofer hoy
  precio:      number;   // RD$ por unidad
  sobrante:    string;   // input del encargado (texto para edición)
}

interface InvGuardado {
  ficha:     string;
  productos: { producto_id: string; nombre: string; c_tiene: number; c_vendio: number; total_rd: number }[];
  totales:   { sobrante: number; vendido: number; total_rd: number };
  guardado_en?: unknown;
  bloqueado?:  boolean;
}

interface Props {
  uid:    string;    // uid del chofer en Firebase
  nombre: string;
  ficha:  string;
  onClose: () => void;
}

function getTodayKey() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function getTodayStart() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

// ─── Componente ───────────────────────────────────────────────────────────────

export default function RegistrarInventario({ uid, nombre, ficha, onClose }: Props) {
  const { profile } = useAuth();

  const [movimientos, setMovimientos] = useState<MovimientoLoker[]>([]);
  const [precios,     setPrecios]     = useState<Record<string, number>>({});
  const [invGuardado, setInvGuardado] = useState<InvGuardado | null>(null);
  const [cargando,    setCargando]    = useState(true);
  const [sobrantes,   setSobrantes]   = useState<Record<string, string>>({});
  const [guardando,   setGuardando]   = useState(false);
  const [msg,         setMsg]         = useState<{ type: "ok" | "err"; text: string } | null>(null);

  const fechaKey   = useMemo(() => getTodayKey(), []);
  const todayStart = useMemo(() => getTodayStart(), []);

  // ── Cargar precios ────────────────────────────────────────────────────────
  useEffect(() => {
    getDoc(doc(db, "config", "precios")).then((snap) => {
      if (!snap.exists()) return;
      const data = snap.data();
      const map: Record<string, number> = {};
      ((data.productos ?? []) as PrecioProducto[]).forEach((p) => {
        map[p.producto_id] = p.precio;
      });
      setPrecios(map);
    });
  }, []);

  // ── Cargar inventario guardado (tiempo real) ──────────────────────────────
  useEffect(() => {
    const invRef = doc(db, "inventarios", fechaKey, "choferes", ficha);
    const unsub = onSnapshot(invRef, (snap) => {
      if (snap.exists()) {
        setInvGuardado({ ficha, ...snap.data() } as InvGuardado);
      } else {
        setInvGuardado(null);
      }
    });
    return unsub;
  }, [fechaKey, ficha]);

  // ── Cargar movimientos del chofer hoy ─────────────────────────────────────
  useEffect(() => {
    const q = query(
      collection(db, "movimientos_loker"),
      where("choferId",  "==", uid),
      where("tipo",      "==", "salida_despacho"),
    );
    const unsub = onSnapshot(q, (snap) => {
      setMovimientos(snap.docs.map((d) => ({ id: d.id, ...d.data() } as MovimientoLoker)));
      setCargando(false);
    });
    return unsub;
  }, [uid]);

  // ── Movimientos de hoy solamente ──────────────────────────────────────────
  const movHoy = useMemo(
    () => movimientos.filter((m) => toDate(m.timestamp) >= todayStart),
    [movimientos, todayStart],
  );

  // ── Totales despachados por producto ──────────────────────────────────────
  const productos = useMemo((): ProductoRow[] => {
    const map = new Map<string, ProductoRow>();
    movHoy.forEach((m) => {
      const prev = map.get(m.producto_id);
      const despachado = Math.abs(m.cantidad);
      if (prev) {
        map.set(m.producto_id, { ...prev, despachado: prev.despachado + despachado });
      } else {
        map.set(m.producto_id, {
          producto_id: m.producto_id,
          nombre:      m.nombre,
          despachado,
          precio:      precios[m.producto_id] ?? 0,
          sobrante:    "",
        });
      }
    });
    return Array.from(map.values()).sort((a, b) => a.nombre.localeCompare(b.nombre));
  }, [movHoy, precios]);

  // ── Calcular totales en tiempo real ──────────────────────────────────────
  const totales = useMemo(() => {
    let totalSobrante = 0;
    let totalVendido  = 0;
    let totalRD       = 0;

    productos.forEach((p) => {
      const sobNum = parseInt(sobrantes[p.producto_id] ?? "", 10);
      const sob    = isNaN(sobNum) ? 0 : Math.max(0, sobNum);
      const vend   = Math.max(0, p.despachado - sob);
      const rd     = vend * p.precio;
      totalSobrante += sob;
      totalVendido  += vend;
      totalRD       += rd;
    });

    return { sobrante: totalSobrante, vendido: totalVendido, total_rd: totalRD };
  }, [productos, sobrantes]);

  // ── Guardar inventario ────────────────────────────────────────────────────
  async function handleGuardar() {
    setGuardando(true);
    setMsg(null);
    try {
      const productosGuardar = productos.map((p) => {
        const sobNum = parseInt(sobrantes[p.producto_id] ?? "", 10);
        const sob    = isNaN(sobNum) ? 0 : Math.max(0, sobNum);
        const vend   = Math.max(0, p.despachado - sob);
        return {
          producto_id: p.producto_id,
          nombre:      p.nombre,
          c_tiene:     sob,
          c_vendio:    vend,
          total_rd:    vend * p.precio,
        };
      });

      const invDoc: Omit<InvGuardado, "ficha"> = {
        productos:   productosGuardar,
        totales,
        guardado_en: Timestamp.now(),
        bloqueado:   true,
      };

      await setDoc(doc(db, "inventarios", fechaKey, "choferes", ficha), invDoc);
      setMsg({ type: "ok", text: "✅ Inventario guardado correctamente." });
    } catch (e) {
      console.error(e);
      setMsg({ type: "err", text: "❌ Error al guardar. Intenta de nuevo." });
    } finally {
      setGuardando(false);
    }
  }

  // ── Render cargando ───────────────────────────────────────────────────────
  if (cargando) {
    return (
      <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-4">
        <div className="bg-white rounded-xl p-8 w-full max-w-lg text-center">
          <p className="text-gray-400 animate-pulse text-sm">Cargando datos del chofer…</p>
        </div>
      </div>
    );
  }

  // ── Vista SOLO LECTURA — inventario ya guardado ───────────────────────────
  if (invGuardado) {
    const tot = invGuardado.totales ?? { sobrante: 0, vendido: 0, total_rd: 0 };
    return (
      <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-4"
           onClick={(e) => e.target === e.currentTarget && onClose()}>
        <div className="bg-white rounded-xl w-full max-w-lg max-h-[90vh] flex flex-col overflow-hidden shadow-2xl">

          {/* Header */}
          <div className="px-4 py-3 bg-[#1E8C3A] flex items-center justify-between flex-shrink-0">
            <div>
              <p className="text-white font-bold text-sm">✅ Inventario guardado</p>
              <p className="text-green-200 text-xs">{nombre} · Ficha #{ficha}</p>
            </div>
            <button onClick={onClose}
              className="text-white/70 hover:text-white text-xl leading-none px-2">×</button>
          </div>

          {/* Banda tricolor */}
          <div className="h-1 flex">
            <div className="flex-1 bg-[#F5C800]" />
            <div className="flex-1 bg-[#D42B2B]" />
            <div className="flex-1 bg-[#1E8C3A]" />
          </div>

          {/* Contenido */}
          <div className="overflow-y-auto flex-1 p-4 space-y-3">

            {/* Tabla de productos */}
            <div className="rounded-xl overflow-hidden border border-gray-100">
              <div className="grid grid-cols-4 bg-gray-50 px-3 py-2 text-xs font-semibold text-gray-500">
                <span className="col-span-2">Producto</span>
                <span className="text-center">Tiene</span>
                <span className="text-center">Vendió</span>
              </div>
              <div className="divide-y divide-gray-50">
                {invGuardado.productos.map((p) => (
                  <div key={p.producto_id} className="grid grid-cols-4 px-3 py-2.5 text-xs items-center">
                    <span className="col-span-2 text-gray-800 truncate font-medium">{p.nombre}</span>
                    <span className="text-center text-gray-600">{p.c_tiene}</span>
                    <span className="text-center font-bold text-[#1E8C3A]">{p.c_vendio}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Totales */}
            <div className="bg-green-50 rounded-xl border border-green-100 p-4 grid grid-cols-3 gap-3 text-center">
              <div>
                <p className="text-xs text-gray-500 mb-0.5">Sobrante</p>
                <p className="text-lg font-bold text-gray-700">{tot.sobrante}</p>
              </div>
              <div>
                <p className="text-xs text-gray-500 mb-0.5">Vendido</p>
                <p className="text-lg font-bold text-[#1E8C3A]">{tot.vendido}</p>
              </div>
              <div>
                <p className="text-xs text-gray-500 mb-0.5">Total RD$</p>
                <p className="text-lg font-bold text-[#1E8C3A]">
                  {tot.total_rd.toLocaleString("es-DO", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </p>
              </div>
            </div>

            {invGuardado.bloqueado && (
              <p className="text-xs text-center text-gray-400 italic">
                🔒 Inventario cerrado — no se puede modificar
              </p>
            )}
          </div>

          <div className="px-4 py-3 border-t border-gray-100 flex-shrink-0">
            <button onClick={onClose}
              className="w-full py-2.5 bg-gray-100 hover:bg-gray-200 active:scale-95 rounded-xl
                text-sm font-semibold text-gray-700 transition-all">
              Cerrar
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ── Vista FORMULARIO de registro ──────────────────────────────────────────
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-4"
         onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="bg-white rounded-xl w-full max-w-lg max-h-[90vh] flex flex-col overflow-hidden shadow-2xl">

        {/* Header */}
        <div className="px-4 py-3 bg-[#1A1A1A] flex items-center justify-between flex-shrink-0">
          <div>
            <p className="text-white font-bold text-sm">📋 Registrar inventario</p>
            <p className="text-gray-400 text-xs">{nombre} · Ficha #{ficha}</p>
          </div>
          <button onClick={onClose}
            className="text-white/70 hover:text-white text-xl leading-none px-2">×</button>
        </div>

        {/* Banda tricolor */}
        <div className="h-1 flex">
          <div className="flex-1 bg-[#F5C800]" />
          <div className="flex-1 bg-[#D42B2B]" />
          <div className="flex-1 bg-[#1E8C3A]" />
        </div>

        {/* Contenido */}
        <div className="overflow-y-auto flex-1 p-4 space-y-3">

          {productos.length === 0 ? (
            <div className="text-center py-12">
              <p className="text-3xl mb-2">🚛</p>
              <p className="text-sm text-gray-500 font-medium">Sin despacho hoy</p>
              <p className="text-xs text-gray-400 mt-1">
                No hay movimientos de salida registrados para este chofer hoy.
              </p>
            </div>
          ) : (
            <>
              {/* Instrucción */}
              <div className="bg-amber-50 border border-amber-100 rounded-xl px-3 py-2.5">
                <p className="text-xs text-amber-700 font-semibold">
                  ⚠️ Ingresa cuántas unidades le quedan en físico al chofer
                </p>
                <p className="text-xs text-amber-600 mt-0.5">
                  El sistema calculará automáticamente cuánto vendió y el monto total.
                </p>
              </div>

              {/* Tabla de productos */}
              <div className="rounded-xl overflow-hidden border border-gray-100">
                <div className="grid grid-cols-12 bg-gray-50 px-3 py-2 text-xs font-semibold text-gray-500">
                  <span className="col-span-4">Producto</span>
                  <span className="col-span-2 text-center">Salió</span>
                  <span className="col-span-3 text-center">Tiene (físico)</span>
                  <span className="col-span-3 text-center">Vendió</span>
                </div>
                <div className="divide-y divide-gray-50">
                  {productos.map((p) => {
                    const sobNum  = parseInt(sobrantes[p.producto_id] ?? "", 10);
                    const sob     = isNaN(sobNum) ? 0 : Math.max(0, sobNum);
                    const vendido = Math.max(0, p.despachado - sob);
                    const hasErr  = !isNaN(sobNum) && sobNum > p.despachado;

                    return (
                      <div key={p.producto_id}
                           className="grid grid-cols-12 px-3 py-2 items-center gap-1">
                        <span className="col-span-4 text-xs text-gray-800 font-medium leading-tight">
                          {p.nombre}
                          {p.precio > 0 && (
                            <span className="block text-gray-400 font-normal">
                              RD${p.precio.toFixed(0)}/u
                            </span>
                          )}
                        </span>

                        <span className="col-span-2 text-center text-sm font-bold text-gray-600">
                          {p.despachado}
                        </span>

                        <div className="col-span-3 flex justify-center">
                          <input
                            type="number"
                            inputMode="numeric"
                            min={0}
                            max={p.despachado}
                            value={sobrantes[p.producto_id] ?? ""}
                            onChange={(e) =>
                              setSobrantes((prev) => ({ ...prev, [p.producto_id]: e.target.value }))
                            }
                            placeholder="0"
                            className={`w-full max-w-[64px] text-center text-sm font-bold border rounded-lg px-1 py-1.5
                              outline-none focus:ring-2 focus:ring-[#F5C800] transition-all ${
                                hasErr
                                  ? "border-red-300 bg-red-50 text-red-600"
                                  : "border-gray-200 bg-white text-gray-800"
                              }`}
                          />
                        </div>

                        <span className={`col-span-3 text-center text-sm font-bold ${
                          vendido > 0 ? "text-[#1E8C3A]" : "text-gray-300"
                        }`}>
                          {vendido}
                          {p.precio > 0 && vendido > 0 && (
                            <span className="block text-xs font-normal text-gray-400">
                              {(vendido * p.precio).toLocaleString("es-DO", { maximumFractionDigits: 0 })}
                            </span>
                          )}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Totales */}
              <div className="bg-gray-50 rounded-xl border border-gray-100 p-4 grid grid-cols-3 gap-3 text-center">
                <div>
                  <p className="text-xs text-gray-500 mb-0.5">Sobrante</p>
                  <p className="text-xl font-bold text-gray-700">{totales.sobrante}</p>
                </div>
                <div>
                  <p className="text-xs text-gray-500 mb-0.5">Vendido</p>
                  <p className="text-xl font-bold text-[#1E8C3A]">{totales.vendido}</p>
                </div>
                <div>
                  <p className="text-xs text-gray-500 mb-0.5">Total RD$</p>
                  <p className="text-lg font-bold text-[#1E8C3A]">
                    {totales.total_rd > 0
                      ? totales.total_rd.toLocaleString("es-DO", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
                      : "—"}
                  </p>
                </div>
              </div>
            </>
          )}

          {msg && (
            <div className={`rounded-xl px-4 py-3 text-sm font-medium text-center ${
              msg.type === "ok"
                ? "bg-green-50 border border-green-200 text-green-700"
                : "bg-red-50 border border-red-200 text-red-700"
            }`}>
              {msg.text}
            </div>
          )}
        </div>

        {/* Footer con botones */}
        {productos.length > 0 && !invGuardado && (
          <div className="px-4 py-3 border-t border-gray-100 flex gap-2 flex-shrink-0">
            <button onClick={onClose}
              className="flex-1 py-2.5 bg-gray-100 hover:bg-gray-200 active:scale-95 rounded-xl
                text-sm font-semibold text-gray-700 transition-all">
              Cancelar
            </button>
            <button
              onClick={handleGuardar}
              disabled={guardando}
              className="flex-2 flex-[2] py-2.5 bg-[#1E8C3A] hover:bg-[#176830] active:scale-95 rounded-xl
                text-sm font-bold text-white transition-all disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {guardando ? "Guardando…" : "💾 Guardar inventario"}
            </button>
          </div>
        )}

        {productos.length === 0 && (
          <div className="px-4 py-3 border-t border-gray-100 flex-shrink-0">
            <button onClick={onClose}
              className="w-full py-2.5 bg-gray-100 hover:bg-gray-200 active:scale-95 rounded-xl
                text-sm font-semibold text-gray-700 transition-all">
              Cerrar
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
