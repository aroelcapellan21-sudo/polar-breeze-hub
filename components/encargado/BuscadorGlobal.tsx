"use client";

import { useState, useEffect, useRef } from "react";
import { collection, getDocs } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { LoteLoker, MovimientoLoker, UserProfile } from "@/lib/types";

type Tab = "lote" | "weight" | "stock" | "choferes" | "vista";

interface Props {
  onClose:    () => void;
  onNavigate: (tab: Tab) => void;
}

type ResLote   = { tipo: "lote";   lote: LoteLoker;                               pts: number };
type ResStock  = { tipo: "stock";  pid: string; nombre: string; saldo: number;    pts: number };
type ResChofer = { tipo: "chofer"; chofer: UserProfile;                            pts: number };
type ResInv    = {
  tipo: "inventario";
  ficha: string;
  choferNombre: string;
  fecha: string;
  totales?: { sobrante: number; vendido: number; total_rd: number };
  pts: number;
};
type Resultado = ResLote | ResStock | ResChofer | ResInv;

type RawStock  = { pid: string; nombre: string; saldo: number };
type RawInv    = { ficha: string; fecha: string; choferNombre?: string; totales?: { sobrante: number; vendido: number; total_rd: number } };

function norm(s: string): string {
  return (s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
}

function iniciales(s: string): string {
  return norm(s).split(/\s+/).map(w => w[0] ?? "").join("");
}

function fechaKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function ultimosDias(n: number): string[] {
  const hoy = new Date();
  return Array.from({ length: n }, (_, i) => {
    const d = new Date(hoy);
    d.setDate(d.getDate() - i);
    return fechaKey(d);
  });
}

/**
 * Escala de relevancia (mayor = mejor):
 *  6 — coincidencia exacta
 *  5 — campo empieza con la consulta
 *  4 — alguna palabra del campo empieza con la consulta
 *  3 — campo contiene la consulta como subcadena
 *  2 — todos los tokens de la consulta aparecen en el campo
 *  2 — la consulta coincide con las iniciales del campo
 *  1 — algún token de la consulta aparece en el campo
 */
function puntuar(campo: string, q: string): number {
  const nc = norm(campo), nq = norm(q);
  if (!nq || !nc) return 0;

  if (nc === nq)                                            return 6;
  if (nc.startsWith(nq))                                    return 5;
  if (nc.split(/\s+/).some(w => w.startsWith(nq)))          return 4;
  if (nc.includes(nq))                                      return 3;

  const tokens = nq.split(/\s+/).filter(Boolean);
  if (tokens.length > 1 && tokens.every(t => nc.includes(t))) return 2;
  if (nq.length >= 2 && iniciales(campo).startsWith(nq))    return 2;
  if (tokens.some(t => nc.includes(t)))                     return 1;

  return 0;
}

function fmtFecha(ts: LoteLoker["timestamp"]): string {
  try {
    const d =
      typeof ts === "object" && "seconds" in ts
        ? new Date((ts as { seconds: number }).seconds * 1000)
        : ts instanceof Date
        ? ts
        : new Date();
    return d.toLocaleDateString("es-DO", { day: "2-digit", month: "short" });
  } catch (_e) {
    return "";
  }
}

function fmtFechaSimple(f: string): string {
  // f = "YYYY-MM-DD"
  try {
    const [y, m, d] = f.split("-").map(Number);
    return new Date(y, m - 1, d).toLocaleDateString("es-DO", { day: "2-digit", month: "short" });
  } catch (_e) {
    return f;
  }
}

function fmtRD(n: number): string {
  return `RD$ ${n.toLocaleString("es-DO")}`;
}

export default function BuscadorGlobal({ onClose, onNavigate }: Props) {
  const [texto,     setTexto]     = useState("");
  const [cargando,  setCargando]  = useState(true);
  const [lotes,     setLotes]     = useState<LoteLoker[]>([]);
  const [stockRaw,  setStockRaw]  = useState<RawStock[]>([]);
  const [choferes,  setChoferes]  = useState<UserProfile[]>([]);
  const [invRaw,    setInvRaw]    = useState<RawInv[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();

    const dias = ultimosDias(14);

    Promise.all([
      // Lotes — sin orderBy para evitar requisito de índice compuesto; se ordena en cliente
      getDocs(collection(db, "lotes_loker"))
        .then(s => s.docs.map(d => ({ id: d.id, ...d.data() } as LoteLoker)).sort((a, b) => {
          const ta = typeof a.timestamp === "object" && "seconds" in a.timestamp ? (a.timestamp as { seconds: number }).seconds : 0;
          const tb = typeof b.timestamp === "object" && "seconds" in b.timestamp ? (b.timestamp as { seconds: number }).seconds : 0;
          return tb - ta;
        }))
        .catch(() => [] as LoteLoker[]),

      // Stock — saldo acumulado de movimientos_loker
      getDocs(collection(db, "movimientos_loker"))
        .then(s => {
          const map = new Map<string, { nombre: string; saldo: number }>();
          s.docs.forEach(d => {
            const m = d.data() as MovimientoLoker;
            const prev = map.get(m.producto_id) ?? { nombre: m.nombre, saldo: 0 };
            map.set(m.producto_id, { nombre: m.nombre, saldo: prev.saldo + m.cantidad });
          });
          return Array.from(map.entries()).map(([pid, v]) => ({ pid, ...v }));
        })
        .catch(() => [] as RawStock[]),

      // Choferes activos
      getDocs(collection(db, "usuarios"))
        .then(s => s.docs
          .map(d => d.data() as UserProfile)
          .filter(u => u.role === "chofer" && u.activo !== false)
        )
        .catch(() => [] as UserProfile[]),

      // Inventarios de los últimos 14 días (subcol inventarios/{fecha}/choferes)
      Promise.all(
        dias.map(fecha =>
          getDocs(collection(db, "inventarios", fecha, "choferes"))
            .then(s => s.docs.map(d => ({ ficha: d.id, fecha, ...d.data() } as RawInv)))
            .catch(() => [] as RawInv[])
        )
      ).then(res => res.flat()),
    ])
      .then(([l, sr, c, inv]) => {
        setLotes(l);
        setStockRaw(sr);
        setChoferes(c);
        setInvRaw(inv);
        setCargando(false);
      })
      .catch(() => setCargando(false));
  }, []);

  // ── Búsqueda ──────────────────────────────────────────────────────────────
  const q = texto.trim();

  const resultados: Resultado[] = (() => {
    if (!q) return [];
    const out: Resultado[] = [];

    // — Lotes —
    for (const lote of lotes) {
      const superProd = lote.productos.map(p => p.nombre).join(" ");
      const pts = Math.max(
        puntuar("lote lotes entrada mercancia almacen bodega", q),
        puntuar(lote.numero, q),
        puntuar(lote.proveedor ?? "", q),
        puntuar(lote.facturaNumero ?? "", q),
        puntuar(lote.registradoPor, q),
        puntuar(superProd, q),
        ...lote.productos.map(p => puntuar(p.nombre, q)),
      );
      if (pts > 0) out.push({ tipo: "lote", lote, pts });
    }

    // — Stock / productos —
    for (const item of stockRaw) {
      const pts = Math.max(
        puntuar("stock inventario productos loker almacen bodega", q),
        puntuar(item.nombre, q),
      );
      if (pts > 0) out.push({ tipo: "stock", ...item, pts });
    }

    // — Choferes —
    for (const c of choferes) {
      const pts = Math.max(
        puntuar("chofer choferes conductor ruta", q),
        puntuar(c.nombre ?? "", q),
        puntuar(c.ficha ?? "", q),
      );
      if (pts > 0) out.push({ tipo: "chofer", chofer: c, pts });
    }

    // — Inventarios de choferes —
    for (const inv of invRaw) {
      const chofer = choferes.find(c => c.ficha === inv.ficha);
      const nombre = chofer?.nombre ?? inv.choferNombre ?? `Ficha ${inv.ficha}`;
      const pts = Math.max(
        puntuar("inventario inventarios cierre registro choferes chofer", q),
        puntuar(nombre, q),
        puntuar(inv.ficha, q),
        puntuar(fmtFechaSimple(inv.fecha), q),
      );
      if (pts > 0) out.push({ tipo: "inventario", ficha: inv.ficha, choferNombre: nombre, fecha: inv.fecha, totales: inv.totales, pts });
    }

    return out.sort((a, b) => b.pts - a.pts);
  })();

  const lotesRes    = resultados.filter((r): r is ResLote   => r.tipo === "lote").slice(0, 4);
  const stockRes    = resultados.filter((r): r is ResStock  => r.tipo === "stock").slice(0, 5);
  const choferesRes = resultados.filter((r): r is ResChofer => r.tipo === "chofer").slice(0, 5);
  const invRes      = resultados.filter((r): r is ResInv    => r.tipo === "inventario").slice(0, 6);
  const sinRes      = q.length > 0 && lotesRes.length + stockRes.length + choferesRes.length + invRes.length === 0;

  function navegar(tab: Tab) {
    onNavigate(tab);
    onClose();
  }

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div
      className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex flex-col"
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="bg-white shadow-2xl w-full max-w-2xl mx-auto mt-0 sm:mt-16 sm:rounded-2xl overflow-hidden flex flex-col max-h-[100dvh] sm:max-h-[80vh]">

        {/* ── Input ── */}
        <div className="flex items-center gap-3 px-4 py-3 border-b border-gray-100">
          <span className="text-xl text-gray-400 flex-shrink-0">🔍</span>
          <input
            ref={inputRef}
            type="text"
            value={texto}
            onChange={e => setTexto(e.target.value)}
            placeholder="Buscar lotes, inventarios, stock, choferes…"
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
            className="flex-1 text-base text-gray-800 placeholder-gray-400 outline-none bg-transparent"
          />
          {texto && (
            <button
              onClick={() => setTexto("")}
              className="text-gray-400 hover:text-gray-600 text-lg w-6 h-6 flex items-center justify-center flex-shrink-0"
            >
              ×
            </button>
          )}
          <button
            onClick={onClose}
            className="text-sm text-gray-500 hover:text-gray-700 font-medium px-2 py-1 rounded flex-shrink-0"
          >
            Cerrar
          </button>
        </div>

        {/* ── Cuerpo ── */}
        <div className="overflow-y-auto flex-1">

          {cargando ? (
            <div className="py-12 text-center text-sm text-gray-400 animate-pulse">Cargando datos…</div>

          ) : !q ? (
            <div className="py-12 text-center">
              <p className="text-4xl mb-3">🔍</p>
              <p className="text-sm font-semibold text-gray-600">Busca en todo el Dashboard</p>
              <p className="text-xs text-gray-400 mt-1">Lotes · Inventarios · Stock · Choferes</p>
            </div>

          ) : sinRes ? (
            <div className="py-12 text-center">
              <p className="text-3xl mb-3">😕</p>
              <p className="text-sm text-gray-500">
                Sin resultados para <strong>&ldquo;{q}&rdquo;</strong>
              </p>
            </div>

          ) : (
            <div>

              {/* Lotes */}
              {lotesRes.length > 0 && (
                <div>
                  <p className="px-4 py-2 bg-gray-50 text-xs font-semibold text-gray-500 uppercase tracking-wide sticky top-0 z-10">
                    📦 Lotes
                  </p>
                  {lotesRes.map(r => (
                    <button
                      key={r.lote.id}
                      onClick={() => navegar("lote")}
                      className="w-full text-left px-4 py-3 hover:bg-[#F5C800]/10 active:bg-[#F5C800]/20 transition-colors border-b border-gray-50"
                    >
                      <div className="flex items-center justify-between gap-3">
                        <div className="min-w-0">
                          <p className="text-sm font-semibold text-gray-800">
                            {r.lote.numero}{r.lote.proveedor ? ` — ${r.lote.proveedor}` : ""}
                          </p>
                          <p className="text-xs text-gray-400 truncate mt-0.5">
                            {r.lote.productos.slice(0, 2).map(p => p.nombre).join(", ")}
                            {r.lote.productos.length > 2 ? ` +${r.lote.productos.length - 2}` : ""}
                          </p>
                        </div>
                        <div className="flex-shrink-0 text-right">
                          <p className="text-xs text-gray-400">{fmtFecha(r.lote.timestamp)}</p>
                          <p className="text-xs text-emerald-600 font-medium">
                            {r.lote.productos.length} prod.
                          </p>
                        </div>
                      </div>
                    </button>
                  ))}
                </div>
              )}

              {/* Inventarios de choferes */}
              {invRes.length > 0 && (
                <div>
                  <p className="px-4 py-2 bg-gray-50 text-xs font-semibold text-gray-500 uppercase tracking-wide sticky top-0 z-10">
                    📋 Inventarios de choferes
                  </p>
                  {invRes.map((r, i) => (
                    <button
                      key={`${r.ficha}-${r.fecha}-${i}`}
                      onClick={() => navegar("vista")}
                      className="w-full text-left px-4 py-3 hover:bg-[#F5C800]/10 active:bg-[#F5C800]/20 transition-colors border-b border-gray-50"
                    >
                      <div className="flex items-center justify-between gap-3">
                        <div className="min-w-0">
                          <p className="text-sm font-semibold text-gray-800">{r.choferNombre}</p>
                          <p className="text-xs text-gray-400 mt-0.5">Ficha {r.ficha}</p>
                        </div>
                        <div className="flex-shrink-0 text-right">
                          <p className="text-xs text-gray-400">{fmtFechaSimple(r.fecha)}</p>
                          {r.totales && (
                            <p className="text-xs text-emerald-600 font-medium">{fmtRD(r.totales.total_rd)}</p>
                          )}
                        </div>
                      </div>
                    </button>
                  ))}
                </div>
              )}

              {/* Stock */}
              {stockRes.length > 0 && (
                <div>
                  <p className="px-4 py-2 bg-gray-50 text-xs font-semibold text-gray-500 uppercase tracking-wide sticky top-0 z-10">
                    📊 Stock
                  </p>
                  {stockRes.map(r => (
                    <button
                      key={r.pid}
                      onClick={() => navegar("stock")}
                      className="w-full text-left px-4 py-3 hover:bg-[#F5C800]/10 active:bg-[#F5C800]/20 transition-colors border-b border-gray-50"
                    >
                      <div className="flex items-center justify-between gap-3">
                        <p className="text-sm font-medium text-gray-800">{r.nombre}</p>
                        <span className={`text-xs font-bold px-2 py-0.5 rounded-full flex-shrink-0 ${
                          r.saldo < 0
                            ? "bg-red-100 text-red-700"
                            : r.saldo === 0
                            ? "bg-amber-100 text-amber-600"
                            : "bg-green-100 text-green-700"
                        }`}>
                          {r.saldo > 0 ? "+" : ""}{r.saldo} uds
                        </span>
                      </div>
                    </button>
                  ))}
                </div>
              )}

              {/* Choferes */}
              {choferesRes.length > 0 && (
                <div>
                  <p className="px-4 py-2 bg-gray-50 text-xs font-semibold text-gray-500 uppercase tracking-wide sticky top-0 z-10">
                    👥 Choferes
                  </p>
                  {choferesRes.map(r => (
                    <button
                      key={r.chofer.uid}
                      onClick={() => navegar("choferes")}
                      className="w-full text-left px-4 py-3 hover:bg-[#F5C800]/10 active:bg-[#F5C800]/20 transition-colors border-b border-gray-50"
                    >
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-full bg-[#F5C800]/20 border border-[#F5C800]/40 flex items-center justify-center flex-shrink-0">
                          <span className="text-sm font-bold text-[#1A1A1A]">
                            {(r.chofer.nombre ?? "?")[0].toUpperCase()}
                          </span>
                        </div>
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-gray-800">{r.chofer.nombre}</p>
                          {r.chofer.ficha && (
                            <p className="text-xs text-gray-400">Ficha {r.chofer.ficha}</p>
                          )}
                        </div>
                      </div>
                    </button>
                  ))}
                </div>
              )}

            </div>
          )}
        </div>
      </div>
    </div>
  );
}
