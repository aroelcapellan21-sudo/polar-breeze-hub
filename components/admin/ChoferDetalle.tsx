"use client";

import { useEffect, useState } from "react";
import {
  collection, query, where, orderBy, onSnapshot,
  doc, getDoc, setDoc, addDoc, Timestamp,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import { reauthenticateWithCredential, EmailAuthProvider } from "firebase/auth";
import {
  UserProfile, ImbentarioRecord,
  calcSemaforo, Semaforo, toDate, fmtDate, ProductoItem, TalonarioDoc,
} from "@/lib/types";
import { ShareBar } from "@/components/shared/ShareButtons";
import { auth } from "@/lib/firebase";

interface Props {
  chofer: UserProfile;
  onBack: () => void;
}

const SEMAFORO_CFG: Record<Semaforo, { icon: string; label: string; color: string; bg: string }> = {
  verde:    { icon: "✅", label: "Eficiencia normal",   color: "text-green-700",  bg: "bg-green-50  border-green-200" },
  amarillo: { icon: "⚠️", label: "Revisar diferencias", color: "text-yellow-700", bg: "bg-yellow-50 border-yellow-200" },
  rojo:     { icon: "🚨", label: "Diferencias críticas", color: "text-red-700",   bg: "bg-red-50    border-red-200" },
};

type SubTab = "stats" | "talonario" | "inventario";

export default function ChoferDetalle({ chofer, onBack }: Props) {
  const [records,    setRecords]    = useState<ImbentarioRecord[]>([]);
  const [talonarios, setTalonarios] = useState<TalonarioDoc[]>([]);
  const [driverEntregas, setDriverEntregas] = useState<ProductoItem[]>([]);
  const [rango,      setRango]      = useState<7 | 15 | 30>(15);
  const [fechaBuscar, setFechaBuscar] = useState("");
  const [subTab,     setSubTab]     = useState<SubTab>("stats");

  // Inventory editing
  const [invPwd,     setInvPwd]     = useState("");
  const [invLocked,  setInvLocked]  = useState(true);
  const [invLoading, setInvLoading] = useState(false);
  const [invMsg,     setInvMsg]     = useState<{ type: "ok" | "err"; text: string } | null>(null);
  const [editEntregas, setEditEntregas] = useState<ProductoItem[]>([]);

  // Product detail modal
  const [selectedProd, setSelectedProd] = useState<string | null>(null);

  useEffect(() => {
    const q = query(
      collection(db, "imbentario"),
      where("choferId", "==", chofer.uid),
      orderBy("timestamp", "desc")
    );
    const q2 = query(
      collection(db, "talonario"),
      where("choferId", "==", chofer.uid),
      orderBy("timestamp", "desc")
    );
    const u1 = onSnapshot(q,  (snap) => setRecords(snap.docs.map((d) => ({ id: d.id, ...d.data() } as ImbentarioRecord))));
    const u2 = onSnapshot(q2, (snap) => setTalonarios(snap.docs.map((d) => ({ id: d.id, ...d.data() } as TalonarioDoc))));
    return () => { u1(); u2(); };
  }, [chofer.uid]);

  // Load driver entregas
  useEffect(() => {
    getDoc(doc(db, "drivers", chofer.uid)).then((snap) => {
      if (snap.exists()) {
        const data = snap.data();
        const entregas = Array.isArray(data.entregas) ? (data.entregas as ProductoItem[]) : [];
        setDriverEntregas(entregas);
        setEditEntregas(JSON.parse(JSON.stringify(entregas)));
      }
    });
  }, [chofer.uid]);

  // Filtrar por rango de días o por fecha exacta
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - rango);

  const recientes = records.filter((r) => {
    const d = toDate(r.timestamp);
    if (fechaBuscar) {
      const bDate = new Date(fechaBuscar + "T00:00:00");
      const bEnd  = new Date(fechaBuscar + "T23:59:59");
      return d >= bDate && d <= bEnd;
    }
    return d >= cutoff;
  });

  const totalCargado   = recientes.reduce((s, r) => s + (r.cantidadCargada ?? 0), 0);
  const totalEntregado = recientes.reduce((s, r) => s + (r.cantidadEntregada ?? 0), 0);
  const totalCajas     = recientes.reduce((s, r) => s + (r.cajas ?? 0), 0);
  const totalPeso      = recientes.reduce((s, r) => s + (r.peso ?? 0), 0);
  const totalMonto     = recientes.reduce((s, r) => s + (r.monto ?? 0), 0);
  const diferencia     = totalCargado - totalEntregado;
  const semaforo       = calcSemaforo(recientes);
  const sfg            = SEMAFORO_CFG[semaforo];

  const porProducto = recientes.reduce<Record<string, {
    cargado: number; entregado: number; cajas: number; peso: number; monto: number; veces: number;
  }>>((acc, r) => {
    if (!acc[r.producto]) acc[r.producto] = { cargado: 0, entregado: 0, cajas: 0, peso: 0, monto: 0, veces: 0 };
    acc[r.producto].cargado   += r.cantidadCargada ?? 0;
    acc[r.producto].entregado += r.cantidadEntregada ?? 0;
    acc[r.producto].cajas     += r.cajas ?? 0;
    acc[r.producto].peso      += r.peso ?? 0;
    acc[r.producto].monto     += r.monto ?? 0;
    acc[r.producto].veces     += 1;
    return acc;
  }, {});

  const porDia = recientes.reduce<Record<string, { entregado: number; cargado: number }>>((acc, r) => {
    const dia = toDate(r.timestamp).toLocaleDateString("es-MX", { day: "2-digit", month: "short" });
    if (!acc[dia]) acc[dia] = { entregado: 0, cargado: 0 };
    acc[dia].entregado += r.cantidadEntregada ?? 0;
    acc[dia].cargado   += r.cantidadCargada ?? 0;
    return acc;
  }, {});

  const diasOrdenados = Object.entries(porDia).reverse();
  const maxEntregado  = Math.max(...diasOrdenados.map(([, v]) => v.entregado), 1);

  // Unlock inventory for editing
  const unlockInventario = async () => {
    try {
      const user = auth.currentUser;
      if (!user?.email) return;
      const cred = EmailAuthProvider.credential(user.email, invPwd);
      await reauthenticateWithCredential(user, cred);
      setInvLocked(false); setInvPwd("");
    } catch {
      setInvMsg({ type: "err", text: "Contraseña Admin incorrecta" });
      setTimeout(() => setInvMsg(null), 3000);
    }
  };

  const saveInventario = async () => {
    setInvLoading(true);
    try {
      await setDoc(doc(db, "drivers", chofer.uid), {
        uid: chofer.uid, nombre: chofer.nombre, ficha: chofer.ficha ?? "",
        entregas: editEntregas, updatedAt: new Date(), activo: true,
      }, { merge: true });

      // Talonario: log admin inventory edit
      await addDoc(collection(db, "talonario"), {
        choferId:          chofer.uid,
        choferNombre:      chofer.nombre,
        choferFicha:       chofer.ficha ?? "",
        productos:         editEntregas,
        tipo:              "agregada",
        fuente:            "admin",
        despachadorId:     "admin",
        despachadorNombre: "Admin",
        timestamp:         Timestamp.now(),
      });

      setDriverEntregas([...editEntregas]);
      setInvMsg({ type: "ok", text: "Inventario actualizado ✓" });
    } catch (e) {
      setInvMsg({ type: "err", text: e instanceof Error ? e.message : "Error" });
    } finally {
      setInvLoading(false);
      setTimeout(() => setInvMsg(null), 3000);
    }
  };

  const updateEdit = (i: number, field: keyof ProductoItem, val: string | number) => {
    const next = [...editEntregas];
    next[i] = { ...next[i], [field]: val };
    setEditEntregas(next);
  };

  return (
    <div className="space-y-5">
      {/* ── Header ── */}
      <div className="flex items-center gap-4 flex-wrap">
        <button
          onClick={onBack}
          className="p-2 rounded-lg hover:bg-gray-100 active:scale-95 text-gray-500 transition-all duration-100"
        >
          ← Volver
        </button>
        <div className={`flex items-center gap-3 flex-1 p-3 rounded-xl border ${sfg.bg}`}>
          <div className="w-12 h-12 bg-cyan-500 rounded-full flex items-center justify-center text-white font-bold text-lg">
            {chofer.nombre.charAt(0).toUpperCase()}
          </div>
          <div>
            <p className="font-bold text-gray-800">{chofer.nombre}</p>
            <p className="text-xs text-gray-500">Ficha: {chofer.ficha ?? "—"} · {chofer.activo !== false ? "Activo" : "Baja"}</p>
          </div>
          <div className="ml-auto text-right">
            <p className="text-2xl">{sfg.icon}</p>
            <p className={`text-xs font-medium ${sfg.color}`}>{sfg.label}</p>
          </div>
        </div>

        {/* Filtro de rango / fecha */}
        <div className="flex flex-col gap-1.5">
          {!fechaBuscar && (
            <div className="flex gap-1">
              {([7, 15, 30] as const).map((d) => (
                <button key={d} onClick={() => setRango(d)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all duration-100 active:scale-95 ${
                    rango === d ? "bg-purple-600 text-white" : "bg-white text-gray-600 hover:bg-gray-100"
                  }`}
                >
                  {d}d
                </button>
              ))}
            </div>
          )}
          <div className="flex items-center gap-1">
            <input
              type="date"
              value={fechaBuscar}
              onChange={(e) => setFechaBuscar(e.target.value)}
              className="px-2 py-1 border border-gray-300 rounded-lg text-xs outline-none focus:ring-2 focus:ring-purple-400"
            />
            {fechaBuscar && (
              <button onClick={() => setFechaBuscar("")}
                className="text-gray-400 hover:text-red-400 text-xs px-1 active:scale-95">✕</button>
            )}
          </div>
        </div>
      </div>

      {/* ── Sub tabs + compartir ── */}
      <div className="flex items-center justify-between flex-wrap gap-2">
      <div className="flex gap-1 bg-gray-100 rounded-xl p-1 w-fit">
        {([
          { key: "stats",      label: "📊 Estadísticas" },
          { key: "talonario",  label: "📋 Talonario" },
          { key: "inventario", label: "📦 Inventario" },
        ] as { key: SubTab; label: string }[]).map((t) => (
          <button
            key={t.key}
            onClick={() => setSubTab(t.key)}
            className={`px-4 py-1.5 rounded-lg text-xs font-medium transition-all duration-100 active:scale-95 ${
              subTab === t.key
                ? "bg-white text-purple-700 shadow-sm"
                : "text-gray-500 hover:text-gray-700"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>
      <ShareBar getMessage={() => {
        const periodo = fechaBuscar || `últimos ${rango} días`;
        const lines = [
          `📦 ${chofer.nombre} — ficha ${chofer.ficha ?? "—"}`,
          `Período: ${periodo}`,
          `• Cargado: ${totalCargado} uds`,
          `• Entregado: ${totalEntregado} uds`,
          `• Diferencia: ${diferencia}`,
        ];
        if (totalMonto > 0) lines.push(`• Monto: $${totalMonto.toLocaleString()}`);
        if (Object.keys(porProducto).length) {
          lines.push("Productos:");
          Object.entries(porProducto).forEach(([prod, d]) =>
            lines.push(`  • ${prod}: ${d.entregado}/${d.cargado} entregado`));
        }
        return lines.join("\n");
      }} />
      </div>

      {/* ── Stats ── */}
      {subTab === "stats" && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            <StatCard label="Unidades cargadas"   value={totalCargado}   icon="📥" color="bg-blue-50 text-blue-700" />
            <StatCard label="Unidades entregadas" value={totalEntregado} icon="📤" color="bg-green-50 text-green-700" />
            <StatCard label="Diferencia"          value={diferencia}     icon="⚡" color={diferencia > 0 ? "bg-orange-50 text-orange-700" : "bg-gray-50 text-gray-600"} />
            <StatCard label="Cajas"               value={totalCajas || "—"} icon="📦" color="bg-cyan-50 text-cyan-700" />
            <StatCard label="Peso total (kg)"     value={totalPeso ? totalPeso.toFixed(1) : "—"} icon="⚖️" color="bg-purple-50 text-purple-700" />
          </div>

          {totalMonto > 0 && (
            <div className="bg-green-50 border border-green-200 rounded-xl p-4 flex items-center gap-3">
              <span className="text-2xl">💰</span>
              <div>
                <p className="text-xs text-green-600">Ventas / Monto acumulado</p>
                <p className="text-2xl font-bold text-green-700">${totalMonto.toLocaleString()}</p>
              </div>
            </div>
          )}

          <div className="grid lg:grid-cols-2 gap-5">
            <div className="bg-white rounded-xl shadow-sm p-5">
              <h3 className="font-bold text-gray-700 mb-3">Desglose por producto</h3>
              {Object.keys(porProducto).length === 0 ? (
                <p className="text-gray-400 text-sm text-center py-6">Sin datos en este período</p>
              ) : (
                <div className="space-y-2 max-h-64 overflow-y-auto">
                  {Object.entries(porProducto).map(([prod, dat]) => {
                    const efic = dat.cargado > 0 ? (dat.entregado / dat.cargado) * 100 : 100;
                    const sem: Semaforo = efic >= 95 ? "verde" : efic >= 85 ? "amarillo" : "rojo";
                    return (
                      <button
                        key={prod}
                        onClick={() => setSelectedProd(prod)}
                        className="w-full text-left border border-gray-100 rounded-lg p-3 hover:border-purple-300 hover:bg-purple-50 active:scale-[0.99] transition-all duration-100 group"
                      >
                        <div className="flex justify-between items-center mb-1.5">
                          <p className="font-medium text-sm text-gray-800 group-hover:text-purple-700">{prod}</p>
                          <div className="flex items-center gap-1.5">
                            <span className="text-lg">{SEMAFORO_CFG[sem].icon}</span>
                            <span className="text-xs text-gray-400 group-hover:text-purple-500">Ver detalle →</span>
                          </div>
                        </div>
                        <div className="flex gap-4 text-xs text-gray-500">
                          <span>Carg: <strong>{dat.cargado}</strong></span>
                          <span>Entr: <strong>{dat.entregado}</strong></span>
                          <span>Efic: <strong className={SEMAFORO_CFG[sem].color}>{efic.toFixed(0)}%</strong></span>
                          {dat.peso > 0 && <span>Peso: <strong>{dat.peso.toFixed(1)}kg</strong></span>}
                        </div>
                        <div className="mt-1.5 h-1.5 bg-gray-100 rounded-full overflow-hidden">
                          <div
                            className={`h-full rounded-full ${sem === "verde" ? "bg-green-400" : sem === "amarillo" ? "bg-yellow-400" : "bg-red-400"}`}
                            style={{ width: `${Math.min(efic, 100)}%` }}
                          />
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            <div className="bg-white rounded-xl shadow-sm p-5">
              <h3 className="font-bold text-gray-700 mb-3">
                {fechaBuscar ? `Historial — ${fechaBuscar}` : `Historial — últimos ${rango} días`}
              </h3>
              {diasOrdenados.length === 0 ? (
                <p className="text-gray-400 text-sm text-center py-6">Sin actividad</p>
              ) : (
                <div className="space-y-2 max-h-64 overflow-y-auto">
                  {diasOrdenados.map(([dia, dat]) => {
                    const efic = dat.cargado > 0 ? (dat.entregado / dat.cargado) * 100 : 100;
                    const sem: Semaforo = efic >= 95 ? "verde" : efic >= 85 ? "amarillo" : "rojo";
                    const barW = Math.round((dat.entregado / maxEntregado) * 100);
                    return (
                      <div key={dia} className="flex items-center gap-3">
                        <span className="text-xs text-gray-500 w-16 flex-shrink-0">{dia}</span>
                        <div className="flex-1 h-5 bg-gray-100 rounded-full overflow-hidden">
                          <div
                            className={`h-full rounded-full flex items-center justify-end pr-1 text-white text-xs font-medium transition-all ${
                              sem === "verde" ? "bg-green-400" : sem === "amarillo" ? "bg-yellow-400" : "bg-red-400"
                            }`}
                            style={{ width: `${Math.max(barW, 8)}%` }}
                          >
                            {dat.entregado > 0 && dat.entregado}
                          </div>
                        </div>
                        <span className="text-lg flex-shrink-0">{SEMAFORO_CFG[sem].icon}</span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          <div className="bg-white rounded-xl shadow-sm p-5">
            <h3 className="font-bold text-gray-700 mb-3">Registros individuales ({recientes.length})</h3>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-xs text-gray-500 border-b">
                    <th className="text-left pb-2 pr-4">Fecha</th>
                    <th className="text-left pb-2 pr-4">Producto</th>
                    <th className="text-left pb-2 pr-4">Ruta</th>
                    <th className="text-right pb-2 pr-4">Cargado</th>
                    <th className="text-right pb-2 pr-4">Entregado</th>
                    <th className="text-right pb-2">Diff</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {recientes.length === 0 ? (
                    <tr><td colSpan={6} className="text-center py-6 text-gray-400">Sin registros</td></tr>
                  ) : recientes.map((r) => {
                    const diff = (r.cantidadCargada ?? 0) - (r.cantidadEntregada ?? 0);
                    return (
                      <tr key={r.id} className="hover:bg-gray-50">
                        <td className="py-2 pr-4 text-gray-500 text-xs">{fmtDate(r.timestamp)}</td>
                        <td className="py-2 pr-4 font-medium text-gray-800">{r.producto}</td>
                        <td className="py-2 pr-4 text-gray-500 text-xs">{r.ruta}</td>
                        <td className="py-2 pr-4 text-right">{r.cantidadCargada}</td>
                        <td className="py-2 pr-4 text-right text-green-600">{r.cantidadEntregada}</td>
                        <td className={`py-2 text-right font-medium ${diff > 0 ? "text-orange-500" : "text-gray-400"}`}>
                          {diff > 0 ? `+${diff}` : diff}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      {/* ── Talonario ── */}
      {subTab === "talonario" && (
        <div className="bg-white rounded-xl shadow-sm p-5">
          <h3 className="font-bold text-gray-700 mb-4">📋 Talonario de movimientos</h3>
          {talonarios.length === 0 ? (
            <p className="text-gray-400 text-sm text-center py-12">Sin registros de talonario</p>
          ) : (
            <div className="space-y-3">
              {talonarios.map((t) => (
                <div key={t.id} className="border border-gray-100 rounded-xl p-4">
                  <div className="flex items-center gap-3 mb-2">
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                      t.fuente === "cuarto_frio" ? "bg-blue-50 text-blue-700" :
                      t.fuente === "despacho"    ? "bg-green-50 text-green-700" :
                                                   "bg-purple-50 text-purple-700"
                    }`}>
                      {t.fuente === "cuarto_frio" ? "🥶 Cuarto Frío" :
                       t.fuente === "despacho"    ? "🚛 Despacho" : "👑 Admin"}
                    </span>
                    <span className={`text-xs px-2 py-0.5 rounded-full ${
                      t.tipo === "retirada" ? "bg-orange-50 text-orange-700" : "bg-teal-50 text-teal-700"
                    }`}>
                      {t.tipo === "retirada" ? "↑ Retirada" : "↓ Agregada"}
                    </span>
                    <span className="ml-auto text-xs text-gray-400">{fmtDate(t.timestamp)}</span>
                  </div>
                  <div className="flex flex-wrap gap-1.5 mb-2">
                    {(t.productos ?? []).map((p, i) => (
                      <span key={i} className={`text-xs px-2 py-0.5 rounded border ${
                        p.visto === "ok"  ? "bg-green-50 text-green-700 border-green-200" :
                        p.visto === "mal" ? "bg-red-50 text-red-700 border-red-200" :
                                           "bg-gray-50 text-gray-600 border-gray-200"
                      }`}>
                        {p.visto === "ok" ? "✅" : p.visto === "mal" ? "❌" : ""} {p.nombre} ×{p.cantidad}
                      </span>
                    ))}
                  </div>
                  {t.observaciones && (
                    <p className="text-xs text-gray-500 bg-gray-50 rounded px-2 py-1">
                      📝 {t.observaciones}
                    </p>
                  )}
                  <p className="text-xs text-gray-400 mt-1">Despachador: {t.despachadorNombre}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── Modal detalle por producto ── */}
      {selectedProd && (() => {
        const dat = porProducto[selectedProd];
        if (!dat) return null;
        const efic = dat.cargado > 0 ? (dat.entregado / dat.cargado) * 100 : 100;
        const sem: Semaforo = efic >= 95 ? "verde" : efic >= 85 ? "amarillo" : "rojo";
        const registrosProd = recientes.filter((r) => r.producto === selectedProd);
        return (
          <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={() => setSelectedProd(null)}>
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[85vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
              <div className="flex items-center justify-between px-5 py-4 border-b flex-shrink-0">
                <div>
                  <h2 className="font-bold text-gray-800 text-lg">{selectedProd}</h2>
                  <p className="text-xs text-gray-500">{chofer.nombre} · {registrosProd.length} registros</p>
                </div>
                <button onClick={() => setSelectedProd(null)} className="text-gray-400 hover:text-gray-600 text-2xl leading-none active:scale-95">×</button>
              </div>
              <div className="flex-1 overflow-y-auto p-5 space-y-4">
                {/* KPIs */}
                <div className="grid grid-cols-3 gap-3">
                  <div className="bg-blue-50 rounded-xl p-3 text-center">
                    <p className="text-xl font-bold text-blue-700">{dat.cargado}</p>
                    <p className="text-xs text-blue-500">Cargado</p>
                  </div>
                  <div className="bg-green-50 rounded-xl p-3 text-center">
                    <p className="text-xl font-bold text-green-700">{dat.entregado}</p>
                    <p className="text-xs text-green-500">Entregado</p>
                  </div>
                  <div className={`rounded-xl p-3 text-center ${SEMAFORO_CFG[sem].bg}`}>
                    <p className={`text-xl font-bold ${SEMAFORO_CFG[sem].color}`}>{efic.toFixed(0)}%</p>
                    <p className={`text-xs ${SEMAFORO_CFG[sem].color} opacity-75`}>Eficiencia</p>
                  </div>
                </div>
                <div className="grid grid-cols-3 gap-3">
                  <div className="bg-gray-50 rounded-xl p-3 text-center">
                    <p className="text-lg font-bold text-gray-700">{dat.cargado - dat.entregado}</p>
                    <p className="text-xs text-gray-400">Diferencia</p>
                  </div>
                  {dat.cajas > 0 && (
                    <div className="bg-cyan-50 rounded-xl p-3 text-center">
                      <p className="text-lg font-bold text-cyan-700">{dat.cajas}</p>
                      <p className="text-xs text-cyan-500">Cajas</p>
                    </div>
                  )}
                  {dat.peso > 0 && (
                    <div className="bg-purple-50 rounded-xl p-3 text-center">
                      <p className="text-lg font-bold text-purple-700">{dat.peso.toFixed(1)}</p>
                      <p className="text-xs text-purple-500">Peso (kg)</p>
                    </div>
                  )}
                  {dat.monto > 0 && (
                    <div className="bg-emerald-50 rounded-xl p-3 text-center">
                      <p className="text-lg font-bold text-emerald-700">${dat.monto.toLocaleString()}</p>
                      <p className="text-xs text-emerald-500">Monto</p>
                    </div>
                  )}
                </div>
                {/* Barra eficiencia */}
                <div>
                  <div className="flex justify-between text-xs text-gray-500 mb-1">
                    <span>{SEMAFORO_CFG[sem].icon} {SEMAFORO_CFG[sem].label}</span>
                    <span>{dat.veces} viaje{dat.veces !== 1 ? "s" : ""}</span>
                  </div>
                  <div className="h-3 bg-gray-100 rounded-full overflow-hidden">
                    <div
                      className={`h-full rounded-full ${sem === "verde" ? "bg-green-400" : sem === "amarillo" ? "bg-yellow-400" : "bg-red-400"}`}
                      style={{ width: `${Math.min(efic, 100)}%` }}
                    />
                  </div>
                </div>
                {/* Registros individuales */}
                {registrosProd.length > 0 && (
                  <div>
                    <p className="text-xs font-medium text-gray-600 mb-2">Registros individuales</p>
                    <div className="space-y-1.5 max-h-48 overflow-y-auto">
                      {registrosProd.map((r) => {
                        const diff = (r.cantidadCargada ?? 0) - (r.cantidadEntregada ?? 0);
                        return (
                          <div key={r.id} className="flex items-center gap-3 text-xs border border-gray-100 rounded-lg px-3 py-2">
                            <span className="text-gray-400 flex-shrink-0">{fmtDate(r.timestamp)}</span>
                            <span className="text-blue-600 font-medium">{r.cantidadCargada} carg.</span>
                            <span className="text-green-600 font-medium">{r.cantidadEntregada} entr.</span>
                            {diff !== 0 && <span className={`font-semibold ${diff > 0 ? "text-orange-500" : "text-gray-400"}`}>+{diff}</span>}
                            {r.ruta && <span className="text-gray-400 truncate ml-auto">{r.ruta}</span>}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        );
      })()}

      {/* ── Inventario (drivers collection) ── */}
      {subTab === "inventario" && (
        <div className="bg-white rounded-xl shadow-sm p-5">
          <h3 className="font-bold text-gray-700 mb-4">📦 Inventario FacturaScan</h3>
          {invLocked ? (
            <div className="space-y-3 max-w-sm">
              <p className="text-sm text-gray-500">Ingresa tu contraseña Admin para editar el inventario del chofer.</p>
              <input
                type="password" value={invPwd} onChange={(e) => setInvPwd(e.target.value)}
                placeholder="Contraseña Admin"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm outline-none focus:ring-2 focus:ring-purple-400"
              />
              <button
                onClick={unlockInventario} disabled={!invPwd}
                className="w-full bg-purple-600 hover:bg-purple-700 active:scale-95 text-white
                  py-2.5 rounded-lg text-sm font-semibold transition-all duration-100 disabled:opacity-60"
              >
                🔓 Desbloquear
              </button>
            </div>
          ) : (
            <div className="space-y-4">
              {driverEntregas.length === 0 && editEntregas.length === 0 ? (
                <p className="text-gray-400 text-sm text-center py-6">Sin inventario registrado en FacturaScan</p>
              ) : (
                <div className="space-y-2">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-xs text-gray-400 border-b">
                        <th className="text-left pb-1.5 pr-2">Producto</th>
                        <th className="text-right pb-1.5 pr-2 w-20">Cant.</th>
                        <th className="text-right pb-1.5 pr-2 w-24">Precio</th>
                        <th className="text-right pb-1.5 pr-2 w-20">Puntos</th>
                        <th className="pb-1.5 w-8"></th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-50">
                  {editEntregas.map((p, i) => (
                    <tr key={i}>
                      <td className="py-1 pr-2">
                      <input
                        value={p.nombre}
                        onChange={(e) => updateEdit(i, "nombre", e.target.value)}
                        className="w-full px-2 py-1.5 border border-gray-200 rounded text-sm outline-none focus:ring-1 focus:ring-purple-400"
                        placeholder="Producto"
                      />
                      </td>
                      <td className="py-1 pr-2">
                      <input
                        type="number"
                        value={p.cantidad}
                        onChange={(e) => updateEdit(i, "cantidad", Number(e.target.value))}
                        className="w-full px-2 py-1.5 border border-gray-200 rounded text-sm text-right outline-none focus:ring-1 focus:ring-purple-400"
                      />
                      </td>
                      <td className="py-1 pr-2">
                      <input
                        type="number"
                        value={p.precio ?? ""}
                        onChange={(e) => updateEdit(i, "precio", e.target.value ? Number(e.target.value) : 0)}
                        className="w-full px-2 py-1.5 border border-gray-200 rounded text-sm text-right outline-none focus:ring-1 focus:ring-purple-400"
                        placeholder="$"
                      />
                      </td>
                      <td className="py-1 pr-2">
                      <input
                        type="number"
                        value={p.puntos ?? ""}
                        onChange={(e) => updateEdit(i, "puntos", e.target.value ? Number(e.target.value) : 0)}
                        className="w-full px-2 py-1.5 border border-gray-200 rounded text-sm text-right outline-none focus:ring-1 focus:ring-yellow-400"
                        placeholder="pts"
                      />
                      </td>
                      <td className="py-1">
                      <button
                        onClick={() => setEditEntregas((prev) => prev.filter((_, idx) => idx !== i))}
                        className="text-gray-300 hover:text-red-400 text-lg"
                      >×</button>
                      </td>
                    </tr>
                  ))}
                    </tbody>
                  </table>
                </div>
                  <button
                    onClick={() => setEditEntregas((p) => [...p, { nombre: "", cantidad: 1, unidad: "cajas" }])}
                    className="w-full py-2 border-2 border-dashed border-gray-200 rounded-lg text-xs text-gray-400 hover:border-purple-300 hover:text-purple-500 transition"
                  >
                    + Agregar producto
                  </button>
                </div>
              )}
              {invMsg && (
                <div className={`text-sm px-3 py-2 rounded-lg ${invMsg.type === "ok" ? "bg-green-50 text-green-700 border border-green-200" : "bg-red-50 text-red-700 border border-red-200"}`}>
                  {invMsg.text}
                </div>
              )}
              <button
                onClick={saveInventario} disabled={invLoading}
                className="w-full bg-purple-600 hover:bg-purple-700 active:scale-95 text-white
                  py-2.5 rounded-lg text-sm font-semibold transition-all duration-100 disabled:opacity-60"
              >
                {invLoading ? "Guardando..." : "💾 Guardar Inventario"}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function StatCard({ label, value, icon, color }: { label: string; value: string | number; icon: string; color: string }) {
  return (
    <div className={`${color} rounded-xl p-3 text-center`}>
      <p className="text-xl mb-0.5">{icon}</p>
      <p className="text-xl font-bold leading-tight">{value}</p>
      <p className="text-xs opacity-75 mt-0.5">{label}</p>
    </div>
  );
}
