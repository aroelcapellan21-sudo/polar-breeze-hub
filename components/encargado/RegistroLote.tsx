"use client";

import { useState, useEffect } from "react";
import {
  collection, addDoc, getDocs, Timestamp, getDoc, doc,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useAuth } from "@/lib/auth-context";
import { PuntoProducto, LoteLoker, toProductoId } from "@/lib/types";

interface ProductoLote {
  nombre:      string;
  producto_id: string;
  cajas:       number;
  unidades:    number;
  total:       number;
}

export default function RegistroLote() {
  const { profile } = useAuth();

  const [catalogo,  setCatalogo]  = useState<PuntoProducto[]>([]);
  const [selProd,   setSelProd]   = useState("");
  const [cajasStr,  setCajasStr]  = useState("");
  const [unidsStr,  setUnidsStr]  = useState("");
  const [items,     setItems]     = useState<ProductoLote[]>([]);
  const [proveedor, setProveedor] = useState("");
  const [factNum,   setFactNum]   = useState("");
  const [factOk,    setFactOk]    = useState(false);
  const [notas,     setNotas]     = useState("");
  const [guardando, setGuardando] = useState(false);
  const [msg,       setMsg]       = useState<{ type: "ok" | "err"; text: string } | null>(null);
  const [guardado,  setGuardado]  = useState<LoteLoker | null>(null);
  const [waNum,     setWaNum]     = useState("");

  useEffect(() => {
    getDoc(doc(db, "config", "puntos")).then((snap) => {
      if (snap.exists()) {
        const d = snap.data();
        const prods: PuntoProducto[] = d.productos ?? [];
        setCatalogo(prods);
        if (prods.length > 0) setSelProd(prods[0].nombre);
      }
    });
    getDoc(doc(db, "config", "main")).then((snap) => {
      if (snap.exists()) {
        const d = snap.data();
        const num = d.whatsappNumero ?? d.whatsappBot?.numero ?? d.whatsapp ?? "";
        setWaNum(String(num));
      }
    });
  }, []);

  function agregar() {
    if (!selProd) return;
    const cajas = Math.max(0, parseInt(cajasStr) || 0);
    const unids = Math.max(0, parseInt(unidsStr) || 0);
    if (cajas === 0 && unids === 0) {
      setMsg({ type: "err", text: "Ingresa al menos 1 caja o 1 unidad." });
      return;
    }
    setMsg(null);
    const pid   = toProductoId(selProd);
    const total = cajas + unids;
    setItems(prev => {
      const idx = prev.findIndex(i => i.producto_id === pid);
      if (idx >= 0) {
        return prev.map((it, i) => i === idx
          ? { ...it, cajas: it.cajas + cajas, unidades: it.unidades + unids, total: it.total + total }
          : it
        );
      }
      return [...prev, { nombre: selProd, producto_id: pid, cajas, unidades: unids, total }];
    });
    setCajasStr(""); setUnidsStr("");
  }

  function quitarItem(idx: number) {
    setItems(prev => prev.filter((_, i) => i !== idx));
  }

  async function guardar() {
    if (items.length === 0) {
      setMsg({ type: "err", text: "Agrega al menos un producto." });
      return;
    }
    setGuardando(true);
    setMsg(null);
    try {
      const lotesSnap = await getDocs(collection(db, "lotes_loker"));
      const numero    = `#${String(lotesSnap.size + 1).padStart(3, "0")}`;
      const ts        = Timestamp.now();
      const nombre    = profile?.nombre ?? "Encargado";
      const uid       = profile?.uid    ?? "";

      const loteData: Omit<LoteLoker, "id"> = {
        numero,
        proveedor:        proveedor.trim() || undefined,
        facturaNumero:    factNum.trim()   || undefined,
        facturaEntregada: factOk,
        productos:        items,
        registradoPor:    nombre,
        registradoPorId:  uid,
        timestamp:        ts,
        notas:            notas.trim() || undefined,
      };

      const loteRef = await addDoc(collection(db, "lotes_loker"), loteData);

      await Promise.all(items.map(item =>
        addDoc(collection(db, "movimientos_loker"), {
          tipo:        "entrada_interior",
          producto_id: item.producto_id,
          nombre:      item.nombre,
          cantidad:    item.total,
          responsable: nombre,
          timestamp:   ts,
          notas:       `Lote ${numero}${proveedor.trim() ? ` — ${proveedor.trim()}` : ""}`,
          loteNumero:  numero,
          loteId:      loteRef.id,
        })
      ));

      setGuardado({ ...loteData, id: loteRef.id });
      setItems([]); setProveedor(""); setFactNum(""); setFactOk(false); setNotas("");
      setMsg({ type: "ok", text: `Lote ${numero} guardado correctamente.` });
    } catch (e) {
      setMsg({ type: "err", text: e instanceof Error ? e.message : "Error al guardar." });
    } finally {
      setGuardando(false);
    }
  }

  function buildWa(lote: LoteLoker) {
    const fecha = new Date().toLocaleDateString("es-MX", { day: "2-digit", month: "short", year: "numeric" });
    const lines = [
      `📦 *LOTE ${lote.numero} — POLAR BREEZE*`,
      `📅 ${fecha}`,
      lote.proveedor ? `🏭 Proveedor: ${lote.proveedor}` : null,
      lote.facturaNumero
        ? `🧾 Factura: ${lote.facturaNumero} — ${lote.facturaEntregada ? "✅ Entregada" : "⏳ Pendiente"}`
        : `🧾 Factura: ${lote.facturaEntregada ? "✅ Entregada" : "⏳ Pendiente"}`,
      `👤 ${lote.registradoPor}`,
      "",
      "*Productos:*",
      ...lote.productos.map(p => {
        const partes: string[] = [];
        if (p.cajas    > 0) partes.push(`${p.cajas} caj`);
        if (p.unidades > 0) partes.push(`${p.unidades} uds`);
        return `• ${p.nombre}: ${partes.join(" + ")}`;
      }),
    ].filter(l => l !== null).join("\n");
    return `https://wa.me/${waNum.replace(/\D/g, "")}?text=${encodeURIComponent(lines)}`;
  }

  return (
    <div className="space-y-4 max-w-lg mx-auto">

      <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
        <div className="px-4 py-3 bg-gradient-to-r from-emerald-600 to-emerald-800">
          <h2 className="text-white font-bold text-sm">📦 Registrar nuevo lote</h2>
          <p className="text-emerald-200 text-xs mt-0.5">El número se genera automáticamente</p>
        </div>

        <div className="p-4 space-y-4">

          {/* Proveedor y factura */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">
                Proveedor <span className="text-gray-400 font-normal">(opcional)</span>
              </label>
              <input
                value={proveedor} onChange={(e) => setProveedor(e.target.value)}
                placeholder="Nombre del proveedor"
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm
                  focus:outline-none focus:ring-2 focus:ring-emerald-400"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">
                Nº Factura <span className="text-gray-400 font-normal">(opcional)</span>
              </label>
              <input
                value={factNum} onChange={(e) => setFactNum(e.target.value)}
                placeholder="Ej. F-2024-001"
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm
                  focus:outline-none focus:ring-2 focus:ring-emerald-400"
              />
            </div>
          </div>

          {/* Factura entregada */}
          <button
            type="button"
            onClick={() => setFactOk(v => !v)}
            className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl border-2
              transition-all duration-100 active:scale-95 ${
              factOk
                ? "border-emerald-400 bg-emerald-50 text-emerald-800"
                : "border-gray-200 bg-gray-50 text-gray-500"
            }`}
          >
            <span className={`w-5 h-5 rounded flex items-center justify-center text-xs font-bold flex-shrink-0 ${
              factOk ? "bg-emerald-500 text-white" : "bg-white border-2 border-gray-300 text-transparent"
            }`}>
              ✓
            </span>
            <span className="text-sm font-medium">Factura física entregada</span>
            {!factOk && (
              <span className="ml-auto text-xs bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full">
                ⏳ Pendiente
              </span>
            )}
          </button>

          {/* Selector de producto */}
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-2">Agregar producto</label>
            <select
              value={selProd} onChange={(e) => setSelProd(e.target.value)}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm
                focus:outline-none focus:ring-2 focus:ring-emerald-400 bg-white mb-2"
            >
              {catalogo.length === 0 && <option value="">Sin catálogo configurado</option>}
              {catalogo.map(p => (
                <option key={p.nombre} value={p.nombre}>{p.nombre}</option>
              ))}
            </select>
            <div className="flex gap-2">
              <div className="flex-1">
                <input
                  type="number" value={cajasStr}
                  onChange={(e) => setCajasStr(e.target.value)}
                  placeholder="Cajas" min="0"
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm
                    focus:outline-none focus:ring-2 focus:ring-emerald-400"
                />
                <p className="text-xs text-gray-400 mt-0.5 text-center">cajas</p>
              </div>
              <div className="flex items-start pt-2.5 text-gray-400 font-bold">+</div>
              <div className="flex-1">
                <input
                  type="number" value={unidsStr}
                  onChange={(e) => setUnidsStr(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && agregar()}
                  placeholder="Unidades" min="0"
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm
                    focus:outline-none focus:ring-2 focus:ring-emerald-400"
                />
                <p className="text-xs text-gray-400 mt-0.5 text-center">unidades</p>
              </div>
              <button
                type="button" onClick={agregar}
                disabled={!selProd || catalogo.length === 0}
                className="px-4 py-2 bg-emerald-600 text-white rounded-lg text-lg font-bold
                  active:scale-95 transition-all duration-100 self-start disabled:opacity-50"
              >
                +
              </button>
            </div>
          </div>

          {/* Lista de productos del lote */}
          {items.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs font-semibold text-gray-600">
                Productos en este lote ({items.length}):
              </p>
              {items.map((it, idx) => (
                <div key={it.producto_id}
                  className="flex items-center gap-2 bg-emerald-50 border border-emerald-200 rounded-xl px-3 py-2.5"
                >
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-emerald-900 truncate">{it.nombre}</p>
                    <div className="flex gap-2 mt-0.5 text-xs text-emerald-600">
                      {it.cajas    > 0 && <span>{it.cajas} caj</span>}
                      {it.cajas    > 0 && it.unidades > 0 && <span>+</span>}
                      {it.unidades > 0 && <span>{it.unidades} uds</span>}
                      <span className="text-emerald-400">· {it.total} en total</span>
                    </div>
                  </div>
                  <button
                    onClick={() => quitarItem(idx)}
                    className="text-red-400 hover:text-red-600 active:scale-95 transition-all
                      text-xl leading-none flex-shrink-0 w-7 h-7 flex items-center justify-center"
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* Notas */}
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">
              Notas <span className="text-gray-400 font-normal">(opcional)</span>
            </label>
            <textarea
              value={notas} onChange={(e) => setNotas(e.target.value)}
              rows={2} placeholder="Observaciones del lote…"
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm
                focus:outline-none focus:ring-2 focus:ring-emerald-400 resize-none"
            />
          </div>

          {/* Registrado por */}
          <div className="flex items-center gap-2 bg-gray-50 border border-gray-200 rounded-lg px-3 py-2">
            <span className="text-xs text-gray-400">Registrado por:</span>
            <span className="text-sm font-medium text-gray-700">{profile?.nombre ?? "—"}</span>
          </div>

          {msg && (
            <div className={`text-sm px-3 py-2 rounded-lg ${
              msg.type === "ok"
                ? "bg-green-50 text-green-700 border border-green-200"
                : "bg-red-50 text-red-600 border border-red-200"
            }`}>
              {msg.text}
            </div>
          )}

          <button
            onClick={guardar}
            disabled={guardando || items.length === 0}
            className="w-full bg-gradient-to-r from-emerald-600 to-emerald-800 hover:from-emerald-500
              hover:to-emerald-700 text-white font-bold py-3 rounded-xl text-sm transition-all
              duration-100 active:scale-95 disabled:opacity-60"
          >
            {guardando ? "Guardando…" : `Registrar lote (${items.length} producto${items.length !== 1 ? "s" : ""})`}
          </button>
        </div>
      </div>

      {/* Tarjeta de éxito + WhatsApp */}
      {guardado && (
        <div className="bg-white rounded-xl shadow-sm border border-emerald-200 overflow-hidden">
          <div className="px-4 py-3 bg-emerald-50 border-b border-emerald-100 flex items-center gap-3">
            <span className="text-2xl">✅</span>
            <div>
              <p className="font-bold text-emerald-800">Lote {guardado.numero} registrado</p>
              <p className="text-xs text-emerald-600">
                {guardado.productos.length} producto{guardado.productos.length !== 1 ? "s" : ""}
                {" · "}
                {guardado.facturaEntregada ? "✅ Factura OK" : "⏳ Factura pendiente"}
                {guardado.proveedor ? ` · ${guardado.proveedor}` : ""}
              </p>
            </div>
          </div>
          <div className="p-4 space-y-2">
            {guardado.productos.map(p => (
              <div key={p.producto_id}
                className="flex items-center justify-between text-sm border border-gray-100 rounded-lg px-3 py-2"
              >
                <span className="font-medium text-gray-800">{p.nombre}</span>
                <span className="text-emerald-700 font-semibold">
                  {[p.cajas > 0 ? `${p.cajas} caj` : null, p.unidades > 0 ? `${p.unidades} uds` : null]
                    .filter(Boolean).join(" + ")}
                </span>
              </div>
            ))}
            <div className="flex gap-2 pt-2">
              {waNum && (
                <a
                  href={buildWa(guardado)}
                  target="_blank" rel="noopener noreferrer"
                  className="flex-1 flex items-center justify-center gap-2 bg-green-500 hover:bg-green-600
                    active:scale-95 text-white text-sm font-bold py-2.5 rounded-xl transition-all duration-100"
                >
                  📱 WhatsApp
                </a>
              )}
              <button
                onClick={() => setGuardado(null)}
                className="flex-1 py-2.5 rounded-xl border border-gray-200 text-sm text-gray-600
                  hover:bg-gray-50 active:scale-95 transition-all duration-100"
              >
                Nuevo lote
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
