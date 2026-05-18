"use client";

import { useState, useEffect, useMemo } from "react";
import { collection, query, orderBy, onSnapshot, Timestamp, where, doc, getDoc } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { toDate } from "@/lib/types";

// ─── Types (reflejo de lo que guarda InformeCierre) ───────────────────────────

interface FaltanteRow { producto: string; cantFaltante: number; choferAfectado: string; }
interface DanadoRow   { producto: string; cantidad: number; choferRechazo: string; motivo: string; }
interface SobranteRow { producto: string; cantidad: number; fuente: string; }
interface CfNoEntrRow { producto: string; cantidad: number; motivo: string; persona: string; }
interface SubProd     { nombre: string; cantidad: number; }
interface ChoferCierre {
  choferId:  string;
  nombre:    string;
  ficha:     string;
  retirados: { nombre: string; cantidad: number; unidad?: string }[];
  agregado1: SubProd[];
  agregado0: SubProd[];
  faltantes: SubProd[];
}
interface InformeCierre {
  id:                   string;
  fecha:                Date | { seconds: number };
  despachadorId:        string;
  despachadorNombre:    string;
  faltantesDespacho:    FaltanteRow[];
  danadosNoRecibidos:   DanadoRow[];
  sobrantesDespacho:    SobranteRow[];
  cfNoEntregados:       CfNoEntrRow[];
  choferes:             ChoferCierre[];
  observacionesGenerales?: string | null;
  cerradoAt:            Date | { seconds: number };
}

// ─── Component ────────────────────────────────────────────────────────────────

interface Empresa { nombre: string; rnc: string; direccion: string; telefono: string; }

export default function InformesHistorial() {
  const [informes,  setInformes]  = useState<InformeCierre[]>([]);
  const [cargando,  setCargando]  = useState(true);
  const [filtroFecha, setFiltroFecha] = useState("");
  const [abierto,   setAbierto]   = useState<string | null>(null);
  const [seccion,   setSeccion]   = useState<Record<string, Record<string, boolean>>>({});
  const [empresa,   setEmpresa]   = useState<Empresa | null>(null);

  // ── Empresa ───────────────────────────────────────────────────────────────
  useEffect(() => {
    getDoc(doc(db, "config", "empresa")).then((snap) => {
      if (snap.exists()) setEmpresa(snap.data() as Empresa);
    });
  }, []);

  // ── Listener ──────────────────────────────────────────────────────────────
  useEffect(() => {
    const q = query(
      collection(db, "informes_cierre"),
      orderBy("cerradoAt", "desc"),
    );
    const unsub = onSnapshot(
      q,
      (snap) => {
        setInformes(
          snap.docs.map((d) => ({ id: d.id, ...d.data() } as InformeCierre)),
        );
        setCargando(false);
      },
      () => setCargando(false),
    );
    return unsub;
  }, []);

  // ── Filtro por fecha ─────────────────────────────────────────────────────
  const filtrados = useMemo(() => {
    if (!filtroFecha) return informes;
    const [yy, mm, dd] = filtroFecha.split("-").map(Number);
    return informes.filter((inf) => {
      const d = toDate(inf.cerradoAt);
      return d.getFullYear() === yy && d.getMonth() + 1 === mm && d.getDate() === dd;
    });
  }, [informes, filtroFecha]);

  // ── Toggle sección interna ────────────────────────────────────────────────
  const toggleSec = (id: string, key: string) =>
    setSeccion((prev) => ({
      ...prev,
      [id]: { ...(prev[id] ?? {}), [key]: !(prev[id]?.[key] ?? true) },
    }));

  const secAbierta = (id: string, key: string) => (seccion[id]?.[key] ?? true);

  // ── Imprimir un informe ───────────────────────────────────────────────────
  const handlePrint = (inf: InformeCierre) => {
    const fecha = toDate(inf.cerradoAt).toLocaleDateString("es-MX", {
      weekday: "long", day: "numeric", month: "long", year: "numeric",
    });
    const emp = empresa;

    const choferRows = inf.choferes.map((c) => `
      <h3 style="margin:12px 0 6px;background:#e8f0fe;padding:4px 8px;border-radius:4px">
        🚛 ${c.nombre}${c.ficha ? ` — Ficha ${c.ficha}` : ""}
      </h3>
      <p style="font-weight:600;margin:8px 0 4px">Productos Retirados:</p>
      <table>
        <thead><tr><th>Producto</th><th>Cant.</th><th>Unidad</th></tr></thead>
        <tbody>
          ${c.retirados.map((p) => `<tr><td>${p.nombre}</td><td>${p.cantidad ?? 0}</td><td>${p.unidad ?? ""}</td></tr>`).join("")}
        </tbody>
      </table>
      ${c.agregado1.length > 0 ? `
        <p style="font-weight:600;margin:8px 0 4px">Agregado 1 (con puntos):</p>
        <table>
          <thead><tr><th>Producto</th><th>Cant.</th></tr></thead>
          <tbody>${c.agregado1.map((p) => `<tr><td>${p.nombre}</td><td>${p.cantidad}</td></tr>`).join("")}</tbody>
        </table>` : ""}
      ${c.agregado0.length > 0 ? `
        <p style="font-weight:600;margin:8px 0 4px">Agregado 0 (informativo):</p>
        <table>
          <thead><tr><th>Producto</th><th>Cant.</th></tr></thead>
          <tbody>${c.agregado0.map((p) => `<tr><td>${p.nombre}</td><td>${p.cantidad}</td></tr>`).join("")}</tbody>
        </table>` : ""}
      ${c.faltantes.length > 0 ? `
        <p style="font-weight:600;margin:8px 0 4px;color:#c0392b">Faltantes (Agr. 1):</p>
        <table>
          <thead><tr><th>Producto</th><th>Cant.</th></tr></thead>
          <tbody>${c.faltantes.map((p) => `<tr><td>${p.nombre}</td><td>${p.cantidad}</td></tr>`).join("")}</tbody>
        </table>` : ""}
    `).join("");

    const html = `<!DOCTYPE html>
    <html><head><title>Informe de Cierre — ${emp?.nombre ?? "Polar Breeze"}</title>
    <style>
      body  { font-family: Arial, sans-serif; font-size: 11px; margin: 20px; color: #222; }
      .co   { border-bottom: 2px solid #374151; padding-bottom: 10px; margin-bottom: 14px; }
      .co-n { font-size: 17px; font-weight: bold; margin: 0 0 3px; }
      .co-i { font-size: 9.5px; color: #6b7280; margin: 0; }
      h1    { font-size: 14px; margin: 0 0 4px; }
      h2    { font-size: 13px; background: #374151; color: white; padding: 5px 8px;
              margin: 16px 0 8px; border-radius: 3px; }
      h3    { font-size: 12px; }
      table { width: 100%; border-collapse: collapse; margin-bottom: 8px; }
      th, td { border: 1px solid #d1d5db; padding: 5px 7px; text-align: left; }
      th    { background: #f3f4f6; font-weight: 600; }
      tr:nth-child(even) { background: #f9fafb; }
      .meta { color: #6b7280; font-size: 10px; margin-bottom: 16px; }
      .obs  { border: 1px solid #d1d5db; border-radius: 4px; padding: 8px;
              background: #f9fafb; font-style: italic; margin-top: 12px; }
    </style></head><body>
      <div class="co">
        <p class="co-n">${emp?.nombre ?? "Polar Breeze E.I.R.L."}</p>
        <p class="co-i">RNC: ${emp?.rnc ?? ""} &nbsp;·&nbsp; ${emp?.direccion ?? ""} &nbsp;·&nbsp; Tel: ${emp?.telefono ?? ""}</p>
      </div>
      <h1>📋 INFORME DE CIERRE DEL DÍA</h1>
      <p class="meta">${fecha} — Despachador: ${inf.despachadorNombre}</p>

      <h2>1. Productos Faltantes del Despacho</h2>
      ${inf.faltantesDespacho.length === 0
        ? "<p>Sin faltantes.</p>"
        : `<table><thead><tr><th>Producto</th><th>Cant. Faltante</th><th>Chofer Afectado</th></tr></thead>
           <tbody>${inf.faltantesDespacho.map((r) => `<tr><td>${r.producto}</td><td>${r.cantFaltante}</td><td>${r.choferAfectado}</td></tr>`).join("")}</tbody></table>`}

      <h2>2. Productos Dañados No Recibidos</h2>
      ${inf.danadosNoRecibidos.length === 0
        ? "<p>Sin dañados.</p>"
        : `<table><thead><tr><th>Producto</th><th>Cant.</th><th>Chofer</th><th>Motivo</th></tr></thead>
           <tbody>${inf.danadosNoRecibidos.map((r) => `<tr><td>${r.producto}</td><td>${r.cantidad}</td><td>${r.choferRechazo}</td><td>${r.motivo || "—"}</td></tr>`).join("")}</tbody></table>`}

      <h2>3. Sobrantes del Despacho</h2>
      ${inf.sobrantesDespacho.length === 0
        ? "<p>Sin sobrantes.</p>"
        : `<table><thead><tr><th>Producto</th><th>Sobrante</th><th>Fuente</th></tr></thead>
           <tbody>${inf.sobrantesDespacho.map((r) => `<tr><td>${r.producto}</td><td>+${r.cantidad}</td><td>${r.fuente}</td></tr>`).join("")}</tbody></table>`}

      <h2>4. Cuarto Frío No Entregado a Despacho</h2>
      ${inf.cfNoEntregados.length === 0
        ? "<p>Sin registros.</p>"
        : `<table><thead><tr><th>Producto</th><th>Cant.</th><th>Persona</th><th>Motivo</th></tr></thead>
           <tbody>${inf.cfNoEntregados.map((r) => `<tr><td>${r.producto}</td><td>${r.cantidad}</td><td>${r.persona || "—"}</td><td>${r.motivo || "—"}</td></tr>`).join("")}</tbody></table>`}

      <h2>5. Facturas por Chofer</h2>
      ${choferRows || "<p>Sin choferes con entregas.</p>"}

      ${inf.observacionesGenerales ? `<div class="obs">📝 ${inf.observacionesGenerales}</div>` : ""}
    </body></html>`;

    const win = window.open("", "_blank");
    if (!win) return;
    win.document.write(html);
    win.document.close();
    win.onload = () => win.print();
  };

  // ── Render ────────────────────────────────────────────────────────────────

  if (cargando) {
    return (
      <div className="flex items-center justify-center py-20">
        <p className="text-sm text-gray-400 animate-pulse">Cargando informes…</p>
      </div>
    );
  }

  return (
    <div className="space-y-4 pb-10">

      {/* Filtro */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-4 flex flex-wrap items-center gap-3">
        <div className="flex-1 min-w-[180px]">
          <label className="block text-xs font-medium text-gray-500 mb-1">Filtrar por fecha</label>
          <input
            type="date"
            value={filtroFecha}
            onChange={(e) => setFiltroFecha(e.target.value)}
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm
              focus:outline-none focus:ring-2 focus:ring-purple-400"
          />
        </div>
        {filtroFecha && (
          <button
            onClick={() => setFiltroFecha("")}
            className="text-xs text-gray-400 hover:text-gray-600 mt-4 transition-colors"
          >
            ✕ Limpiar filtro
          </button>
        )}
        <div className="ml-auto text-xs text-gray-400 mt-4 text-right">
          {filtrados.length} informe{filtrados.length !== 1 ? "s" : ""}
          {filtroFecha ? " ese día" : " en total"}
        </div>
      </div>

      {filtrados.length === 0 && (
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-10 text-center">
          <p className="text-2xl mb-2">📋</p>
          <p className="text-sm text-gray-500 font-medium">
            {filtroFecha ? "Sin informes para esa fecha" : "Sin informes de cierre aún"}
          </p>
          <p className="text-xs text-gray-400 mt-1">
            Los informes aparecen aquí cuando el despachador cierra el día.
          </p>
        </div>
      )}

      {filtrados.map((inf) => {
        const fechaStr = toDate(inf.cerradoAt).toLocaleDateString("es-MX", {
          weekday: "short", day: "numeric", month: "short", year: "numeric",
          hour: "2-digit", minute: "2-digit",
        });
        const esAbierto = abierto === inf.id;

        return (
          <div
            key={inf.id}
            className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden"
          >
            {/* Cabecera del informe */}
            <button
              onClick={() => setAbierto(esAbierto ? null : inf.id)}
              className="w-full flex items-center justify-between px-4 py-3
                hover:bg-gray-50 transition-colors text-left"
            >
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 bg-gray-800 rounded-lg flex items-center justify-center
                  text-white font-bold text-xs flex-shrink-0">
                  📋
                </div>
                <div>
                  <p className="font-semibold text-sm text-gray-800 capitalize">{fechaStr}</p>
                  <p className="text-xs text-gray-400 mt-0.5">
                    Despachador: {inf.despachadorNombre}
                    {inf.choferes.length > 0 && ` · ${inf.choferes.length} chofer${inf.choferes.length !== 1 ? "es" : ""}`}
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2 flex-shrink-0">
                {/* Pills de resumen rápido */}
                <div className="hidden sm:flex gap-1">
                  {inf.faltantesDespacho.length > 0 && (
                    <span className="text-xs bg-red-100 text-red-700 border border-red-200 px-1.5 py-0.5 rounded-full">
                      {inf.faltantesDespacho.length} falt.
                    </span>
                  )}
                  {inf.danadosNoRecibidos.length > 0 && (
                    <span className="text-xs bg-orange-100 text-orange-700 border border-orange-200 px-1.5 py-0.5 rounded-full">
                      {inf.danadosNoRecibidos.length} dañ.
                    </span>
                  )}
                  {inf.sobrantesDespacho.length > 0 && (
                    <span className="text-xs bg-blue-100 text-blue-700 border border-blue-200 px-1.5 py-0.5 rounded-full">
                      {inf.sobrantesDespacho.length} sob.
                    </span>
                  )}
                </div>
                <span className="text-gray-400 text-sm">{esAbierto ? "▲" : "▼"}</span>
              </div>
            </button>

            {/* Detalle expandido */}
            {esAbierto && (
              <div className="border-t border-gray-100 divide-y divide-gray-50">

                {/* Acciones */}
                <div className="px-4 py-2 flex gap-2 bg-gray-50/50">
                  <button
                    onClick={() => handlePrint(inf)}
                    className="flex items-center gap-1.5 text-xs px-3 py-1.5 bg-white
                      border border-gray-200 rounded-lg hover:bg-gray-100 active:scale-95
                      transition-all duration-100 text-gray-700 font-medium"
                  >
                    🖨️ Imprimir
                  </button>
                </div>

                {/* Tabla 1: Faltantes */}
                <CollapsibleSection
                  titulo="1. Faltantes del Despacho"
                  icon="🔴"
                  badge={inf.faltantesDespacho.length}
                  abierta={secAbierta(inf.id, "t1")}
                  onToggle={() => toggleSec(inf.id, "t1")}
                >
                  {inf.faltantesDespacho.length === 0 ? (
                    <p className="px-4 py-3 text-xs text-gray-400">Sin faltantes</p>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full text-xs">
                        <thead>
                          <tr className="bg-red-50 text-red-700">
                            <th className="text-left px-3 py-2 font-medium">Producto</th>
                            <th className="text-right px-3 py-2 font-medium">Cant.</th>
                            <th className="text-left px-3 py-2 font-medium">Chofer afectado</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-50">
                          {inf.faltantesDespacho.map((r, i) => (
                            <tr key={i} className="hover:bg-red-50/20">
                              <td className="px-3 py-2 text-gray-700 font-medium">{r.producto}</td>
                              <td className="px-3 py-2 text-right text-red-700 font-semibold">{r.cantFaltante}</td>
                              <td className="px-3 py-2 text-gray-500">{r.choferAfectado || "—"}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </CollapsibleSection>

                {/* Tabla 2: Dañados */}
                <CollapsibleSection
                  titulo="2. Dañados No Recibidos"
                  icon="💥"
                  badge={inf.danadosNoRecibidos.length}
                  abierta={secAbierta(inf.id, "t2")}
                  onToggle={() => toggleSec(inf.id, "t2")}
                >
                  {inf.danadosNoRecibidos.length === 0 ? (
                    <p className="px-4 py-3 text-xs text-gray-400">Sin dañados</p>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full text-xs">
                        <thead>
                          <tr className="bg-orange-50 text-orange-700">
                            <th className="text-left px-3 py-2 font-medium">Producto</th>
                            <th className="text-right px-3 py-2 font-medium">Cant.</th>
                            <th className="text-left px-3 py-2 font-medium">Chofer</th>
                            <th className="text-left px-3 py-2 font-medium">Motivo</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-50">
                          {inf.danadosNoRecibidos.map((r, i) => (
                            <tr key={i} className="hover:bg-orange-50/20">
                              <td className="px-3 py-2 text-gray-700 font-medium">{r.producto}</td>
                              <td className="px-3 py-2 text-right text-orange-700 font-semibold">{r.cantidad}</td>
                              <td className="px-3 py-2 text-gray-500">{r.choferRechazo}</td>
                              <td className="px-3 py-2 text-gray-400 italic">{r.motivo || "—"}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </CollapsibleSection>

                {/* Tabla 3: Sobrantes */}
                <CollapsibleSection
                  titulo="3. Sobrantes del Despacho"
                  icon="📦"
                  badge={inf.sobrantesDespacho.length}
                  abierta={secAbierta(inf.id, "t3")}
                  onToggle={() => toggleSec(inf.id, "t3")}
                >
                  {inf.sobrantesDespacho.length === 0 ? (
                    <p className="px-4 py-3 text-xs text-gray-400">Sin sobrantes</p>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full text-xs">
                        <thead>
                          <tr className="bg-blue-50 text-blue-700">
                            <th className="text-left px-3 py-2 font-medium">Producto</th>
                            <th className="text-right px-3 py-2 font-medium">Sobrante</th>
                            <th className="text-left px-3 py-2 font-medium">Fuente</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-50">
                          {inf.sobrantesDespacho.map((r, i) => (
                            <tr key={i} className="hover:bg-blue-50/20">
                              <td className="px-3 py-2 text-gray-700 font-medium">{r.producto}</td>
                              <td className="px-3 py-2 text-right text-blue-700 font-semibold">+{r.cantidad}</td>
                              <td className="px-3 py-2 text-gray-400">{r.fuente}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </CollapsibleSection>

                {/* Tabla 4: CF no entregados */}
                <CollapsibleSection
                  titulo="4. Cuarto Frío No Entregado"
                  icon="🥶"
                  badge={inf.cfNoEntregados.length}
                  abierta={secAbierta(inf.id, "t4")}
                  onToggle={() => toggleSec(inf.id, "t4")}
                >
                  {inf.cfNoEntregados.length === 0 ? (
                    <p className="px-4 py-3 text-xs text-gray-400">Sin registros</p>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full text-xs">
                        <thead>
                          <tr className="bg-cyan-50 text-cyan-700">
                            <th className="text-left px-3 py-2 font-medium">Producto</th>
                            <th className="text-right px-3 py-2 font-medium">Cant.</th>
                            <th className="text-left px-3 py-2 font-medium">Persona</th>
                            <th className="text-left px-3 py-2 font-medium">Motivo</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-50">
                          {inf.cfNoEntregados.map((r, i) => (
                            <tr key={i} className="hover:bg-cyan-50/20">
                              <td className="px-3 py-2 text-gray-700 font-medium">{r.producto}</td>
                              <td className="px-3 py-2 text-right text-cyan-700 font-semibold">{r.cantidad}</td>
                              <td className="px-3 py-2 text-gray-500">{r.persona || "—"}</td>
                              <td className="px-3 py-2 text-gray-400 italic">{r.motivo || "—"}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </CollapsibleSection>

                {/* Choferes */}
                {inf.choferes.length > 0 && (
                  <CollapsibleSection
                    titulo="5. Facturas por Chofer"
                    icon="🚛"
                    badge={inf.choferes.length}
                    abierta={secAbierta(inf.id, "choferes")}
                    onToggle={() => toggleSec(inf.id, "choferes")}
                  >
                    <div className="divide-y divide-gray-50">
                      {inf.choferes.map((ch) => (
                        <div key={ch.choferId} className="px-4 py-3">
                          <p className="text-sm font-semibold text-gray-800 mb-2">
                            {ch.nombre}
                            {ch.ficha && <span className="text-xs text-gray-400 ml-2 font-normal">Ficha {ch.ficha}</span>}
                          </p>

                          {/* Retirados */}
                          {ch.retirados.length > 0 && (
                            <div className="mb-2">
                              <p className="text-xs font-medium text-blue-600 mb-1">Retirados</p>
                              <div className="overflow-x-auto rounded-lg border border-blue-100">
                                <table className="w-full text-xs">
                                  <thead>
                                    <tr className="bg-blue-50 text-blue-700">
                                      <th className="text-left px-2 py-1.5 font-medium">Producto</th>
                                      <th className="text-right px-2 py-1.5 font-medium">Cant.</th>
                                      <th className="text-left px-2 py-1.5 font-medium">Unidad</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {ch.retirados.map((p, i) => (
                                      <tr key={i} className="border-t border-blue-50">
                                        <td className="px-2 py-1.5 text-gray-700">{p.nombre}</td>
                                        <td className="px-2 py-1.5 text-right font-semibold text-blue-700">{p.cantidad ?? 0}</td>
                                        <td className="px-2 py-1.5 text-gray-400">{p.unidad ?? ""}</td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              </div>
                            </div>
                          )}

                          {/* Agregado 1 */}
                          {ch.agregado1.length > 0 && (
                            <div className="mb-2">
                              <p className="text-xs font-medium text-green-600 mb-1">Agregado 1 (con puntos)</p>
                              <div className="space-y-0.5">
                                {ch.agregado1.map((p, i) => (
                                  <div key={i} className="flex justify-between text-xs bg-green-50 px-2 py-1 rounded">
                                    <span className="text-gray-700">{p.nombre}</span>
                                    <span className="font-semibold text-green-700">{p.cantidad}</span>
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}

                          {/* Agregado 0 */}
                          {ch.agregado0.length > 0 && (
                            <div className="mb-2">
                              <p className="text-xs font-medium text-gray-500 mb-1">Agregado 0 (informativo)</p>
                              <div className="space-y-0.5">
                                {ch.agregado0.map((p, i) => (
                                  <div key={i} className="flex justify-between text-xs bg-gray-50 px-2 py-1 rounded">
                                    <span className="text-gray-700">{p.nombre}</span>
                                    <span className="font-semibold text-gray-600">{p.cantidad}</span>
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}

                          {/* Faltantes del chofer */}
                          {ch.faltantes.length > 0 && (
                            <div>
                              <p className="text-xs font-medium text-red-600 mb-1">Faltantes (Agr. 1)</p>
                              <div className="space-y-0.5">
                                {ch.faltantes.map((p, i) => (
                                  <div key={i} className="flex justify-between text-xs bg-red-50 px-2 py-1 rounded">
                                    <span className="text-gray-700">{p.nombre}</span>
                                    <span className="font-semibold text-red-700">{p.cantidad}</span>
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  </CollapsibleSection>
                )}

                {/* Observaciones */}
                {inf.observacionesGenerales && (
                  <div className="px-4 py-3 bg-gray-50/50">
                    <p className="text-xs font-medium text-gray-500 mb-1">📝 Observaciones</p>
                    <p className="text-xs text-gray-700 italic">{inf.observacionesGenerales}</p>
                  </div>
                )}

              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ─── Sub-componente ───────────────────────────────────────────────────────────

function CollapsibleSection({
  titulo, icon, badge, abierta, onToggle, children,
}: {
  titulo:   string;
  icon:     string;
  badge:    number;
  abierta:  boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  return (
    <div>
      <button
        onClick={onToggle}
        className="w-full flex items-center justify-between px-4 py-2.5
          hover:bg-gray-50/80 transition-colors text-left"
      >
        <div className="flex items-center gap-2">
          <span className="text-sm">{icon}</span>
          <span className="text-xs font-semibold text-gray-700">{titulo}</span>
          {badge > 0 && (
            <span className="text-xs bg-gray-100 text-gray-600 border border-gray-200
              px-1.5 py-0.5 rounded-full font-medium">
              {badge}
            </span>
          )}
        </div>
        <span className="text-gray-400 text-xs">{abierta ? "▲" : "▼"}</span>
      </button>
      {abierta && children}
    </div>
  );
}
