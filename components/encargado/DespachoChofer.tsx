"use client";

/**
 * DespachoChofer — Modal de despacho directo Encargado → chofer (Mejora #7)
 *
 * El Encargado entrega mercancía a un chofer directamente desde el loker.
 * Escribe en movimientos_loker un `salida_despacho` por producto con
 * choferId/choferNombre (igual que el Despachador) y cantidad NEGATIVA →
 * descuenta del stock y queda atribuido al chofer (aparece en su vista).
 */

import { useState, useEffect, useMemo } from "react";
import { collection, query, orderBy, onSnapshot, addDoc, Timestamp } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useAuth } from "@/lib/auth-context";
import { MovimientoLoker } from "@/lib/types";

type PickItem = { pid: string; nombre: string; cantidad: number };
type SaldoItem = { pid: string; nombre: string; saldo: number };

interface Props {
  uid: string;
  nombre: string;
  ficha?: string;
  onClose: () => void;
}

export default function DespachoChofer({ uid, nombre, ficha, onClose }: Props) {
  const { profile } = useAuth();

  const [movs,    setMovs]    = useState<MovimientoLoker[]>([]);
  const [cargado, setCargado] = useState(false);
  const [error,   setError]   = useState<string | null>(null);

  const [items,     setItems]     = useState<PickItem[]>([]);
  const [sel,       setSel]       = useState("");
  const [qty,       setQty]       = useState("");
  const [guardando, setGuardando] = useState(false);
  const [msg,       setMsg]       = useState<{ type: "ok" | "err"; text: string } | null>(null);

  useEffect(() => {
    const unsub = onSnapshot(
      query(collection(db, "movimientos_loker"), orderBy("timestamp", "desc")),
      (snap) => {
        setMovs(snap.docs.map((d) => ({ id: d.id, ...d.data() } as MovimientoLoker)));
        setError(null);
        setCargado(true);
      },
      (err) => {
        setError(
          err?.code === "permission-denied"
            ? "No se pudo leer el stock: sin permiso sobre movimientos_loker."
            : "No se pudo leer el stock del loker."
        );
        setCargado(true);
      }
    );
    return unsub;
  }, []);

  const saldo = useMemo<SaldoItem[]>(() => {
    const map = new Map<string, { nombre: string; saldo: number }>();
    for (const m of movs) {
      const prev = map.get(m.producto_id) ?? { nombre: m.nombre, saldo: 0 };
      map.set(m.producto_id, { nombre: m.nombre, saldo: prev.saldo + m.cantidad });
    }
    return Array.from(map.entries())
      .map(([pid, d]) => ({ pid, ...d }))
      .filter((p) => p.saldo > 0)
      .sort((a, b) => a.nombre.localeCompare(b.nombre, "es"));
  }, [movs]);

  const saldoMap = useMemo(
    () => Object.fromEntries(saldo.map((p) => [p.pid, p])) as Record<string, SaldoItem>,
    [saldo],
  );
  const totalUds  = useMemo(() => items.reduce((s, i) => s + i.cantidad, 0), [items]);
  const hayExceso = items.some((i) => i.cantidad > (saldoMap[i.pid]?.saldo ?? 0));

  function agregar() {
    const prod = saldoMap[sel];
    const n = Number(qty);
    if (!prod || !n || n <= 0) return;
    setItems((prev) => {
      const idx = prev.findIndex((i) => i.pid === sel);
      if (idx >= 0) {
        const copy = [...prev];
        copy[idx] = { ...copy[idx], cantidad: copy[idx].cantidad + n };
        return copy;
      }
      return [...prev, { pid: sel, nombre: prod.nombre, cantidad: n }];
    });
    setSel("");
    setQty("");
    setMsg(null);
  }

  function quitar(pid: string) {
    setItems((prev) => prev.filter((i) => i.pid !== pid));
  }

  function setCantidad(pid: string, n: number) {
    setItems((prev) => prev.map((i) => (i.pid === pid ? { ...i, cantidad: Math.max(0, n) } : i)));
  }

  async function despachar() {
    if (items.length === 0 || guardando) return;
    setGuardando(true);
    setMsg(null);
    try {
      const resp = profile?.nombre ?? "Encargado";
      const ts   = Timestamp.now();
      const nota = `Despacho directo (Encargado) → ${nombre}${ficha ? ` · ficha ${ficha}` : ""}`;
      await Promise.all(
        items.map((it) =>
          addDoc(collection(db, "movimientos_loker"), {
            tipo:         "salida_despacho",
            producto_id:  it.pid,
            nombre:       it.nombre,
            cantidad:     -Math.abs(it.cantidad),
            responsable:  resp,
            responsableId: profile?.uid ?? "",
            choferId:     uid,
            choferNombre: nombre,
            timestamp:    ts,
            notas:        nota,
          })
        )
      );
      setMsg({
        type: "ok",
        text: `Despacho registrado — ${totalUds} uds a ${nombre.split(" ")[0]}.`,
      });
      setItems([]);
    } catch (e) {
      setMsg({ type: "err", text: e instanceof Error ? e.message : "Error al despachar." });
    } finally {
      setGuardando(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-4"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="bg-white rounded-xl w-full max-w-lg max-h-[90vh] flex flex-col overflow-hidden shadow-2xl">
        {/* Header */}
        <div className="px-4 py-3 bg-[#1A1A1A] flex items-center justify-between gap-3 flex-shrink-0">
          <div className="min-w-0">
            <h2 className="text-white font-bold text-sm flex items-center gap-1.5">🚚 Despachar a {nombre.split(" ").slice(0, 2).join(" ")}</h2>
            <p className="text-gray-400 text-xs mt-0.5">{ficha ? `Ficha #${ficha} · ` : ""}descuenta del stock del loker</p>
          </div>
          <button
            onClick={onClose}
            className="flex-shrink-0 w-8 h-8 rounded-lg bg-white/10 hover:bg-white/20 text-white
              flex items-center justify-center transition-colors"
          >
            ✕
          </button>
        </div>
        {/* Banda tricolor */}
        <div className="h-[3px] flex flex-shrink-0">
          <div className="flex-1 bg-[#F5C800]" />
          <div className="flex-1 bg-[#D42B2B]" />
          <div className="flex-1 bg-[#1E8C3A]" />
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {!cargado ? (
            <p className="text-sm text-gray-400 animate-pulse text-center py-8">Cargando stock…</p>
          ) : error ? (
            <div className="text-center py-8">
              <p className="text-3xl mb-2">⚠️</p>
              <p className="text-sm font-semibold text-red-600">{error}</p>
            </div>
          ) : saldo.length === 0 ? (
            <div className="text-center py-8">
              <p className="text-3xl mb-2">📦</p>
              <p className="text-sm font-semibold text-gray-600">Sin stock disponible para despachar</p>
            </div>
          ) : (
            <>
              {/* Selector producto + cantidad */}
              <div className="flex flex-wrap items-end gap-2">
                <label className="flex-1 min-w-[150px]">
                  <span className="block text-xs font-semibold text-gray-500 mb-1">Producto</span>
                  <select
                    value={sel}
                    onChange={(e) => setSel(e.target.value)}
                    className="w-full border border-gray-200 rounded-lg px-2 py-2 text-sm text-gray-800
                      bg-white focus:outline-none focus:ring-2 focus:ring-[#1E8C3A]/30"
                  >
                    <option value="">Elegir…</option>
                    {saldo.map((p) => (
                      <option key={p.pid} value={p.pid}>{p.nombre} (disp. {p.saldo})</option>
                    ))}
                  </select>
                </label>
                <label className="w-20">
                  <span className="block text-xs font-semibold text-gray-500 mb-1">Cant.</span>
                  <input
                    type="number"
                    min={1}
                    value={qty}
                    onChange={(e) => setQty(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") agregar(); }}
                    placeholder="0"
                    className="w-full border border-gray-200 rounded-lg px-2 py-2 text-sm text-gray-800
                      focus:outline-none focus:ring-2 focus:ring-[#1E8C3A]/30"
                  />
                </label>
                <button
                  type="button"
                  onClick={agregar}
                  disabled={!sel || !qty || Number(qty) <= 0}
                  className="px-3 py-2 rounded-lg text-sm font-bold bg-[#1A1A1A] text-white
                    hover:brightness-110 active:scale-95 transition-all disabled:opacity-40"
                >
                  + Agregar
                </button>
              </div>

              {/* Lista */}
              {items.length === 0 ? (
                <div className="text-center py-6 border border-dashed border-gray-200 rounded-xl">
                  <p className="text-2xl mb-1">🚚</p>
                  <p className="text-xs text-gray-400">Agrega productos para despachar a este chofer.</p>
                </div>
              ) : (
                <div className="divide-y divide-gray-100 border border-gray-100 rounded-xl overflow-hidden">
                  {items.map((it) => {
                    const disp   = saldoMap[it.pid]?.saldo ?? 0;
                    const exceso = it.cantidad > disp;
                    return (
                      <div key={it.pid} className="flex items-center gap-2 px-3 py-2.5">
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-gray-800 truncate">{it.nombre}</p>
                          <p className={`text-[11px] ${exceso ? "text-red-500 font-semibold" : "text-gray-400"}`}>
                            Disponible: {disp}{exceso ? " — excede el stock (negativo)" : ""}
                          </p>
                        </div>
                        <input
                          type="number"
                          min={0}
                          value={it.cantidad}
                          onChange={(e) => setCantidad(it.pid, Number(e.target.value))}
                          className={`w-16 text-center border rounded-lg px-1 py-1 text-sm font-bold tabular-nums
                            focus:outline-none focus:ring-2 ${
                              exceso ? "border-red-300 text-red-600 focus:ring-red-200"
                                     : "border-gray-200 text-gray-800 focus:ring-[#1E8C3A]/30"
                            }`}
                        />
                        <button
                          type="button"
                          onClick={() => quitar(it.pid)}
                          title="Quitar"
                          className="w-8 h-8 flex items-center justify-center rounded-lg text-gray-400
                            hover:bg-red-50 hover:text-red-500 transition-colors"
                        >
                          ✕
                        </button>
                      </div>
                    );
                  })}
                  <div className="flex items-center justify-between px-3 py-2 bg-gray-50">
                    <span className="text-xs font-semibold text-gray-500">Total a despachar</span>
                    <span className="text-sm font-black text-[#1A1A1A] tabular-nums">{totalUds} uds</span>
                  </div>
                </div>
              )}

              {msg && (
                <div className={`rounded-xl px-4 py-3 text-sm font-semibold ${
                  msg.type === "ok" ? "bg-[#1E8C3A]/10 text-[#1E8C3A]" : "bg-red-50 text-red-600"
                }`}>
                  {msg.type === "ok" ? "✅ " : "❌ "}{msg.text}
                </div>
              )}

              {hayExceso && items.length > 0 && (
                <p className="text-[11px] text-red-500 font-semibold text-center">
                  ⚠ Hay productos que exceden el stock — quedarán en negativo (alarma roja).
                </p>
              )}
            </>
          )}
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-gray-100 flex items-center gap-2 flex-shrink-0">
          <button
            onClick={onClose}
            className="px-4 py-2.5 rounded-xl text-sm font-bold bg-gray-100 text-gray-600
              hover:bg-gray-200 active:scale-95 transition-all"
          >
            Cerrar
          </button>
          <button
            onClick={despachar}
            disabled={guardando || items.length === 0}
            className="flex-1 py-2.5 rounded-xl text-sm font-bold bg-[#1E8C3A] text-white
              hover:brightness-110 active:scale-95 transition-all disabled:opacity-50
              flex items-center justify-center gap-2"
          >
            {guardando ? (
              <>
                <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                Despachando…
              </>
            ) : (
              <>🚚 Despachar {totalUds > 0 ? `${totalUds} uds` : ""}</>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
