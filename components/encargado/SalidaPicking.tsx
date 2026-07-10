"use client";

import { useState, useEffect, useMemo } from "react";
import { collection, query, orderBy, onSnapshot, addDoc, Timestamp } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useAuth } from "@/lib/auth-context";
import { MovimientoLoker } from "@/lib/types";
import SearchableSelect from "@/components/shared/SearchableSelect";

type PickItem = { pid: string; nombre: string; cantidad: number };
type SaldoItem = { pid: string; nombre: string; saldo: number };

export default function SalidaPicking() {
  const { profile } = useAuth();

  // ── Stock en vivo (mismo patrón que el tab Stock del Encargado) ────────────
  const [movs,    setMovs]    = useState<MovimientoLoker[]>([]);
  const [cargado, setCargado] = useState(false);
  const [error,   setError]   = useState<string | null>(null);

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
            ? "No se pudo leer el stock: sin permiso sobre movimientos_loker. Revisa/despliega las reglas Firestore."
            : "No se pudo leer el stock del loker."
        );
        setCargado(true);
      }
    );
    return unsub;
  }, []);

  // Saldo por producto — Mejora #46: antes se filtraba a saldo > 0, así que un
  // producto que se agotaba (por un despacho grande, otra salida, etc.)
  // desaparecía de la lista sin ninguna explicación visible. Ahora se muestran
  // TODOS los productos con historial, y los que están en 0 o negativo quedan
  // deshabilitados con el motivo a la vista ("sin stock") en vez de esfumarse.
  const saldo = useMemo<SaldoItem[]>(() => {
    const map = new Map<string, { nombre: string; saldo: number }>();
    for (const m of movs) {
      const prev = map.get(m.producto_id) ?? { nombre: m.nombre, saldo: 0 };
      map.set(m.producto_id, { nombre: m.nombre, saldo: prev.saldo + m.cantidad });
    }
    return Array.from(map.entries())
      .map(([pid, d]) => ({ pid, ...d }))
      .sort((a, b) => (b.saldo > 0) === (a.saldo > 0) ? a.nombre.localeCompare(b.nombre, "es") : (b.saldo > 0 ? 1 : -1));
  }, [movs]);

  const saldoMap = useMemo(
    () => Object.fromEntries(saldo.map((p) => [p.pid, p])) as Record<string, SaldoItem>,
    [saldo],
  );

  // ── Lista de picking ───────────────────────────────────────────────────────
  const [items,     setItems]     = useState<PickItem[]>([]);
  const [sel,       setSel]       = useState("");
  const [qty,       setQty]       = useState<string>("");
  const [destino,   setDestino]   = useState("");
  const [guardando, setGuardando] = useState(false);
  const [msg,       setMsg]       = useState<{ type: "ok" | "err"; text: string } | null>(null);

  const totalUds = useMemo(() => items.reduce((s, i) => s + i.cantidad, 0), [items]);

  function agregar() {
    const prod = saldoMap[sel];
    const n = Number(qty);
    if (!prod || prod.saldo <= 0 || !n || n <= 0) return;
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

  // ¿Algún producto saca más de lo disponible? (generaría stock negativo)
  const hayExceso = items.some((i) => i.cantidad > (saldoMap[i.pid]?.saldo ?? 0));

  function buildWa(): string {
    const fecha = new Date().toLocaleDateString("es-DO", { day: "2-digit", month: "short", year: "numeric" });
    const lines = [
      "📤 *SALIDA / PICKING — POLAR BREEZE*",
      `📅 ${fecha}`,
      ...(destino.trim() ? [`📍 Destino: ${destino.trim()}`] : []),
      "",
      ...items.map((i) => `• ${i.nombre}: *${i.cantidad} uds*`),
      "",
      `Total: ${totalUds} uds · ${items.length} producto${items.length !== 1 ? "s" : ""}`,
    ].join("\n");
    return `https://wa.me/?text=${encodeURIComponent(lines)}`;
  }

  async function registrarSalida() {
    if (items.length === 0 || guardando) return;
    setGuardando(true);
    setMsg(null);
    try {
      const nombre = profile?.nombre ?? "Encargado";
      const ts     = Timestamp.now();
      const nota   = `Picking (Encargado) → ${destino.trim() || "despacho"}`;
      await Promise.all(
        items.map((it) =>
          addDoc(collection(db, "movimientos_loker"), {
            tipo:        "salida_despacho",
            categoria:   "retiro_despacho",
            motivo:      "picking",
            producto_id: it.pid,
            nombre:      it.nombre,
            cantidad:    -Math.abs(it.cantidad),
            responsable: nombre,
            responsableId: profile?.uid ?? "",
            timestamp:   ts,
            notas:       nota,
          })
        )
      );
      setMsg({
        type: "ok",
        text: `Salida registrada — ${items.length} producto${items.length !== 1 ? "s" : ""}, ${totalUds} uds descontadas del stock.`,
      });
      setItems([]);
      setDestino("");
    } catch (e) {
      setMsg({ type: "err", text: e instanceof Error ? e.message : "Error al registrar la salida." });
    } finally {
      setGuardando(false);
    }
  }

  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
      {/* Header del card */}
      <div className="px-4 py-3 bg-[#1A1A1A] pb-print-flat">
        <h2 className="text-white font-bold text-sm">📤 Salida — Picking</h2>
        <p className="text-gray-400 text-xs mt-0.5">Descuenta del stock del loker (movimientos_loker)</p>
      </div>
      {/* Banda tricolor */}
      <div className="h-[3px] flex pb-print-band">
        <div className="flex-1 bg-[#F5C800]" />
        <div className="flex-1 bg-[#D42B2B]" />
        <div className="flex-1 bg-[#1E8C3A]" />
      </div>

      {!cargado ? (
        <div className="px-4 py-12 text-center">
          <p className="text-sm text-gray-400 animate-pulse">Cargando stock…</p>
        </div>
      ) : error ? (
        <div className="px-4 py-10 text-center">
          <p className="text-3xl mb-2">⚠️</p>
          <p className="text-sm font-semibold text-red-600">{error}</p>
        </div>
      ) : saldo.length === 0 ? (
        <div className="px-4 py-12 text-center">
          <p className="text-3xl mb-2">📦</p>
          <p className="text-sm font-semibold text-gray-600">Sin stock disponible para sacar</p>
          <p className="text-xs text-gray-400 mt-1">Registra entradas en 📥 Entrada para tener qué despachar.</p>
        </div>
      ) : (
        <div className="p-4 space-y-4">
          {/* Selector de producto + cantidad */}
          <div className="no-print flex flex-wrap items-end gap-2">
            <label className="flex-1 min-w-[160px]">
              <span className="block text-xs font-semibold text-gray-500 mb-1">Producto</span>
              <SearchableSelect
                value={sel}
                onChange={setSel}
                options={saldo.map((p) => ({
                  id: p.pid, label: p.nombre,
                  sublabel: p.saldo > 0 ? `disponible: ${p.saldo}` : `sin stock (${p.saldo})`,
                  disabled: p.saldo <= 0,
                }))}
                placeholder="Buscar producto…"
                emptyLabel="Elegir…"
                panelMaxHeightPx={512}
              />
            </label>
            <label className="w-24">
              <span className="block text-xs font-semibold text-gray-500 mb-1">Cantidad</span>
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
              className="px-4 py-2 rounded-lg text-sm font-bold bg-[#1A1A1A] text-white
                hover:brightness-110 active:scale-95 transition-all disabled:opacity-40"
            >
              + Agregar
            </button>
          </div>

          {/* Lista de picking */}
          {items.length === 0 ? (
            <div className="text-center py-8 border border-dashed border-gray-200 rounded-xl">
              <p className="text-2xl mb-1">📤</p>
              <p className="text-xs text-gray-400">Agrega productos para preparar la salida.</p>
            </div>
          ) : (
            <div className="divide-y divide-gray-100 border border-gray-100 rounded-xl overflow-hidden">
              {items.map((it) => {
                const disp    = saldoMap[it.pid]?.saldo ?? 0;
                const exceso  = it.cantidad > disp;
                return (
                  <div key={it.pid} className="flex items-center gap-2 px-3 py-2.5">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-gray-800 truncate">{it.nombre}</p>
                      <p className={`text-[11px] ${exceso ? "text-red-500 font-semibold" : "text-gray-400"}`}>
                        Disponible: {disp}{exceso ? " — excede el stock (quedará en negativo)" : ""}
                      </p>
                    </div>
                    <input
                      type="number"
                      min={0}
                      value={it.cantidad}
                      onChange={(e) => setCantidad(it.pid, Number(e.target.value))}
                      className={`no-print w-16 text-center border rounded-lg px-1 py-1 text-sm font-bold tabular-nums
                        focus:outline-none focus:ring-2 ${
                          exceso ? "border-red-300 text-red-600 focus:ring-red-200"
                                 : "border-gray-200 text-gray-800 focus:ring-[#1E8C3A]/30"
                        }`}
                    />
                    <button
                      type="button"
                      onClick={() => quitar(it.pid)}
                      title="Quitar"
                      className="no-print w-8 h-8 flex items-center justify-center rounded-lg text-gray-400
                        hover:bg-red-50 hover:text-red-500 transition-colors"
                    >
                      ✕
                    </button>
                  </div>
                );
              })}
              {/* Total */}
              <div className="flex items-center justify-between px-3 py-2 bg-gray-50">
                <span className="text-xs font-semibold text-gray-500">Total a sacar</span>
                <span className="text-sm font-black text-[#1A1A1A] tabular-nums">{totalUds} uds</span>
              </div>
            </div>
          )}

          {/* Destino opcional */}
          {items.length > 0 && (
            <label className="no-print block">
              <span className="block text-xs font-semibold text-gray-500 mb-1">Destino / nota (opcional)</span>
              <input
                type="text"
                value={destino}
                onChange={(e) => setDestino(e.target.value)}
                placeholder="Ej. Despacho mañana · ruta Cibao…"
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-800
                  focus:outline-none focus:ring-2 focus:ring-[#1E8C3A]/30"
              />
            </label>
          )}

          {/* Mensaje */}
          {msg && (
            <div className={`rounded-xl px-4 py-3 text-sm font-semibold ${
              msg.type === "ok" ? "bg-[#1E8C3A]/10 text-[#1E8C3A]" : "bg-red-50 text-red-600"
            }`}>
              {msg.type === "ok" ? "✅ " : "❌ "}{msg.text}
            </div>
          )}

          {/* Acciones */}
          {items.length > 0 && (
            <div className="no-print flex items-center gap-2">
              <button
                type="button"
                onClick={registrarSalida}
                disabled={guardando}
                className="flex-1 py-2.5 rounded-xl text-sm font-bold bg-[#D42B2B] text-white
                  hover:brightness-110 active:scale-95 transition-all disabled:opacity-50
                  flex items-center justify-center gap-2"
              >
                {guardando ? (
                  <>
                    <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    Registrando…
                  </>
                ) : (
                  <>📤 Registrar salida</>
                )}
              </button>
              <a
                href={buildWa()}
                target="_blank" rel="noopener noreferrer"
                className="px-4 py-2.5 rounded-xl text-sm font-bold bg-green-500 text-white
                  hover:bg-green-600 active:scale-95 transition-all"
              >
                📱
              </a>
            </div>
          )}

          {hayExceso && items.length > 0 && (
            <p className="text-[11px] text-red-500 font-semibold text-center">
              ⚠ Hay productos que exceden el stock disponible — quedarán en negativo (se activará la alarma roja).
            </p>
          )}
        </div>
      )}
    </div>
  );
}
