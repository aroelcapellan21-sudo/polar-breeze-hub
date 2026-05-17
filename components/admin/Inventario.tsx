"use client";

import { useState, useEffect, useMemo } from "react";
import {
  collection, query, orderBy, onSnapshot, addDoc, Timestamp,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useAuth } from "@/lib/auth-context";
import { MovimientoLoker, toDate, fmtDate, toProductoId } from "@/lib/types";

// ─── Config de tipos ──────────────────────────────────────────────────────────

const TIPO_CFG = {
  entrada_interior:  { label: "Entrada interior",   sign:  1, bg: "bg-green-100",  text: "text-green-700",  border: "border-green-200"  },
  devolucion_chofer: { label: "Devolución chofer",  sign:  1, bg: "bg-blue-100",   text: "text-blue-700",   border: "border-blue-200"   },
  salida_despacho:   { label: "Salida despacho",    sign: -1, bg: "bg-orange-100", text: "text-orange-700", border: "border-orange-200" },
  merma:             { label: "Merma",              sign: -1, bg: "bg-red-100",    text: "text-red-700",    border: "border-red-200"    },
  ajuste:            { label: "Ajuste",             sign:  0, bg: "bg-gray-100",   text: "text-gray-700",   border: "border-gray-200"   },
} as const;

type TipoLoker = MovimientoLoker["tipo"];

const TIPOS_ORDEN: TipoLoker[] = [
  "entrada_interior", "devolucion_chofer", "salida_despacho", "merma", "ajuste",
];

// ─── Component ────────────────────────────────────────────────────────────────

export default function Inventario() {
  const { profile } = useAuth();

  const [movimientos, setMovimientos] = useState<MovimientoLoker[]>([]);
  const [cargando, setCargando]       = useState(true);

  // Form state
  const [tipo,      setTipo]      = useState<TipoLoker>("entrada_interior");
  const [nombre,    setNombre]    = useState("");
  const [cantidad,  setCantidad]  = useState("");
  const [ajustePos, setAjustePos] = useState(true);   // solo para tipo ajuste
  const [notas,     setNotas]     = useState("");
  const [guardando, setGuardando] = useState(false);
  const [msg, setMsg]             = useState<{ type: "ok" | "err"; text: string } | null>(null);

  const [saldoAbierto, setSaldoAbierto] = useState(true);

  // ── Listener tiempo real ────────────────────────────────────────────────────
  useEffect(() => {
    const q = query(
      collection(db, "movimientos_loker"),
      orderBy("timestamp", "desc"),
    );
    const unsub = onSnapshot(q, (snap) => {
      setMovimientos(
        snap.docs.map((d) => ({ id: d.id, ...d.data() } as MovimientoLoker))
      );
      setCargando(false);
    });
    return unsub;
  }, []);

  // ── Saldo actual por producto ───────────────────────────────────────────────
  const saldos = useMemo(() => {
    const map = new Map<string, { nombre: string; saldo: number }>();
    for (const m of movimientos) {
      const prev = map.get(m.producto_id) ?? { nombre: m.nombre, saldo: 0 };
      map.set(m.producto_id, { nombre: m.nombre, saldo: prev.saldo + m.cantidad });
    }
    return Array.from(map.values()).sort((a, b) => b.saldo - a.saldo);
  }, [movimientos]);

  // ── Guardar movimiento ──────────────────────────────────────────────────────
  async function handleGuardar(e: React.FormEvent) {
    e.preventDefault();
    const qty = parseFloat(cantidad);
    if (!nombre.trim() || isNaN(qty) || qty <= 0) {
      setMsg({ type: "err", text: "Completa producto y cantidad (> 0)." });
      return;
    }

    setGuardando(true);
    setMsg(null);

    const cfg   = TIPO_CFG[tipo];
    const sign  = cfg.sign !== 0 ? cfg.sign : (ajustePos ? 1 : -1);
    const mov: Omit<MovimientoLoker, "id"> = {
      tipo,
      producto_id: toProductoId(nombre),
      nombre:      nombre.trim(),
      cantidad:    sign * qty,
      responsable: profile?.nombre ?? "—",
      timestamp:   Timestamp.now(),
      notas:       notas.trim() || undefined,
    };

    try {
      await addDoc(collection(db, "movimientos_loker"), mov);
      setNombre("");
      setCantidad("");
      setNotas("");
      setMsg({ type: "ok", text: "Movimiento registrado." });
      setTimeout(() => setMsg(null), 3000);
    } catch {
      setMsg({ type: "err", text: "Error al guardar. Intenta de nuevo." });
    } finally {
      setGuardando(false);
    }
  }

  // ── Render ──────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-5">

      {/* ── Saldo actual ─────────────────────────────────────────────────────── */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
        <button
          onClick={() => setSaldoAbierto((v) => !v)}
          className="w-full flex items-center justify-between px-4 py-3
            bg-gradient-to-r from-purple-50 to-purple-100 hover:from-purple-100
            hover:to-purple-150 transition-colors duration-100"
        >
          <div className="flex items-center gap-2">
            <span className="text-lg">📦</span>
            <span className="font-semibold text-purple-900 text-sm">
              Saldo actual
            </span>
            <span className="text-xs bg-purple-200 text-purple-800 px-2 py-0.5 rounded-full">
              {saldos.length} {saldos.length === 1 ? "producto" : "productos"}
            </span>
          </div>
          <span className="text-purple-600 text-sm">{saldoAbierto ? "▲" : "▼"}</span>
        </button>

        {saldoAbierto && (
          <div className="p-4">
            {cargando ? (
              <p className="text-sm text-gray-400 animate-pulse">Cargando saldo…</p>
            ) : saldos.length === 0 ? (
              <p className="text-sm text-gray-400">
                Sin movimientos — registra la primera entrada.
              </p>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-2">
                {saldos.map((p) => (
                  <div
                    key={p.nombre}
                    className={`rounded-lg border px-3 py-2 text-center ${
                      p.saldo > 0
                        ? "bg-green-50 border-green-200"
                        : p.saldo === 0
                        ? "bg-gray-50 border-gray-200"
                        : "bg-red-50 border-red-200"
                    }`}
                  >
                    <p className="text-xs text-gray-500 truncate leading-tight">{p.nombre}</p>
                    <p className={`text-xl font-bold leading-tight mt-0.5 ${
                      p.saldo > 0 ? "text-green-700" : p.saldo === 0 ? "text-gray-500" : "text-red-600"
                    }`}>
                      {p.saldo > 0 ? "+" : ""}{p.saldo}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── Layout 2 columnas en pantallas grandes ───────────────────────────── */}
      <div className="grid grid-cols-1 md:grid-cols-5 gap-5">

        {/* ── Formulario ─────────────────────────────────────────────────────── */}
        <div className="md:col-span-2">
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
            <div className="px-4 py-3 bg-gradient-to-r from-purple-700 to-purple-900">
              <h2 className="text-white font-semibold text-sm">+ Registrar movimiento</h2>
            </div>

            <form onSubmit={handleGuardar} className="p-4 space-y-3">

              {/* Tipo */}
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Tipo</label>
                <select
                  value={tipo}
                  onChange={(e) => setTipo(e.target.value as TipoLoker)}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm
                    focus:outline-none focus:ring-2 focus:ring-purple-400 bg-white"
                >
                  {TIPOS_ORDEN.map((t) => (
                    <option key={t} value={t}>{TIPO_CFG[t].label}</option>
                  ))}
                </select>

                {/* Badge visual del tipo seleccionado */}
                <div className={`mt-1.5 inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs
                  font-medium border ${TIPO_CFG[tipo].bg} ${TIPO_CFG[tipo].text} ${TIPO_CFG[tipo].border}`}>
                  <span>{TIPO_CFG[tipo].sign >= 0 ? "▲" : "▼"}</span>
                  <span>{TIPO_CFG[tipo].label}</span>
                </div>
              </div>

              {/* Producto */}
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Producto</label>
                <input
                  type="text"
                  value={nombre}
                  onChange={(e) => setNombre(e.target.value)}
                  placeholder="Ej. Helado de fresa"
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm
                    focus:outline-none focus:ring-2 focus:ring-purple-400"
                />
              </div>

              {/* Cantidad + signo para ajuste */}
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Cantidad</label>
                <div className="flex gap-2">
                  {tipo === "ajuste" && (
                    <button
                      type="button"
                      onClick={() => setAjustePos((v) => !v)}
                      className={`px-3 py-2 rounded-lg border text-sm font-bold transition-colors ${
                        ajustePos
                          ? "bg-green-100 border-green-300 text-green-700"
                          : "bg-red-100 border-red-300 text-red-700"
                      }`}
                    >
                      {ajustePos ? "+" : "−"}
                    </button>
                  )}
                  <input
                    type="number"
                    value={cantidad}
                    onChange={(e) => setCantidad(e.target.value)}
                    placeholder="0"
                    min="0"
                    step="any"
                    className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm
                      focus:outline-none focus:ring-2 focus:ring-purple-400"
                  />
                </div>
              </div>

              {/* Notas */}
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">
                  Notas <span className="text-gray-400 font-normal">(opcional)</span>
                </label>
                <textarea
                  value={notas}
                  onChange={(e) => setNotas(e.target.value)}
                  rows={2}
                  placeholder="Observaciones, lote, proveedor…"
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm
                    focus:outline-none focus:ring-2 focus:ring-purple-400 resize-none"
                />
              </div>

              {/* Responsable (readonly, del perfil) */}
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Responsable</label>
                <div className="border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-500 bg-gray-50">
                  {profile?.nombre ?? "—"}
                </div>
              </div>

              {/* Mensaje */}
              {msg && (
                <p className={`text-xs rounded-lg px-3 py-2 ${
                  msg.type === "ok"
                    ? "bg-green-50 text-green-700 border border-green-200"
                    : "bg-red-50 text-red-600 border border-red-200"
                }`}>
                  {msg.text}
                </p>
              )}

              <button
                type="submit"
                disabled={guardando}
                className="w-full bg-gradient-to-r from-purple-700 to-purple-900 hover:from-purple-600
                  hover:to-purple-800 text-white font-semibold py-2.5 rounded-lg text-sm
                  transition-all duration-100 active:scale-95 disabled:opacity-60"
              >
                {guardando ? "Guardando…" : "Registrar movimiento"}
              </button>
            </form>
          </div>
        </div>

        {/* ── Lista de movimientos ────────────────────────────────────────────── */}
        <div className="md:col-span-3">
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
            <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
              <h2 className="font-semibold text-gray-800 text-sm">Movimientos recientes</h2>
              <span className="text-xs text-gray-400">
                {cargando ? "…" : `${movimientos.length} total`}
              </span>
            </div>

            <div className="divide-y divide-gray-50 max-h-[60vh] overflow-y-auto">
              {cargando ? (
                <div className="px-4 py-8 text-center">
                  <p className="text-sm text-gray-400 animate-pulse">Cargando movimientos…</p>
                </div>
              ) : movimientos.length === 0 ? (
                <div className="px-4 py-8 text-center">
                  <p className="text-2xl mb-2">📦</p>
                  <p className="text-sm text-gray-400">Sin movimientos aún.</p>
                  <p className="text-xs text-gray-300 mt-1">Registra la primera entrada al loker.</p>
                </div>
              ) : (
                movimientos.slice(0, 100).map((m) => {
                  const cfg = TIPO_CFG[m.tipo] ?? TIPO_CFG.ajuste;
                  return (
                    <div key={m.id} className="px-4 py-3 hover:bg-gray-50 transition-colors">
                      <div className="flex items-start gap-3">

                        {/* Badge tipo */}
                        <span className={`mt-0.5 flex-shrink-0 px-2 py-0.5 rounded-full text-xs
                          font-medium border ${cfg.bg} ${cfg.text} ${cfg.border}`}>
                          {cfg.sign >= 0 ? "▲" : "▼"} {cfg.label}
                        </span>

                        {/* Info */}
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between gap-2">
                            <p className="text-sm font-medium text-gray-800 truncate">
                              {m.nombre}
                            </p>
                            <span className={`text-sm font-bold flex-shrink-0 ${
                              m.cantidad > 0 ? "text-green-600" : "text-red-600"
                            }`}>
                              {m.cantidad > 0 ? "+" : ""}{m.cantidad}
                            </span>
                          </div>
                          <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                            <span className="text-xs text-gray-400">{m.responsable}</span>
                            <span className="text-gray-200">·</span>
                            <span className="text-xs text-gray-400">{fmtDate(m.timestamp)}</span>
                            {m.choferNombre && (
                              <>
                                <span className="text-gray-200">·</span>
                                <span className="text-xs bg-cyan-50 text-cyan-700 border border-cyan-200
                                  px-1.5 py-0.5 rounded-full font-medium">
                                  → {m.choferNombre}
                                </span>
                              </>
                            )}
                          </div>
                          {m.notas && (
                            <p className="text-xs text-gray-500 mt-1 italic truncate">
                              {m.notas}
                            </p>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
            </div>

            {movimientos.length > 100 && (
              <div className="px-4 py-2 border-t border-gray-100 bg-gray-50">
                <p className="text-xs text-gray-400 text-center">
                  Mostrando los últimos 100 de {movimientos.length} movimientos.
                </p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
