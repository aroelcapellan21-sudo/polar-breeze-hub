"use client";

import { useEffect, useState } from "react";
import {
  collectionGroup, query, where, getDocs, Timestamp,
} from "firebase/firestore";
import { db } from "@/lib/firebase";

interface DayData { label: string; diaCort: string; total: number; }

const W = 540, H = 150;
const PAD = { top: 14, right: 20, bottom: 32, left: 56 };
const IW = W - PAD.left - PAD.right;
const IH = H - PAD.top  - PAD.bottom;

function buildDias(map: Record<string, number>): DayData[] {
  const days: DayData[] = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    d.setHours(0, 0, 0, 0);
    const key = d.toISOString().slice(0, 10);
    const label    = d.toLocaleDateString("es-DO", { weekday: "short" });
    const diaCort  = d.toLocaleDateString("es-DO", { day: "2-digit", month: "2-digit" });
    days.push({ label, diaCort, total: map[key] ?? 0 });
  }
  return days;
}

export default function SalesChart() {
  const [dias,    setDias]    = useState<DayData[]>([]);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState<string | null>(null);

  useEffect(() => {
    const hace7 = new Date();
    hace7.setDate(hace7.getDate() - 6);
    hace7.setHours(0, 0, 0, 0);

    getDocs(
      query(
        collectionGroup(db, "choferes"),
        where("guardado_en", ">=", Timestamp.fromDate(hace7)),
      ),
    )
      .then((snap) => {
        const map: Record<string, number> = {};
        snap.docs.forEach((d) => {
          const data = d.data();
          const ts   = data.guardado_en;
          const rd   = (data.totales?.total_rd as number | undefined) ?? 0;
          if (!rd) return;
          let fecha: Date;
          if (ts?.seconds) fecha = new Date((ts.seconds as number) * 1000);
          else if (ts instanceof Date) fecha = ts;
          else return;
          const key = fecha.toISOString().slice(0, 10);
          map[key] = (map[key] ?? 0) + rd;
        });
        setDias(buildDias(map));
        setLoading(false);
      })
      .catch((err: Error) => {
        // Index not yet created or no data — show empty chart
        setDias(buildDias({}));
        setError(err.message ?? "Sin datos");
        setLoading(false);
      });
  }, []);

  const total7d = dias.reduce((s, d) => s + d.total, 0);
  const maxVal  = Math.max(...dias.map((d) => d.total), 1);

  const pts = dias.map((_, i) => ({
    x: PAD.left + (i / (dias.length - 1 || 1)) * IW,
    y: PAD.top  + (1 - _ .total / maxVal) * IH,
    v: _.total,
  }));

  const lineD = pts
    .map((p, i) => `${i === 0 ? "M" : "L"}${p.x.toFixed(1)},${p.y.toFixed(1)}`)
    .join(" ");
  const areaD = `${lineD} L${pts[pts.length - 1].x.toFixed(1)},${(PAD.top + IH).toFixed(1)} L${PAD.left.toFixed(1)},${(PAD.top + IH).toFixed(1)} Z`;

  const gridVals = [0, 0.25, 0.5, 0.75, 1];

  return (
    <div className="bg-white rounded-xl shadow-sm overflow-hidden">
      {/* Header */}
      <div className="px-5 py-3 flex items-center justify-between border-b border-gray-100">
        <div>
          <h3 className="font-bold text-gray-800 text-sm">📈 Ventas — últimos 7 días</h3>
          <p className="text-xs text-gray-400 mt-0.5">
            Inventarios de choferes ·{" "}
            <span className="font-semibold text-[#1E8C3A]">
              {loading
                ? "cargando…"
                : `RD$${total7d.toLocaleString("es-DO", { minimumFractionDigits: 0 })}`}
            </span>
          </p>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="w-2 h-2 rounded-full bg-[#F5C800] animate-pulse" />
          <span className="text-xs text-gray-400">7 días</span>
        </div>
      </div>

      {/* Chart */}
      <div className="px-3 py-2">
        {loading ? (
          <div className="flex items-center justify-center" style={{ height: H }}>
            <p className="text-sm text-gray-400 animate-pulse">Cargando ventas…</p>
          </div>
        ) : (
          <>
            <svg
              viewBox={`0 0 ${W} ${H}`}
              className="w-full"
              style={{ height: H }}
              aria-label="Gráfico de ventas 7 días"
            >
              {/* Grid horizontales */}
              {gridVals.map((frac) => {
                const y   = PAD.top + (1 - frac) * IH;
                const val = maxVal * frac;
                return (
                  <g key={frac}>
                    <line
                      x1={PAD.left} y1={y}
                      x2={W - PAD.right} y2={y}
                      stroke="#f3f4f6" strokeWidth={1}
                    />
                    <text
                      x={PAD.left - 6} y={y + 4}
                      textAnchor="end" fill="#9ca3af" fontSize={10}
                    >
                      {val >= 1000
                        ? `${(val / 1000).toFixed(val >= 10000 ? 0 : 1)}K`
                        : val.toFixed(0)}
                    </text>
                  </g>
                );
              })}

              {/* Área bajo la curva */}
              {total7d > 0 && (
                <path d={areaD} fill="#F5C800" fillOpacity={0.13} />
              )}

              {/* Línea */}
              {total7d > 0 && (
                <path
                  d={lineD}
                  fill="none"
                  stroke="#F5C800"
                  strokeWidth={2.5}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              )}

              {/* Dots + etiquetas de eje X */}
              {pts.map((p, i) => (
                <g key={i}>
                  {total7d > 0 && (
                    <circle
                      cx={p.x} cy={p.y} r={4.5}
                      fill={p.v > 0 ? "#F5C800" : "#e5e7eb"}
                      stroke="white" strokeWidth={2}
                    />
                  )}
                  {/* Día abreviado */}
                  <text
                    x={p.x}
                    y={H - PAD.bottom + 14}
                    textAnchor="middle"
                    fill="#9ca3af"
                    fontSize={10}
                    fontWeight={i === 6 ? "700" : "400"}
                  >
                    {dias[i].label}
                  </text>
                  {/* Fecha corta (solo primer y último) */}
                  {(i === 0 || i === 6) && (
                    <text
                      x={p.x}
                      y={H - PAD.bottom + 26}
                      textAnchor="middle"
                      fill="#d1d5db"
                      fontSize={9}
                    >
                      {dias[i].diaCort}
                    </text>
                  )}
                  {/* Tooltip: valor encima del punto */}
                  {p.v > 0 && (
                    <text
                      x={p.x}
                      y={p.y - 9}
                      textAnchor="middle"
                      fill="#6b7280"
                      fontSize={9}
                      fontWeight="600"
                    >
                      {p.v >= 1000
                        ? `${(p.v / 1000).toFixed(p.v >= 10000 ? 0 : 1)}K`
                        : p.v.toFixed(0)}
                    </text>
                  )}
                </g>
              ))}

              {/* Mensaje sin datos */}
              {total7d === 0 && (
                <text
                  x={W / 2} y={H / 2 + 4}
                  textAnchor="middle"
                  fill="#d1d5db"
                  fontSize={13}
                >
                  {error ? "Índice pendiente — sin datos aún" : "Sin ventas registradas esta semana"}
                </text>
              )}
            </svg>

            {/* Leyenda mini */}
            <div className="flex items-center gap-4 mt-1 px-2">
              <div className="flex items-center gap-1">
                <span className="w-3 h-3 rounded-full bg-[#F5C800] inline-block" />
                <span className="text-xs text-gray-400">ventas RD$</span>
              </div>
              <span className="text-xs text-gray-300">
                Promedio: RD${(total7d / 7).toLocaleString("es-DO", { maximumFractionDigits: 0 })}/día
              </span>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
