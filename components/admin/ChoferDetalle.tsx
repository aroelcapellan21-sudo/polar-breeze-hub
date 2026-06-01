"use client";

import { useEffect, useMemo, useState } from "react";
import PasswordInput from "@/components/shared/PasswordInput";
import {
  collection, query, where, orderBy, onSnapshot,
  doc, getDoc, setDoc, addDoc, Timestamp,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import { reauthenticateWithCredential, EmailAuthProvider } from "firebase/auth";
import {
  UserProfile, ImbentarioRecord, InventarioBaseItem,
  calcSemaforo, Semaforo, toDate, fmtDate, ProductoItem, TalonarioDoc, MovimientoLoker,
  PreciosConfig, PuntosConfig,
} from "@/lib/types";
import { ShareBar } from "@/components/shared/ShareButtons";
import { pbHeader, pbFooter } from "@/lib/wa-format";
import { pbPrintDoc, pbTable } from "@/lib/print-template";
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

type SubTab = "stats" | "talonario" | "inventario" | "extras";

export default function ChoferDetalle({ chofer, onBack }: Props) {
  const [records,       setRecords]       = useState<ImbentarioRecord[]>([]);
  const [talonarios,    setTalonarios]    = useState<TalonarioDoc[]>([]);
  const [extrasChofer,  setExtrasChofer]  = useState<(MovimientoLoker & { id: string })[]>([]);
  const [driverEntregas, setDriverEntregas] = useState<ProductoItem[]>([]);
  const [invBase,        setInvBase]        = useState<InventarioBaseItem[]>([]);
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
  const [detalleModal, setDetalleModal] = useState<string | null>(null);

  // Precios / puntos config + modal inventario base
  const [preciosConfig, setPreciosConfig] = useState<PreciosConfig | null>(null);
  const [puntosConfig,  setPuntosConfig]  = useState<PuntosConfig | null>(null);
  const [selectedInvBase, setSelectedInvBase] = useState<InventarioBaseItem | null>(null);

  // Edición inventario base
  const [invBaseOverride, setInvBaseOverride] = useState<InventarioBaseItem[] | null>(null);
  const [editingBase,     setEditingBase]     = useState(false);
  const [editInvBase,     setEditInvBase]     = useState<InventarioBaseItem[]>([]);
  const [confirmSaveBase, setConfirmSaveBase] = useState(false);
  const [savingBase,      setSavingBase]      = useState(false);
  const [invBaseMsg,      setInvBaseMsg]      = useState<{ type: "ok" | "err"; text: string } | null>(null);

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
    const q3 = query(collection(db, "movimientos_loker"), where("choferId", "==", chofer.uid));
    const u1 = onSnapshot(q,  (snap) => setRecords(snap.docs.map((d) => ({ id: d.id, ...d.data() } as ImbentarioRecord))));
    const u2 = onSnapshot(q2, (snap) => setTalonarios(snap.docs.map((d) => ({ id: d.id, ...d.data() } as TalonarioDoc))));
    const u3 = onSnapshot(q3, (snap) => {
      const allMovs = snap.docs.map(
        (d) => ({ id: d.id, ...d.data() } as MovimientoLoker & { id: string }),
      );

      // Extras (tienen campo categoria)
      const extras = allMovs
        .filter((d) => !!(d as { categoria?: string }).categoria)
        .sort((a, b) => toDate(b.timestamp).getTime() - toDate(a.timestamp).getTime());
      setExtrasChofer(extras);

      // Inventario base — todos los movimientos tipo entrada_consignacion_inicial
      // sin ningún filtro de fecha para capturar datos históricos
      const baseMap = new Map<string, InventarioBaseItem>();
      for (const m of allMovs) {
        if (m.tipo !== "entrada_consignacion_inicial") continue;
        const prev = baseMap.get(m.producto_id) ?? {
          nombre: m.nombre, producto_id: m.producto_id, cantidad: 0,
        };
        baseMap.set(m.producto_id, { ...prev, cantidad: prev.cantidad + m.cantidad });
      }
      const baseList = Array.from(baseMap.values()).sort((a, b) => b.cantidad - a.cantidad);
      setInvBase(baseList);
    });
    return () => { u1(); u2(); u3(); };
  }, [chofer.uid]);

  // Load precios y puntos desde config
  useEffect(() => {
    getDoc(doc(db, "config", "precios")).then((snap) => {
      if (snap.exists()) setPreciosConfig(snap.data() as PreciosConfig);
    });
    getDoc(doc(db, "config", "puntos")).then((snap) => {
      if (snap.exists()) setPuntosConfig(snap.data() as PuntosConfig);
    });
  }, []);

  // Load driver entregas (FacturaScan editable)
  useEffect(() => {
    getDoc(doc(db, "drivers", chofer.uid)).then((snap) => {
      if (!snap.exists()) return;
      const data = snap.data();
      const entregas = Array.isArray(data.entregas) ? (data.entregas as ProductoItem[]) : [];
      setDriverEntregas(entregas);
      setEditEntregas(JSON.parse(JSON.stringify(entregas)));
      if (Array.isArray(data.inventarioBase)) {
        setInvBaseOverride(data.inventarioBase as InventarioBaseItem[]);
      }
    });
  }, [chofer.uid]);

  // Inventario base efectivo: override manual si existe, sino calculado de movimientos
  const activeInvBase = useMemo(
    () => invBaseOverride ?? invBase,
    [invBaseOverride, invBase],
  );

  const totalInvRD = useMemo(() => {
    if (!preciosConfig || activeInvBase.length === 0) return null;
    return activeInvBase.reduce((s, p) => {
      const pc = preciosConfig.productos.find((x) => x.producto_id === p.producto_id);
      return s + (pc ? p.cantidad * pc.precio : 0);
    }, 0);
  }, [activeInvBase, preciosConfig]);

  const totalInvPts = useMemo(() => {
    if (!puntosConfig || activeInvBase.length === 0) return null;
    return activeInvBase.reduce((s, p) => {
      const pc = puntosConfig.productos.find((x) => x.nombre === p.nombre);
      return s + (pc ? p.cantidad * pc.puntos : 0);
    }, 0);
  }, [activeInvBase, puntosConfig]);

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

  const totalPuntosRecientes = useMemo(() => {
    if (!puntosConfig) return 0;
    const map: Record<string, number> = {};
    puntosConfig.productos.forEach((p) => { map[p.nombre.toLowerCase().trim()] = p.puntos; });
    return recientes.reduce((s, r) => {
      const pts = map[(r.producto ?? "").toLowerCase().trim()] ?? 0;
      return s + (r.cantidadEntregada ?? 0) * pts;
    }, 0);
  }, [recientes, puntosConfig]);

  // Inventario base — edición y guardado
  const startEditBase = () => {
    setEditInvBase(JSON.parse(JSON.stringify(activeInvBase)));
    setEditingBase(true);
  };

  const saveInvBase = async () => {
    setSavingBase(true);
    try {
      await setDoc(doc(db, "drivers", chofer.uid), {
        inventarioBase: editInvBase,
        updatedAt: new Date(),
      }, { merge: true });
      setInvBaseOverride([...editInvBase]);
      setEditingBase(false);
      setConfirmSaveBase(false);
      setInvBaseMsg({ type: "ok", text: "Inventario base actualizado ✓" });
    } catch (e) {
      setInvBaseMsg({ type: "err", text: e instanceof Error ? e.message : "Error al guardar" });
    } finally {
      setSavingBase(false);
      setTimeout(() => setInvBaseMsg(null), 4000);
    }
  };

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
      <div className="space-y-2">
        <div className="grid grid-cols-4 gap-2">
          {([
            { key: "stats",      emoji: "📊", label: "Stats" },
            { key: "talonario",  emoji: "📋", label: "Talonario" },
            { key: "inventario", emoji: "📦", label: "Inventario" },
            { key: "extras",     emoji: "⭐", label: "Extras" },
          ] as { key: SubTab; emoji: string; label: string }[]).map((t) => (
            <button
              key={t.key}
              onClick={() => setSubTab(t.key)}
              className={`flex flex-col items-center gap-2 py-5 px-1 rounded-xl transition-all duration-100 active:scale-95 ${
                subTab === t.key
                  ? "bg-purple-600 text-white shadow-lg"
                  : "bg-white text-gray-500 border border-gray-200 hover:bg-gray-50"
              }`}
            >
              <span className="text-3xl leading-none">{t.emoji}</span>
              <span className="text-base font-extrabold leading-tight">{t.label}</span>
            </button>
          ))}
        </div>
        <div className="flex justify-end">
          <ShareBar
            getMessage={() => {
              const periodo = fechaBuscar || `últimos ${rango} días`;
              const lines = [pbHeader(), `📦 *${chofer.nombre}* — ficha ${chofer.ficha ?? "—"}`, ""];
              if (activeInvBase.length > 0) {
                lines.push("📋 *Inventario Base:*");
                activeInvBase.forEach((p) => lines.push(`  • ${p.nombre}: ${p.cantidad} uds`));
                if (totalInvRD != null) lines.push(`  💵 Total: RD$${totalInvRD.toLocaleString("es-DO")}`);
                if (totalInvPts != null) lines.push(`  ⭐ Puntos: ${totalInvPts.toLocaleString()}`);
                lines.push("");
              }
              lines.push(`📊 *Estadísticas — ${periodo}:*`,
                `• Cargado: ${totalCargado} uds`, `• Entregado: ${totalEntregado} uds`, `• Diferencia: ${diferencia}`);
              if (totalMonto > 0)           lines.push(`• Monto: RD$${totalMonto.toLocaleString("es-DO")}`);
              if (totalPuntosRecientes > 0) lines.push(`• Puntos período: ${totalPuntosRecientes.toLocaleString()}`);
              if (Object.keys(porProducto).length) {
                lines.push("", "Productos:");
                Object.entries(porProducto).forEach(([prod, d]) =>
                  lines.push(`  • ${prod}: ${d.entregado}/${d.cargado} entregado`));
              }
              lines.push("", pbFooter());
              return lines.join("\n");
            }}
            getPrintHtml={() => {
              const periodo = fechaBuscar || `últimos ${rango} días`;
              const invSection = activeInvBase.length > 0 ? `
                <div class="sec-title">Inventario Base</div>
                ${pbTable(
                  ["Producto", "Cantidad"],
                  activeInvBase.map((p) => [p.nombre, p.cantidad]),
                  totalInvRD != null
                    ? ["TOTAL", `RD$${totalInvRD.toLocaleString("es-DO")} · ${totalInvPts?.toLocaleString() ?? "—"} pts`]
                    : undefined,
                )}` : "";
              const statsSection = `
                <div class="sec-title">Estadísticas — ${periodo}</div>
                ${pbTable(
                  ["Concepto", "Valor"],
                  [
                    ["Unidades cargadas",   totalCargado],
                    ["Unidades entregadas", totalEntregado],
                    ["Diferencia",          diferencia],
                    ...(totalMonto > 0          ? [["Monto RD$",        `RD$${totalMonto.toLocaleString("es-DO")}`]] : []),
                    ...(totalPuntosRecientes > 0 ? [["Puntos del período", totalPuntosRecientes.toLocaleString()]]  : []),
                  ],
                )}`;
              const prodsSection = Object.keys(porProducto).length > 0 ? `
                <div class="sec-title">Detalle por Producto</div>
                ${pbTable(
                  ["Producto", "Cargado", "Entregado", "Diferencia", "Monto RD$"],
                  Object.entries(porProducto).map(([prod, d]) => [
                    prod, d.cargado, d.entregado, d.cargado - d.entregado,
                    d.monto > 0 ? `RD$${d.monto.toLocaleString("es-DO")}` : "—",
                  ]),
                )}` : "";
              return pbPrintDoc(
                `CHOFER: ${chofer.nombre}`,
                `Ficha: ${chofer.ficha ?? "—"} · Período: ${periodo}`,
                invSection + statsSection + prodsSection,
              );
            }}
          />
        </div>
      </div>

      {/* ── Stats ── */}
      {subTab === "stats" && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            <StatCard label="Unidades cargadas"   value={totalCargado}   icon="📥" color="bg-blue-50 text-blue-700"    onClick={() => setDetalleModal("cargado")} />
            <StatCard label="Unidades entregadas" value={totalEntregado} icon="📤" color="bg-green-50 text-green-700"  onClick={() => setDetalleModal("entregado")} />
            <StatCard label="Diferencia"          value={diferencia}     icon="⚡" color={diferencia > 0 ? "bg-orange-50 text-orange-700" : "bg-gray-50 text-gray-600"} onClick={() => setDetalleModal("diferencia")} />
            <StatCard label="Cajas"               value={totalCajas || "—"} icon="📦" color="bg-cyan-50 text-cyan-700" onClick={() => setDetalleModal("cajas")} />
            <StatCard label="Peso total (kg)"     value={totalPeso ? totalPeso.toFixed(1) : "—"} icon="⚖️" color="bg-purple-50 text-purple-700" onClick={() => setDetalleModal("peso")} />
          </div>

          {totalMonto > 0 && (
            <button onClick={() => setDetalleModal("monto")} className="w-full bg-green-50 border border-green-200 rounded-xl p-4 flex items-center gap-3 active:scale-95 transition-all duration-100 hover:shadow-md text-left">
              <span className="text-2xl">💰</span>
              <div>
                <p className="text-xs text-green-600">Ventas / Monto acumulado</p>
                <p className="text-2xl font-bold text-green-700">${totalMonto.toLocaleString()}</p>
              </div>
              <span className="ml-auto text-gray-300 text-lg">›</span>
            </button>
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
                      <button key={dia} onClick={() => setDetalleModal(`dia:${dia}`)} className="w-full flex items-center gap-3 active:scale-[0.99] transition-all duration-100 rounded hover:bg-gray-50 px-1">
                        <span className="text-xs text-gray-500 w-16 flex-shrink-0 text-left">{dia}</span>
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
                      </button>
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

      {/* ── Extras ── */}
      {subTab === "extras" && (() => {
        const extrasRecientes = extrasChofer.filter((r) => {
          const d = toDate(r.timestamp);
          if (fechaBuscar) {
            return d >= new Date(fechaBuscar + "T00:00:00") && d <= new Date(fechaBuscar + "T23:59:59");
          }
          return d >= cutoff;
        });
        const retirosExt = extrasRecientes.filter((e) => (e as { categoria?: string }).categoria === "retiro_despacho");
        const agr1Ext    = extrasRecientes.filter((e) => (e as { categoria?: string }).categoria === "agregado_1");
        const agr0Ext    = extrasRecientes.filter((e) => (e as { categoria?: string }).categoria === "agregado_0");

        const renderLista = (items: (MovimientoLoker & { id: string })[], colorRow: string, badge?: string) =>
          items.length === 0 ? (
            <p className="text-sm text-gray-400 text-center py-4">Sin registros en este período</p>
          ) : (
            <div className="space-y-1.5">
              {items.map((r) => (
                <div key={r.id} className={`flex items-center gap-2 text-sm px-3 py-2 rounded-lg ${colorRow}`}>
                  <span className="text-gray-400 text-xs flex-shrink-0 w-24">{fmtDate(r.timestamp)}</span>
                  <span className="font-medium flex-1 truncate">{r.nombre}</span>
                  <span className="font-bold flex-shrink-0">{r.cantidad > 0 ? `+${r.cantidad}` : `×${Math.abs(r.cantidad)}`}</span>
                  {badge && <span className="text-xs bg-white/60 px-1.5 py-0.5 rounded flex-shrink-0">{badge}</span>}
                  {(r as { motivo?: string }).motivo && (
                    <span className="text-gray-400 text-xs truncate max-w-[100px]">{(r as { motivo?: string }).motivo}</span>
                  )}
                </div>
              ))}
            </div>
          );

        return (
          <div className="space-y-4">
            {/* Resumen */}
            <div className="grid grid-cols-3 gap-3">
              <button onClick={() => setDetalleModal("extras_retiro")} className="bg-orange-50 rounded-xl p-3 text-center active:scale-95 transition-all duration-100 hover:shadow-md">
                <p className="text-xl font-bold text-orange-700">{retirosExt.reduce((s, r) => s + r.cantidad, 0)}</p>
                <p className="text-xs text-orange-500">Retirados</p>
              </button>
              <button onClick={() => setDetalleModal("extras_agr1")} className="bg-green-50 rounded-xl p-3 text-center active:scale-95 transition-all duration-100 hover:shadow-md">
                <p className="text-xl font-bold text-green-700">{agr1Ext.reduce((s, r) => s + Math.abs(r.cantidad), 0)}</p>
                <p className="text-xs text-green-500">Agr. c/puntos</p>
              </button>
              <button onClick={() => setDetalleModal("extras_agr0")} className="bg-slate-50 rounded-xl p-3 text-center active:scale-95 transition-all duration-100 hover:shadow-md">
                <p className="text-xl font-bold text-slate-600">{agr0Ext.reduce((s, r) => s + Math.abs(r.cantidad), 0)}</p>
                <p className="text-xs text-slate-400">Agr. s/puntos</p>
              </button>
            </div>

            {/* Retirados */}
            <div className="bg-white rounded-xl shadow-sm p-4">
              <h4 className="font-bold text-orange-700 text-sm mb-3">📦 Productos Retirados ({retirosExt.length})</h4>
              {renderLista(retirosExt, "bg-orange-50 text-orange-800")}
            </div>

            {/* Agregado 1 */}
            <div className="bg-white rounded-xl shadow-sm p-4">
              <h4 className="font-bold text-green-700 text-sm mb-3">✅ Agregado 1 — Con Puntos ({agr1Ext.length})</h4>
              {renderLista(agr1Ext, "bg-green-50 text-green-800", "⭐ pts")}
            </div>

            {/* Agregado 0 */}
            <div className="bg-white rounded-xl shadow-sm p-4">
              <h4 className="font-bold text-slate-600 text-sm mb-3">⚪ Agregado 0 — Sin Puntos ({agr0Ext.length})</h4>
              {renderLista(agr0Ext, "bg-slate-50 text-slate-700", "Sin pts")}
            </div>
          </div>
        );
      })()}

      {/* ── Modal detalle de KPI ── */}
      {detalleModal && (() => {
        const isDia = detalleModal.startsWith("dia:");
        const diaKey = isDia ? detalleModal.slice(4) : "";
        const diaData = isDia ? porDia[diaKey] : null;

        const title =
          detalleModal === "cargado"       ? "📥 Unidades cargadas"
          : detalleModal === "entregado"   ? "📤 Unidades entregadas"
          : detalleModal === "diferencia"  ? "⚡ Diferencia"
          : detalleModal === "cajas"       ? "📦 Cajas"
          : detalleModal === "peso"        ? "⚖️ Peso total"
          : detalleModal === "monto"       ? "💰 Monto acumulado"
          : detalleModal === "extras_retiro" ? "📦 Productos Retirados"
          : detalleModal === "extras_agr1"   ? "✅ Agregado 1 — Con Puntos"
          : detalleModal === "extras_agr0"   ? "⚪ Agregado 0 — Sin Puntos"
          : isDia ? `📅 ${diaKey}` : "";

        return (
          <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={() => setDetalleModal(null)}>
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[85vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
              <div className="flex items-center justify-between px-5 py-4 border-b flex-shrink-0">
                <div>
                  <h2 className="font-bold text-gray-800 text-lg">{title}</h2>
                  <p className="text-xs text-gray-500">{chofer.nombre} · {recientes.length} registros</p>
                </div>
                <button onClick={() => setDetalleModal(null)} className="text-gray-400 hover:text-gray-600 text-2xl leading-none active:scale-95">×</button>
              </div>
              <div className="flex-1 overflow-y-auto p-5 space-y-3">
                {(detalleModal === "cargado" || detalleModal === "entregado" || detalleModal === "diferencia") && (
                  recientes.length === 0 ? (
                    <p className="text-gray-400 text-sm text-center py-8">Sin registros en este período</p>
                  ) : (
                    <>
                      <div className="grid grid-cols-3 gap-3 mb-2">
                        <div className="bg-blue-50 rounded-xl p-3 text-center">
                          <p className="text-xl font-bold text-blue-700">{totalCargado}</p>
                          <p className="text-xs text-blue-500">Cargado</p>
                        </div>
                        <div className="bg-green-50 rounded-xl p-3 text-center">
                          <p className="text-xl font-bold text-green-700">{totalEntregado}</p>
                          <p className="text-xs text-green-500">Entregado</p>
                        </div>
                        <div className="bg-orange-50 rounded-xl p-3 text-center">
                          <p className="text-xl font-bold text-orange-700">{diferencia}</p>
                          <p className="text-xs text-orange-500">Diferencia</p>
                        </div>
                      </div>
                      {recientes.map((r) => {
                        const diff = (r.cantidadCargada ?? 0) - (r.cantidadEntregada ?? 0);
                        return (
                          <div key={r.id} className="flex items-center gap-3 text-xs border border-gray-100 rounded-lg px-3 py-2">
                            <span className="text-gray-400 flex-shrink-0">{fmtDate(r.timestamp)}</span>
                            <span className="font-medium text-gray-800 flex-1 truncate">{r.producto}</span>
                            <span className="text-blue-600">{r.cantidadCargada}↓</span>
                            <span className="text-green-600">{r.cantidadEntregada}✓</span>
                            {diff !== 0 && <span className="text-orange-500 font-semibold">+{diff}</span>}
                          </div>
                        );
                      })}
                    </>
                  )
                )}
                {detalleModal === "cajas" && (
                  totalCajas === 0 ? (
                    <p className="text-gray-400 text-sm text-center py-8">Sin registros de cajas en este período</p>
                  ) : (
                    <>
                      <div className="bg-cyan-50 rounded-xl p-4 text-center mb-2">
                        <p className="text-3xl font-bold text-cyan-700">{totalCajas}</p>
                        <p className="text-sm text-cyan-500">cajas totales</p>
                      </div>
                      {recientes.filter((r) => (r.cajas ?? 0) > 0).map((r) => (
                        <div key={r.id} className="flex items-center gap-3 text-xs border border-gray-100 rounded-lg px-3 py-2">
                          <span className="text-gray-400 flex-shrink-0">{fmtDate(r.timestamp)}</span>
                          <span className="flex-1 truncate font-medium text-gray-800">{r.producto}</span>
                          <span className="text-cyan-700 font-bold">{r.cajas} caj.</span>
                        </div>
                      ))}
                    </>
                  )
                )}
                {detalleModal === "peso" && (
                  totalPeso === 0 ? (
                    <p className="text-gray-400 text-sm text-center py-8">Sin registros de peso en este período</p>
                  ) : (
                    <>
                      <div className="bg-purple-50 rounded-xl p-4 text-center mb-2">
                        <p className="text-3xl font-bold text-purple-700">{totalPeso.toFixed(1)} kg</p>
                        <p className="text-sm text-purple-500">peso total</p>
                      </div>
                      {recientes.filter((r) => (r.peso ?? 0) > 0).map((r) => (
                        <div key={r.id} className="flex items-center gap-3 text-xs border border-gray-100 rounded-lg px-3 py-2">
                          <span className="text-gray-400 flex-shrink-0">{fmtDate(r.timestamp)}</span>
                          <span className="flex-1 truncate font-medium text-gray-800">{r.producto}</span>
                          <span className="text-purple-700 font-bold">{(r.peso ?? 0).toFixed(1)} kg</span>
                        </div>
                      ))}
                    </>
                  )
                )}
                {detalleModal === "monto" && (
                  totalMonto === 0 ? (
                    <p className="text-gray-400 text-sm text-center py-8">Sin registros de monto en este período</p>
                  ) : (
                    <>
                      <div className="bg-green-50 rounded-xl p-4 text-center mb-2">
                        <p className="text-3xl font-bold text-green-700">${totalMonto.toLocaleString()}</p>
                        <p className="text-sm text-green-500">monto acumulado</p>
                      </div>
                      {recientes.filter((r) => (r.monto ?? 0) > 0).map((r) => (
                        <div key={r.id} className="flex items-center gap-3 text-xs border border-gray-100 rounded-lg px-3 py-2">
                          <span className="text-gray-400 flex-shrink-0">{fmtDate(r.timestamp)}</span>
                          <span className="flex-1 truncate font-medium text-gray-800">{r.producto}</span>
                          <span className="text-green-700 font-bold">${(r.monto ?? 0).toLocaleString()}</span>
                        </div>
                      ))}
                    </>
                  )
                )}
                {(detalleModal === "extras_retiro" || detalleModal === "extras_agr1" || detalleModal === "extras_agr0") && (() => {
                  const cat = detalleModal === "extras_retiro" ? "retiro_despacho" : detalleModal === "extras_agr1" ? "agregado_1" : "agregado_0";
                  const items = extrasChofer.filter((e) => (e as { categoria?: string }).categoria === cat);
                  return items.length === 0 ? (
                    <p className="text-gray-400 text-sm text-center py-8">Sin registros en este período</p>
                  ) : (
                    <div className="space-y-1.5">
                      {items.map((r) => (
                        <div key={r.id} className="flex items-center gap-2 text-sm border border-gray-100 rounded-lg px-3 py-2">
                          <span className="text-gray-400 text-xs flex-shrink-0">{fmtDate(r.timestamp)}</span>
                          <span className="font-medium flex-1 truncate">{r.nombre}</span>
                          <span className="font-bold text-gray-700 flex-shrink-0">{r.cantidad > 0 ? `+${r.cantidad}` : `×${Math.abs(r.cantidad)}`}</span>
                          {(r as { motivo?: string }).motivo && (
                            <span className="text-gray-400 text-xs truncate max-w-[100px]">{(r as { motivo?: string }).motivo}</span>
                          )}
                        </div>
                      ))}
                    </div>
                  );
                })()}
                {isDia && diaData && (
                  <>
                    <div className="grid grid-cols-3 gap-3 mb-2">
                      <div className="bg-blue-50 rounded-xl p-3 text-center">
                        <p className="text-xl font-bold text-blue-700">{diaData.cargado}</p>
                        <p className="text-xs text-blue-500">Cargado</p>
                      </div>
                      <div className="bg-green-50 rounded-xl p-3 text-center">
                        <p className="text-xl font-bold text-green-700">{diaData.entregado}</p>
                        <p className="text-xs text-green-500">Entregado</p>
                      </div>
                      <div className="bg-orange-50 rounded-xl p-3 text-center">
                        <p className="text-xl font-bold text-orange-700">{diaData.cargado - diaData.entregado}</p>
                        <p className="text-xs text-orange-500">Diferencia</p>
                      </div>
                    </div>
                    {recientes.filter((r) => {
                      const d = toDate(r.timestamp);
                      return d.toLocaleDateString("es-MX", { day: "2-digit", month: "short" }) === diaKey;
                    }).map((r) => {
                      const diff = (r.cantidadCargada ?? 0) - (r.cantidadEntregada ?? 0);
                      return (
                        <div key={r.id} className="flex items-center gap-3 text-xs border border-gray-100 rounded-lg px-3 py-2">
                          <span className="text-gray-400 flex-shrink-0">{fmtDate(r.timestamp)}</span>
                          <span className="font-medium text-gray-800 flex-1 truncate">{r.producto}</span>
                          <span className="text-blue-600">{r.cantidadCargada}↓</span>
                          <span className="text-green-600">{r.cantidadEntregada}✓</span>
                          {diff !== 0 && <span className="text-orange-500 font-semibold">+{diff}</span>}
                        </div>
                      );
                    })}
                  </>
                )}
              </div>
            </div>
          </div>
        );
      })()}

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

      {/* ── Modal producto del inventario base ── */}
      {selectedInvBase && (() => {
        const precio  = preciosConfig?.productos.find((x) => x.producto_id === selectedInvBase.producto_id)?.precio ?? null;
        const puntos  = puntosConfig?.productos.find((x) => x.nombre === selectedInvBase.nombre)?.puntos ?? null;
        const totalRD  = precio !== null ? selectedInvBase.cantidad * precio : null;
        const totalPts = puntos !== null ? selectedInvBase.cantidad * puntos : null;
        return (
          <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={() => setSelectedInvBase(null)}>
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm" onClick={(e) => e.stopPropagation()}>
              <div className="flex items-center justify-between px-5 py-4 border-b">
                <div>
                  <h2 className="font-bold text-gray-800 text-lg leading-tight">{selectedInvBase.nombre}</h2>
                  <p className="text-xs text-gray-400 mt-0.5">Inventario base · {chofer.nombre}</p>
                </div>
                <button onClick={() => setSelectedInvBase(null)} className="text-gray-400 hover:text-gray-600 text-2xl leading-none active:scale-95">×</button>
              </div>
              <div className="p-5 space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <div className="bg-violet-50 rounded-xl p-3 text-center">
                    <p className="text-2xl font-bold text-violet-700">{selectedInvBase.cantidad}</p>
                    <p className="text-xs text-violet-500">Unidades asignadas</p>
                  </div>
                  <div className="bg-blue-50 rounded-xl p-3 text-center">
                    <p className="text-2xl font-bold text-blue-700">
                      {precio !== null ? `RD$${precio.toLocaleString()}` : "—"}
                    </p>
                    <p className="text-xs text-blue-500">Precio unitario</p>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="bg-green-50 rounded-xl p-3 text-center">
                    <p className="text-2xl font-bold text-green-700">
                      {totalRD !== null ? `RD$${totalRD.toLocaleString()}` : "—"}
                    </p>
                    <p className="text-xs text-green-500">Total RD$</p>
                  </div>
                  <div className="bg-yellow-50 rounded-xl p-3 text-center">
                    <p className="text-2xl font-bold text-yellow-700">
                      {puntos !== null ? puntos : "—"}
                    </p>
                    <p className="text-xs text-yellow-500">Puntos por unidad</p>
                  </div>
                </div>
                {totalPts !== null && (
                  <div className="bg-amber-50 border border-amber-100 rounded-xl p-4 text-center">
                    <p className="text-3xl font-bold text-amber-600">{totalPts.toLocaleString()}</p>
                    <p className="text-sm text-amber-500 mt-0.5">Total de puntos</p>
                  </div>
                )}
                {precio === null && puntos === null && (
                  <p className="text-xs text-gray-400 text-center py-1">
                    Sin precio ni puntos configurados para este producto
                  </p>
                )}
              </div>
            </div>
          </div>
        );
      })()}

      {/* ── Inventario base (editable por Admin) ── */}
      {subTab === "inventario" && (() => {
        const displayList = editingBase ? editInvBase : activeInvBase;
        return (
          <div className="bg-white rounded-xl shadow-sm overflow-hidden">
            {/* Cabecera */}
            <div className="px-5 py-4 bg-gradient-to-r from-violet-50 to-violet-100">
              <div className="flex items-start justify-between mb-3">
                <div>
                  <h3 className="font-bold text-violet-900 text-sm">📋 Inventario base asignado</h3>
                  <p className="text-xs text-violet-600 mt-0.5">
                    {invBaseOverride ? "Editado manualmente · " : ""}toca un producto para ver detalles
                  </p>
                </div>
                {!editingBase ? (
                  <button
                    onClick={startEditBase}
                    className="text-xs px-3 py-1.5 bg-violet-600 text-white rounded-lg font-semibold active:scale-95 hover:bg-violet-700 transition-all duration-100 flex-shrink-0"
                  >
                    ✏️ Editar
                  </button>
                ) : (
                  <div className="flex gap-1.5 flex-shrink-0">
                    <button
                      onClick={() => setEditingBase(false)}
                      className="text-xs px-2.5 py-1.5 bg-gray-200 text-gray-600 rounded-lg font-semibold active:scale-95 hover:bg-gray-300 transition-all duration-100"
                    >
                      Cancelar
                    </button>
                    <button
                      onClick={() => setConfirmSaveBase(true)}
                      className="text-xs px-3 py-1.5 bg-green-600 text-white rounded-lg font-semibold active:scale-95 hover:bg-green-700 transition-all duration-100"
                    >
                      💾 Guardar
                    </button>
                  </div>
                )}
              </div>
              {activeInvBase.length > 0 && (
                <div className="grid grid-cols-3 gap-2">
                  <div className="bg-white/70 rounded-xl p-2.5 text-center">
                    <p className="text-lg font-bold text-violet-700">
                      {displayList.reduce((s, p) => s + p.cantidad, 0)}
                    </p>
                    <p className="text-xs text-violet-500">Unidades</p>
                  </div>
                  <div className="bg-white/70 rounded-xl p-2.5 text-center">
                    <p className="text-base font-bold text-green-700">
                      {totalInvRD !== null ? `RD$${totalInvRD.toLocaleString()}` : "—"}
                    </p>
                    <p className="text-xs text-green-500">Valor total</p>
                  </div>
                  <div className="bg-white/70 rounded-xl p-2.5 text-center">
                    <p className="text-base font-bold text-amber-600">
                      {totalInvPts !== null ? totalInvPts.toLocaleString() : "—"}
                    </p>
                    <p className="text-xs text-amber-500">Puntos totales</p>
                  </div>
                </div>
              )}
            </div>

            {/* Mensaje de estado */}
            {invBaseMsg && (
              <div className={`mx-4 mt-3 text-sm px-3 py-2 rounded-lg ${invBaseMsg.type === "ok" ? "bg-green-50 text-green-700 border border-green-200" : "bg-red-50 text-red-700 border border-red-200"}`}>
                {invBaseMsg.text}
              </div>
            )}

            {/* Tabla */}
            {activeInvBase.length === 0 ? (
              <div className="px-5 py-6 text-center">
                <p className="text-2xl mb-2">📋</p>
                <p className="text-sm text-gray-400">Sin inventario base registrado</p>
                <p className="text-xs text-gray-300 mt-1">Ejecuta seed-inventario-base para cargar los datos.</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="bg-violet-50/60 text-violet-700 border-b border-violet-100">
                      <th className="text-left px-4 py-2.5 font-semibold">Producto</th>
                      <th className="text-right px-4 py-2.5 font-semibold w-28">Cantidad</th>
                      <th className="w-6"></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {displayList.map((p, i) => (
                      <tr
                        key={i}
                        onClick={editingBase ? undefined : () => setSelectedInvBase(p)}
                        className={`${editingBase ? "" : "hover:bg-violet-50/50 cursor-pointer active:bg-violet-100/60"} transition-colors`}
                      >
                        <td className="px-4 py-2.5 text-gray-700 font-medium">{p.nombre}</td>
                        <td className="px-4 py-2 text-right">
                          {editingBase ? (
                            <input
                              type="number"
                              min="0"
                              value={editInvBase[i]?.cantidad ?? 0}
                              onChange={(e) => {
                                const next = [...editInvBase];
                                next[i] = { ...next[i], cantidad: Number(e.target.value) };
                                setEditInvBase(next);
                              }}
                              className="w-20 px-2 py-1 border border-violet-300 rounded text-right text-xs outline-none focus:ring-1 focus:ring-violet-500"
                            />
                          ) : (
                            <span className="font-bold text-violet-700">{p.cantidad}</span>
                          )}
                        </td>
                        <td className="pr-3 py-2.5 text-gray-300 text-sm">{!editingBase && "›"}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="bg-violet-50/60 border-t border-violet-100 font-bold text-xs">
                      <td className="px-4 py-2.5 text-violet-700">
                        Total — {displayList.length} productos
                      </td>
                      <td className="px-4 py-2.5 text-right text-violet-700">
                        {displayList.reduce((s, p) => s + p.cantidad, 0)} uds
                      </td>
                      <td></td>
                    </tr>
                    {totalInvRD !== null && (
                      <tr className="bg-white border-t border-violet-50">
                        <td className="px-4 py-2.5 text-gray-700 font-semibold text-xs">💵 Total general RD$</td>
                        <td className="px-4 py-2.5 text-right font-extrabold text-green-700 text-sm">
                          RD${totalInvRD.toLocaleString()}
                        </td>
                        <td></td>
                      </tr>
                    )}
                    {totalInvPts !== null && (
                      <tr className="bg-amber-50/50 border-t border-amber-100">
                        <td className="px-4 py-2.5 text-gray-700 font-semibold text-xs">⭐ Total general puntos</td>
                        <td className="px-4 py-2.5 text-right font-extrabold text-amber-600 text-sm">
                          {totalInvPts.toLocaleString()} pts
                        </td>
                        <td></td>
                      </tr>
                    )}
                  </tfoot>
                </table>
              </div>
            )}

            {/* Botones al pie en modo edición */}
            {editingBase && (
              <div className="px-5 py-4 border-t border-gray-100 flex gap-2 justify-end">
                <button
                  onClick={() => setEditingBase(false)}
                  className="px-4 py-2.5 bg-gray-100 text-gray-700 rounded-xl text-sm font-semibold active:scale-95 hover:bg-gray-200 transition-all duration-100"
                >
                  Cancelar
                </button>
                <button
                  onClick={() => setConfirmSaveBase(true)}
                  className="px-5 py-2.5 bg-green-600 text-white rounded-xl text-sm font-semibold active:scale-95 hover:bg-green-700 transition-all duration-100"
                >
                  💾 Guardar cambios
                </button>
              </div>
            )}
          </div>
        );
      })()}

      {/* ── Inventario FacturaScan (editable) ── */}
      {subTab === "inventario" && (
        <div className="bg-white rounded-xl shadow-sm p-5">
          <h3 className="font-bold text-gray-700 mb-4">📦 Inventario FacturaScan</h3>
          {invLocked ? (
            <div className="space-y-3 max-w-sm">
              <p className="text-sm text-gray-500">Ingresa tu contraseña Admin para editar el inventario del chofer.</p>
              <PasswordInput
                value={invPwd} onChange={(e) => setInvPwd(e.target.value)}
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
      {/* ── Modal confirmación guardar inventario base ── */}
      {confirmSaveBase && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6 space-y-5">
            <div className="text-center">
              <p className="text-3xl mb-2">💾</p>
              <h2 className="font-extrabold text-gray-800 text-lg">¿Guardar cambios?</h2>
              <p className="text-sm text-gray-500 mt-2 leading-relaxed">
                ¿Está seguro que desea guardar los cambios en el inventario de este chofer?
              </p>
            </div>
            <div className="flex gap-3">
              <button
                onClick={() => setConfirmSaveBase(false)}
                disabled={savingBase}
                className="flex-1 py-3 bg-gray-100 text-gray-700 rounded-xl font-semibold active:scale-95 hover:bg-gray-200 transition-all duration-100 disabled:opacity-60"
              >
                Cancelar
              </button>
              <button
                onClick={saveInvBase}
                disabled={savingBase}
                className="flex-1 py-3 bg-green-600 text-white rounded-xl font-semibold active:scale-95 hover:bg-green-700 transition-all duration-100 disabled:opacity-60"
              >
                {savingBase ? "Guardando..." : "Confirmar"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function StatCard({ label, value, icon, color, onClick }: { label: string; value: string | number; icon: string; color: string; onClick?: () => void }) {
  return (
    <button onClick={onClick} className={`${color} rounded-xl p-3 text-center w-full active:scale-95 transition-all duration-100 hover:shadow-md`}>
      <p className="text-xl mb-0.5">{icon}</p>
      <p className="text-xl font-bold leading-tight">{value}</p>
      <p className="text-xs opacity-75 mt-0.5">{label}</p>
    </button>
  );
}
