"use client";

import { useEffect, useState } from "react";
import { collection, onSnapshot, query, where } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { UserProfile } from "@/lib/types";
import InventarioChoferesAjuste from "@/components/shared/InventarioChoferesAjuste";

export default function InventarioChoferesTab() {
  const [choferes, setChoferes] = useState<UserProfile[]>([]);
  const [selUid,   setSelUid]   = useState("");

  useEffect(() => {
    const unsub = onSnapshot(
      query(collection(db, "usuarios"), where("role", "==", "chofer")),
      (snap) => {
        const list = snap.docs
          .map((d) => d.data() as UserProfile)
          .filter((u) => u.activo !== false)
          .sort((a, b) => a.nombre.localeCompare(b.nombre, "es"));
        setChoferes(list);
      },
    );
    return unsub;
  }, []);

  const sel = choferes.find((c) => c.uid === selUid) ?? null;

  return (
    <div className="space-y-4">
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4">
        <label className="block text-xs font-semibold text-gray-500 mb-1.5">Chofer</label>
        <select
          value={selUid}
          onChange={(e) => setSelUid(e.target.value)}
          className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-800
            bg-white focus:outline-none focus:ring-2 focus:ring-[#1E8C3A]/30"
        >
          <option value="">Elegir chofer…</option>
          {choferes.map((c) => (
            <option key={c.uid} value={c.uid}>{c.nombre} — Ficha {c.ficha ?? "—"}</option>
          ))}
        </select>
      </div>

      {sel && <InventarioChoferesAjuste chofer={sel} />}
    </div>
  );
}
