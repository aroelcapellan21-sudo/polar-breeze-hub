"use client";

import { useEffect, useState } from "react";
import { collection, query, orderBy, onSnapshot, limit } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { FsHistory, ProductoItem, toDate, fmtDate } from "@/lib/types";
import { ShareBar } from "@/components/shared/ShareButtons";
import { pbHeader, pbFooter } from "@/lib/wa-format";

const TIPO_CFG: Record<string, { icon: string; label: string; color: string }> = {
  cuarto_frio:    { icon: "🥶", label: "Cuarto Frío",   color: "bg-blue-50   text-blue-700   border-blue-200"   },
  entrega_chofer: { icon: "🚚", label: "Entrega chofer", color: "bg-cyan-50   text-cyan-700   border-cyan-200"   },
  despacho:       { icon: "📦", label: "Despacho",       color: "bg-indigo-50 text-indigo-700 border-indigo-200" },
  factura:        { icon: "🧾", label: "Factura",         color: "bg-green-50  text-green-700  border-green-200"  },
};

function getDia(d: Date) {
  return d.toLocaleDateString("es-MX", { weekday: "long", day: "2-digit", month: "long" });
}

export default function Historial() {
  const [records,  setRecords]  = useState<FsHistory[]>([]);
  const [abiertos, setAbiertos] = useState<Set<string>>(new Set());
  const [filtro,   setFiltro]   = useState<string>("todos");

  useEffect(() => {
    const q = query(collection(db, "history"), orderBy("timestamp", "desc"), limit(200));
    return onSnapshot(q, (snap) => {
      setRecords(snap.docs.map((d) => ({ id: d.id, ...d.data() } as FsHistory)));
    });
  }, []);

  const toggleDia = (dia: string) =>
    setAbiertos((prev) => {
      const next = new Set(prev);
      next.has(dia) ? next.delete(dia) : next.add(dia);
      return next;
    });

  // Filtrado
  const filtrados = filtro === "todos"
    ? records
    : records.filter((r) => r.tipo === filtro);

  // Agrupar por día
  const porDia: Record<string, FsHistory[]> = {};
  filtrados.forEach((r) => {
    const d   = toDate(r.timestamp);
    const dia = getDia(d);
    (porDia[dia] ??= []).push(r);
  });

  const tipos = Array.from(new Set(records.map((r) => r.tipo).filter(Boolean))) as string[];

  const getWhatsAppMsg = () => {
    const filtroLabel = filtro === "todos" ? "todos" : (TIPO_CFG[filtro]?.label ?? filtro);
    const lines = [pbHeader(), `📅 *Historial — ${filtroLabel}*`, `${filtrados.length} registros`, ""];
    Object.entries(porDia).slice(0, 5).forEach(([dia, regs]) => {
      lines.push(`${dia}:`);
      regs.slice(0, 3).forEach((r) => {
        const prods = (Array.isArray(r.productos) ? (r.productos as ProductoItem[]) : [])
          .slice(0, 3).map((p) => `${p.nombre}×${p.cantidad}`).join(", ");
        const quien = r.choferNombre ?? r.despachadorNombre ?? "";
        lines.push(`  • ${quien}${prods ? ` — ${prods}` : ""}`);
      });
      if (regs.length > 3) lines.push(`  ...y ${regs.length - 3} más`);
      lines.push("");
    });
    lines.push(pbFooter());
    return lines.join("\n");
  };

  return (
    <div className="space-y-4">
      {/* Filtros */}
      <div className="flex items-center gap-2 flex-wrap">
        <FiltroBtn active={filtro === "todos"} onClick={() => setFiltro("todos")}>
          Todos ({records.length})
        </FiltroBtn>
        {tipos.map((t) => {
          const cfg = TIPO_CFG[t] ?? { icon: "📋", label: t, color: "" };
          const cnt = records.filter((r) => r.tipo === t).length;
          return (
            <FiltroBtn key={t} active={filtro === t} onClick={() => setFiltro(t)}>
              {cfg.icon} {cfg.label} ({cnt})
            </FiltroBtn>
          );
        })}
        <ShareBar getMessage={getWhatsAppMsg} className="ml-auto" />
      </div>

      {Object.keys(porDia).length === 0 ? (
        <div className="bg-white rounded-xl shadow-sm p-12 text-center text-gray-400">
          <p className="text-3xl mb-2">📅</p>
          <p>Sin registros históricos aún</p>
          <p className="text-xs mt-1">Los registros aparecen aquí después de guardar en Cuarto Frío o Choferes</p>
        </div>
      ) : (
        Object.entries(porDia).map(([dia, regs]) => (
          <div key={dia} className="bg-white rounded-xl shadow-sm overflow-hidden">
            <button
              onClick={() => toggleDia(dia)}
              className="w-full flex items-center justify-between px-5 py-3
                border-b hover:bg-gray-50 transition"
            >
              <div className="flex items-center gap-2">
                <span className="font-semibold text-gray-700 capitalize">{dia}</span>
                <span className="text-xs text-gray-400 bg-gray-100 px-2 py-0.5 rounded-full">
                  {regs.length} registros
                </span>
              </div>
              <span className="text-gray-400 text-sm">{abiertos.has(dia) ? "▲" : "▼"}</span>
            </button>

            {(abiertos.has(dia)) && (
              <div className="divide-y divide-gray-50">
                {regs.map((r) => {
                  const cfg      = TIPO_CFG[r.tipo ?? ""] ?? { icon: "📋", label: r.tipo ?? "registro", color: "bg-gray-50 text-gray-600 border-gray-200" };
                  const productos = Array.isArray(r.productos) ? (r.productos as ProductoItem[]) : [];
                  const totalUnd = productos.reduce((s, p) => s + (p.cantidad ?? 0), 0);

                  return (
                    <div key={r.id} className="px-5 py-3 flex items-start gap-3">
                      <span className="text-xl flex-shrink-0 mt-0.5">{cfg.icon}</span>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className={`text-xs px-2 py-0.5 rounded-full border ${cfg.color}`}>
                            {cfg.label}
                          </span>
                          {r.choferNombre && (
                            <span className="text-xs text-cyan-700 font-medium">{r.choferNombre}</span>
                          )}
                          {r.despachadorNombre && (
                            <span className="text-xs text-gray-400">{r.despachadorNombre}</span>
                          )}
                        </div>

                        {productos.length > 0 && (
                          <div className="mt-1.5 flex flex-wrap gap-1">
                            {productos.slice(0, 5).map((p, i) => (
                              <span key={i} className="text-xs bg-gray-50 text-gray-600 px-2 py-0.5 rounded">
                                {p.nombre} ×{p.cantidad}
                              </span>
                            ))}
                            {productos.length > 5 && (
                              <span className="text-xs text-gray-400">+{productos.length - 5}</span>
                            )}
                          </div>
                        )}

                        <div className="flex gap-4 mt-1 text-xs text-gray-400">
                          {totalUnd > 0 && <span>{totalUnd} uds</span>}
                          {typeof r.totalMonto === "number" && r.totalMonto > 0 && <span>${r.totalMonto.toLocaleString()}</span>}
                        </div>
                      </div>

                      <span className="text-xs text-gray-400 flex-shrink-0 whitespace-nowrap">
                        {fmtDate(r.timestamp)}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        ))
      )}
    </div>
  );
}

function FiltroBtn({ active, onClick, children }: {
  active: boolean; onClick: () => void; children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`px-3 py-1.5 rounded-lg text-xs font-medium transition ${
        active
          ? "bg-blue-600 text-white"
          : "bg-white text-gray-600 border border-gray-200 hover:border-blue-300"
      }`}
    >
      {children}
    </button>
  );
}
