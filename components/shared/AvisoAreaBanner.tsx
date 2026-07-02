"use client";

// Banner de mensaje para un ÁREA del Hub (ej. Encargado). Lee la colección `avisos`
// (area == prop, activo), muestra el más reciente como banner fijo, y al dar OK
// escribe un acuse en `acuses_despacho` (para que Oliver vea "leído") y lo descarta
// en este dispositivo (localStorage). No depende de que el usuario refresque.

import { useEffect, useState } from "react";
import { collection, query, where, onSnapshot, addDoc, Timestamp } from "firebase/firestore";
import { db } from "@/lib/firebase";

interface Aviso { texto: string; avisoId: number; }

export default function AvisoAreaBanner({ area }: { area: string }) {
  const [aviso, setAviso]   = useState<Aviso | null>(null);
  const [vistos, setVistos] = useState<string[]>([]);

  useEffect(() => {
    try { setVistos(JSON.parse(localStorage.getItem("hub_avisos_vistos") || "[]")); } catch { /* noop */ }
  }, []);

  useEffect(() => {
    const q = query(collection(db, "avisos"), where("area", "==", area), where("activo", "==", true));
    const unsub = onSnapshot(q, (s) => {
      let best: Aviso | null = null;
      s.forEach((d) => {
        const a = d.data() as { texto?: string; id?: number };
        const id = Number(a.id || 0);
        if (!best || id > best.avisoId) best = { texto: a.texto || "", avisoId: id };
      });
      setAviso(best);
    });
    return () => unsub();
  }, [area]);

  if (!aviso || vistos.includes(String(aviso.avisoId))) return null;

  const ok = async () => {
    const arr = [...vistos, String(aviso.avisoId)];
    setVistos(arr);
    try { localStorage.setItem("hub_avisos_vistos", JSON.stringify(arr.slice(-200))); } catch { /* noop */ }
    try {
      await addDoc(collection(db, "acuses_despacho"), {
        avisoId: String(aviso.avisoId), visto: true,
        dispositivo: (navigator.userAgent || "").slice(0, 60), timestamp: Timestamp.now(),
      });
    } catch { /* best-effort */ }
  };

  return (
    <div className="fixed top-0 left-0 right-0 z-[9999] bg-blue-600 text-white px-4 py-3 shadow-lg flex flex-col gap-2">
      <div className="font-bold text-sm">📣 Mensaje del despachador (Oliver)</div>
      <div className="text-base whitespace-pre-wrap leading-snug">{aviso.texto}</div>
      <button onClick={ok} className="self-end bg-white text-blue-700 font-bold rounded-lg px-5 py-1.5 text-sm">OK</button>
    </div>
  );
}
