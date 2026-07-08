"use client";

/**
 * InventarioDespachador — mejora #41: Oliver (rol despachador) gana
 * sumar/restar cantidades del inventario del Loker y asignar/enviar producto
 * al inventario base de un chofer, compartido con el Encargado. Reutiliza
 * los mismos componentes de components/encargado/ (mismo shape de datos,
 * mismas colecciones) — solo cambia quién puede llegar a esta pantalla.
 *
 * A propósito NO incluye Stock/Urgente/Reposición/Vista/Factura Prov. — el
 * alcance acordado con Ariel es solo entradas/salidas + asignar a chofer.
 */

import { useState } from "react";
import RegistroLote          from "@/components/encargado/RegistroLote";
import SalidaPicking         from "@/components/encargado/SalidaPicking";
import InventarioChoferesTab from "@/components/encargado/InventarioChoferesTab";

type Vista = "entrada" | "salida" | "choferes";

export default function InventarioDespachador() {
  const [vista, setVista] = useState<Vista>("entrada");

  return (
    <div className="space-y-4">
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-1 flex gap-1">
        <button
          type="button"
          onClick={() => setVista("entrada")}
          className={`flex-1 py-2 rounded-lg text-xs font-bold truncate transition-all ${
            vista === "entrada" ? "bg-blue-600 text-white shadow-sm" : "text-gray-500 hover:bg-gray-50"
          }`}
        >
          📥 Entrada
        </button>
        <button
          type="button"
          onClick={() => setVista("salida")}
          className={`flex-1 py-2 rounded-lg text-xs font-bold truncate transition-all ${
            vista === "salida" ? "bg-[#D42B2B] text-white shadow-sm" : "text-gray-500 hover:bg-gray-50"
          }`}
        >
          📤 Salida
        </button>
        <button
          type="button"
          onClick={() => setVista("choferes")}
          className={`flex-1 py-2 rounded-lg text-xs font-bold truncate transition-all ${
            vista === "choferes" ? "bg-[#1E8C3A] text-white shadow-sm" : "text-gray-500 hover:bg-gray-50"
          }`}
        >
          📋 Choferes
        </button>
      </div>
      {vista === "entrada"
        ? <RegistroLote />
        : vista === "salida"
        ? <SalidaPicking />
        : <InventarioChoferesTab />}
    </div>
  );
}
