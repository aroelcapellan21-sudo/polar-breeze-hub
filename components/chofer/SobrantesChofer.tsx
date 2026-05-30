"use client";

import { useState, useEffect, useMemo } from "react";
import {
  collection, query, where, onSnapshot, addDoc, Timestamp,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useAuth } from "@/lib/auth-context";
import { MovimientoLoker, toDate, toProductoId } from "@/lib/types";

function getTodayStart() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

interface ProductoRow {
  pid:       string;
  nombre:    string;
  despachado: number;
  devuelto:  number;
}

export default function SobrantesChofer() {
  const { profile } = useAuth();

  const [movimientos, setMovimientos] = useState<MovimientoLoker[]>([]);
  const [cargando,    setCargando]    = useState(true);
  const [sobrantes,   setSobrantes]   = useState<Record<string, string>>({});
  const [guardando,   setGuardando]   = useState(false);
  const [msg,         setMsg]         = useState<{ type: "ok" | "err" | "fraude"; text: string } | null>(null);

  const todayStart = useMemo(() => getTodayStart(), []);

  // ── Listener de movimientos del chofer ─────────────────────────────────────
  useEffect(() => {
    if (!profile) return;
    const q = query(
      collection(db, "movimientos_loker"),
      where("choferId", "==", profile.uid),
    );
    const unsub = onSnapshot(q, (snap) => {
      setMovimientos(snap.docs.map((d) => ({ id: d.id, ...d.data() } as MovimientoLoker)));
      setCargando(false);
    });
    return unsub;
  }, [profile]);

  // ── Solo movimientos de hoy ─────────────────────────────────────────────────
  const movHoy = useMemo(
    () => movimientos.filter((m) => toDate(m.timestamp) >= todayStart),
    [movimientos, todayStart],
  );

  // Despachado hoy: salida_despacho tiene cantidad negativa → tomamos valor abs
  const despachado = useMemo(() => {
    const map = new Map<string, { nombre: string; cantidad: number }>();
    movHoy
      .filter((m) => m.tipo === "salida_despacho")
      .forEach((m) => {
        const prev = map.get(m.producto_id) ?? { nombre: m.nombre, cantidad: 0 };
        map.set(m.producto_id, {
          nombre:   m.nombre,
          cantidad: prev.cantidad + Math.abs(m.cantidad),
        });
      });
    return map;
  }, [movHoy]);

  // Devoluciones ya registradas hoy por este chofer
  const devolucionesHoy = useMemo(() => {
    const map = new Map<string, number>();
    movHoy
      .filter((m) => m.tipo === "devolucion_chofer")
      .forEach((m) => {
        map.set(m.producto_id, (map.get(m.producto_id) ?? 0) + m.cantidad);
      });
    return map;
  }, [movHoy]);

  const yaReporto = devolucionesHoy.size > 0;

  // Filas para mostrar
  const filas: ProductoRow[] = useMemo(
    () =>
      Array.from(despachado.entries()).map(([pid, d]) => ({
        pid,
        nombre:     d.nombre,
        despachado: d.cantidad,
        devuelto:   devolucionesHoy.get(pid) ?? 0,
      })),
    [despachado, devolucionesHoy],
  );

  // ── Guardar sobrantes ───────────────────────────────────────────────────────
  async function handleGuardar() {
    if (!profile) return;

    const errores: string[] = [];

    filas.forEach(({ nombre, despachado: desp, pid }) => {
      const sob     = parseFloat(sobrantes[pid] ?? "0") || 0;
      const vendido = desp - sob;

      if (sob > desp) {
        errores.push(`• ${nombre}: sobrante (${sob}) mayor que despachado (${desp}) — imposible`);
      } else if (vendido < 0) {
        errores.push(`• ${nombre}: vendido negativo — posible fraude`);
      }
    });

    if (errores.length > 0) {
      setMsg({ type: "fraude", text: errores.join("\n") });
      // Notificar al admin por Telegram
      fetch("/api/telegram", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: `🚨 ALERTA FRAUDE\nChofer: ${profile.nombre}\nInconsistencias al reportar sobrantes:\n${errores.join("\n")}`,
          level: "error",
          fn:    "SobrantesChofer",
          win:   "Chofer → Sobrantes",
        }),
      }).catch(() => {});
      return;
    }

    setGuardando(true);
    setMsg(null);

    try {
      const escrituras: Promise<unknown>[] = [];

      filas.forEach(({ pid, nombre, despachado: desp }) => {
        const sob = parseFloat(sobrantes[pid] ?? "0") || 0;
        if (sob <= 0) return; // no devuelve nada de este producto

        escrituras.push(
          addDoc(collection(db, "movimientos_loker"), {
            tipo:         "devolucion_chofer",
            producto_id:  pid,
            nombre,
            cantidad:     sob,   // positivo → entra al loker
            responsable:  profile.nombre,
            choferId:     profile.uid,
            choferNombre: profile.nombre,
            timestamp:    Timestamp.now(),
            notas:        `Sobrante devuelto — despachado ${desp}`,
          } satisfies Omit<MovimientoLoker, "id">),
        );
      });

      await Promise.all(escrituras);

      setMsg({ type: "ok", text: "Sobrantes registrados correctamente." });
      setSobrantes({});
      setTimeout(() => setMsg(null), 5000);
    } catch {
      setMsg({ type: "err", text: "Error al guardar. Intenta de nuevo." });
    } finally {
      setGuardando(false);
    }
  }

  // ── Render ──────────────────────────────────────────────────────────────────
  if (cargando) {
    return (
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 text-center">
        <p className="text-sm text-gray-400 animate-pulse">Cargando despachos del día…</p>
      </div>
    );
  }

  if (filas.length === 0) {
    return (
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-5 text-center">
        <p className="text-2xl mb-2">📦</p>
        <p className="text-sm text-gray-500 font-medium">Sin despachos registrados hoy</p>
        <p className="text-xs text-gray-400 mt-1">
          El despachador debe registrar tu salida primero.
        </p>
      </div>
    );
  }

  // Si ya reportó → mostrar resumen de solo lectura
  if (yaReporto) {
    return (
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
        <div className="px-4 py-3 bg-[#1E8C3A]">
          <h2 className="text-white font-semibold text-sm">✅ Sobrantes del día — reportados</h2>
        </div>
        <div className="p-4 space-y-3">
          {filas.map(({ pid, nombre, despachado: desp, devuelto }) => {
            const vendido = desp - devuelto;
            return (
              <div key={pid} className="rounded-lg border border-gray-100 bg-gray-50 p-3">
                <p className="text-sm font-medium text-gray-800 mb-2">{nombre}</p>
                <div className="grid grid-cols-3 gap-2 text-center text-xs">
                  <div>
                    <p className="text-gray-400">Despachado</p>
                    <p className="font-bold text-cyan-700 text-base">{desp}</p>
                  </div>
                  <div>
                    <p className="text-gray-400">Sobrante</p>
                    <p className="font-bold text-blue-600 text-base">{devuelto}</p>
                  </div>
                  <div>
                    <p className="text-gray-400">Vendido</p>
                    <p className={`font-bold text-base ${vendido > 0 ? "text-green-600" : "text-gray-400"}`}>
                      {vendido}
                    </p>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  // Formulario de captura de sobrantes
  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
      <div className="px-4 py-3 bg-[#1A1A1A]">
        <h2 className="text-white font-semibold text-sm">🔄 Sobrantes del día</h2>
        <p className="text-white/50 text-xs mt-0.5">Registra lo que devuelves al loker</p>
      </div>

      <div className="p-4 space-y-4">
        <div className="space-y-3">
          {filas.map(({ pid, nombre, despachado: desp }) => {
            const sob     = parseFloat(sobrantes[pid] ?? "") || 0;
            const vendido = desp - sob;
            const invalido = sob > desp || vendido < 0;

            return (
              <div
                key={pid}
                className={`rounded-lg border p-3 transition-colors ${
                  invalido ? "border-red-300 bg-red-50" : "border-gray-200"
                }`}
              >
                <div className="flex items-center justify-between mb-2">
                  <p className="text-sm font-medium text-gray-800">{nombre}</p>
                  <span className="text-xs bg-cyan-50 text-cyan-700 border border-cyan-200
                    px-2 py-0.5 rounded-full font-medium">
                    Despachado: {desp}
                  </span>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="text-xs text-gray-500 block mb-1">Sobrante que devuelves</label>
                    <input
                      type="number"
                      min={0}
                      max={desp}
                      value={sobrantes[pid] ?? ""}
                      onChange={(e) =>
                        setSobrantes((prev) => ({ ...prev, [pid]: e.target.value }))
                      }
                      placeholder="0"
                      className={`w-full border rounded-lg px-3 py-2 text-sm
                        focus:outline-none focus:ring-2 transition-colors ${
                          invalido
                            ? "border-red-400 bg-red-50 text-red-800 focus:ring-red-300"
                            : "border-gray-300 bg-white text-gray-800 focus:ring-teal-400"
                        }`}
                    />
                  </div>
                  <div>
                    <label className="text-xs text-gray-500 block mb-1">Vendido (calculado)</label>
                    <div
                      className={`border rounded-lg px-3 py-2 text-sm font-bold text-center ${
                        invalido
                          ? "border-red-300 bg-red-100 text-red-700"
                          : vendido === desp
                          ? "border-gray-200 bg-gray-50 text-gray-500"
                          : "border-green-200 bg-green-50 text-green-700"
                      }`}
                    >
                      {vendido < 0 ? "⚠️ ERR" : vendido}
                    </div>
                  </div>
                </div>

                {invalido && (
                  <p className="text-xs text-red-600 mt-1.5 font-medium">
                    {sob > desp
                      ? "El sobrante no puede superar lo despachado."
                      : "Vendido negativo — verifica las cantidades."}
                  </p>
                )}
              </div>
            );
          })}
        </div>

        {msg && (
          <div
            className={`rounded-lg px-3 py-2.5 text-xs border whitespace-pre-line ${
              msg.type === "ok"
                ? "bg-green-50 text-green-700 border-green-200"
                : msg.type === "fraude"
                ? "bg-red-50 text-red-700 border-red-300"
                : "bg-red-50 text-red-600 border-red-200"
            }`}
          >
            {msg.type === "fraude" && (
              <p className="font-bold mb-1">🚨 Inconsistencia — admin notificado</p>
            )}
            {msg.text}
          </div>
        )}

        <button
          onClick={handleGuardar}
          disabled={guardando}
          className="w-full bg-[#1E8C3A] hover:bg-[#176830] text-white font-semibold py-2.5 rounded-lg text-sm
            transition-all duration-100 active:scale-95 disabled:opacity-60"
        >
          {guardando ? "Registrando…" : "Registrar sobrantes"}
        </button>
      </div>
    </div>
  );
}
