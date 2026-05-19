"use client";

import { useState, useEffect, useMemo } from "react";
import {
  collection, query, orderBy, onSnapshot, addDoc, getDocs, Timestamp, where,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useAuth } from "@/lib/auth-context";
import {
  MovimientoLoker, TalonarioDoc, LoteLoker, NotaCredito, toDate, fmtDate, toProductoId,
} from "@/lib/types";
import { ShareBar }           from "@/components/shared/ShareButtons";
import { pbHeader, pbFooter } from "@/lib/wa-format";
import { pbPrintDoc, pbTable } from "@/lib/print-template";

// ─── Tipos internos ───────────────────────────────────────────────────────────

interface ResumenChofer {
  choferId:        string;
  choferNombre:    string;
  productos: {
    pid:        string;
    nombre:     string;
    despachado: number;
    sobrante:   number;
    vendido:    number;
  }[];
  totalDespachado: number;
  totalSobrante:   number;
  totalVendido:    number;
  reportado:       boolean;
}

interface SaldoDetalle {
  pid:         string;
  nombre:      string;
  saldo:       number;
  despachHoy:  number;
  sobranteHoy: number;
  vendidoHoy:  number;
}

// ─── Config de tipos de movimiento ───────────────────────────────────────────

const TIPO_CFG = {
  entrada_interior:             { label: "Entrada interior",       sign:  1, bg: "bg-green-100",  text: "text-green-700",  border: "border-green-200"  },
  entrada_consignacion_inicial: { label: "Inventario base",        sign:  1, bg: "bg-violet-100", text: "text-violet-700", border: "border-violet-200" },
  devolucion_chofer:            { label: "Devolución chofer",      sign:  1, bg: "bg-blue-100",   text: "text-blue-700",   border: "border-blue-200"   },
  salida_despacho:              { label: "Salida despacho",        sign: -1, bg: "bg-orange-100", text: "text-orange-700", border: "border-orange-200" },
  merma:                        { label: "Merma",                  sign: -1, bg: "bg-red-100",    text: "text-red-700",    border: "border-red-200"    },
  ajuste:                       { label: "Ajuste",                 sign:  0, bg: "bg-gray-100",   text: "text-gray-700",   border: "border-gray-200"   },
} as const;

type TipoLoker = MovimientoLoker["tipo"];

const TIPOS_ORDEN: TipoLoker[] = [
  "entrada_interior", "devolucion_chofer", "salida_despacho", "merma", "ajuste",
];

function getTodayStart(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function Inventario() {
  const { profile } = useAuth();

  const [movimientos,  setMovimientos]  = useState<MovimientoLoker[]>([]);
  const [talonarioHoy, setTalonarioHoy] = useState<TalonarioDoc[]>([]);
  const [cargando,     setCargando]     = useState(true);

  // Form state
  const [tipo,      setTipo]      = useState<TipoLoker>("entrada_interior");
  const [nombre,    setNombre]    = useState("");
  const [cantidad,  setCantidad]  = useState("");
  const [ajustePos, setAjustePos] = useState(true);
  const [notas,     setNotas]     = useState("");
  const [guardando, setGuardando] = useState(false);
  const [msg, setMsg]             = useState<{ type: "ok" | "err"; text: string } | null>(null);

  // UI toggles
  const [saldoAbierto,        setSaldoAbierto]        = useState(true);
  const [chofersAbierto,      setChofersAbierto]      = useState(true);
  const [movAbierto,          setMovAbierto]           = useState(false);
  const [lotesAbierto,        setLotesAbierto]        = useState(false);
  const [consigAbierto,       setConsigAbierto]       = useState(false);
  const [notasCreditoAbierto, setNotasCreditoAbierto] = useState(false);
  const [fifoAbierto,         setFifoAbierto]         = useState(false);
  const [invBaseAbierto,      setInvBaseAbierto]      = useState(false);
  const [invBaseExpanded,     setInvBaseExpanded]     = useState<string | null>(null);
  const [lotes,               setLotes]               = useState<LoteLoker[]>([]);
  const [notasCredito,        setNotasCredito]        = useState<NotaCredito[]>([]);

  // Form nota de crédito
  const [ncLoteId,    setNcLoteId]    = useState("");
  const [ncProveedor, setNcProveedor] = useState("");
  const [ncFactura,   setNcFactura]   = useState("");
  const [ncMotivo,    setNcMotivo]    = useState("Productos dañados");
  const [ncNombre,    setNcNombre]    = useState("");
  const [ncCantidad,  setNcCantidad]  = useState("");
  const [ncCosto,     setNcCosto]     = useState("");
  const [ncItems,     setNcItems]     = useState<NotaCredito["productos"]>([]);
  const [ncNotas,     setNcNotas]     = useState("");
  const [guardandoNc, setGuardandoNc] = useState(false);
  const [msgNc,       setMsgNc]       = useState<{ type: "ok" | "err"; text: string } | null>(null);

  // Modal
  type InvModal =
    | { type: "stat"; key: "loker" | "despachado" | "vendido" | "facturado" }
    | { type: "producto"; pid: string; nombre: string }
    | { type: "chofer"; ch: ResumenChofer }
    | { type: "lote"; lote: LoteLoker }
    | { type: "nota"; nc: NotaCredito }
    | null;
  const [invModal, setInvModal] = useState<InvModal>(null);

  // Timestamps estables (solo se calculan una vez por montaje)
  const todayStart = useMemo(() => getTodayStart(), []);
  const todayTs    = useMemo(() => Timestamp.fromDate(todayStart), [todayStart]);

  // ── Listener 1: movimientos_loker (tiempo real completo) ──────────────────
  useEffect(() => {
    const q = query(collection(db, "movimientos_loker"), orderBy("timestamp", "desc"));
    return onSnapshot(q, (snap) => {
      setMovimientos(snap.docs.map((d) => ({ id: d.id, ...d.data() } as MovimientoLoker)));
      setCargando(false);
    });
  }, []);

  // ── Listener 2: talonario de hoy (para calcular dinero facturado) ─────────
  useEffect(() => {
    const q = query(
      collection(db, "talonario"),
      where("timestamp", ">=", todayTs),
      orderBy("timestamp", "desc"),
    );
    const unsub = onSnapshot(q, (snap) => {
      setTalonarioHoy(snap.docs.map((d) => ({ id: d.id, ...d.data() } as TalonarioDoc)));
    }, () => {
      // Si no hay índice, fallback silencioso
      setTalonarioHoy([]);
    });
    return unsub;
  }, [todayTs]);

  // ── Listener 3: lotes_loker ───────────────────────────────────────────────
  useEffect(() => {
    const q = query(collection(db, "lotes_loker"), orderBy("timestamp", "desc"));
    return onSnapshot(q, (snap) => {
      setLotes(snap.docs.map((d) => ({ id: d.id, ...d.data() } as LoteLoker)));
    });
  }, []);

  // ── Listener 4: notas_credito ─────────────────────────────────────────────
  useEffect(() => {
    const q = query(collection(db, "notas_credito"), orderBy("timestamp", "desc"));
    return onSnapshot(q, (snap) => {
      setNotasCredito(snap.docs.map((d) => ({ id: d.id, ...d.data() } as NotaCredito)));
    }, () => setNotasCredito([]));
  }, []);

  // ── Movimientos de hoy ────────────────────────────────────────────────────
  const movHoy = useMemo(
    () => movimientos.filter((m) => toDate(m.timestamp) >= todayStart),
    [movimientos, todayStart],
  );

  // ── Saldo acumulado + desglose del día por producto ───────────────────────
  const saldoConDetalle = useMemo((): SaldoDetalle[] => {
    // Balance acumulado (todo el tiempo)
    const saldoMap = new Map<string, { nombre: string; saldo: number }>();
    for (const m of movimientos) {
      const prev = saldoMap.get(m.producto_id) ?? { nombre: m.nombre, saldo: 0 };
      saldoMap.set(m.producto_id, { nombre: m.nombre, saldo: prev.saldo + m.cantidad });
    }

    // Desglose de hoy
    const despachHoyMap  = new Map<string, number>();
    const sobranteHoyMap = new Map<string, number>();
    for (const m of movHoy) {
      if (m.tipo === "salida_despacho") {
        despachHoyMap.set(m.producto_id, (despachHoyMap.get(m.producto_id) ?? 0) + Math.abs(m.cantidad));
      }
      if (m.tipo === "devolucion_chofer") {
        sobranteHoyMap.set(m.producto_id, (sobranteHoyMap.get(m.producto_id) ?? 0) + m.cantidad);
      }
    }

    return Array.from(saldoMap.entries())
      .map(([pid, d]) => {
        const despachHoy  = despachHoyMap.get(pid)  ?? 0;
        const sobranteHoy = sobranteHoyMap.get(pid) ?? 0;
        return { pid, nombre: d.nombre, saldo: d.saldo, despachHoy, sobranteHoy, vendidoHoy: despachHoy - sobranteHoy };
      })
      .sort((a, b) => {
        // Negativos primero (alerta)
        if (a.saldo < 0 && b.saldo >= 0) return -1;
        if (b.saldo < 0 && a.saldo >= 0) return 1;
        return b.saldo - a.saldo;
      });
  }, [movimientos, movHoy]);

  // ── Resumen de sobrantes por chofer ──────────────────────────────────────
  const resumenChoferes = useMemo((): ResumenChofer[] => {
    const mapaChoferes = new Map<string, {
      nombre:         string;
      despachadoProd: Map<string, { nombre: string; cantidad: number }>;
      sobranteProd:   Map<string, { nombre: string; cantidad: number }>;
    }>();

    for (const m of movHoy) {
      if (!m.choferId || !m.choferNombre) continue;
      if (m.tipo !== "salida_despacho" && m.tipo !== "devolucion_chofer") continue;

      if (!mapaChoferes.has(m.choferId)) {
        mapaChoferes.set(m.choferId, {
          nombre:         m.choferNombre,
          despachadoProd: new Map(),
          sobranteProd:   new Map(),
        });
      }
      const ch = mapaChoferes.get(m.choferId)!;

      if (m.tipo === "salida_despacho") {
        const prev = ch.despachadoProd.get(m.producto_id) ?? { nombre: m.nombre, cantidad: 0 };
        ch.despachadoProd.set(m.producto_id, { nombre: m.nombre, cantidad: prev.cantidad + Math.abs(m.cantidad) });
      } else {
        const prev = ch.sobranteProd.get(m.producto_id) ?? { nombre: m.nombre, cantidad: 0 };
        ch.sobranteProd.set(m.producto_id, { nombre: m.nombre, cantidad: prev.cantidad + m.cantidad });
      }
    }

    return Array.from(mapaChoferes.entries())
      .map(([choferId, data]) => {
        const productos = Array.from(data.despachadoProd.entries()).map(([pid, d]) => {
          const sob = data.sobranteProd.get(pid)?.cantidad ?? 0;
          return { pid, nombre: d.nombre, despachado: d.cantidad, sobrante: sob, vendido: d.cantidad - sob };
        });
        const totalDespachado = productos.reduce((s, p) => s + p.despachado, 0);
        const totalSobrante   = productos.reduce((s, p) => s + p.sobrante,   0);
        const totalVendido    = productos.reduce((s, p) => s + p.vendido,     0);
        return {
          choferId,
          choferNombre: data.nombre,
          productos,
          totalDespachado,
          totalSobrante,
          totalVendido,
          reportado: data.sobranteProd.size > 0,
        };
      })
      .sort((a, b) => a.choferNombre.localeCompare(b.choferNombre));
  }, [movHoy]);

  // ── Inventario en consignación (acumulado histórico) ─────────────────────
  const consignacion = useMemo(() => {
    interface ProdConsig { nombre: string; cantidad: number }
    const porProducto = new Map<string, ProdConsig>();
    const porChofer   = new Map<string, { nombre: string; productos: Map<string, ProdConsig> }>();

    for (const m of movimientos) {
      if (m.tipo !== "salida_despacho" && m.tipo !== "devolucion_chofer") continue;
      if (!m.choferId) continue;
      // salida_despacho: cantidad < 0 → delta = +|cantidad| (va al chofer)
      // devolucion_chofer: cantidad > 0 → delta = -cantidad (regresa al loker)
      const delta = -m.cantidad;

      const prevP = porProducto.get(m.producto_id) ?? { nombre: m.nombre, cantidad: 0 };
      porProducto.set(m.producto_id, { nombre: m.nombre, cantidad: prevP.cantidad + delta });

      if (!porChofer.has(m.choferId)) {
        porChofer.set(m.choferId, { nombre: m.choferNombre ?? m.choferId, productos: new Map() });
      }
      const ch    = porChofer.get(m.choferId)!;
      const prevC = ch.productos.get(m.producto_id) ?? { nombre: m.nombre, cantidad: 0 };
      ch.productos.set(m.producto_id, { nombre: m.nombre, cantidad: prevC.cantidad + delta });
    }

    const listaProductos = Array.from(porProducto.entries())
      .map(([pid, d]) => ({ pid, nombre: d.nombre, cantidad: d.cantidad }))
      .filter((p) => p.cantidad > 0)
      .sort((a, b) => b.cantidad - a.cantidad);

    const listaChoferes = Array.from(porChofer.entries())
      .map(([id, d]) => ({
        id, nombre: d.nombre,
        productos: Array.from(d.productos.entries())
          .map(([pid, p]) => ({ pid, nombre: p.nombre, cantidad: p.cantidad }))
          .filter((p) => p.cantidad > 0),
        total: Array.from(d.productos.values()).reduce((s, p) => s + p.cantidad, 0),
      }))
      .filter((c) => c.total > 0)
      .sort((a, b) => b.total - a.total);

    return { listaProductos, listaChoferes,
      totalConsignado: listaProductos.reduce((s, p) => s + p.cantidad, 0) };
  }, [movimientos]);

  // ── Orden PEPS por producto (lotes más antiguos primero) ─────────────────
  const fifoData = useMemo(() => {
    // Para cada producto, qué lotes tienen unidades (en orden de antigüedad)
    const byProduct = new Map<string, {
      nombre: string;
      lotes: { loteNumero: string; fecha: Date; unidadesEntrada: number }[];
    }>();

    for (const lote of [...lotes].reverse()) { // más antiguo primero
      for (const p of lote.productos) {
        if (!byProduct.has(p.producto_id)) {
          byProduct.set(p.producto_id, { nombre: p.nombre, lotes: [] });
        }
        byProduct.get(p.producto_id)!.lotes.push({
          loteNumero: lote.numero,
          fecha: toDate(lote.timestamp),
          unidadesEntrada: p.total,
        });
      }
    }

    return Array.from(byProduct.entries())
      .map(([pid, d]) => ({ pid, nombre: d.nombre, lotes: d.lotes }))
      .filter((p) => p.lotes.length > 0)
      .sort((a, b) => a.nombre.localeCompare(b.nombre));
  }, [lotes]);

  // ── Inventario base por chofer (entrada_consignacion_inicial) ────────────
  const inventarioBase = useMemo(() => {
    const porChofer = new Map<string, {
      nombre: string;
      productos: Map<string, { nombre: string; cantidad: number }>;
    }>();

    for (const m of movimientos) {
      if (m.tipo !== "entrada_consignacion_inicial") continue;
      if (!m.choferId) continue;
      if (!porChofer.has(m.choferId)) {
        porChofer.set(m.choferId, { nombre: m.choferNombre ?? m.choferId, productos: new Map() });
      }
      const ch   = porChofer.get(m.choferId)!;
      const prev = ch.productos.get(m.producto_id) ?? { nombre: m.nombre, cantidad: 0 };
      ch.productos.set(m.producto_id, { nombre: m.nombre, cantidad: prev.cantidad + m.cantidad });
    }

    return Array.from(porChofer.entries())
      .map(([id, d]) => ({
        id,
        nombre: d.nombre,
        productos: Array.from(d.productos.entries())
          .map(([pid, p]) => ({ pid, nombre: p.nombre, cantidad: p.cantidad }))
          .sort((a, b) => b.cantidad - a.cantidad),
        total: Array.from(d.productos.values()).reduce((s, p) => s + p.cantidad, 0),
      }))
      .sort((a, b) => a.nombre.localeCompare(b.nombre));
  }, [movimientos]);

  // ── Dashboard stats del día ───────────────────────────────────────────────
  const dashboard = useMemo(() => {
    const totalEnLoker    = saldoConDetalle.reduce((s, p) => s + Math.max(0, p.saldo), 0);
    const totalDespachado = saldoConDetalle.reduce((s, p) => s + p.despachHoy, 0);
    const totalSobrante   = saldoConDetalle.reduce((s, p) => s + p.sobranteHoy, 0);

    const chofersConReport  = resumenChoferes.filter((c) => c.reportado);
    const totalVendido      = chofersConReport.reduce((s, c) => s + c.totalVendido, 0);
    const chofersReportados = chofersConReport.length;
    const chofersTotal      = resumenChoferes.length;
    const productosAlerta   = saldoConDetalle.filter((p) => p.saldo <= 0).length;

    // Dinero facturado (de talonario, precio * cantidad para cada producto con precio)
    let moneyHoy  = 0;
    let hayPrecios = false;
    for (const tal of talonarioHoy) {
      if (tal.tipo !== "retirada") continue;
      for (const p of tal.productos) {
        if (p.precio != null && p.precio > 0) {
          moneyHoy  += p.precio * (p.cantidad ?? 0);
          hayPrecios = true;
        }
      }
    }

    return {
      totalEnLoker,
      totalDespachado,
      totalSobrante,
      totalVendido,
      moneyHoy,
      hayPrecios,
      productosAlerta,
      chofersTotal,
      chofersReportados,
      pendientes: chofersTotal - chofersReportados,
    };
  }, [saldoConDetalle, resumenChoferes, talonarioHoy]);

  // ── Agregar ítem a nota de crédito ────────────────────────────────────────
  function ncAgregarItem() {
    const cant = parseInt(ncCantidad) || 0;
    if (!ncNombre.trim() || cant <= 0) return;
    const costo = parseFloat(ncCosto) || undefined;
    setNcItems((prev) => {
      const pid = toProductoId(ncNombre.trim());
      const idx = prev.findIndex((i) => i.producto_id === pid);
      if (idx >= 0) {
        return prev.map((it, i) => i === idx
          ? { ...it, cantidad: it.cantidad + cant, costoUnitario: costo ?? it.costoUnitario,
              subtotal: (costo ?? it.costoUnitario ?? 0) * (it.cantidad + cant) }
          : it
        );
      }
      return [...prev, {
        nombre: ncNombre.trim(), producto_id: pid, cantidad: cant,
        costoUnitario: costo, subtotal: costo != null ? costo * cant : undefined,
      }];
    });
    setNcNombre(""); setNcCantidad(""); setNcCosto("");
  }

  // ── Guardar nota de crédito ────────────────────────────────────────────────
  async function guardarNotaCredito() {
    if (ncItems.length === 0 || !ncMotivo.trim()) {
      setMsgNc({ type: "err", text: "Agrega al menos un producto y un motivo." });
      return;
    }
    setGuardandoNc(true); setMsgNc(null);
    try {
      const snap = await getDocs(collection(db, "notas_credito"));
      const numero    = `NC-${String(snap.size + 1).padStart(3, "0")}`;
      const totalUnid = ncItems.reduce((s, i) => s + i.cantidad, 0);
      const totalMon  = ncItems.reduce((s, i) => s + (i.subtotal ?? 0), 0);
      const loteRef   = lotes.find((l) => l.id === ncLoteId);

      const nc: Omit<NotaCredito, "id"> = {
        numero,
        loteId:      ncLoteId   || undefined,
        loteNumero:  loteRef?.numero ?? undefined,
        facturaNumero: ncFactura.trim()   || loteRef?.facturaNumero || undefined,
        proveedor:   ncProveedor.trim() || loteRef?.proveedor     || undefined,
        motivo:      ncMotivo.trim(),
        productos:   ncItems,
        totalUnidades: totalUnid,
        totalMonto:  totalMon > 0 ? totalMon : undefined,
        registradoPor:   profile?.nombre ?? "Admin",
        registradoPorId: profile?.uid    ?? "",
        timestamp:   Timestamp.now(),
        notas:       ncNotas.trim() || undefined,
        estado:      "pendiente",
      };
      await addDoc(collection(db, "notas_credito"), nc);
      setNcItems([]); setNcLoteId(""); setNcProveedor(""); setNcFactura(""); setNcNotas("");
      setMsgNc({ type: "ok", text: `Nota de crédito ${numero} registrada.` });
      setTimeout(() => setMsgNc(null), 4000);
    } catch {
      setMsgNc({ type: "err", text: "Error al guardar. Intenta de nuevo." });
    } finally {
      setGuardandoNc(false);
    }
  }

  // ── Guardar movimiento ────────────────────────────────────────────────────
  async function handleGuardar(e: React.FormEvent) {
    e.preventDefault();
    const qty = parseFloat(cantidad);
    if (!nombre.trim() || isNaN(qty) || qty <= 0) {
      setMsg({ type: "err", text: "Completa producto y cantidad (> 0)." });
      return;
    }
    setGuardando(true);
    setMsg(null);
    const cfg  = TIPO_CFG[tipo];
    const sign = cfg.sign !== 0 ? cfg.sign : (ajustePos ? 1 : -1);
    const mov: Omit<MovimientoLoker, "id"> = {
      tipo,
      producto_id: toProductoId(nombre),
      nombre:      nombre.trim(),
      cantidad:    sign * qty,
      responsable: profile?.nombre ?? "—",
      timestamp:   Timestamp.now(),
      notas:       notas.trim() || undefined,
    };
    try {
      await addDoc(collection(db, "movimientos_loker"), mov);
      setNombre(""); setCantidad(""); setNotas("");
      setMsg({ type: "ok", text: "Movimiento registrado." });
      setTimeout(() => setMsg(null), 3000);
    } catch {
      setMsg({ type: "err", text: "Error al guardar. Intenta de nuevo." });
    } finally {
      setGuardando(false);
    }
  }

  // ── Render ────────────────────────────────────────────────────────────────
  const hoyLabel = new Date().toLocaleDateString("es-MX", {
    weekday: "long", day: "numeric", month: "long",
  });

  // ── Mensajes para modales ─────────────────────────────────────────────────
  const getInvModalMsg = (): string => {
    if (!invModal) return "";
    const lines = [pbHeader(), ""];
    if (invModal.type === "stat" && invModal.key === "loker") {
      lines.push("📦 *STOCK EN EL LOKER*", "");
      saldoConDetalle.forEach((p) => {
        const icon = p.saldo < 0 ? "🚨" : p.saldo === 0 ? "⚠️" : "✅";
        lines.push(`${icon} ${p.nombre}: *${p.saldo > 0 ? "+" : ""}${p.saldo}*`);
      });
    } else if (invModal.type === "stat" && invModal.key === "despachado") {
      lines.push("🚚 *DESPACHADO HOY*", "");
      saldoConDetalle.filter((p) => p.despachHoy > 0).forEach((p) => {
        lines.push(`• ${p.nombre}: *${p.despachHoy} uds*`);
      });
    } else if (invModal.type === "stat" && invModal.key === "vendido") {
      lines.push("✅ *VENDIDO HOY*", "");
      resumenChoferes.filter((c) => c.reportado).forEach((ch) => {
        lines.push(`\n🚛 *${ch.choferNombre}* — vendido: ${ch.totalVendido}`);
        ch.productos.forEach((p) => lines.push(`  • ${p.nombre}: ${p.vendido} vend. / ${p.despachado} desp.`));
      });
    } else if (invModal.type === "stat" && invModal.key === "facturado") {
      lines.push("💰 *FACTURADO HOY*", "");
      const items = talonarioHoy.filter((t) => t.tipo === "retirada").flatMap((t) =>
        t.productos.filter((p) => p.precio != null && p.precio! > 0).map((p) => ({
          chofer: t.choferNombre, nombre: p.nombre,
          cantidad: p.cantidad ?? 0, precio: p.precio!,
          subtotal: p.precio! * (p.cantidad ?? 0),
        }))
      );
      items.forEach((it) => lines.push(`• ${it.nombre} (${it.chofer}): ${it.cantidad} × $${it.precio} = *$${it.subtotal.toLocaleString()}*`));
      if (items.length > 0) lines.push(`\nTotal: *$${dashboard.moneyHoy.toLocaleString("es-MX")}*`);
    } else if (invModal.type === "producto") {
      lines.push(`📊 *HISTORIAL — ${invModal.nombre}*`, "");
      const movProd = movimientos.filter((m) => m.producto_id === invModal.pid).slice(0, 20);
      movProd.forEach((m) => {
        const cfg = TIPO_CFG[m.tipo] ?? TIPO_CFG.ajuste;
        lines.push(`• ${cfg.label}: *${m.cantidad > 0 ? "+" : ""}${m.cantidad}* — ${m.responsable} ${fmtDate(m.timestamp)}`);
      });
    } else if (invModal.type === "chofer") {
      const ch = invModal.ch;
      lines.push(`🚛 *${ch.choferNombre}*`, "");
      lines.push(`Despachado: ${ch.totalDespachado} · Sobrante: ${ch.reportado ? ch.totalSobrante : "—"} · Vendido: ${ch.reportado ? ch.totalVendido : "—"}`, "");
      ch.productos.forEach((p) => lines.push(`• ${p.nombre}: ${p.despachado} desp.${ch.reportado ? ` / ${p.vendido} vend.` : ""}`));
    } else if (invModal.type === "lote") {
      const lote = invModal.lote;
      const fecha = toDate(lote.timestamp).toLocaleDateString("es-MX");
      lines.push(`🏭 *LOTE ${lote.numero}*`, "");
      lines.push(`Registrado por: ${lote.registradoPor} · ${fecha}`);
      if (lote.proveedor) lines.push(`Proveedor: ${lote.proveedor}`);
      lines.push(`Factura: ${lote.facturaEntregada ? `✅ ${lote.facturaNumero ?? ""}` : "⏳ pendiente"}`, "");
      lote.productos.forEach((p) => {
        const uds = [p.cajas > 0 ? `${p.cajas} caj` : "", p.unidades > 0 ? `${p.unidades} uds` : ""].filter(Boolean).join("+") || `${p.total} uds`;
        lines.push(`• ${p.nombre}: *${uds}* (total: ${p.total})`);
      });
      lines.push(`\nTotal entradas: *+${lote.productos.reduce((s, p) => s + p.total, 0)} unidades*`);
    } else if (invModal.type === "nota") {
      const nc = invModal.nc;
      lines.push(`📝 *${nc.numero}*`, "");
      lines.push(`Motivo: ${nc.motivo}`);
      if (nc.proveedor) lines.push(`Proveedor: ${nc.proveedor}`);
      lines.push(`Estado: *${nc.estado}*`, "");
      nc.productos.forEach((p) => lines.push(`• ${p.nombre}: ${p.cantidad} uds${p.subtotal ? ` ($${p.subtotal.toFixed(2)})` : ""}`));
      if (nc.totalMonto) lines.push(`\nMonto total: *$${nc.totalMonto.toFixed(2)}*`);
    }
    lines.push("", pbFooter());
    return lines.join("\n");
  };

  const getInvModalHtml = (): string => {
    if (!invModal) return "";
    if (invModal.type === "stat" && invModal.key === "loker") {
      const rows = saldoConDetalle.map((p) => [
        p.nombre,
        `<b style="color:${p.saldo < 0 ? "#dc2626" : p.saldo === 0 ? "#d97706" : "#16a34a"}">${p.saldo > 0 ? "+" : ""}${p.saldo}</b>`,
        p.despachHoy > 0 ? `${p.despachHoy} hoy` : "—",
      ]);
      return pbPrintDoc("Stock en el Loker", hoyLabel, pbTable(["Producto", "Saldo", "Despachado hoy"], rows));
    }
    if (invModal.type === "stat" && invModal.key === "despachado") {
      const rows = saldoConDetalle.filter((p) => p.despachHoy > 0).map((p) => [p.nombre, `<b>${p.despachHoy}</b>`]);
      return pbPrintDoc("Despachado Hoy", hoyLabel, pbTable(["Producto", "Unidades"], rows));
    }
    if (invModal.type === "stat" && invModal.key === "facturado") {
      const items = talonarioHoy.filter((t) => t.tipo === "retirada").flatMap((t) =>
        t.productos.filter((p) => p.precio != null && p.precio! > 0).map((p) => ({
          chofer: t.choferNombre, nombre: p.nombre,
          cantidad: p.cantidad ?? 0, precio: p.precio!,
          subtotal: p.precio! * (p.cantidad ?? 0),
        }))
      );
      const rows = items.map((it) => [it.nombre, it.chofer, it.cantidad, `$${it.precio.toLocaleString()}`, `<b>$${it.subtotal.toLocaleString()}</b>`]);
      const tot: (string|number)[] = ["<b>Total</b>", "", "", "", `<b>$${dashboard.moneyHoy.toLocaleString("es-MX")}</b>`];
      return pbPrintDoc("Facturado Hoy", hoyLabel, pbTable(["Producto", "Chofer", "Uds", "Precio", "Subtotal"], rows, tot));
    }
    if (invModal.type === "lote") {
      const lote = invModal.lote;
      const fecha = toDate(lote.timestamp).toLocaleDateString("es-MX");
      const rows = lote.productos.map((p) => [
        p.nombre,
        p.cajas > 0 ? p.cajas : "—",
        p.unidades > 0 ? p.unidades : "—",
        `<b>+${p.total}</b>`,
        p.costoUnitario != null ? `$${p.costoUnitario.toFixed(2)}/ud` : "—",
      ]);
      const totalUds  = lote.productos.reduce((s, p) => s + p.total, 0);
      const totalCost = lote.productos.reduce((s, p) => s + (p.costoUnitario ?? 0) * p.total, 0);
      const tot: (string|number)[] = ["<b>Total</b>", "", "", `<b>+${totalUds}</b>`, totalCost > 0 ? `<b>$${totalCost.toFixed(2)}</b>` : "—"];
      const sub = `Registrado por ${lote.registradoPor} · ${fecha}${lote.proveedor ? ` · ${lote.proveedor}` : ""} · Factura: ${lote.facturaEntregada ? "✅" : "⏳ Pendiente"}`;
      return pbPrintDoc(`Lote ${lote.numero}`, sub, pbTable(["Producto", "Cajas", "Unidades", "Total", "Costo/ud"], rows, tot));
    }
    if (invModal.type === "chofer") {
      const ch = invModal.ch;
      const rows = ch.productos.map((p) => [p.nombre, p.despachado, ch.reportado ? p.sobrante : "—", ch.reportado ? `<b>${p.vendido}</b>` : "—"]);
      const tot: (string|number)[] = ["<b>Total</b>", `<b>${ch.totalDespachado}</b>`, ch.reportado ? `<b>${ch.totalSobrante}</b>` : "—", ch.reportado ? `<b>${ch.totalVendido}</b>` : "—"];
      return pbPrintDoc(`Detalle — ${ch.choferNombre}`, hoyLabel, pbTable(["Producto", "Despachado", "Sobrante", "Vendido"], rows, tot));
    }
    return pbPrintDoc("Inventario", hoyLabel, `<p>${getInvModalMsg()}</p>`);
  };

  return (
    <div className="space-y-4">

      {/* ── 1. Dashboard del día ─────────────────────────────────────────────── */}
      {!cargando && (
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
          <div className="px-4 py-3 bg-gradient-to-r from-indigo-700 to-purple-800">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h2 className="text-white font-bold text-sm">📊 Dashboard del día</h2>
                <p className="text-indigo-200 text-xs capitalize mt-0.5">{hoyLabel}</p>
              </div>
              {dashboard.productosAlerta > 0 && (
                <span className="flex-shrink-0 text-xs bg-red-500 text-white
                  px-2.5 py-1 rounded-full font-bold animate-pulse">
                  🚨 {dashboard.productosAlerta} en alerta
                </span>
              )}
            </div>
          </div>

          <div className="p-4 space-y-4">
            {/* Stats 2×2 en móvil, 4 en escritorio */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <StatCard icon="📦" label="En loker"       value={dashboard.totalEnLoker}    color="purple"
                onClick={() => setInvModal({ type: "stat", key: "loker" })} />
              <StatCard icon="🚚" label="Despachado hoy" value={dashboard.totalDespachado} color="orange"
                onClick={() => setInvModal({ type: "stat", key: "despachado" })} />
              <StatCard
                icon="✅"
                label="Vendido hoy"
                value={dashboard.chofersReportados === 0 ? "—" : dashboard.totalVendido}
                color="green"
                sub={dashboard.chofersReportados === 0 ? "sin reportes" : undefined}
                onClick={() => setInvModal({ type: "stat", key: "vendido" })}
              />
              <StatCard
                icon="💰"
                label="Facturado hoy"
                value={dashboard.hayPrecios ? `$${dashboard.moneyHoy.toLocaleString("es-MX")}` : "—"}
                color="yellow"
                sub={!dashboard.hayPrecios ? "sin precios" : undefined}
                onClick={() => setInvModal({ type: "stat", key: "facturado" })}
              />
            </div>

            {/* Progreso sobrantes por chofer */}
            {dashboard.chofersTotal > 0 && (
              <div className="bg-gray-50 rounded-xl p-3 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-gray-600">
                    Choferes con sobrantes reportados
                  </span>
                  <span className="text-xs font-bold text-gray-700">
                    {dashboard.chofersReportados}/{dashboard.chofersTotal}
                  </span>
                </div>

                {/* Barra de progreso */}
                <div className="h-2 bg-gray-200 rounded-full overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all duration-500 ${
                      dashboard.pendientes === 0 ? "bg-green-500" : "bg-amber-500"
                    }`}
                    style={{
                      width: dashboard.chofersTotal > 0
                        ? `${(dashboard.chofersReportados / dashboard.chofersTotal) * 100}%`
                        : "0%",
                    }}
                  />
                </div>

                {/* Chips por chofer */}
                <div className="flex gap-1.5 flex-wrap">
                  {resumenChoferes.map((ch) => (
                    <button
                      key={ch.choferId}
                      onClick={() => setInvModal({ type: "chofer", ch })}
                      title={`${ch.choferNombre} — Despachado: ${ch.totalDespachado} | Vendido: ${ch.totalVendido}`}
                      className={`text-xs px-2.5 py-1 rounded-full border font-medium active:scale-95 transition-all duration-100 ${
                        ch.reportado
                          ? "bg-green-100 text-green-700 border-green-200 hover:bg-green-200"
                          : "bg-amber-100 text-amber-700 border-amber-200 hover:bg-amber-200"
                      }`}
                    >
                      {ch.reportado ? "✅" : "⏳"} {ch.choferNombre.split(" ")[0]}
                    </button>
                  ))}
                </div>

                {dashboard.pendientes > 0 && (
                  <p className="text-xs text-amber-600 font-medium">
                    ⏳ {dashboard.pendientes}{" "}
                    {dashboard.pendientes === 1 ? "chofer pendiente" : "choferes pendientes"} de reportar
                  </p>
                )}
              </div>
            )}

            {/* Resumen numérico compacto */}
            {dashboard.totalDespachado > 0 && (
              <div className="grid grid-cols-3 gap-2 text-center">
                <div className="bg-orange-50 border border-orange-100 rounded-lg py-2">
                  <p className="text-xs text-orange-500 font-medium">Despachado</p>
                  <p className="text-lg font-bold text-orange-700">{dashboard.totalDespachado}</p>
                  <p className="text-xs text-orange-400">unidades</p>
                </div>
                <div className="bg-blue-50 border border-blue-100 rounded-lg py-2">
                  <p className="text-xs text-blue-500 font-medium">Sobrante</p>
                  <p className="text-lg font-bold text-blue-700">{dashboard.totalSobrante}</p>
                  <p className="text-xs text-blue-400">regresadas</p>
                </div>
                <div className="bg-green-50 border border-green-100 rounded-lg py-2">
                  <p className="text-xs text-green-500 font-medium">Vendido</p>
                  <p className="text-lg font-bold text-green-700">
                    {dashboard.chofersReportados > 0 ? dashboard.totalVendido : "—"}
                  </p>
                  <p className="text-xs text-green-400">
                    {dashboard.chofersReportados > 0 ? "calculado" : "sin datos"}
                  </p>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── 2. Stock del loker con desglose ─────────────────────────────────── */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
        <button
          onClick={() => setSaldoAbierto((v) => !v)}
          className="w-full flex items-center justify-between px-4 py-3
            bg-gradient-to-r from-purple-50 to-purple-100 hover:from-purple-100
            hover:to-purple-150 transition-colors duration-100"
        >
          <div className="flex items-center gap-2">
            <span className="text-lg">📦</span>
            <span className="font-semibold text-purple-900 text-sm">Stock del loker</span>
            <span className="text-xs bg-purple-200 text-purple-800 px-2 py-0.5 rounded-full">
              {saldoConDetalle.length} {saldoConDetalle.length === 1 ? "producto" : "productos"}
            </span>
            {saldoConDetalle.some((p) => p.saldo <= 0) && (
              <span className="text-xs bg-red-100 text-red-700 border border-red-200
                px-2 py-0.5 rounded-full font-medium">
                🚨 stock bajo
              </span>
            )}
          </div>
          <span className="text-purple-600 text-sm">{saldoAbierto ? "▲" : "▼"}</span>
        </button>

        {saldoAbierto && (
          <div>
            {cargando ? (
              <div className="px-4 py-6 text-center">
                <p className="text-sm text-gray-400 animate-pulse">Cargando stock…</p>
              </div>
            ) : saldoConDetalle.length === 0 ? (
              <div className="px-4 py-6 text-center">
                <p className="text-2xl mb-2">📦</p>
                <p className="text-sm text-gray-400">Sin productos — registra la primera entrada.</p>
              </div>
            ) : (
              <div className="divide-y divide-gray-50">
                {saldoConDetalle.map((p) => {
                  const negativo    = p.saldo < 0;
                  const sinStock    = p.saldo === 0;
                  const hayDesp     = p.despachHoy > 0;
                  const haySobrante = p.sobranteHoy > 0;

                  return (
                    <button
                      key={p.pid}
                      onClick={() => setInvModal({ type: "producto", pid: p.pid, nombre: p.nombre })}
                      className={`w-full px-4 py-3 transition-colors text-left active:scale-[0.99] hover:bg-gray-50/80 ${negativo ? "bg-red-50/50" : ""}`}
                    >
                      <div className="flex items-center justify-between gap-3">
                        {/* Ícono + nombre */}
                        <div className="flex items-center gap-2 min-w-0">
                          <span className={`flex-shrink-0 text-sm ${
                            negativo ? "text-red-500" : sinStock ? "text-amber-400" : "text-green-500"
                          }`}>
                            {negativo ? "🚨" : sinStock ? "⚠️" : "✅"}
                          </span>
                          <p className="text-sm font-medium text-gray-800 truncate">{p.nombre}</p>
                        </div>

                        {/* Stock badge */}
                        <span className={`flex-shrink-0 text-sm font-bold px-2.5 py-0.5 rounded-full border ${
                          negativo
                            ? "bg-red-100 text-red-700 border-red-300"
                            : sinStock
                            ? "bg-amber-100 text-amber-600 border-amber-200"
                            : "bg-green-100 text-green-700 border-green-200"
                        }`}>
                          {p.saldo > 0 ? "+" : ""}{p.saldo}
                        </span>
                      </div>

                      {/* Desglose del día (solo si hubo movimiento hoy) */}
                      {hayDesp && (
                        <div className="mt-2 flex gap-2 flex-wrap text-xs">
                          <span className="flex items-center gap-1 bg-orange-50 text-orange-700
                            border border-orange-200 px-2 py-0.5 rounded-full">
                            🚚 {p.despachHoy} despachado
                          </span>
                          <span className={`flex items-center gap-1 px-2 py-0.5 rounded-full border ${
                            haySobrante
                              ? "bg-blue-50 text-blue-700 border-blue-200"
                              : "bg-gray-50 text-gray-400 border-gray-200"
                          }`}>
                            🔄 {haySobrante ? p.sobranteHoy : "—"} sobrante
                          </span>
                          {haySobrante && (
                            <span className={`flex items-center gap-1 px-2 py-0.5 rounded-full border ${
                              p.vendidoHoy < 0
                                ? "bg-red-50 text-red-700 border-red-200"
                                : "bg-green-50 text-green-700 border-green-200"
                            }`}>
                              ✅ {p.vendidoHoy < 0 ? "🚨 ERROR" : p.vendidoHoy} vendido
                            </span>
                          )}
                        </div>
                      )}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── 3. Sobrantes por chofer (hoy) ────────────────────────────────────── */}
      {resumenChoferes.length > 0 && (
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
          <button
            onClick={() => setChofersAbierto((v) => !v)}
            className="w-full flex items-center justify-between px-4 py-3
              bg-gradient-to-r from-teal-50 to-teal-100 hover:from-teal-100
              hover:to-teal-150 transition-colors duration-100"
          >
            <div className="flex items-center gap-2">
              <span className="text-lg">🚚</span>
              <span className="font-semibold text-teal-900 text-sm">
                Sobrantes choferes — hoy
              </span>
              <span className="text-xs bg-teal-200 text-teal-800 px-2 py-0.5 rounded-full">
                {resumenChoferes.length} {resumenChoferes.length === 1 ? "chofer" : "choferes"}
              </span>
              {resumenChoferes.some((c) => !c.reportado) && (
                <span className="text-xs bg-amber-100 text-amber-700 border border-amber-200
                  px-2 py-0.5 rounded-full font-medium animate-pulse">
                  ⏳ pendientes
                </span>
              )}
            </div>
            <span className="text-teal-600 text-sm">{chofersAbierto ? "▲" : "▼"}</span>
          </button>

          {chofersAbierto && (
            <div className="divide-y divide-gray-50">
              {resumenChoferes.map((ch) => {
                const alerta = !ch.reportado || ch.productos.some((p) => p.vendido < 0);
                return (
                  <div key={ch.choferId} className={`p-4 ${alerta && ch.reportado ? "bg-red-50/30" : ""}`}>
                    {/* Cabecera chofer */}
                    <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-semibold text-sm text-gray-800">{ch.choferNombre}</span>
                        {!ch.reportado ? (
                          <span className="text-xs bg-amber-100 text-amber-700 border border-amber-200
                            px-2 py-0.5 rounded-full font-medium">⏳ Sin sobrantes</span>
                        ) : (
                          <span className="text-xs bg-green-100 text-green-700 border border-green-200
                            px-2 py-0.5 rounded-full font-medium">✅ Reportado</span>
                        )}
                        {alerta && ch.reportado && (
                          <span className="text-xs bg-red-100 text-red-700 border border-red-200
                            px-2 py-0.5 rounded-full font-medium">🚨 Inconsistencia</span>
                        )}
                      </div>
                      <div className="flex gap-3 text-xs text-center">
                        <div>
                          <p className="text-gray-400">Despachado</p>
                          <p className="font-bold text-cyan-700">{ch.totalDespachado}</p>
                        </div>
                        <div>
                          <p className="text-gray-400">Sobrante</p>
                          <p className="font-bold text-blue-600">{ch.totalSobrante}</p>
                        </div>
                        <div>
                          <p className="text-gray-400">Vendido</p>
                          <p className={`font-bold ${ch.totalVendido < 0 ? "text-red-600" : "text-green-700"}`}>
                            {ch.totalVendido}
                          </p>
                        </div>
                      </div>
                    </div>

                    {/* Tabla de productos */}
                    <div className="overflow-x-auto rounded-lg border border-gray-100">
                      <table className="w-full text-xs">
                        <thead>
                          <tr className="bg-gray-50 text-gray-500">
                            <th className="text-left px-3 py-2 font-medium">Producto</th>
                            <th className="text-right px-3 py-2 font-medium">Despachado</th>
                            <th className="text-right px-3 py-2 font-medium">Sobrante</th>
                            <th className="text-right px-3 py-2 font-medium">Vendido</th>
                            <th className="text-center px-3 py-2 font-medium">Estado</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-50">
                          {ch.productos.map((p) => {
                            const prodAlerta = p.vendido < 0 || p.sobrante > p.despachado;
                            const sinReporte = !ch.reportado;
                            return (
                              <tr key={p.pid} className={prodAlerta ? "bg-red-50" : "hover:bg-gray-50/50"}>
                                <td className="px-3 py-2 font-medium text-gray-700 max-w-[120px] truncate">
                                  {p.nombre}
                                </td>
                                <td className="px-3 py-2 text-right text-cyan-700 font-semibold">
                                  {p.despachado}
                                </td>
                                <td className="px-3 py-2 text-right text-blue-600 font-semibold">
                                  {sinReporte ? <span className="text-gray-300">—</span> : p.sobrante}
                                </td>
                                <td className={`px-3 py-2 text-right font-semibold ${
                                  sinReporte ? "text-gray-300"
                                  : prodAlerta ? "text-red-600"
                                  : "text-green-700"
                                }`}>
                                  {sinReporte ? "—" : p.vendido}
                                </td>
                                <td className="px-3 py-2 text-center">
                                  {sinReporte ? "⏳" : prodAlerta ? "🚨" : "✅"}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ── 4. Lotes de almacén ──────────────────────────────────────────────── */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
        <button
          onClick={() => setLotesAbierto((v) => !v)}
          className="w-full flex items-center justify-between px-4 py-3
            bg-gradient-to-r from-emerald-50 to-emerald-100 hover:from-emerald-100
            hover:to-emerald-150 transition-colors duration-100"
        >
          <div className="flex items-center gap-2">
            <span className="text-lg">🏭</span>
            <span className="font-semibold text-emerald-900 text-sm">Lotes registrados</span>
            <span className="text-xs bg-emerald-200 text-emerald-800 px-2 py-0.5 rounded-full">
              {lotes.length} {lotes.length === 1 ? "lote" : "lotes"}
            </span>
            {lotes.some((l) => !l.facturaEntregada) && (
              <span className="text-xs bg-amber-100 text-amber-700 border border-amber-200
                px-2 py-0.5 rounded-full font-medium animate-pulse">
                ⏳ facturas pendientes
              </span>
            )}
          </div>
          <span className="text-emerald-600 text-sm">{lotesAbierto ? "▲" : "▼"}</span>
        </button>

        {lotesAbierto && (
          <div>
            {lotes.length === 0 ? (
              <div className="px-4 py-8 text-center">
                <p className="text-2xl mb-2">🏭</p>
                <p className="text-sm text-gray-400">Sin lotes registrados aún.</p>
                <p className="text-xs text-gray-300 mt-1">Los encargados de almacén registran lotes desde su panel.</p>
              </div>
            ) : (
              <div className="divide-y divide-gray-50">
                {lotes.map((lote) => (
                  <button
                    key={lote.id}
                    onClick={() => setInvModal({ type: "lote", lote })}
                    className="w-full px-4 py-3 text-left hover:bg-gray-50 active:scale-[0.99]
                      transition-all duration-100"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="text-sm font-bold text-emerald-700 flex-shrink-0">
                          {lote.numero}
                        </span>
                        {lote.proveedor && (
                          <span className="text-xs text-gray-500 truncate">{lote.proveedor}</span>
                        )}
                        <span className={`flex-shrink-0 text-xs px-1.5 py-0.5 rounded-full border font-medium ${
                          lote.facturaEntregada
                            ? "bg-green-100 text-green-700 border-green-200"
                            : "bg-amber-100 text-amber-700 border-amber-200"
                        }`}>
                          {lote.facturaEntregada ? "✅ Factura" : "⏳ Sin factura"}
                        </span>
                      </div>
                      <div className="text-right flex-shrink-0">
                        <p className="text-xs text-gray-400">{fmtDate(lote.timestamp)}</p>
                        <p className="text-xs text-gray-500 mt-0.5">
                          {lote.productos.length} prod · {lote.registradoPor}
                        </p>
                      </div>
                    </div>
                    {lote.productos.length > 0 && (
                      <div className="mt-1.5 flex gap-1.5 flex-wrap">
                        {lote.productos.map((p) => (
                          <span key={p.producto_id}
                            className="text-xs bg-emerald-50 text-emerald-700 border border-emerald-200
                              px-2 py-0.5 rounded-full"
                          >
                            {p.nombre.split(" ")[0]} {p.cajas > 0 ? `${p.cajas}caj` : ""}{p.cajas > 0 && p.unidades > 0 ? "+" : ""}{p.unidades > 0 ? `${p.unidades}uds` : ""}
                          </span>
                        ))}
                      </div>
                    )}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── 5. Orden PEPS/FIFO ───────────────────────────────────────────────── */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
        <button
          onClick={() => setFifoAbierto((v) => !v)}
          className="w-full flex items-center justify-between px-4 py-3
            bg-gradient-to-r from-amber-50 to-amber-100 hover:from-amber-100
            hover:to-amber-150 transition-colors duration-100"
        >
          <div className="flex items-center gap-2">
            <span className="text-lg">📋</span>
            <span className="font-semibold text-amber-900 text-sm">Orden PEPS — lotes por producto</span>
            <span className="text-xs bg-amber-200 text-amber-800 px-2 py-0.5 rounded-full">
              {lotes.length} lotes
            </span>
          </div>
          <span className="text-amber-600 text-sm">{fifoAbierto ? "▲" : "▼"}</span>
        </button>

        {fifoAbierto && (
          <div className="p-4 space-y-3">
            {fifoData.length === 0 ? (
              <div className="text-center py-6">
                <p className="text-2xl mb-2">📋</p>
                <p className="text-sm text-gray-400">Sin lotes registrados para mostrar orden PEPS.</p>
              </div>
            ) : (
              <>
                <p className="text-xs text-gray-500 bg-amber-50 border border-amber-100
                  rounded-lg px-3 py-2"
                >
                  ⚠️ Consumir siempre el lote más antiguo primero.
                  El orden PEPS es una guía — el sistema no descuenta automáticamente por lote.
                </p>
                <div className="space-y-3">
                  {fifoData.map((prod) => (
                    <div key={prod.pid} className="border border-gray-100 rounded-xl overflow-hidden">
                      <div className="bg-gray-50 px-3 py-2 text-xs font-semibold text-gray-700">
                        {prod.nombre}
                      </div>
                      <div className="divide-y divide-gray-50">
                        {prod.lotes.map((l, idx) => (
                          <div key={l.loteNumero}
                            className={`flex items-center justify-between px-3 py-2 text-xs ${
                              idx === 0 ? "bg-amber-50" : ""
                            }`}
                          >
                            <div className="flex items-center gap-2">
                              {idx === 0 && (
                                <span className="bg-amber-500 text-white text-xs px-1.5 py-0.5
                                  rounded font-bold flex-shrink-0">1º</span>
                              )}
                              <span className="font-semibold text-gray-800">{l.loteNumero}</span>
                              <span className="text-gray-400">
                                {l.fecha.toLocaleDateString("es-MX", { day: "2-digit", month: "short" })}
                              </span>
                            </div>
                            <span className="text-emerald-700 font-semibold">
                              {l.unidadesEntrada} uds entrada
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        )}
      </div>

      {/* ── 6. Inventario en consignación ───────────────────────────────────── */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
        <button
          onClick={() => setConsigAbierto((v) => !v)}
          className="w-full flex items-center justify-between px-4 py-3
            bg-gradient-to-r from-cyan-50 to-cyan-100 hover:from-cyan-100
            hover:to-cyan-150 transition-colors duration-100"
        >
          <div className="flex items-center gap-2">
            <span className="text-lg">🚛</span>
            <span className="font-semibold text-cyan-900 text-sm">Inventario en consignación</span>
            <span className="text-xs bg-cyan-200 text-cyan-800 px-2 py-0.5 rounded-full">
              {consignacion.totalConsignado} uds
            </span>
            {consignacion.listaChoferes.length > 0 && (
              <span className="text-xs bg-cyan-100 text-cyan-700 border border-cyan-200
                px-2 py-0.5 rounded-full font-medium">
                {consignacion.listaChoferes.length} choferes
              </span>
            )}
          </div>
          <span className="text-cyan-600 text-sm">{consigAbierto ? "▲" : "▼"}</span>
        </button>

        {consigAbierto && (
          <div className="p-4 space-y-4">
            {consignacion.totalConsignado === 0 ? (
              <div className="text-center py-6">
                <p className="text-2xl mb-2">🚛</p>
                <p className="text-sm text-gray-400">Sin productos en consignación actualmente.</p>
              </div>
            ) : (
              <>
                {/* Resumen por producto */}
                <div>
                  <p className="text-xs font-semibold text-gray-600 mb-2">
                    📦 Por producto — total en la calle
                  </p>
                  <div className="space-y-1.5">
                    {consignacion.listaProductos.map((p) => (
                      <div key={p.pid}
                        className="flex items-center justify-between bg-cyan-50
                          border border-cyan-100 rounded-lg px-3 py-2"
                      >
                        <span className="text-sm text-gray-800 flex-1 truncate mr-3">{p.nombre}</span>
                        <span className="text-sm font-bold text-cyan-700 flex-shrink-0">
                          {p.cantidad} uds
                        </span>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Resumen por chofer */}
                <div>
                  <p className="text-xs font-semibold text-gray-600 mb-2">
                    👤 Por chofer — desglose individual
                  </p>
                  <div className="space-y-2">
                    {consignacion.listaChoferes.map((ch) => (
                      <div key={ch.id}
                        className="border border-gray-100 rounded-xl overflow-hidden"
                      >
                        <div className="flex items-center justify-between
                          bg-gray-50 px-3 py-2"
                        >
                          <span className="text-sm font-semibold text-gray-800">{ch.nombre}</span>
                          <span className="text-xs font-bold text-cyan-700">
                            {ch.total} uds total
                          </span>
                        </div>
                        <div className="divide-y divide-gray-50">
                          {ch.productos.map((p) => (
                            <div key={p.pid}
                              className="flex items-center justify-between px-3 py-1.5"
                            >
                              <span className="text-xs text-gray-600 flex-1 truncate mr-2">
                                {p.nombre}
                              </span>
                              <span className="text-xs font-semibold text-cyan-600 flex-shrink-0">
                                {p.cantidad} uds
                              </span>
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </>
            )}
          </div>
        )}
      </div>

      {/* ── 7. Inventario base por chofer ───────────────────────────────────── */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
        <button
          onClick={() => setInvBaseAbierto((v) => !v)}
          className="w-full flex items-center justify-between px-4 py-3
            bg-gradient-to-r from-violet-50 to-violet-100 hover:from-violet-100
            hover:to-violet-150 transition-colors duration-100"
        >
          <div className="flex items-center gap-2">
            <span className="text-lg">📋</span>
            <span className="font-semibold text-violet-900 text-sm">Inventario base — choferes</span>
            {inventarioBase.length > 0 && (
              <span className="text-xs bg-violet-200 text-violet-800 px-2 py-0.5 rounded-full">
                {inventarioBase.length} choferes
              </span>
            )}
            {inventarioBase.length > 0 && (
              <span className="text-xs bg-violet-100 text-violet-700 border border-violet-200
                px-2 py-0.5 rounded-full">
                {inventarioBase.reduce((s, c) => s + c.total, 0).toLocaleString()} uds total
              </span>
            )}
          </div>
          <span className="text-violet-600 text-sm">{invBaseAbierto ? "▲" : "▼"}</span>
        </button>

        {invBaseAbierto && (
          <div>
            {inventarioBase.length === 0 ? (
              <div className="px-4 py-8 text-center">
                <p className="text-2xl mb-2">📋</p>
                <p className="text-sm text-gray-400">Sin inventario base registrado.</p>
                <p className="text-xs text-gray-300 mt-1">
                  Ejecuta el script seed-inventario-base para cargar los datos.
                </p>
              </div>
            ) : (
              <div className="divide-y divide-gray-50">
                {inventarioBase.map((ch) => {
                  const expanded = invBaseExpanded === ch.id;
                  // Consignación actual de este chofer (para comparar)
                  const consigActual = consignacion.listaChoferes.find((c) => c.id === ch.id);
                  const totalActual  = consigActual?.total ?? 0;
                  const diff         = totalActual - ch.total;

                  return (
                    <div key={ch.id}>
                      {/* Fila cabecera del chofer */}
                      <button
                        onClick={() => setInvBaseExpanded(expanded ? null : ch.id)}
                        className="w-full px-4 py-3 text-left flex items-center
                          justify-between hover:bg-violet-50/40 active:scale-[0.995]
                          transition-all duration-100"
                      >
                        <div className="flex items-center gap-2 flex-wrap min-w-0">
                          <span className="font-semibold text-sm text-gray-800 truncate">
                            {ch.nombre}
                          </span>
                          <span className="flex-shrink-0 text-xs bg-violet-100 text-violet-700
                            border border-violet-200 px-2 py-0.5 rounded-full">
                            {ch.total} uds base · {ch.productos.length} prod
                          </span>
                          {/* Comparación con consignación actual */}
                          {consigActual && (
                            <span className={`flex-shrink-0 text-xs px-2 py-0.5 rounded-full
                              border font-medium ${
                                Math.abs(diff) <= 2
                                  ? "bg-green-50 text-green-700 border-green-200"
                                  : diff > 0
                                  ? "bg-blue-50 text-blue-700 border-blue-200"
                                  : "bg-amber-50 text-amber-700 border-amber-200"
                              }`}>
                              Actual: {totalActual} uds
                              {diff > 0 ? ` (+${diff})` : diff < 0 ? ` (${diff})` : " ✅"}
                            </span>
                          )}
                        </div>
                        <span className="flex-shrink-0 text-violet-400 text-xs ml-2">
                          {expanded ? "▲" : "▼"}
                        </span>
                      </button>

                      {/* Tabla de productos expandida */}
                      {expanded && (
                        <div className="border-t border-violet-50 overflow-x-auto">
                          <table className="w-full text-xs">
                            <thead>
                              <tr className="bg-violet-50/60 text-violet-700">
                                <th className="text-left px-4 py-2 font-semibold">Producto</th>
                                <th className="text-right px-4 py-2 font-semibold">Base</th>
                                {consigActual && (
                                  <th className="text-right px-4 py-2 font-semibold">Actual</th>
                                )}
                                {consigActual && (
                                  <th className="text-right px-4 py-2 font-semibold">Dif</th>
                                )}
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-50">
                              {ch.productos.map((p) => {
                                const actual = consigActual?.productos.find(
                                  (cp) => cp.pid === p.pid,
                                )?.cantidad ?? null;
                                const d = actual !== null ? actual - p.cantidad : null;
                                return (
                                  <tr key={p.pid} className="hover:bg-violet-50/30">
                                    <td className="px-4 py-2 text-gray-700 font-medium
                                      max-w-[180px] truncate">
                                      {p.nombre}
                                    </td>
                                    <td className="px-4 py-2 text-right font-bold text-violet-700">
                                      {p.cantidad}
                                    </td>
                                    {consigActual && (
                                      <td className="px-4 py-2 text-right text-cyan-700 font-semibold">
                                        {actual ?? <span className="text-gray-300">—</span>}
                                      </td>
                                    )}
                                    {consigActual && (
                                      <td className={`px-4 py-2 text-right font-semibold ${
                                        d === null ? "text-gray-300"
                                        : Math.abs(d) <= 1 ? "text-green-600"
                                        : d > 0 ? "text-blue-600"
                                        : "text-amber-600"
                                      }`}>
                                        {d === null ? "—" : d > 0 ? `+${d}` : d}
                                      </td>
                                    )}
                                  </tr>
                                );
                              })}
                            </tbody>
                            <tfoot>
                              <tr className="bg-violet-50/60 font-bold text-xs">
                                <td className="px-4 py-2 text-violet-700">Total</td>
                                <td className="px-4 py-2 text-right text-violet-700">{ch.total}</td>
                                {consigActual && (
                                  <td className="px-4 py-2 text-right text-cyan-700">{totalActual}</td>
                                )}
                                {consigActual && (
                                  <td className={`px-4 py-2 text-right ${
                                    Math.abs(diff) <= 2 ? "text-green-600"
                                    : diff > 0 ? "text-blue-600"
                                    : "text-amber-600"
                                  }`}>
                                    {diff > 0 ? `+${diff}` : diff}
                                  </td>
                                )}
                              </tr>
                            </tfoot>
                          </table>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── 8. Notas de crédito ──────────────────────────────────────────────── */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
        <button
          onClick={() => setNotasCreditoAbierto((v) => !v)}
          className="w-full flex items-center justify-between px-4 py-3
            bg-gradient-to-r from-red-50 to-red-100 hover:from-red-100
            hover:to-red-150 transition-colors duration-100"
        >
          <div className="flex items-center gap-2">
            <span className="text-lg">📝</span>
            <span className="font-semibold text-red-900 text-sm">Notas de crédito</span>
            <span className="text-xs bg-red-200 text-red-800 px-2 py-0.5 rounded-full">
              {notasCredito.length}
            </span>
            {notasCredito.some((nc) => nc.estado === "pendiente") && (
              <span className="text-xs bg-amber-100 text-amber-700 border border-amber-200
                px-2 py-0.5 rounded-full font-medium animate-pulse">
                ⏳ pendientes
              </span>
            )}
          </div>
          <span className="text-red-600 text-sm">{notasCreditoAbierto ? "▲" : "▼"}</span>
        </button>

        {notasCreditoAbierto && (
          <div className="p-4 space-y-4">
            {/* Formulario nueva nota */}
            <div className="border border-red-100 rounded-xl overflow-hidden">
              <div className="px-3 py-2 bg-red-50 border-b border-red-100">
                <p className="text-xs font-semibold text-red-800">+ Nueva nota de crédito</p>
              </div>
              <div className="p-3 space-y-3">
                {/* Lote (opcional) */}
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">
                    Lote referencia <span className="text-gray-400">(opcional)</span>
                  </label>
                  <select
                    value={ncLoteId}
                    onChange={(e) => {
                      setNcLoteId(e.target.value);
                      const l = lotes.find((l) => l.id === e.target.value);
                      if (l) { setNcProveedor(l.proveedor ?? ""); setNcFactura(l.facturaNumero ?? ""); }
                    }}
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm
                      outline-none focus:ring-2 focus:ring-red-300 bg-white"
                  >
                    <option value="">— Sin lote asociado —</option>
                    {lotes.map((l) => (
                      <option key={l.id} value={l.id}>
                        {l.numero}{l.proveedor ? ` — ${l.proveedor}` : ""}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">Proveedor</label>
                    <input
                      value={ncProveedor}
                      onChange={(e) => setNcProveedor(e.target.value)}
                      placeholder="Nombre"
                      className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm
                        outline-none focus:ring-2 focus:ring-red-300"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">Nº Factura</label>
                    <input
                      value={ncFactura}
                      onChange={(e) => setNcFactura(e.target.value)}
                      placeholder="F-2024-001"
                      className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm
                        outline-none focus:ring-2 focus:ring-red-300"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Motivo</label>
                  <select
                    value={ncMotivo}
                    onChange={(e) => setNcMotivo(e.target.value)}
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm
                      outline-none focus:ring-2 focus:ring-red-300 bg-white"
                  >
                    {["Productos dañados", "Faltantes en lote", "Productos vencidos",
                      "Entrega incorrecta", "Otro"].map((m) => (
                      <option key={m} value={m}>{m}</option>
                    ))}
                  </select>
                </div>

                {/* Agregar producto */}
                <div className="bg-gray-50 rounded-lg p-3 space-y-2">
                  <p className="text-xs font-medium text-gray-600">Productos afectados</p>
                  <div className="flex gap-2">
                    <input
                      value={ncNombre}
                      onChange={(e) => setNcNombre(e.target.value)}
                      placeholder="Nombre del producto"
                      className="flex-1 border border-gray-200 rounded-lg px-3 py-2 text-sm
                        outline-none focus:ring-2 focus:ring-red-300"
                    />
                    <input
                      type="number" min={1}
                      value={ncCantidad}
                      onChange={(e) => setNcCantidad(e.target.value)}
                      placeholder="Cant"
                      className="w-16 border border-gray-200 rounded-lg px-2 py-2 text-sm
                        outline-none focus:ring-2 focus:ring-red-300"
                    />
                    <input
                      type="number" min={0} step="0.01"
                      value={ncCosto}
                      onChange={(e) => setNcCosto(e.target.value)}
                      placeholder="$/ud"
                      className="w-20 border border-gray-200 rounded-lg px-2 py-2 text-sm
                        outline-none focus:ring-2 focus:ring-red-300"
                    />
                    <button
                      onClick={ncAgregarItem}
                      disabled={!ncNombre.trim() || !ncCantidad}
                      className="px-3 py-2 bg-red-500 text-white rounded-lg font-bold text-sm
                        active:scale-95 transition-all duration-100 disabled:opacity-50"
                    >+</button>
                  </div>
                  {ncItems.map((it, idx) => (
                    <div key={idx} className="flex items-center justify-between bg-red-50
                      border border-red-100 rounded-lg px-3 py-1.5"
                    >
                      <span className="text-xs text-red-900 flex-1 truncate mr-2">{it.nombre}</span>
                      <span className="text-xs font-bold text-red-700 flex-shrink-0">
                        {it.cantidad} uds
                        {it.costoUnitario != null && ` · $${(it.costoUnitario * it.cantidad).toFixed(2)}`}
                      </span>
                      <button
                        onClick={() => setNcItems((p) => p.filter((_, i) => i !== idx))}
                        className="ml-2 text-red-400 hover:text-red-600 active:scale-95 text-lg leading-none"
                      >×</button>
                    </div>
                  ))}
                  {ncItems.length > 0 && ncItems.some((i) => i.subtotal) && (
                    <div className="flex justify-between text-xs font-semibold text-red-700">
                      <span>Total monto:</span>
                      <span>${ncItems.reduce((s, i) => s + (i.subtotal ?? 0), 0).toFixed(2)}</span>
                    </div>
                  )}
                </div>

                <textarea
                  value={ncNotas}
                  onChange={(e) => setNcNotas(e.target.value)}
                  rows={2} placeholder="Observaciones adicionales…"
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm
                    outline-none focus:ring-2 focus:ring-red-300 resize-none"
                />

                {msgNc && (
                  <div className={`text-sm px-3 py-2 rounded-lg ${
                    msgNc.type === "ok"
                      ? "bg-green-50 text-green-700 border border-green-200"
                      : "bg-red-50 text-red-600 border border-red-200"
                  }`}>{msgNc.text}</div>
                )}

                <button
                  onClick={guardarNotaCredito}
                  disabled={guardandoNc || ncItems.length === 0}
                  className="w-full py-2.5 bg-red-600 hover:bg-red-700 active:scale-95 text-white
                    rounded-xl text-sm font-semibold transition-all duration-100 disabled:opacity-50"
                >
                  {guardandoNc ? "Guardando…" : "📝 Registrar nota de crédito"}
                </button>
              </div>
            </div>

            {/* Lista de notas */}
            {notasCredito.length > 0 && (
              <div className="space-y-2">
                <p className="text-xs font-semibold text-gray-600">Notas registradas:</p>
                {notasCredito.map((nc) => (
                  <button
                    key={nc.id}
                    onClick={() => setInvModal({ type: "nota", nc })}
                    className="w-full text-left p-3 border border-gray-100 rounded-xl
                      hover:bg-gray-50 active:scale-[0.99] transition-all duration-100"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="text-sm font-bold text-red-700 flex-shrink-0">{nc.numero}</span>
                        <span className="text-xs text-gray-500 truncate">{nc.motivo}</span>
                        <span className={`flex-shrink-0 text-xs px-1.5 py-0.5 rounded-full border ${
                          nc.estado === "aprobada"  ? "bg-green-100 text-green-700 border-green-200"
                          : nc.estado === "rechazada" ? "bg-red-100 text-red-700 border-red-200"
                          : "bg-amber-100 text-amber-700 border-amber-200"
                        }`}>
                          {nc.estado}
                        </span>
                      </div>
                      <span className="text-xs text-gray-400 flex-shrink-0">{fmtDate(nc.timestamp)}</span>
                    </div>
                    <div className="mt-1 flex flex-wrap gap-1">
                      {nc.productos.map((p, i) => (
                        <span key={i} className="text-xs bg-red-50 text-red-700 border
                          border-red-100 px-2 py-0.5 rounded-full">
                          {p.nombre.split(" ")[0]} ×{p.cantidad}
                        </span>
                      ))}
                      {nc.totalMonto != null && nc.totalMonto > 0 && (
                        <span className="text-xs bg-amber-50 text-amber-700 border
                          border-amber-100 px-2 py-0.5 rounded-full font-semibold">
                          ${nc.totalMonto.toFixed(2)}
                        </span>
                      )}
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── 7. Formulario + Lista de movimientos ─────────────────────────────── */}
      <div className="grid grid-cols-1 md:grid-cols-5 gap-4">

        {/* Formulario */}
        <div className="md:col-span-2">
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
            <div className="px-4 py-3 bg-gradient-to-r from-purple-700 to-purple-900">
              <h2 className="text-white font-semibold text-sm">+ Registrar movimiento</h2>
            </div>
            <form onSubmit={handleGuardar} className="p-4 space-y-3">

              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Tipo</label>
                <select
                  value={tipo}
                  onChange={(e) => setTipo(e.target.value as TipoLoker)}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm
                    focus:outline-none focus:ring-2 focus:ring-purple-400 bg-white"
                >
                  {TIPOS_ORDEN.map((t) => (
                    <option key={t} value={t}>{TIPO_CFG[t].label}</option>
                  ))}
                </select>
                <div className={`mt-1.5 inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs
                  font-medium border ${TIPO_CFG[tipo].bg} ${TIPO_CFG[tipo].text} ${TIPO_CFG[tipo].border}`}>
                  <span>{TIPO_CFG[tipo].sign >= 0 ? "▲" : "▼"}</span>
                  <span>{TIPO_CFG[tipo].label}</span>
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Producto</label>
                <input
                  type="text" value={nombre}
                  onChange={(e) => setNombre(e.target.value)}
                  placeholder="Ej. Helado de fresa"
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm
                    focus:outline-none focus:ring-2 focus:ring-purple-400"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Cantidad</label>
                <div className="flex gap-2">
                  {tipo === "ajuste" && (
                    <button
                      type="button"
                      onClick={() => setAjustePos((v) => !v)}
                      className={`px-3 py-2 rounded-lg border text-sm font-bold transition-colors ${
                        ajustePos
                          ? "bg-green-100 border-green-300 text-green-700"
                          : "bg-red-100 border-red-300 text-red-700"
                      }`}
                    >
                      {ajustePos ? "+" : "−"}
                    </button>
                  )}
                  <input
                    type="number" value={cantidad}
                    onChange={(e) => setCantidad(e.target.value)}
                    placeholder="0" min="0" step="any"
                    className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm
                      focus:outline-none focus:ring-2 focus:ring-purple-400"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">
                  Notas <span className="text-gray-400 font-normal">(opcional)</span>
                </label>
                <textarea
                  value={notas} onChange={(e) => setNotas(e.target.value)}
                  rows={2} placeholder="Observaciones, lote, proveedor…"
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm
                    focus:outline-none focus:ring-2 focus:ring-purple-400 resize-none"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Responsable</label>
                <div className="border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-500 bg-gray-50">
                  {profile?.nombre ?? "—"}
                </div>
              </div>

              {msg && (
                <p className={`text-xs rounded-lg px-3 py-2 ${
                  msg.type === "ok"
                    ? "bg-green-50 text-green-700 border border-green-200"
                    : "bg-red-50 text-red-600 border border-red-200"
                }`}>
                  {msg.text}
                </p>
              )}

              <button
                type="submit" disabled={guardando}
                className="w-full bg-gradient-to-r from-purple-700 to-purple-900 hover:from-purple-600
                  hover:to-purple-800 text-white font-semibold py-2.5 rounded-lg text-sm
                  transition-all duration-100 active:scale-95 disabled:opacity-60"
              >
                {guardando ? "Guardando…" : "Registrar movimiento"}
              </button>
            </form>
          </div>
        </div>

        {/* Lista de movimientos (colapsable) */}
        <div className="md:col-span-3">
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
            <button
              onClick={() => setMovAbierto((v) => !v)}
              className="w-full px-4 py-3 border-b border-gray-100 flex items-center
                justify-between hover:bg-gray-50 transition-colors"
            >
              <h2 className="font-semibold text-gray-800 text-sm">Movimientos recientes</h2>
              <div className="flex items-center gap-2">
                <span className="text-xs text-gray-400">
                  {cargando ? "…" : `${movimientos.length} total`}
                </span>
                <span className="text-gray-400 text-sm">{movAbierto ? "▲" : "▼"}</span>
              </div>
            </button>

            {movAbierto && (
              <div className="divide-y divide-gray-50 max-h-[60vh] overflow-y-auto">
                {cargando ? (
                  <div className="px-4 py-8 text-center">
                    <p className="text-sm text-gray-400 animate-pulse">Cargando movimientos…</p>
                  </div>
                ) : movimientos.length === 0 ? (
                  <div className="px-4 py-8 text-center">
                    <p className="text-2xl mb-2">📦</p>
                    <p className="text-sm text-gray-400">Sin movimientos aún.</p>
                    <p className="text-xs text-gray-300 mt-1">Registra la primera entrada al loker.</p>
                  </div>
                ) : (
                  movimientos.slice(0, 100).map((m) => {
                    const cfg = TIPO_CFG[m.tipo] ?? TIPO_CFG.ajuste;
                    return (
                      <div key={m.id} className="px-4 py-3 hover:bg-gray-50 transition-colors">
                        <div className="flex items-start gap-3">
                          <span className={`mt-0.5 flex-shrink-0 px-2 py-0.5 rounded-full text-xs
                            font-medium border ${cfg.bg} ${cfg.text} ${cfg.border}`}>
                            {cfg.sign >= 0 ? "▲" : "▼"} {cfg.label}
                          </span>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center justify-between gap-2">
                              <p className="text-sm font-medium text-gray-800 truncate">{m.nombre}</p>
                              <span className={`text-sm font-bold flex-shrink-0 ${
                                m.cantidad > 0 ? "text-green-600" : "text-red-600"
                              }`}>
                                {m.cantidad > 0 ? "+" : ""}{m.cantidad}
                              </span>
                            </div>
                            <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                              <span className="text-xs text-gray-400">{m.responsable}</span>
                              <span className="text-gray-200">·</span>
                              <span className="text-xs text-gray-400">{fmtDate(m.timestamp)}</span>
                              {m.choferNombre && (
                                <>
                                  <span className="text-gray-200">·</span>
                                  <span className="text-xs bg-cyan-50 text-cyan-700 border border-cyan-200
                                    px-1.5 py-0.5 rounded-full font-medium">
                                    → {m.choferNombre}
                                  </span>
                                </>
                              )}
                            </div>
                            {m.notas && (
                              <p className="text-xs text-gray-500 mt-1 italic truncate">{m.notas}</p>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            )}

            {movAbierto && movimientos.length > 100 && (
              <div className="px-4 py-2 border-t border-gray-100 bg-gray-50">
                <p className="text-xs text-gray-400 text-center">
                  Mostrando los últimos 100 de {movimientos.length} movimientos.
                </p>
              </div>
            )}

            {!movAbierto && !cargando && (
              <div className="px-4 py-3">
                <p className="text-xs text-gray-400 text-center">
                  Toca para ver {movimientos.length} movimientos
                </p>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ── Modal global ── */}
      {invModal !== null && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-end sm:items-center justify-center p-4" onClick={() => setInvModal(null)}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[80vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center gap-2 px-5 py-4 border-b flex-shrink-0">
              <h3 className="font-bold text-gray-800 flex-1 min-w-0 truncate">
                {invModal.type === "stat" && invModal.key === "loker"      && "📦 Stock en el loker"}
                {invModal.type === "stat" && invModal.key === "despachado" && "🚚 Despachado hoy"}
                {invModal.type === "stat" && invModal.key === "vendido"    && "✅ Vendido hoy"}
                {invModal.type === "stat" && invModal.key === "facturado"  && "💰 Facturado hoy"}
                {invModal.type === "producto" && `📊 Historial — ${invModal.nombre}`}
                {invModal.type === "chofer"   && `🚛 ${invModal.ch.choferNombre}`}
                {invModal.type === "lote"     && `🏭 Lote ${invModal.lote.numero}`}
                {invModal.type === "nota"     && `📝 ${invModal.nc.numero}`}
              </h3>
              <ShareBar
                getMessage={getInvModalMsg}
                getPrintHtml={getInvModalHtml}
                className="flex-shrink-0"
              />
              <button onClick={() => setInvModal(null)} className="text-gray-400 hover:text-gray-600 text-2xl leading-none active:scale-95 transition-all flex-shrink-0">×</button>
            </div>
            <div className="flex-1 overflow-y-auto p-4 space-y-2">

              {/* Stat: loker */}
              {invModal.type === "stat" && invModal.key === "loker" && (
                saldoConDetalle.length === 0 ? (
                  <p className="text-sm text-gray-400 text-center py-8">Sin productos en el loker aún</p>
                ) : saldoConDetalle.map((p) => (
                  <div key={p.pid} className={`flex justify-between items-center px-3 py-2 rounded-xl border text-sm ${p.saldo < 0 ? "bg-red-50 border-red-200" : p.saldo === 0 ? "bg-amber-50 border-amber-200" : "bg-green-50 border-green-100"}`}>
                    <span className="font-medium text-gray-800">{p.nombre}</span>
                    <span className={`font-bold ${p.saldo < 0 ? "text-red-700" : p.saldo === 0 ? "text-amber-600" : "text-green-700"}`}>
                      {p.saldo > 0 ? "+" : ""}{p.saldo}
                    </span>
                  </div>
                ))
              )}

              {/* Stat: despachado */}
              {invModal.type === "stat" && invModal.key === "despachado" && (
                saldoConDetalle.filter(p => p.despachHoy > 0).length === 0 ? (
                  <p className="text-sm text-gray-400 text-center py-8">Sin despachos registrados hoy</p>
                ) : saldoConDetalle.filter(p => p.despachHoy > 0).map((p) => (
                  <div key={p.pid} className="flex justify-between items-center px-3 py-2 rounded-xl border border-orange-100 bg-orange-50 text-sm">
                    <span className="font-medium text-gray-800">{p.nombre}</span>
                    <span className="font-bold text-orange-700">{p.despachHoy} uds</span>
                  </div>
                ))
              )}

              {/* Stat: vendido */}
              {invModal.type === "stat" && invModal.key === "vendido" && (
                resumenChoferes.filter(c => c.reportado).length === 0 ? (
                  <div className="text-center py-8">
                    <p className="text-3xl mb-2">⏳</p>
                    <p className="text-sm text-gray-500 font-medium">Sin reportes de sobrantes aún</p>
                    <p className="text-xs text-gray-400 mt-1">Los choferes deben reportar sus sobrantes para ver lo vendido</p>
                  </div>
                ) : resumenChoferes.filter(c => c.reportado).map((ch) => (
                  <div key={ch.choferId} className="border border-green-100 rounded-xl p-3 bg-green-50">
                    <p className="text-sm font-semibold text-gray-800 mb-2">{ch.choferNombre} <span className="text-xs font-normal text-green-600">· vendido: {ch.totalVendido}</span></p>
                    <div className="space-y-1">
                      {ch.productos.map(p => (
                        <div key={p.pid} className="flex justify-between text-xs text-gray-600">
                          <span>{p.nombre}</span>
                          <span className="font-semibold">{p.vendido} vend. / {p.despachado} desp.</span>
                        </div>
                      ))}
                    </div>
                  </div>
                ))
              )}

              {/* Stat: facturado */}
              {invModal.type === "stat" && invModal.key === "facturado" && (() => {
                const items = talonarioHoy
                  .filter(t => t.tipo === "retirada")
                  .flatMap(t => t.productos.filter(p => p.precio != null && p.precio! > 0).map(p => ({
                    chofer: t.choferNombre, nombre: p.nombre,
                    cantidad: p.cantidad ?? 0, precio: p.precio!,
                    subtotal: p.precio! * (p.cantidad ?? 0),
                  })));
                return items.length === 0 ? (
                  <div className="text-center py-8">
                    <p className="text-3xl mb-2">💰</p>
                    <p className="text-sm text-gray-500 font-medium">Sin precios configurados hoy</p>
                    <p className="text-xs text-gray-400 mt-1">Asigna precios al registrar talonarios para ver el facturado</p>
                  </div>
                ) : (
                  <>
                    {items.map((it, i) => (
                      <div key={i} className="flex items-center justify-between border border-gray-100 rounded-xl px-3 py-2 text-sm">
                        <div>
                          <p className="font-medium text-gray-800">{it.nombre}</p>
                          <p className="text-xs text-gray-400">{it.chofer} · {it.cantidad} × ${it.precio.toLocaleString()}</p>
                        </div>
                        <span className="font-bold text-green-700">${it.subtotal.toLocaleString()}</span>
                      </div>
                    ))}
                    <div className="flex justify-between bg-green-50 border border-green-200 rounded-xl px-3 py-2.5">
                      <span className="font-bold text-green-700">Total</span>
                      <span className="font-bold text-green-700">${dashboard.moneyHoy.toLocaleString("es-MX")}</span>
                    </div>
                  </>
                );
              })()}

              {/* Producto: historial de movimientos */}
              {invModal.type === "producto" && (() => {
                const movProd = movimientos.filter(m => m.producto_id === invModal.pid).slice(0, 50);
                return movProd.length === 0 ? (
                  <p className="text-sm text-gray-400 text-center py-8">Sin movimientos para este producto</p>
                ) : movProd.map((m) => {
                  const cfg = TIPO_CFG[m.tipo] ?? TIPO_CFG.ajuste;
                  return (
                    <div key={m.id} className={`flex items-center justify-between text-sm px-3 py-2 rounded-xl border ${cfg.bg} ${cfg.border}`}>
                      <div className="flex-1 min-w-0">
                        <p className={`text-xs font-medium ${cfg.text}`}>{cfg.label}</p>
                        <p className="text-xs text-gray-500 truncate">{m.responsable} {m.choferNombre ? `→ ${m.choferNombre}` : ""}</p>
                      </div>
                      <div className="text-right flex-shrink-0 ml-2">
                        <p className={`font-bold ${m.cantidad > 0 ? "text-green-700" : "text-red-600"}`}>
                          {m.cantidad > 0 ? "+" : ""}{m.cantidad}
                        </p>
                        <p className="text-xs text-gray-400">{fmtDate(m.timestamp)}</p>
                      </div>
                    </div>
                  );
                });
              })()}

              {/* Chofer: detalle sobrantes */}
              {invModal.type === "chofer" && (() => {
                const ch = invModal.ch;
                return (
                  <div className="space-y-3">
                    <div className="grid grid-cols-3 gap-3">
                      <div className="bg-cyan-50 rounded-xl p-3 text-center">
                        <p className="text-xl font-bold text-cyan-700">{ch.totalDespachado}</p>
                        <p className="text-xs text-cyan-500">Despachado</p>
                      </div>
                      <div className="bg-blue-50 rounded-xl p-3 text-center">
                        <p className="text-xl font-bold text-blue-700">{ch.reportado ? ch.totalSobrante : "—"}</p>
                        <p className="text-xs text-blue-500">Sobrante</p>
                      </div>
                      <div className="bg-green-50 rounded-xl p-3 text-center">
                        <p className="text-xl font-bold text-green-700">{ch.reportado ? ch.totalVendido : "—"}</p>
                        <p className="text-xs text-green-500">Vendido</p>
                      </div>
                    </div>
                    {!ch.reportado && (
                      <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 text-center">
                        <p className="text-sm font-medium text-amber-700">⏳ Sin sobrantes reportados</p>
                      </div>
                    )}
                    <div className="space-y-1.5">
                      {ch.productos.map(p => (
                        <div key={p.pid} className="flex items-center justify-between text-xs border border-gray-100 rounded-lg px-3 py-2">
                          <span className="font-medium text-gray-800">{p.nombre}</span>
                          <div className="flex gap-3 text-right">
                            <span className="text-cyan-700">{p.despachado} desp.</span>
                            {ch.reportado && <span className="text-green-700 font-semibold">{p.vendido} vend.</span>}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })()}

              {/* Lote: detalle completo */}
              {invModal.type === "lote" && (() => {
                const lote = invModal.lote;
                const fecha = (() => {
                  const d = toDate(lote.timestamp);
                  return d.toLocaleDateString("es-MX", { weekday: "short", day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
                })();
                return (
                  <div className="space-y-3">
                    {/* Meta */}
                    <div className="grid grid-cols-2 gap-2 text-sm">
                      <div className="bg-gray-50 rounded-xl p-3">
                        <p className="text-xs text-gray-400 mb-0.5">Registrado</p>
                        <p className="font-medium text-gray-800">{lote.registradoPor}</p>
                        <p className="text-xs text-gray-400 mt-0.5">{fecha}</p>
                      </div>
                      <div className={`rounded-xl p-3 ${lote.facturaEntregada ? "bg-green-50" : "bg-amber-50"}`}>
                        <p className="text-xs text-gray-400 mb-0.5">Factura</p>
                        {lote.facturaNumero && (
                          <p className="font-medium text-gray-800 text-xs">{lote.facturaNumero}</p>
                        )}
                        <p className={`text-xs font-semibold mt-0.5 ${lote.facturaEntregada ? "text-green-700" : "text-amber-700"}`}>
                          {lote.facturaEntregada ? "✅ Entregada" : "⏳ Pendiente"}
                        </p>
                      </div>
                    </div>
                    {lote.proveedor && (
                      <div className="bg-gray-50 rounded-xl px-3 py-2.5 text-sm">
                        <span className="text-xs text-gray-400">Proveedor: </span>
                        <span className="font-medium text-gray-800">{lote.proveedor}</span>
                      </div>
                    )}
                    {/* Productos */}
                    <div>
                      <p className="text-xs font-semibold text-gray-600 mb-2">
                        Productos ({lote.productos.length})
                      </p>
                      <div className="space-y-1.5">
                        {lote.productos.map((p) => (
                          <div key={p.producto_id}
                            className="flex items-center justify-between bg-emerald-50 border border-emerald-200
                              rounded-xl px-3 py-2.5 text-sm"
                          >
                            <span className="font-medium text-emerald-900">{p.nombre}</span>
                            <div className="flex items-center gap-2 text-emerald-700 text-xs font-semibold">
                              {p.cajas    > 0 && <span>{p.cajas} caj</span>}
                              {p.cajas    > 0 && p.unidades > 0 && <span>+</span>}
                              {p.unidades > 0 && <span>{p.unidades} uds</span>}
                              <span className="text-emerald-400 font-normal">· {p.total} total</span>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                    {/* Totales */}
                    <div className="bg-emerald-50 border border-emerald-200 rounded-xl px-3 py-2.5 flex justify-between text-sm">
                      <span className="text-emerald-700 font-semibold">Total entradas</span>
                      <span className="font-bold text-emerald-800">
                        +{lote.productos.reduce((s, p) => s + p.total, 0)} unidades
                      </span>
                    </div>
                    {lote.notas && (
                      <div className="bg-gray-50 border border-gray-200 rounded-xl px-3 py-2.5">
                        <p className="text-xs text-gray-400 mb-0.5">Notas</p>
                        <p className="text-sm text-gray-700 italic">{lote.notas}</p>
                      </div>
                    )}
                    {/* Costos del lote */}
                    {lote.productos.some((p) => p.costoUnitario != null) && (
                      <div className="border border-amber-200 rounded-xl overflow-hidden">
                        <div className="bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-800">
                          💰 Costos del lote
                        </div>
                        <div className="divide-y divide-gray-50">
                          {lote.productos.filter((p) => p.costoUnitario != null).map((p) => (
                            <div key={p.producto_id} className="flex items-center justify-between px-3 py-2 text-xs">
                              <span className="text-gray-700 flex-1 truncate">{p.nombre}</span>
                              <span className="text-amber-700 font-semibold ml-2">
                                ${p.costoUnitario!.toFixed(2)}/ud
                                {" · "}${(p.costoUnitario! * p.total).toFixed(2)}
                              </span>
                            </div>
                          ))}
                        </div>
                        <div className="bg-amber-50 px-3 py-2 flex justify-between text-xs font-bold text-amber-800">
                          <span>Inversión total:</span>
                          <span>${lote.productos.reduce((s, p) => s + (p.costoUnitario ?? 0) * p.total, 0).toFixed(2)}</span>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })()}

              {/* Nota de crédito: detalle */}
              {invModal.type === "nota" && (() => {
                const nc = invModal.nc;
                return (
                  <div className="space-y-3">
                    <div className={`rounded-xl px-4 py-3 flex items-center justify-between ${
                      nc.estado === "aprobada"   ? "bg-green-50 border border-green-200"
                      : nc.estado === "rechazada" ? "bg-red-50 border border-red-200"
                      : "bg-amber-50 border border-amber-200"
                    }`}>
                      <div>
                        <p className="font-bold text-gray-800">{nc.motivo}</p>
                        {nc.proveedor && <p className="text-xs text-gray-500 mt-0.5">{nc.proveedor}</p>}
                      </div>
                      <span className={`text-sm font-bold px-3 py-1 rounded-full ${
                        nc.estado === "aprobada"   ? "bg-green-200 text-green-800"
                        : nc.estado === "rechazada" ? "bg-red-200 text-red-800"
                        : "bg-amber-200 text-amber-800"
                      }`}>{nc.estado}</span>
                    </div>
                    <div className="grid grid-cols-2 gap-2 text-xs">
                      {nc.loteNumero && (
                        <div className="bg-gray-50 rounded-lg px-3 py-2">
                          <p className="text-gray-400">Lote ref.</p>
                          <p className="font-semibold text-gray-800">{nc.loteNumero}</p>
                        </div>
                      )}
                      {nc.facturaNumero && (
                        <div className="bg-gray-50 rounded-lg px-3 py-2">
                          <p className="text-gray-400">Factura</p>
                          <p className="font-semibold text-gray-800">{nc.facturaNumero}</p>
                        </div>
                      )}
                    </div>
                    <div className="space-y-1.5">
                      {nc.productos.map((p, i) => (
                        <div key={i} className="flex items-center justify-between bg-red-50
                          border border-red-100 rounded-xl px-3 py-2.5 text-sm"
                        >
                          <span className="font-medium text-red-900">{p.nombre}</span>
                          <div className="text-right text-xs text-red-700 font-semibold">
                            <span>{p.cantidad} uds</span>
                            {p.subtotal != null && p.subtotal > 0 && (
                              <p className="text-amber-600">${p.subtotal.toFixed(2)}</p>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                    {nc.totalMonto != null && nc.totalMonto > 0 && (
                      <div className="flex justify-between bg-amber-50 border border-amber-200
                        rounded-xl px-3 py-2.5 text-sm font-bold text-amber-800"
                      >
                        <span>Monto total:</span>
                        <span>${nc.totalMonto.toFixed(2)}</span>
                      </div>
                    )}
                    {nc.notas && (
                      <div className="bg-gray-50 rounded-xl px-3 py-2.5">
                        <p className="text-xs text-gray-400 mb-0.5">Notas</p>
                        <p className="text-sm text-gray-700 italic">{nc.notas}</p>
                      </div>
                    )}
                    <p className="text-xs text-gray-400 text-right">
                      {nc.registradoPor} · {fmtDate(nc.timestamp)}
                    </p>
                  </div>
                );
              })()}

            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── StatCard ─────────────────────────────────────────────────────────────────

function StatCard({
  icon, label, value, color, sub, onClick,
}: {
  icon:    string;
  label:   string;
  value:   number | string;
  color:   "purple" | "orange" | "green" | "yellow";
  sub?:    string;
  onClick?: () => void;
}) {
  const bg = {
    purple: "from-purple-500 to-purple-700",
    orange: "from-orange-400 to-orange-600",
    green:  "from-emerald-500 to-emerald-700",
    yellow: "from-yellow-500 to-amber-600",
  }[color];

  return (
    <button onClick={onClick} className={`w-full rounded-xl p-3.5 text-white bg-gradient-to-br ${bg} shadow-sm text-left active:scale-95 transition-all duration-100 hover:brightness-110`}>
      <p className="text-xl leading-none mb-1">{icon}</p>
      <p className="text-lg font-bold leading-tight">{value}</p>
      <p className="text-xs opacity-80 mt-0.5 leading-tight">{label}</p>
      {sub && <p className="text-xs opacity-60 italic leading-tight">{sub}</p>}
    </button>
  );
}
