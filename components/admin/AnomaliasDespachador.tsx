"use client";

import { useState, useEffect, useMemo } from "react";
import {
  collection, query, where, orderBy, onSnapshot, addDoc, getDoc, doc, Timestamp,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useAuth } from "@/lib/auth-context";
import { UserProfile, PrecioProducto, toDate, resolverProductoEnCatalogo } from "@/lib/types";
import { ShareBar } from "@/components/shared/ShareButtons";
import { pbHeader, pbFooter } from "@/lib/wa-format";
import { pbPrintDoc, openPrint, pbTable } from "@/lib/print-template";

interface AnomaliaDespacho {
  id: string;
  producto: string;
  cantidad: number;
  costoUnitario: number;
  total: number;
  receptorId: string;
  receptorNombre: string;
  registradoPorNombre: string;
  fecha: string;
  timestamp: Date | { seconds: number };
  notas?: string;
}

interface Props {
  mode: "admin" | "despachador";
  registradorNombre?: string;
}

export default function AnomaliasDespachador({ mode, registradorNombre }: Props) {
  const { profile } = useAuth();
  const [anomalias, setAnomalias] = useState<AnomaliaDespacho[]>([]);
  const [choferes,  setChoferes]  = useState<UserProfile[]>([]);
  const [loading,   setLoading]   = useState(false);
  const [msg,       setMsg]       = useState<{ type: "ok" | "err"; text: string } | null>(null);

  // Catálogo canónico (config/precios) — solo para sugerir/anclar nombres,
  // nunca bloquea: si el producto de verdad es nuevo, se guarda tal cual se escribió.
  const [catalogoPrecios, setCatalogoPrecios] = useState<PrecioProducto[]>([]);

  // Form
  const todayStr = new Date().toISOString().slice(0, 10);
  const [formFecha,    setFormFecha]    = useState(todayStr);
  const [formProducto, setFormProducto] = useState("");
  const [formCantidad, setFormCantidad] = useState(1);
  const [formCosto,    setFormCosto]    = useState(0);
  const [formReceptor, setFormReceptor] = useState("");
  const [formNotas,    setFormNotas]    = useState("");

  // Filters (admin only)
  const [fechaDesde,   setFechaDesde]   = useState("");
  const [fechaHasta,   setFechaHasta]   = useState("");
  const [filtroChofer, setFiltroChofer] = useState("");

  useEffect(() => {
    const q = query(collection(db, "anomalias_despacho"), orderBy("timestamp", "desc"));
    const uChof = onSnapshot(
      query(collection(db, "usuarios"), where("role", "==", "chofer")),
      (s) => setChoferes(s.docs.map((d) => d.data() as UserProfile)),
    );
    const unsub = onSnapshot(q, (snap) =>
      setAnomalias(snap.docs.map((d) => ({ id: d.id, ...d.data() } as AnomaliaDespacho))),
    );
    return () => { unsub(); uChof(); };
  }, []);

  useEffect(() => {
    getDoc(doc(db, "config", "precios")).then((snap) => {
      if (snap.exists()) setCatalogoPrecios((snap.data().productos as PrecioProducto[]) ?? []);
    }).catch(() => { /* sin catálogo → los nombres se guardan tal cual se escriban */ });
  }, []);

  const flash = (type: "ok" | "err", text: string) => {
    setMsg({ type, text });
    setTimeout(() => setMsg(null), 4000);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formProducto.trim() || !formReceptor) return;
    setLoading(true);
    try {
      const chofer = choferes.find((c) => c.uid === formReceptor);
      const nombreRegistrador = registradorNombre ?? profile?.nombre ?? "Despachador";
      const nombreAnclado = resolverProductoEnCatalogo(formProducto, catalogoPrecios).nombre;
      await addDoc(collection(db, "anomalias_despacho"), {
        producto:            nombreAnclado,
        cantidad:            formCantidad,
        costoUnitario:       formCosto,
        total:               formCantidad * formCosto,
        receptorId:          formReceptor,
        receptorNombre:      chofer?.nombre ?? formReceptor,
        registradoPorNombre: nombreRegistrador,
        fecha:               formFecha,
        timestamp:           Timestamp.now(),
        notas:               formNotas.trim() || null,
      });
      setFormProducto(""); setFormCantidad(1); setFormCosto(0); setFormNotas("");
      flash("ok", "Anomalía registrada ✓");
    } catch (e) {
      flash("err", e instanceof Error ? e.message : "Error al guardar");
    } finally {
      setLoading(false);
    }
  };

  const filtradas = useMemo(() => {
    return anomalias.filter((a) => {
      if (fechaDesde && a.fecha < fechaDesde) return false;
      if (fechaHasta && a.fecha > fechaHasta) return false;
      if (filtroChofer && a.receptorId !== filtroChofer) return false;
      return true;
    });
  }, [anomalias, fechaDesde, fechaHasta, filtroChofer]);

  const totalRD = useMemo(() => filtradas.reduce((s, a) => s + (a.total ?? 0), 0), [filtradas]);

  const getWhatsAppMsg = () => {
    const lines = [
      pbHeader(),
      `⚠️ *Anomalías de Despacho*`,
      `Total: RD$${totalRD.toLocaleString("es-DO")}`,
      `Registros: ${filtradas.length}`,
      "",
    ];
    filtradas.forEach((a) => {
      lines.push(`• ${a.producto} ×${a.cantidad} → ${a.receptorNombre}`);
      if (a.total > 0) lines.push(`  RD$${a.total.toLocaleString("es-DO")} (RD$${a.costoUnitario}/ud) · ${a.fecha}`);
      if (a.notas) lines.push(`  📝 ${a.notas}`);
    });
    lines.push("", pbFooter());
    return lines.join("\n");
  };

  const getPrintHtml = () => {
    const cols = mode === "admin"
      ? ["Fecha", "Producto", "Cant.", "Costo/u", "Total RD$", "Chofer afectado", "Registrado por", "Notas"]
      : ["Fecha", "Producto", "Cant.", "Costo/u", "Total RD$", "Chofer afectado", "Notas"];
    const rows = filtradas.map((a) => {
      const base = [
        a.fecha, a.producto, a.cantidad,
        `RD$${a.costoUnitario}`,
        a.total > 0 ? `RD$${a.total.toLocaleString("es-DO")}` : "—",
        a.receptorNombre,
      ];
      if (mode === "admin") base.push(a.registradoPorNombre ?? "—");
      base.push(a.notas || "—");
      return base;
    });
    const totalRow = ["TOTAL", "", filtradas.reduce((s, a) => s + a.cantidad, 0),
      "", `RD$${totalRD.toLocaleString("es-DO")}`, "", ...(mode === "admin" ? [""] : []), ""];
    const body = rows.length
      ? pbTable(cols, rows, totalRow)
      : "<p>Sin anomalías registradas.</p>";
    return pbPrintDoc("ANOMALÍAS DE DESPACHO", `${filtradas.length} registros`, body);
  };

  const chofActivos = choferes.filter((c) => c.activo !== false);

  return (
    <div className="space-y-5">

      {/* ── Header ── */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="font-bold text-gray-800 text-lg">⚠️ Anomalías de Despacho</h2>
          <p className="text-xs text-gray-400 mt-0.5">
            Productos faltantes registrados · {anomalias.length} total acumulado
          </p>
        </div>
      </div>

      {/* ── Formulario de registro ── */}
      <div className="bg-white rounded-xl shadow-sm p-5">
        <h3 className="font-bold text-gray-700 mb-4">➕ Registrar faltante</h3>
        <form onSubmit={handleSubmit} className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Fecha</label>
            <input
              type="date" value={formFecha} onChange={(e) => setFormFecha(e.target.value)}
              required
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm outline-none focus:ring-2 focus:ring-orange-400"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Producto</label>
            <input
              value={formProducto} onChange={(e) => setFormProducto(e.target.value)}
              required placeholder="Ej: Barquillos x24"
              list="catalogo-precios-anomalias"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm outline-none focus:ring-2 focus:ring-orange-400"
            />
            <datalist id="catalogo-precios-anomalias">
              {catalogoPrecios.map((p) => (
                <option key={p.producto_id} value={p.nombre} />
              ))}
            </datalist>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Cantidad</label>
            <input
              type="number" min="1" value={formCantidad} onChange={(e) => setFormCantidad(Number(e.target.value))}
              required
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm text-right outline-none focus:ring-2 focus:ring-orange-400"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Costo unitario (RD$)</label>
            <input
              type="number" min="0" value={formCosto} onChange={(e) => setFormCosto(Number(e.target.value))}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm text-right outline-none focus:ring-2 focus:ring-orange-400"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Chofer receptor (afectado)</label>
            <select
              value={formReceptor} onChange={(e) => setFormReceptor(e.target.value)}
              required
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm outline-none focus:ring-2 focus:ring-orange-400 bg-white"
            >
              <option value="">Seleccionar chofer...</option>
              {chofActivos.map((c) => (
                <option key={c.uid} value={c.uid}>{c.nombre} — ficha {c.ficha ?? "—"}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">
              Notas · Total: <span className="text-orange-600 font-bold">RD${(formCantidad * formCosto).toLocaleString()}</span>
            </label>
            <input
              value={formNotas} onChange={(e) => setFormNotas(e.target.value)}
              placeholder="Observaciones (opcional)"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm outline-none focus:ring-2 focus:ring-orange-400"
            />
          </div>
          <div className="sm:col-span-2 lg:col-span-3 flex items-center gap-3 flex-wrap">
            <button
              type="submit" disabled={loading}
              className="px-5 py-2.5 bg-orange-500 hover:bg-orange-600 active:scale-95 text-white rounded-lg text-sm font-semibold transition-all duration-100 disabled:opacity-60"
            >
              {loading ? "Guardando..." : "⚠️ Registrar Anomalía"}
            </button>
            {msg && (
              <span className={`text-sm px-3 py-1.5 rounded-lg border ${
                msg.type === "ok" ? "bg-green-50 text-green-700 border-green-200" : "bg-red-50 text-red-700 border-red-200"
              }`}>{msg.text}</span>
            )}
          </div>
        </form>
      </div>

      {/* ── Filtros (Admin) ── */}
      {mode === "admin" && (
        <div className="bg-white rounded-xl shadow-sm p-4">
          <p className="text-xs font-semibold text-gray-600 mb-3">🔍 Filtros</p>
          <div className="flex flex-wrap gap-3 items-end">
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Desde</label>
              <input
                type="date" value={fechaDesde} onChange={(e) => setFechaDesde(e.target.value)}
                className="px-3 py-2 border border-gray-300 rounded-lg text-xs outline-none focus:ring-2 focus:ring-purple-400"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Hasta</label>
              <input
                type="date" value={fechaHasta} onChange={(e) => setFechaHasta(e.target.value)}
                className="px-3 py-2 border border-gray-300 rounded-lg text-xs outline-none focus:ring-2 focus:ring-purple-400"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Chofer</label>
              <select
                value={filtroChofer} onChange={(e) => setFiltroChofer(e.target.value)}
                className="px-3 py-2 border border-gray-300 rounded-lg text-xs outline-none focus:ring-2 focus:ring-purple-400 bg-white"
              >
                <option value="">Todos los choferes</option>
                {choferes.map((c) => (
                  <option key={c.uid} value={c.uid}>{c.nombre}</option>
                ))}
              </select>
            </div>
            {(fechaDesde || fechaHasta || filtroChofer) && (
              <button
                onClick={() => { setFechaDesde(""); setFechaHasta(""); setFiltroChofer(""); }}
                className="px-3 py-2 text-xs text-gray-400 hover:text-red-500 transition-colors active:scale-95"
              >
                ✕ Limpiar
              </button>
            )}
          </div>
        </div>
      )}

      {/* ── Resumen KPI ── */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        <div className="bg-orange-50 border border-orange-200 rounded-xl p-4 text-center">
          <p className="text-2xl font-extrabold text-orange-700">{filtradas.length}</p>
          <p className="text-xs text-orange-500 mt-0.5">Anomalías</p>
        </div>
        <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-center">
          <p className="text-xl font-extrabold text-red-700">RD${totalRD.toLocaleString()}</p>
          <p className="text-xs text-red-500 mt-0.5">Total en pérdidas</p>
        </div>
        <div className="bg-white border border-gray-200 rounded-xl p-4 flex items-center justify-center sm:col-span-1 col-span-2">
          <ShareBar getMessage={getWhatsAppMsg} getPrintHtml={getPrintHtml} />
        </div>
      </div>

      {/* ── Lista de anomalías ── */}
      {filtradas.length === 0 ? (
        <div className="bg-white rounded-xl shadow-sm p-12 text-center">
          <p className="text-4xl mb-3">{anomalias.length === 0 ? "✅" : "🔍"}</p>
          <p className="font-medium text-gray-600">
            {anomalias.length === 0 ? "Sin anomalías registradas" : "Sin resultados para este filtro"}
          </p>
          <p className="text-xs text-gray-400 mt-2">Los registros aparecen aquí en tiempo real.</p>
        </div>
      ) : (
        <div className="bg-white rounded-xl shadow-sm overflow-hidden">
          <div className="flex items-center justify-between px-5 py-3 border-b">
            <h3 className="font-bold text-gray-800 text-sm">
              Registros ({filtradas.length})
              {(fechaDesde || fechaHasta || filtroChofer) && (
                <span className="ml-2 text-xs font-normal text-orange-500">· filtrado</span>
              )}
            </h3>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="bg-orange-50/80 text-orange-700 border-b border-orange-100">
                  <th className="text-left px-4 py-2.5 font-semibold">Fecha</th>
                  <th className="text-left px-4 py-2.5 font-semibold">Producto</th>
                  <th className="text-right px-4 py-2.5 font-semibold">Cant.</th>
                  <th className="text-right px-4 py-2.5 font-semibold">Costo/u</th>
                  <th className="text-right px-4 py-2.5 font-semibold">Total RD$</th>
                  <th className="text-left px-4 py-2.5 font-semibold">Chofer afectado</th>
                  {mode === "admin" && (
                    <th className="text-left px-4 py-2.5 font-semibold">Registrado por</th>
                  )}
                  <th className="text-left px-4 py-2.5 font-semibold">Notas</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {filtradas.map((a) => (
                  <tr key={a.id} className="hover:bg-orange-50/30 transition-colors">
                    <td className="px-4 py-2.5 text-gray-500 whitespace-nowrap">{a.fecha}</td>
                    <td className="px-4 py-2.5 font-medium text-gray-800">{a.producto}</td>
                    <td className="px-4 py-2.5 text-right font-bold text-orange-700">{a.cantidad}</td>
                    <td className="px-4 py-2.5 text-right text-gray-500">
                      {a.costoUnitario > 0 ? `RD$${a.costoUnitario.toLocaleString()}` : "—"}
                    </td>
                    <td className="px-4 py-2.5 text-right font-extrabold text-red-700">
                      {a.total > 0 ? `RD$${a.total.toLocaleString()}` : "—"}
                    </td>
                    <td className="px-4 py-2.5 text-gray-700">{a.receptorNombre}</td>
                    {mode === "admin" && (
                      <td className="px-4 py-2.5 text-gray-400">{a.registradoPorNombre}</td>
                    )}
                    <td className="px-4 py-2.5 text-gray-400 max-w-[140px] truncate">
                      {a.notas ?? "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="bg-red-50 border-t-2 border-red-200 font-bold">
                  <td colSpan={4} className="px-4 py-3 text-red-800">
                    💵 Total general ({filtradas.length} registros)
                  </td>
                  <td className="px-4 py-3 text-right text-red-800 text-sm">
                    RD${totalRD.toLocaleString()}
                  </td>
                  <td colSpan={mode === "admin" ? 3 : 2}></td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
