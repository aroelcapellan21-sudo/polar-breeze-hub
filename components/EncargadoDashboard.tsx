"use client";

import { useState, useEffect, useMemo } from "react";
import { collection, query, orderBy, onSnapshot } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useAuth } from "@/lib/auth-context";
import { MovimientoLoker } from "@/lib/types";
import RegistroLote          from "@/components/encargado/RegistroLote";
import FloatingFAB           from "@/components/shared/FloatingFAB";
import ConsultarTablaModal   from "@/components/shared/ConsultarTablaModal";

type Tab = "lote" | "stock";

export default function EncargadoDashboard() {
  const { profile, logout } = useAuth();
  const [tab,         setTab]         = useState<Tab>("lote");
  const [movimientos, setMovimientos] = useState<MovimientoLoker[]>([]);
  const [showTablas,  setShowTablas]  = useState(false);
  const [stockCargado, setStockCargado] = useState(false);

  useEffect(() => {
    if (tab !== "stock") return;
    setStockCargado(false);
    const q = query(collection(db, "movimientos_loker"), orderBy("timestamp", "desc"));
    const unsub = onSnapshot(q, (snap) => {
      setMovimientos(snap.docs.map(d => ({ id: d.id, ...d.data() } as MovimientoLoker)));
      setStockCargado(true);
    });
    return unsub;
  }, [tab]);

  const saldo = useMemo(() => {
    const map = new Map<string, { nombre: string; saldo: number }>();
    for (const m of movimientos) {
      const prev = map.get(m.producto_id) ?? { nombre: m.nombre, saldo: 0 };
      map.set(m.producto_id, { nombre: m.nombre, saldo: prev.saldo + m.cantidad });
    }
    return Array.from(map.entries())
      .map(([pid, d]) => ({ pid, ...d }))
      .sort((a, b) => {
        if (a.saldo < 0 && b.saldo >= 0) return -1;
        if (b.saldo < 0 && a.saldo >= 0) return 1;
        return b.saldo - a.saldo;
      });
  }, [movimientos]);

  const TABS: { key: Tab; icon: string; label: string }[] = [
    { key: "lote",  icon: "📦", label: "Registrar lote" },
    { key: "stock", icon: "📊", label: "Stock"          },
  ];

  return (
    <div className="min-h-screen bg-gray-100">

      {/* ── Header ── */}
      <header className="bg-gradient-to-r from-emerald-700 to-emerald-900 text-white shadow-lg sticky top-0 z-30">
        <div className="max-w-2xl mx-auto px-4 py-3 flex items-center gap-3">

          <div className="w-9 h-9 bg-white/20 rounded-lg flex items-center justify-center font-black text-sm flex-shrink-0">
            PB
          </div>

          <nav className="flex gap-1 flex-1">
            {TABS.map(t => (
              <button
                key={t.key}
                onClick={() => setTab(t.key)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium
                  whitespace-nowrap transition-all duration-100 active:scale-95 flex-shrink-0 ${
                  tab === t.key
                    ? "bg-white text-emerald-800 shadow-sm"
                    : "text-emerald-200 hover:bg-white/10 hover:text-white"
                }`}
              >
                <span>{t.icon}</span>
                <span className="hidden sm:inline">{t.label}</span>
              </button>
            ))}
          </nav>

          <div className="flex items-center gap-1.5 flex-shrink-0">
            <button
              onClick={() => setShowTablas(true)}
              title="Consultar tablas"
              className="bg-white/10 hover:bg-white/20 active:scale-95 w-8 h-8 rounded-lg
                flex items-center justify-center text-base transition-all duration-100"
            >
              📋
            </button>
            <div className="text-right hidden sm:block">
              <p className="text-sm font-medium leading-tight">{profile?.nombre}</p>
              <span className="text-xs text-emerald-300">Encargado</span>
            </div>
            <button
              onClick={logout}
              className="bg-white/10 hover:bg-white/20 active:scale-95 px-3 py-1.5
                rounded-lg text-xs transition-all duration-100 font-medium"
            >
              Salir
            </button>
          </div>
        </div>

        <div className="border-t border-white/10 bg-black/10">
          <div className="max-w-2xl mx-auto px-4 py-1.5 text-xs text-emerald-200">
            {tab === "lote"  && (
              <span className="text-white font-medium">📦 Registrar lote — entrada de mercancía al loker</span>
            )}
            {tab === "stock" && (
              <span className="text-white font-medium">📊 Stock actual — saldo del loker en tiempo real</span>
            )}
          </div>
        </div>
      </header>

      {/* ── Contenido ── */}
      <main className="max-w-2xl mx-auto px-4 py-5">

        {tab === "lote" && <RegistroLote />}

        {tab === "stock" && (
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
            <div className="px-4 py-3 bg-gradient-to-r from-emerald-600 to-emerald-800">
              <h2 className="text-white font-bold text-sm">📊 Stock actual del loker</h2>
            </div>
            {!stockCargado ? (
              <div className="px-4 py-10 text-center">
                <p className="text-sm text-gray-400 animate-pulse">Cargando stock…</p>
              </div>
            ) : saldo.length === 0 ? (
              <div className="px-4 py-10 text-center">
                <p className="text-3xl mb-2">📦</p>
                <p className="text-sm text-gray-400">Sin movimientos registrados aún.</p>
                <p className="text-xs text-gray-300 mt-1">Registra el primer lote para ver el stock.</p>
              </div>
            ) : (
              <div className="divide-y divide-gray-50">
                {saldo.map(p => (
                  <div key={p.pid} className={`px-4 py-3 flex items-center justify-between ${p.saldo < 0 ? "bg-red-50/50" : ""}`}>
                    <div className="flex items-center gap-2 min-w-0">
                      <span className={`text-sm flex-shrink-0 ${
                        p.saldo < 0 ? "text-red-500" : p.saldo === 0 ? "text-amber-400" : "text-green-500"
                      }`}>
                        {p.saldo < 0 ? "🚨" : p.saldo === 0 ? "⚠️" : "✅"}
                      </span>
                      <p className="text-sm font-medium text-gray-800 truncate">{p.nombre}</p>
                    </div>
                    <span className={`flex-shrink-0 text-sm font-bold px-2.5 py-0.5 rounded-full border ${
                      p.saldo < 0
                        ? "bg-red-100 text-red-700 border-red-300"
                        : p.saldo === 0
                        ? "bg-amber-100 text-amber-600 border-amber-200"
                        : "bg-green-100 text-green-700 border-green-200"
                    }`}>
                      {p.saldo > 0 ? "+" : ""}{p.saldo}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </main>

      {/* ── Modal Tablas ── */}
      {showTablas && <ConsultarTablaModal onClose={() => setShowTablas(false)} />}

      {/* ── Botón flotante ── */}
      <FloatingFAB />
    </div>
  );
}
