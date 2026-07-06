"use client";

/**
 * GestionCodigos — Gestión de la base de códigos de cajas
 *
 * CRUD de la colección codigos_cajas en Firestore.
 * Usada por SPIKINSCAN y Polar Breeze Weight.
 */

import { useState, useEffect } from "react";
import {
  collection, onSnapshot, orderBy, query,
  doc, getDoc, setDoc, deleteDoc, serverTimestamp,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useAuth } from "@/lib/auth-context";
import { CodigoCaja, PrecioProducto, toDate, resolverProductoEnCatalogo } from "@/lib/types";

interface CodigoCajaDoc extends CodigoCaja {
  id: string;
}

export default function GestionCodigos() {
  const { profile }  = useAuth();
  const [codigos,    setCodigos]   = useState<CodigoCajaDoc[]>([]);
  const [loading,    setLoading]   = useState(true);
  const [busqueda,   setBusqueda]  = useState("");
  const [showForm,   setShowForm]  = useState(false);
  const [editando,   setEditando]  = useState<CodigoCajaDoc | null>(null);
  const [guardando,  setGuardando] = useState(false);
  const [eliminando, setEliminando] = useState<string | null>(null);

  // Catálogo canónico (config/precios) — solo para sugerir/anclar nombres,
  // nunca bloquea: si el producto de verdad es nuevo, se guarda tal cual se escribió.
  const [catalogoPrecios, setCatalogoPrecios] = useState<PrecioProducto[]>([]);

  // Form state
  const [fCodigo,   setFCodigo]   = useState("");
  const [fProducto, setFProducto] = useState("");
  const [fUnids,    setFUnids]    = useState(24);
  const [fPeso,     setFPeso]     = useState("");
  const [formMsg,   setFormMsg]   = useState<string | null>(null);

  useEffect(() => {
    const unsub = onSnapshot(
      query(collection(db, "codigos_cajas"), orderBy("producto")),
      (snap) => {
        setCodigos(snap.docs.map((d) => ({ id: d.id, ...d.data() } as CodigoCajaDoc)));
        setLoading(false);
      }
    );
    return () => unsub();
  }, []);

  useEffect(() => {
    getDoc(doc(db, "config", "precios")).then((snap) => {
      if (snap.exists()) setCatalogoPrecios((snap.data().productos as PrecioProducto[]) ?? []);
    }).catch(() => { /* sin catálogo → los nombres se guardan tal cual se escriban */ });
  }, []);

  const openNuevo = () => {
    setEditando(null);
    setFCodigo(""); setFProducto(""); setFUnids(24); setFPeso("");
    setFormMsg(null);
    setShowForm(true);
  };

  const openEditar = (c: CodigoCajaDoc) => {
    setEditando(c);
    setFCodigo(c.codigo);
    setFProducto(c.producto);
    setFUnids(c.unidadesPorCaja);
    setFPeso(c.pesoCajaKg ? String(c.pesoCajaKg) : "");
    setFormMsg(null);
    setShowForm(true);
  };

  const guardar = async () => {
    if (!fCodigo.trim() || !fProducto.trim()) {
      setFormMsg("El código y el nombre son obligatorios.");
      return;
    }
    setGuardando(true);
    setFormMsg(null);
    try {
      const docId = fCodigo.trim();
      const nombreAnclado = resolverProductoEnCatalogo(fProducto, catalogoPrecios).nombre;
      await setDoc(doc(db, "codigos_cajas", docId), {
        codigo:          docId,
        producto:        nombreAnclado,
        unidadesPorCaja: fUnids,
        pesoCajaKg:      fPeso ? parseFloat(fPeso) : null,
        creadoPor:       profile?.nombre ?? "Admin",
        creadoEn:        serverTimestamp(),
      });
      setShowForm(false);
    } catch (e) {
      setFormMsg(e instanceof Error ? e.message : "Error al guardar");
    } finally {
      setGuardando(false);
    }
  };

  const eliminar = async (id: string) => {
    if (!confirm("¿Eliminar este código? Esta acción es permanente.")) return;
    setEliminando(id);
    try {
      await deleteDoc(doc(db, "codigos_cajas", id));
    } finally {
      setEliminando(null);
    }
  };

  const filtrados = busqueda.trim().length < 2
    ? codigos
    : codigos.filter((c) =>
        c.codigo.toLowerCase().includes(busqueda.toLowerCase()) ||
        c.producto.toLowerCase().includes(busqueda.toLowerCase())
      );

  return (
    <div className="space-y-5">
      {/* ── Header ── */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-lg font-bold text-[#1A1A1A]">🔲 Códigos de Cajas</h2>
          <p className="text-xs text-gray-400">
            Base compartida SPIKINSCAN + Polar Breeze Weight · {codigos.length} códigos registrados
          </p>
        </div>
        <button
          onClick={openNuevo}
          className="px-4 py-2 rounded-xl bg-[#F5C800] text-[#1A1A1A] text-sm font-bold
            hover:brightness-95 active:scale-95 transition-all"
        >
          + Nuevo código
        </button>
      </div>

      {/* ── Buscador ── */}
      <div className="relative">
        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400">🔍</span>
        <input
          value={busqueda}
          onChange={(e) => setBusqueda(e.target.value)}
          placeholder="Buscar por código o nombre…"
          className="w-full pl-9 pr-4 py-2.5 border border-gray-200 rounded-xl text-sm
            text-gray-800 outline-none focus:ring-2 focus:ring-[#F5C800] bg-white"
        />
      </div>

      {/* ── Modal Formulario ── */}
      {showForm && (
        <div className="fixed inset-0 z-[9998] flex items-center justify-center bg-black/50 p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6 space-y-4">
            <h3 className="font-bold text-[#1A1A1A]">
              {editando ? "✏️ Editar código" : "➕ Nuevo código"}
            </h3>
            <div className="space-y-3">
              <div>
                <label className="text-xs font-medium text-gray-500 block mb-1">Código de barras *</label>
                <input
                  autoFocus={!editando}
                  value={fCodigo}
                  onChange={(e) => setFCodigo(e.target.value)}
                  readOnly={!!editando}
                  placeholder="Escanea o escribe el código"
                  className={`w-full px-3 py-2.5 border border-gray-300 rounded-xl text-sm
                    text-gray-800 outline-none focus:ring-2 focus:ring-[#F5C800] font-mono
                    ${editando ? "bg-gray-50 text-gray-400" : ""}`}
                />
              </div>
              <div>
                <label className="text-xs font-medium text-gray-500 block mb-1">Nombre del producto *</label>
                <input
                  autoFocus={!!editando}
                  value={fProducto}
                  onChange={(e) => setFProducto(e.target.value)}
                  placeholder="Ej. Paleta Chocolate 90ml"
                  list="catalogo-precios-codigos"
                  className="w-full px-3 py-2.5 border border-gray-300 rounded-xl text-sm
                    text-gray-800 outline-none focus:ring-2 focus:ring-[#F5C800]"
                />
                <datalist id="catalogo-precios-codigos">
                  {catalogoPrecios.map((p) => (
                    <option key={p.producto_id} value={p.nombre} />
                  ))}
                </datalist>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-medium text-gray-500 block mb-1">Unidades / caja</label>
                  <input
                    type="number" min={1} value={fUnids}
                    onChange={(e) => setFUnids(parseInt(e.target.value) || 1)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-xl text-sm
                      text-gray-800 outline-none focus:ring-2 focus:ring-[#F5C800]"
                  />
                </div>
                <div>
                  <label className="text-xs font-medium text-gray-500 block mb-1">Peso / caja (kg)</label>
                  <input
                    type="number" step="0.1" value={fPeso}
                    onChange={(e) => setFPeso(e.target.value)}
                    placeholder="Opcional"
                    className="w-full px-3 py-2 border border-gray-300 rounded-xl text-sm
                      text-gray-800 outline-none focus:ring-2 focus:ring-[#F5C800]"
                  />
                </div>
              </div>
              {formMsg && (
                <p className="text-xs text-red-600 bg-red-50 rounded-lg px-3 py-2">{formMsg}</p>
              )}
            </div>
            <div className="flex gap-2">
              <button onClick={() => setShowForm(false)}
                className="flex-1 py-2.5 rounded-xl border border-gray-200 text-sm text-gray-600
                  hover:bg-gray-50 transition">
                Cancelar
              </button>
              <button onClick={guardar} disabled={guardando || !fCodigo.trim() || !fProducto.trim()}
                className="flex-1 py-2.5 rounded-xl bg-[#F5C800] text-[#1A1A1A] text-sm font-bold
                  hover:brightness-95 active:scale-95 transition-all disabled:opacity-50">
                {guardando ? "Guardando…" : "💾 Guardar"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Lista de códigos ── */}
      {loading ? (
        <div className="space-y-2">
          {[1,2,3,4,5].map((i) => (
            <div key={i} className="h-14 bg-gray-100 rounded-xl animate-pulse" />
          ))}
        </div>
      ) : filtrados.length === 0 ? (
        <div className="text-center py-12 bg-white rounded-xl shadow-sm">
          <p className="text-3xl mb-2">🔲</p>
          <p className="text-sm font-semibold text-gray-700">Sin códigos registrados</p>
          <p className="text-xs text-gray-400 mt-1">Los códigos se crean al escanear en Weight o SPIKINSCAN.</p>
        </div>
      ) : (
        <div className="bg-white rounded-xl shadow-sm overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-100">
              <tr>
                <th className="text-left py-3 px-4 text-xs font-semibold text-gray-500">Código</th>
                <th className="text-left py-3 px-4 text-xs font-semibold text-gray-500">Producto</th>
                <th className="text-right py-3 px-4 text-xs font-semibold text-gray-500">Uds/Caja</th>
                <th className="text-right py-3 px-4 text-xs font-semibold text-gray-500">Peso(kg)</th>
                <th className="text-left py-3 px-4 text-xs font-semibold text-gray-500">Creado</th>
                <th className="py-3 px-4"></th>
              </tr>
            </thead>
            <tbody>
              {filtrados.map((c) => (
                <tr key={c.id} className="border-b border-gray-50 hover:bg-gray-50 transition-colors">
                  <td className="py-2.5 px-4 font-mono text-xs text-gray-600">{c.codigo}</td>
                  <td className="py-2.5 px-4 font-semibold text-gray-800">{c.producto}</td>
                  <td className="py-2.5 px-4 text-right text-gray-700">{c.unidadesPorCaja}</td>
                  <td className="py-2.5 px-4 text-right text-gray-500">
                    {c.pesoCajaKg ? `${c.pesoCajaKg} kg` : "—"}
                  </td>
                  <td className="py-2.5 px-4 text-xs text-gray-400">
                    {c.creadoPor ?? "—"}
                    {c.creadoEn && (
                      <span className="block text-gray-300">
                        {toDate(c.creadoEn).toLocaleDateString("es-DO")}
                      </span>
                    )}
                  </td>
                  <td className="py-2.5 px-4">
                    <div className="flex items-center justify-end gap-2">
                      <button
                        onClick={() => openEditar(c)}
                        className="text-xs px-2.5 py-1 rounded-lg bg-gray-100 text-gray-600
                          hover:bg-gray-200 transition active:scale-95"
                      >
                        ✏️
                      </button>
                      <button
                        onClick={() => eliminar(c.id)}
                        disabled={eliminando === c.id}
                        className="text-xs px-2.5 py-1 rounded-lg bg-red-50 text-red-600
                          hover:bg-red-100 transition active:scale-95 disabled:opacity-50"
                      >
                        {eliminando === c.id ? "…" : "🗑️"}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {filtrados.length < codigos.length && (
            <p className="text-xs text-gray-400 text-center py-2">
              Mostrando {filtrados.length} de {codigos.length} códigos
            </p>
          )}
        </div>
      )}
    </div>
  );
}
