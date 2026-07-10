"use client";

// Bandeja de Despacho — Sub-mejora 1 de PLAN-CORRECCION-CHOFER-2026-07-09.
// Bandeja general del Despachador (Oliver): Encargado/Admin le envían notas
// sueltas (y, en sub-mejoras futuras, correcciones de reporte y avisos de
// reposición de stock). No es broadcast como `avisos` — cada ítem tiene un
// ciclo de vida propio (pendiente → leída → resuelta) que ambas áreas
// consultan de forma permanente, no se descarta al verlo.
//
// Los productos mencionados en una nota se adjuntan por catálogo real
// (codigo/producto_id de config/precios), no como texto libre — mismo
// principio del CONTRATO-IDENTIDAD-CANONICA.md (evita el caso P5 de la
// auditoría: texto libre vs. código real).

import { useEffect, useState } from "react";
import {
  collection, addDoc, doc, getDoc, getDocs, updateDoc, onSnapshot, query, where, orderBy, Timestamp,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useAuth } from "@/lib/auth-context";
import { BandejaDespachoItem, PrecioProducto } from "@/lib/types";
import SearchableSelect, { SearchableOption } from "@/components/shared/SearchableSelect";

interface Props {
  puedeCrear: boolean;      // Encargado/Admin: escribe notas nuevas
  puedeResolver: boolean;   // Despachador: marca leída/resuelta
}

interface Chofer { ficha: string; nombre: string; }
interface ProductoRow { uid: string; producto_id: string; cantidad: string; }

export default function BandejaDespacho({ puedeCrear, puedeResolver }: Props) {
  const { profile } = useAuth();
  const [items, setItems] = useState<BandejaDespachoItem[]>([]);
  const [texto, setTexto] = useState("");
  const [ficha, setFicha] = useState("");   // "" = sin chofer asociado
  const [choferes, setChoferes] = useState<Chofer[]>([]);
  const [catalogo, setCatalogo] = useState<PrecioProducto[]>([]);
  const [catalogoCargando, setCatalogoCargando] = useState(true);
  const [filas, setFilas] = useState<ProductoRow[]>([]);
  const [busy,  setBusy]  = useState(false);
  const [msg,   setMsg]   = useState<{ type: "ok" | "err"; text: string } | null>(null);

  const flash = (type: "ok" | "err", text: string) => { setMsg({ type, text }); setTimeout(() => setMsg(null), 3000); };

  useEffect(() => {
    const q = query(collection(db, "bandeja_despacho"), orderBy("timestamp", "desc"));
    const unsub = onSnapshot(q, (snap) => {
      setItems(snap.docs.map((d) => ({ id: d.id, ...d.data() } as BandejaDespachoItem)));
    });
    return () => unsub();
  }, []);

  // Padrón de choferes (mismo patrón que AvisoBon.tsx) — solo hace falta si se puede crear.
  useEffect(() => {
    if (!puedeCrear) return;
    getDocs(query(collection(db, "usuarios"), where("role", "==", "chofer"))).then((s) => {
      const list = s.docs.map((d) => { const u = d.data() as { ficha?: string; nombre?: string }; return { ficha: String(u.ficha || ""), nombre: u.nombre || "" }; }).filter((c) => c.ficha);
      list.sort((a, b) => Number(a.ficha) - Number(b.ficha));
      setChoferes(list);
    }).catch(() => {});
  }, [puedeCrear]);

  // Catálogo (config/precios, mismo patrón que FacturaProveedor.tsx) — solo hace falta si se puede crear.
  // catalogoCargando cierra la ventana de confusión "Sin resultados" (parece roto)
  // vs. "todavía no cargó" — indistinguibles sin este estado.
  useEffect(() => {
    if (!puedeCrear) return;
    getDoc(doc(db, "config", "precios")).then((snap) => {
      if (snap.exists()) setCatalogo((snap.data().productos as PrecioProducto[]) ?? []);
    }).catch(() => {}).finally(() => setCatalogoCargando(false));
  }, [puedeCrear]);

  const opcionesProductos: SearchableOption[] = catalogo.map((p) => ({
    id: p.producto_id, label: p.nombre, sublabel: `Cód. ${p.codigo}`,
  }));

  const agregarFila = () => setFilas((prev) => [...prev, { uid: `${Date.now()}-${prev.length}`, producto_id: "", cantidad: "" }]);
  const quitarFila   = (uid: string) => setFilas((prev) => prev.filter((f) => f.uid !== uid));
  const editarFila   = (uid: string, campo: "producto_id" | "cantidad", valor: string) =>
    setFilas((prev) => prev.map((f) => f.uid === uid ? { ...f, [campo]: valor } : f));

  const crearNota = async () => {
    if (!texto.trim()) { flash("err", "Escribe el mensaje"); return; }
    setBusy(true);
    try {
      const productos = filas
        .filter((f) => f.producto_id && Number(f.cantidad) > 0)
        .map((f) => {
          const p = catalogo.find((c) => c.producto_id === f.producto_id);
          return p ? { codigo: p.codigo, producto_id: p.producto_id, nombre: p.nombre, cantidad: Number(f.cantidad) } : null;
        })
        .filter((p): p is NonNullable<typeof p> => p !== null);

      await addDoc(collection(db, "bandeja_despacho"), {
        tipo: "nota",
        estado: "pendiente",
        ficha: ficha || null,
        texto: texto.trim(),
        ...(productos.length > 0 ? { productos } : {}),
        creadoPor: { uid: profile?.uid ?? "", nombre: profile?.nombre ?? "", rol: profile?.role ?? "" },
        timestamp: Timestamp.now(),
      });
      setTexto(""); setFicha(""); setFilas([]);
      flash("ok", "Nota enviada ✓");
    } catch (e) { flash("err", e instanceof Error ? e.message : "Error"); }
    setBusy(false);
  };

  const marcarLeida = async (id: string) => {
    setBusy(true);
    try {
      await updateDoc(doc(db, "bandeja_despacho", id), {
        estado: "leida", leidaPor: profile?.nombre ?? "", leidaEn: Timestamp.now(),
      });
    } catch (e) { flash("err", e instanceof Error ? e.message : "Error"); }
    setBusy(false);
  };

  const marcarResuelta = async (id: string) => {
    setBusy(true);
    try {
      await updateDoc(doc(db, "bandeja_despacho", id), {
        estado: "resuelta", resueltaPor: profile?.nombre ?? "", resueltaEn: Timestamp.now(),
      });
    } catch (e) { flash("err", e instanceof Error ? e.message : "Error"); }
    setBusy(false);
  };

  const estadoBadge = (estado: BandejaDespachoItem["estado"]) => {
    if (estado === "pendiente") return <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-red-100 text-red-700 border border-red-200 whitespace-nowrap">⏳ Pendiente</span>;
    if (estado === "leida")     return <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 border border-amber-200 whitespace-nowrap">👀 Leída</span>;
    return <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-green-100 text-green-700 border border-green-200 whitespace-nowrap">✅ Resuelta</span>;
  };

  const tipoLabel = (tipo: BandejaDespachoItem["tipo"]) =>
    tipo === "nota" ? "📝 Nota" : tipo === "correccion_reporte" ? "✏️ Corrección" : "📦 Reposición";

  return (
    <div className="space-y-4">
      {msg && (
        <div className={`rounded-lg px-3 py-2 text-sm ${msg.type === "ok" ? "bg-green-50 text-green-700 border border-green-200" : "bg-red-50 text-red-700 border border-red-200"}`}>
          {msg.text}
        </div>
      )}

      {puedeCrear && (
        <div className="rounded-xl border border-blue-200 bg-blue-50/50 p-4 space-y-3">
          <h3 className="font-semibold text-blue-800 text-sm">📨 Enviar nota al Despachador</h3>
          <textarea
            value={texto} onChange={(e) => setTexto(e.target.value)} rows={3}
            placeholder="Escribe el mensaje…"
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
          />

          <div>
            <div className="text-xs font-medium text-gray-500 mb-1">Chofer asociado (opcional):</div>
            <select value={ficha} onChange={(e) => setFicha(e.target.value)} className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm">
              <option value="">Sin chofer asociado</option>
              {choferes.map((c) => <option key={c.ficha} value={c.ficha}>Ficha {c.ficha} · {c.nombre}</option>)}
            </select>
          </div>

          <div className="space-y-2">
            <div className="text-xs font-medium text-gray-500">Productos (opcional):</div>
            {filas.map((f) => (
              <div key={f.uid} className="flex gap-1.5 items-center">
                <div className="flex-1">
                  <SearchableSelect
                    value={f.producto_id}
                    onChange={(id) => editarFila(f.uid, "producto_id", id)}
                    options={opcionesProductos}
                    disabled={catalogoCargando}
                    placeholder="Buscar producto…"
                    emptyLabel={catalogoCargando ? "Cargando catálogo…" : "Elegir producto…"}
                  />
                </div>
                <input
                  type="number" min={1} inputMode="numeric" value={f.cantidad}
                  onChange={(e) => editarFila(f.uid, "cantidad", e.target.value)}
                  placeholder="Cant."
                  className="w-20 border border-gray-300 rounded-lg px-2 py-2 text-sm"
                />
                <button onClick={() => quitarFila(f.uid)} title="Quitar" className="text-red-400 hover:text-red-600 text-lg leading-none px-1">×</button>
              </div>
            ))}
            <button onClick={agregarFila} type="button" disabled={catalogoCargando} className="text-xs text-blue-600 font-semibold disabled:opacity-50 disabled:cursor-not-allowed">
              {catalogoCargando ? "Cargando catálogo…" : "+ Agregar producto"}
            </button>
          </div>

          <button onClick={crearNota} disabled={busy} className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50">
            Enviar
          </button>
        </div>
      )}

      <div className="rounded-xl border border-gray-200 p-4 space-y-2">
        <h3 className="font-semibold text-gray-800 text-sm">Bandeja</h3>
        {items.length === 0 && <div className="text-xs text-gray-500">No hay nada en la bandeja.</div>}
        <ul className="space-y-2">
          {items.map((it) => (
            <li key={it.id} className="rounded-lg bg-white border border-gray-200 p-3 text-sm">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-semibold text-gray-600">
                  {tipoLabel(it.tipo)}{it.ficha ? ` · ficha ${it.ficha}` : ""}
                </span>
                {estadoBadge(it.estado)}
              </div>
              {it.texto && <div className="whitespace-pre-wrap text-gray-800 mt-1">{it.texto}</div>}
              {it.productos && it.productos.length > 0 && (
                <ul className="mt-1.5 space-y-0.5">
                  {it.productos.map((p, i) => (
                    <li key={i} className="text-xs text-gray-600">
                      • {p.nombre} <span className="font-semibold">× {p.cantidad}</span>
                    </li>
                  ))}
                </ul>
              )}
              <div className="text-[11px] text-gray-400 mt-1">De: {it.creadoPor?.nombre || "—"}</div>
              {puedeResolver && (
                <div className="flex gap-2 mt-2">
                  {it.estado === "pendiente" && (
                    <button onClick={() => it.id && marcarLeida(it.id)} disabled={busy} className="text-xs text-blue-600 font-semibold disabled:opacity-50">
                      Marcar leída
                    </button>
                  )}
                  {it.estado === "leida" && (
                    <button onClick={() => it.id && marcarResuelta(it.id)} disabled={busy} className="text-xs text-green-600 font-semibold disabled:opacity-50">
                      Marcar resuelta
                    </button>
                  )}
                </div>
              )}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
