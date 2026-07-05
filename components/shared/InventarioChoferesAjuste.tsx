"use client";

import { useEffect, useState } from "react";
import { doc, setDoc, addDoc, collection, Timestamp } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useAuth } from "@/lib/auth-context";
import { UserProfile, InventarioBaseItem } from "@/lib/types";

interface Props {
  chofer: UserProfile;
}

// Ajuste rápido del inventario fijo (inventario_base) del chofer — sin
// historial ni ledger en pantalla (eso vive en 🔀 Cruce, Fase 1B). Cada +/-
// escribe un movimiento en movimientos_loker con el mismo shape que usa
// Despachador en "Extras" (agregado_0/retiro_despacho) para que el stock del
// Loker quede en sync — nunca genera puntos, es una corrección, no una venta.
export default function InventarioChoferesAjuste({ chofer }: Props) {
  const { profile } = useAuth();
  const [filas,    setFilas]    = useState<InventarioBaseItem[]>(chofer.inventario_base ?? []);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [msg,      setMsg]      = useState<{ type: "ok" | "err"; text: string } | null>(null);

  useEffect(() => {
    setFilas(chofer.inventario_base ?? []);
  }, [chofer.uid, chofer.inventario_base]);

  const ajustar = async (item: InventarioBaseItem, delta: 1 | -1) => {
    if (delta === -1 && item.cantidad <= 0) return;
    setSavingId(item.producto_id);
    setMsg(null);
    const nuevasFilas = filas.map((f) =>
      f.producto_id === item.producto_id ? { ...f, cantidad: f.cantidad + delta } : f
    );
    try {
      await addDoc(collection(db, "movimientos_loker"), {
        tipo:         delta === 1 ? "salida_despacho" : "devolucion_chofer",
        categoria:    delta === 1 ? "agregado_0" : "retiro_despacho",
        ...(delta === 1 && { generaPuntos: false }),
        producto_id:  item.producto_id,
        nombre:       item.nombre,
        cantidad:     delta === 1 ? -1 : 1,
        responsable:  profile?.nombre ?? "Encargado",
        choferId:     chofer.uid,
        choferNombre: chofer.nombre,
        timestamp:    Timestamp.now(),
        notas:        `Ajuste inventario fijo (${delta === 1 ? "+1" : "-1"}) — Inventario Choferes`,
      });
      await setDoc(doc(db, "usuarios", chofer.uid), { inventario_base: nuevasFilas }, { merge: true });
      setFilas(nuevasFilas);
      setMsg({ type: "ok", text: `${item.nombre}: ${delta === 1 ? "+1" : "-1"} guardado ✓` });
    } catch (e) {
      setMsg({ type: "err", text: e instanceof Error ? e.message : "Error al guardar el ajuste" });
    } finally {
      setSavingId(null);
      setTimeout(() => setMsg(null), 3000);
    }
  };

  const total = filas.reduce((s, f) => s + f.cantidad, 0);

  return (
    <div className="bg-white rounded-xl shadow-sm overflow-hidden">
      <div className="px-5 py-4 bg-gradient-to-r from-emerald-50 to-emerald-100">
        <h3 className="font-bold text-emerald-900 text-sm">📋 Inventario Choferes</h3>
        <p className="text-xs text-emerald-600 mt-0.5">
          Ajusta el inventario fijo actual — cada cambio se registra en el Loker
        </p>
      </div>

      {msg && (
        <div className={`mx-4 mt-3 text-sm px-3 py-2 rounded-lg ${msg.type === "ok" ? "bg-green-50 text-green-700 border border-green-200" : "bg-red-50 text-red-700 border border-red-200"}`}>
          {msg.text}
        </div>
      )}

      {filas.length === 0 ? (
        <div className="px-5 py-8 text-center">
          <p className="text-2xl mb-2">📋</p>
          <p className="text-sm text-gray-400">Este chofer no tiene inventario base declarado.</p>
        </div>
      ) : (
        <>
          <div className="divide-y divide-gray-50">
            {filas.map((f) => (
              <div key={f.producto_id} className="flex items-center gap-3 px-4 py-3">
                <p className="flex-1 text-sm font-medium text-gray-800 truncate">{f.nombre}</p>
                <button
                  onClick={() => ajustar(f, -1)}
                  disabled={savingId === f.producto_id || f.cantidad <= 0}
                  className="w-9 h-9 rounded-lg bg-red-50 text-red-600 font-bold text-lg flex items-center justify-center active:scale-95 hover:bg-red-100 transition-all duration-100 disabled:opacity-40"
                >
                  −
                </button>
                <span className="w-8 text-center font-bold text-gray-800 tabular-nums">{f.cantidad}</span>
                <button
                  onClick={() => ajustar(f, 1)}
                  disabled={savingId === f.producto_id}
                  className="w-9 h-9 rounded-lg bg-green-50 text-green-700 font-bold text-lg flex items-center justify-center active:scale-95 hover:bg-green-100 transition-all duration-100 disabled:opacity-40"
                >
                  +
                </button>
              </div>
            ))}
          </div>
          <div className="flex justify-between px-5 py-3 bg-gray-50 text-xs font-bold text-gray-500">
            <span>Total — {filas.length} producto{filas.length !== 1 ? "s" : ""}</span>
            <span>{total} uds</span>
          </div>
        </>
      )}
    </div>
  );
}
