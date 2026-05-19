"use client";

import { useState, useEffect } from "react";
import { doc, getDoc } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { PuntosConfig, PreciosConfig } from "@/lib/types";
import { ShareBar } from "@/components/shared/ShareButtons";
import { pbHeader, pbFooter } from "@/lib/wa-format";
import { pbPrintDoc, pbTable } from "@/lib/print-template";
import { useRegisterModal } from "./ModalShareContext";

type TabView = "puntos" | "precios";

export default function ConsultarTablaModal({ onClose }: { onClose: () => void }) {
  const [tab,     setTab]     = useState<TabView>("puntos");
  const [puntos,  setPuntos]  = useState<PuntosConfig | null>(null);
  const [precios, setPrecios] = useState<PreciosConfig | null>(null);
  const [loading, setLoading] = useState(true);

  const getTablaMsg = () => {
    const lines = [pbHeader(), ""];
    if (tab === "puntos" && puntos?.productos?.length) {
      lines.push("🏆 *TABLA DE PUNTOS POR PRODUCTO*", "");
      if (puntos.meta != null) lines.push(`Meta quincena: *${puntos.meta} pts*`, "");
      [...puntos.productos].sort((a, b) => b.puntos - a.puntos).forEach((p) => {
        lines.push(`• ${p.nombre}: *${p.puntos} pts/ud*`);
      });
    } else if (tab === "precios" && precios?.productos?.length) {
      lines.push("💰 *TABLA DE PRECIOS DE VENTA*", "");
      [...precios.productos].sort((a, b) => a.nombre.localeCompare(b.nombre, "es")).forEach((p) => {
        lines.push(`• ${p.nombre}: *${p.moneda ?? precios!.moneda} ${p.precio.toLocaleString("es-MX")}*`);
      });
    } else {
      lines.push("Sin datos cargados.");
    }
    lines.push("", pbFooter());
    return lines.join("\n");
  };

  const getTablaHtml = () => {
    if (tab === "puntos" && puntos?.productos?.length) {
      const subtitle = puntos.meta != null ? `Meta quincena: ${puntos.meta} pts` : "";
      const rows = [...puntos.productos]
        .sort((a, b) => b.puntos - a.puntos)
        .map((p) => [p.nombre, `<span class="td-r">${p.puntos}</span>`]);
      return pbPrintDoc(
        "Tabla de Puntos por Producto",
        subtitle,
        pbTable(["Producto", "Pts / unidad"], rows),
      );
    } else if (tab === "precios" && precios?.productos?.length) {
      const rows = [...precios.productos]
        .sort((a, b) => a.nombre.localeCompare(b.nombre, "es"))
        .map((p) => [p.nombre, `<span class="td-r">${p.moneda ?? precios!.moneda} ${p.precio.toLocaleString("es-MX")}</span>`]);
      return pbPrintDoc(
        "Tabla de Precios de Venta",
        "",
        pbTable(["Producto", "Precio"], rows),
      );
    }
    return pbPrintDoc("Tablas de Referencia", "", "<p>Sin datos cargados.</p>");
  };

  // Registra en el FAB flotante mientras este modal está montado
  useRegisterModal(true, getTablaMsg, getTablaHtml);

  useEffect(() => {
    Promise.all([
      getDoc(doc(db, "config", "puntos")),
      getDoc(doc(db, "config", "precios")),
    ]).then(([pSnap, prSnap]) => {
      if (pSnap.exists())  setPuntos(pSnap.data() as PuntosConfig);
      if (prSnap.exists()) setPrecios(prSnap.data() as PreciosConfig);
    }).finally(() => setLoading(false));
  }, []);

  return (
    <div
      className="fixed inset-0 bg-black/50 flex items-end sm:items-center justify-center z-50 p-4"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[85vh] flex flex-col">

        {/* Header */}
        <div className="flex items-center gap-2 px-5 py-4 border-b border-gray-100">
          <h2 className="font-bold text-gray-800 text-base flex-1 min-w-0">📋 Tablas de referencia</h2>
          {!loading && (
            <ShareBar
              getMessage={getTablaMsg}
              getPrintHtml={getTablaHtml}
              className="flex-shrink-0"
            />
          )}
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-lg bg-gray-100 hover:bg-gray-200 flex items-center
              justify-center text-gray-500 text-sm font-bold transition flex-shrink-0"
          >
            ✕
          </button>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 px-4 pt-3 pb-1 border-b border-gray-100">
          <button
            onClick={() => setTab("puntos")}
            className={`flex-1 py-2 rounded-lg text-sm font-medium transition ${
              tab === "puntos"
                ? "bg-purple-100 text-purple-700"
                : "text-gray-500 hover:bg-gray-50"
            }`}
          >
            🏆 Puntos por producto
          </button>
          <button
            onClick={() => setTab("precios")}
            className={`flex-1 py-2 rounded-lg text-sm font-medium transition ${
              tab === "precios"
                ? "bg-blue-100 text-blue-700"
                : "text-gray-500 hover:bg-gray-50"
            }`}
          >
            💰 Precios de venta
          </button>
        </div>

        {/* Contenido */}
        <div className="flex-1 overflow-y-auto px-4 py-4">
          {loading ? (
            <div className="text-center py-10">
              <p className="text-gray-400 text-sm animate-pulse">Cargando tablas…</p>
            </div>

          ) : tab === "puntos" ? (
            !puntos || !puntos.productos?.length ? (
              <div className="text-center py-10">
                <p className="text-3xl mb-2">🏆</p>
                <p className="text-sm text-gray-400">No hay tabla de puntos configurada.</p>
              </div>
            ) : (
              <div className="space-y-3">
                {puntos.meta != null && (
                  <div className="px-4 py-3 bg-purple-50 rounded-xl border border-purple-100 text-sm">
                    <span className="text-purple-600 font-semibold">Meta quincena: </span>
                    <span className="text-purple-800 font-bold">{puntos.meta} pts</span>
                  </div>
                )}
                <div className="overflow-hidden rounded-xl border border-gray-200">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-gray-50">
                        <th className="text-left px-4 py-2.5 font-semibold text-gray-500 text-xs uppercase tracking-wide">
                          Producto
                        </th>
                        <th className="text-right px-4 py-2.5 font-semibold text-gray-500 text-xs uppercase tracking-wide">
                          Pts / unidad
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {[...puntos.productos]
                        .sort((a, b) => b.puntos - a.puntos)
                        .map((p, i) => (
                          <tr key={i} className="hover:bg-gray-50">
                            <td className="px-4 py-3 text-gray-800">{p.nombre}</td>
                            <td className="px-4 py-3 text-right font-bold text-purple-600">
                              {p.puntos}
                            </td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )

          ) : (
            !precios || !precios.productos?.length ? (
              <div className="text-center py-10">
                <p className="text-3xl mb-2">💰</p>
                <p className="text-sm text-gray-400">No hay tabla de precios configurada.</p>
              </div>
            ) : (
              <div className="overflow-hidden rounded-xl border border-gray-200">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-gray-50">
                      <th className="text-left px-4 py-2.5 font-semibold text-gray-500 text-xs uppercase tracking-wide">
                        Producto
                      </th>
                      <th className="text-right px-4 py-2.5 font-semibold text-gray-500 text-xs uppercase tracking-wide">
                        Precio
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {[...precios.productos]
                      .sort((a, b) => a.nombre.localeCompare(b.nombre, "es"))
                      .map((p, i) => (
                        <tr key={i} className="hover:bg-gray-50">
                          <td className="px-4 py-3 text-gray-800">{p.nombre}</td>
                          <td className="px-4 py-3 text-right font-bold text-blue-600">
                            {p.moneda ?? precios.moneda} {p.precio.toLocaleString("es-MX")}
                          </td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            )
          )}
        </div>
      </div>
    </div>
  );
}
