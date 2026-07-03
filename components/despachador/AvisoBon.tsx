"use client";

// Centro de Mensajes del Hub. Oliver/Admin envían un mensaje a un ÁREA
// (Despacho→BON, Choferes→app-chofer, Encargado→Hub) o a UN chofer por ficha.
// Se guarda en la colección `avisos`; cada app lo muestra como banner y al dar OK
// escribe un acuse en `acuses_despacho` (aquí se cuentan como "leído por N").
// También edita config/despacho.hora_retraso (semáforo azul de BON).

import { useEffect, useState } from "react";
import {
  doc, setDoc, addDoc, updateDoc, onSnapshot, collection, query, where, getDocs, Timestamp,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useAuth } from "@/lib/auth-context";

type Area = "despacho" | "chofer" | "encargado";
interface Aviso { id: string; texto: string; area: Area; ficha: string | null; avisoId: number; }
interface Chofer { ficha: string; nombre: string; }

export default function AvisoBon() {
  const { profile } = useAuth();
  const [texto, setTexto]     = useState("");
  const [area, setArea]       = useState<Area>("despacho");
  const [ficha, setFicha]     = useState("");           // "" = todos los choferes
  const [choferes, setChof]   = useState<Chofer[]>([]);
  const [avisos, setAvisos]   = useState<Aviso[]>([]);
  const [acuses, setAcuses]   = useState<Record<string, number>>({});
  const [horaInput, setHora]  = useState("15");
  const [busy, setBusy]       = useState(false);
  const [msg, setMsg]         = useState<{ type: "ok" | "err"; text: string } | null>(null);

  const flash = (type: "ok" | "err", text: string) => { setMsg({ type, text }); setTimeout(() => setMsg(null), 3000); };

  useEffect(() => {
    getDocs(query(collection(db, "usuarios"), where("role", "==", "chofer"))).then((s) => {
      const list = s.docs.map((d) => { const u = d.data() as { ficha?: string; nombre?: string }; return { ficha: String(u.ficha || ""), nombre: u.nombre || "" }; }).filter((c) => c.ficha);
      list.sort((a, b) => Number(a.ficha) - Number(b.ficha));
      setChof(list);
    }).catch(() => {});
  }, []);

  useEffect(() => {
    const unsub = onSnapshot(query(collection(db, "avisos"), where("activo", "==", true)), (s) => {
      const list: Aviso[] = s.docs.map((d) => { const a = d.data() as { texto?: string; area?: Area; ficha?: string | null; id?: number }; return { id: d.id, texto: a.texto || "", area: (a.area || "despacho") as Area, ficha: a.ficha ?? null, avisoId: Number(a.id || 0) }; });
      list.sort((a, b) => b.avisoId - a.avisoId);
      setAvisos(list);
    });
    return () => unsub();
  }, []);

  useEffect(() => {
    const unsub = onSnapshot(collection(db, "acuses_despacho"), (s) => {
      const m: Record<string, number> = {};
      s.forEach((d) => { const x = d.data() as { avisoId?: string }; const k = String(x.avisoId); m[k] = (m[k] || 0) + 1; });
      setAcuses(m);
    });
    return () => unsub();
  }, []);

  useEffect(() => {
    const unsub = onSnapshot(doc(db, "config", "despacho"), (snap) => {
      const d = (snap.data() || {}) as { hora_retraso?: number };
      if (typeof d.hora_retraso === "number") setHora(String(d.hora_retraso));
    });
    return () => unsub();
  }, []);

  const enviar = async () => {
    if (!texto.trim()) { flash("err", "Escribe el mensaje"); return; }
    setBusy(true);
    try {
      const de = profile?.role === "admin" ? "Administración"
        : profile?.role === "despachador" ? "Despacho"
        : (profile?.nombre || "Hub");
      await addDoc(collection(db, "avisos"), {
        texto: texto.trim(), area,
        ficha: area === "chofer" ? (ficha || null) : null,
        id: Date.now(), activo: true, de, createdBy: profile?.nombre || "Hub", timestamp: Timestamp.now(),
      });
      setTexto("");
      flash("ok", "Mensaje enviado ✓");
    } catch (e) { flash("err", e instanceof Error ? e.message : "Error"); }
    setBusy(false);
  };

  const quitar = async (id: string) => {
    setBusy(true);
    try { await updateDoc(doc(db, "avisos", id), { activo: false }); flash("ok", "Mensaje retirado ✓"); }
    catch (e) { flash("err", e instanceof Error ? e.message : "Error"); }
    setBusy(false);
  };

  const guardarHora = async () => {
    const h = parseInt(horaInput, 10);
    if (!Number.isInteger(h) || h < 0 || h > 23) { flash("err", "Hora entre 0 y 23"); return; }
    setBusy(true);
    try { await setDoc(doc(db, "config", "despacho"), { hora_retraso: h }, { merge: true }); flash("ok", "Hora de retraso guardada ✓"); }
    catch (e) { flash("err", e instanceof Error ? e.message : "Error"); }
    setBusy(false);
  };

  const destinoLabel = (a: Area, f: string | null) =>
    a === "despacho" ? "🎙️ Despacho (BON)" : a === "encargado" ? "🏭 Encargado" : (f ? `🚚 Chofer ${f}` : "🚚 Todos los choferes");

  const areaBtn = (a: Area, label: string) => (
    <button
      onClick={() => setArea(a)}
      className={`rounded-lg px-3 py-2 text-sm font-medium border ${area === a ? "bg-blue-600 text-white border-blue-600" : "bg-white text-gray-700 border-gray-300"}`}
    >{label}</button>
  );

  return (
    <div className="space-y-4">
      {msg && (
        <div className={`rounded-lg px-3 py-2 text-sm ${msg.type === "ok" ? "bg-green-50 text-green-700 border border-green-200" : "bg-red-50 text-red-700 border border-red-200"}`}>{msg.text}</div>
      )}

      {/* Compositor */}
      <div className="rounded-xl border border-blue-200 bg-blue-50/50 p-4 space-y-3">
        <h3 className="font-semibold text-blue-800 text-sm">📣 Enviar mensaje</h3>
        <textarea
          value={texto} onChange={(e) => setTexto(e.target.value)} rows={3}
          placeholder="Escribe el mensaje…"
          className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
        />
        <div>
          <div className="text-xs font-medium text-gray-500 mb-1">Enviar a:</div>
          <div className="flex flex-wrap gap-2">
            {areaBtn("despacho", "🎙️ Despacho")}
            {areaBtn("chofer", "🚚 Choferes")}
            {areaBtn("encargado", "🏭 Encargado")}
          </div>
        </div>
        {area === "chofer" && (
          <div>
            <div className="text-xs font-medium text-gray-500 mb-1">Chofer:</div>
            <select value={ficha} onChange={(e) => setFicha(e.target.value)} className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm">
              <option value="">Todos los choferes</option>
              {choferes.map((c) => <option key={c.ficha} value={c.ficha}>Ficha {c.ficha} · {c.nombre}</option>)}
            </select>
          </div>
        )}
        <button onClick={enviar} disabled={busy} className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50">
          Enviar mensaje
        </button>
      </div>

      {/* Mensajes activos */}
      <div className="rounded-xl border border-gray-200 p-4 space-y-2">
        <h3 className="font-semibold text-gray-800 text-sm">Mensajes activos</h3>
        {avisos.length === 0 && <div className="text-xs text-gray-500">No hay mensajes activos.</div>}
        <ul className="space-y-2">
          {avisos.map((a) => (
            <li key={a.id} className="rounded-lg bg-white border border-gray-200 p-3 text-sm">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-semibold text-blue-700">{destinoLabel(a.area, a.ficha)}</span>
                <button onClick={() => quitar(a.id)} disabled={busy} className="text-xs text-red-600 disabled:opacity-50">Quitar</button>
              </div>
              <div className="whitespace-pre-wrap text-gray-800 mt-1">{a.texto}</div>
              <div className="text-xs font-medium text-gray-500 mt-1">
                {acuses[String(a.avisoId)] ? `✅ Leído por ${acuses[String(a.avisoId)]} dispositivo(s)` : "⏳ Aún no lo han leído"}
              </div>
            </li>
          ))}
        </ul>
      </div>

      {/* Hora de retraso */}
      <div className="rounded-xl border border-gray-200 p-4 space-y-2">
        <h3 className="font-semibold text-gray-800 text-sm">⏰ Hora de retraso (semáforo azul en BON)</h3>
        <p className="text-xs text-gray-500">A partir de esta hora, una factura de hoy sin leer se marca azul (retraso) en BON.</p>
        <div className="flex items-center gap-2">
          <input type="number" min={0} max={23} value={horaInput} onChange={(e) => setHora(e.target.value)} className="w-20 rounded-lg border border-gray-300 px-3 py-2 text-sm" />
          <span className="text-sm text-gray-500">h (0–23, hora RD)</span>
          <button onClick={guardarHora} disabled={busy} className="rounded-lg bg-gray-800 px-4 py-2 text-sm font-medium text-white disabled:opacity-50">Guardar</button>
        </div>
      </div>
    </div>
  );
}
