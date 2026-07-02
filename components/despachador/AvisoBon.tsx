"use client";

// Avisar a BON (APP-DICTADA-A-VOZ) desde el Hub del Despachador.
// - Oliver escribe `config/despacho.aviso = { texto, id, activo }`  -> BON lo
//   muestra como banner en su pantalla de Despacho.
// - Oliver ve los ACUSES: BON, al dar OK, escribe en `acuses_despacho`
//   { avisoId, visto, dispositivo, timestamp }. Aquí se leen para mostrar "leído".
// - También edita `config/despacho.hora_retraso` (hora de corte del semáforo azul
//   de BON). Reglas: config/despacho y acuses_despacho permiten esAdmin()||esDespacha().

import { useEffect, useState } from "react";
import {
  doc, setDoc, onSnapshot, collection, query, where,
} from "firebase/firestore";
import { db } from "@/lib/firebase";

interface Aviso { texto: string; id: number; activo: boolean; }
interface Acuse {
  id: string;
  avisoId: string;
  dispositivo: string;
  timestamp?: { toDate: () => Date } | null;
}

export default function AvisoBon() {
  const [texto, setTexto]         = useState("");
  const [aviso, setAviso]         = useState<Aviso | null>(null);
  const [horaInput, setHoraInput] = useState("15");
  const [acuses, setAcuses]       = useState<Acuse[]>([]);
  const [busy, setBusy]           = useState(false);
  const [msg, setMsg]             = useState<{ type: "ok" | "err"; text: string } | null>(null);

  const flash = (type: "ok" | "err", text: string) => {
    setMsg({ type, text });
    setTimeout(() => setMsg(null), 3000);
  };

  // config/despacho en vivo (aviso actual + hora_retraso)
  useEffect(() => {
    const unsub = onSnapshot(doc(db, "config", "despacho"), (snap) => {
      const d = (snap.data() || {}) as { aviso?: Aviso; hora_retraso?: number };
      setAviso(d.aviso ?? null);
      if (typeof d.hora_retraso === "number") setHoraInput(String(d.hora_retraso));
    });
    return () => unsub();
  }, []);

  // Acuses del aviso activo
  useEffect(() => {
    if (!aviso?.id) { setAcuses([]); return; }
    const q = query(collection(db, "acuses_despacho"), where("avisoId", "==", String(aviso.id)));
    const unsub = onSnapshot(q, (s) => {
      setAcuses(s.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<Acuse, "id">) })));
    });
    return () => unsub();
  }, [aviso?.id]);

  const enviar = async () => {
    if (!texto.trim()) { flash("err", "Escribe el mensaje"); return; }
    setBusy(true);
    try {
      await setDoc(doc(db, "config", "despacho"),
        { aviso: { texto: texto.trim(), id: Date.now(), activo: true } },
        { merge: true });
      setTexto("");
      flash("ok", "Aviso enviado a BON ✓");
    } catch (e) { flash("err", e instanceof Error ? e.message : "Error"); }
    setBusy(false);
  };

  const quitar = async () => {
    if (!aviso) return;
    setBusy(true);
    try {
      await setDoc(doc(db, "config", "despacho"),
        { aviso: { ...aviso, activo: false } }, { merge: true });
      flash("ok", "Aviso retirado ✓");
    } catch (e) { flash("err", e instanceof Error ? e.message : "Error"); }
    setBusy(false);
  };

  const guardarHora = async () => {
    const h = parseInt(horaInput, 10);
    if (!Number.isInteger(h) || h < 0 || h > 23) { flash("err", "Hora entre 0 y 23"); return; }
    setBusy(true);
    try {
      await setDoc(doc(db, "config", "despacho"), { hora_retraso: h }, { merge: true });
      flash("ok", "Hora de retraso guardada ✓");
    } catch (e) { flash("err", e instanceof Error ? e.message : "Error"); }
    setBusy(false);
  };

  const avisoActivo = aviso?.activo === true;

  return (
    <div className="space-y-4">
      {msg && (
        <div className={`rounded-lg px-3 py-2 text-sm ${msg.type === "ok" ? "bg-green-50 text-green-700 border border-green-200" : "bg-red-50 text-red-700 border border-red-200"}`}>
          {msg.text}
        </div>
      )}

      {/* Enviar aviso a BON */}
      <div className="rounded-xl border border-blue-200 bg-blue-50/50 p-4 space-y-3">
        <h3 className="font-semibold text-blue-800 text-sm">📣 Avisar a la pantalla de Despacho (BON)</h3>
        <textarea
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
          placeholder="Ej: Despacho cerrado por hoy. Terminen las facturas pendientes. — Oliver"
          rows={3}
          className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
        />
        <div className="flex gap-2">
          <button
            onClick={enviar}
            disabled={busy}
            className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
          >
            Enviar aviso a BON
          </button>
          {avisoActivo && (
            <button
              onClick={quitar}
              disabled={busy}
              className="rounded-lg border border-gray-300 px-4 py-2 text-sm disabled:opacity-50"
            >
              Quitar aviso
            </button>
          )}
        </div>

        {/* Estado del aviso actual + acuses */}
        {avisoActivo ? (
          <div className="rounded-lg bg-white border border-blue-200 p-3 text-sm space-y-1">
            <div className="text-gray-500 text-xs">Aviso activo enviado a BON:</div>
            <div className="whitespace-pre-wrap text-gray-800">{aviso?.texto}</div>
            <div className="pt-1 text-xs font-medium text-blue-700">
              {acuses.length > 0
                ? `✅ Leído por ${acuses.length} dispositivo(s)`
                : "⏳ Aún no lo han leído"}
            </div>
            {acuses.length > 0 && (
              <ul className="text-xs text-gray-500 list-disc pl-4">
                {acuses.map((a) => (
                  <li key={a.id}>
                    {a.dispositivo || "dispositivo"}
                    {a.timestamp?.toDate ? ` · ${a.timestamp.toDate().toLocaleString("es-DO")}` : ""}
                  </li>
                ))}
              </ul>
            )}
          </div>
        ) : (
          <div className="text-xs text-gray-500">No hay aviso activo. BON no muestra banner.</div>
        )}
      </div>

      {/* Hora de retraso (semáforo azul de BON) */}
      <div className="rounded-xl border border-gray-200 p-4 space-y-2">
        <h3 className="font-semibold text-gray-800 text-sm">⏰ Hora de retraso (semáforo azul en BON)</h3>
        <p className="text-xs text-gray-500">
          A partir de esta hora, una factura de hoy sin leer se marca azul (retraso) en BON.
        </p>
        <div className="flex items-center gap-2">
          <input
            type="number"
            min={0}
            max={23}
            value={horaInput}
            onChange={(e) => setHoraInput(e.target.value)}
            className="w-20 rounded-lg border border-gray-300 px-3 py-2 text-sm"
          />
          <span className="text-sm text-gray-500">h (0–23, hora RD)</span>
          <button
            onClick={guardarHora}
            disabled={busy}
            className="rounded-lg bg-gray-800 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
          >
            Guardar
          </button>
        </div>
      </div>
    </div>
  );
}
