"use client";

import { useEffect, useState } from "react";
import { collection, doc, onSnapshot } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { ProductoItem, FsSession, FsDriver, calcSemaforo, toDate } from "@/lib/types";
import { ShareBar } from "@/components/shared/ShareButtons";
import { pbHeader, pbFooter } from "@/lib/wa-format";
import { pbPrintDoc, pbTable } from "@/lib/print-template";

const norm = (s: string) => s.toLowerCase().trim().replace(/\s+/g, " ");

interface ProductRow {
  nombre:       string;
  cuartoFrio:   number;
  entregado:    number;
  diferencia:   number;
  pct:          number;
  porChofer:    Record<string, number>;
}

export default function Comparar() {
  const [session,  setSession]  = useState<FsSession | null>(null);
  const [drivers,  setDrivers]  = useState<FsDriver[]>([]);

  useEffect(() => {
    const u1 = onSnapshot(doc(db, "session", "despacho"), (snap) => {
      setSession(snap.exists() ? (snap.data() as FsSession) : null);
    });
    const u2 = onSnapshot(collection(db, "drivers"), (snap) => {
      setDrivers(snap.docs.map((d) => ({ id: d.id, ...d.data() } as FsDriver)));
    });
    return () => { u1(); u2(); };
  }, []);

  const cuartoFrio: ProductoItem[] = Array.isArray(session?.cuartoFrio)
    ? (session!.cuartoFrio as ProductoItem[])
    : [];

  // Construir mapa de entregas por producto (normalizado)
  const entregaMap: Record<string, { total: number; porChofer: Record<string, number> }> = {};
  drivers.forEach((driver) => {
    const entregas = Array.isArray(driver.entregas) ? (driver.entregas as ProductoItem[]) : [];
    entregas.forEach((e) => {
      const key = norm(e.nombre ?? "");
      if (!entregaMap[key]) entregaMap[key] = { total: 0, porChofer: {} };
      entregaMap[key].total += e.cantidad ?? 0;
      const label = (driver.nombre ?? driver.id ?? "?") as string;
      entregaMap[key].porChofer[label] = (entregaMap[key].porChofer[label] ?? 0) + (e.cantidad ?? 0);
    });
  });

  // Construir filas de comparación
  const filas: ProductRow[] = cuartoFrio.map((p) => {
    const key       = norm(p.nombre ?? "");
    const entr      = entregaMap[key];
    const entregado = entr?.total ?? 0;
    const cargado   = p.cantidad ?? 0;
    const diferencia = cargado - entregado;
    const pct        = cargado > 0 ? (diferencia / cargado) * 100 : 0;
    return {
      nombre:    p.nombre,
      cuartoFrio: cargado,
      entregado,
      diferencia,
      pct,
      porChofer: entr?.porChofer ?? {},
    };
  });

  // Agregar productos entregados que no están en cuarto frío
  Object.entries(entregaMap).forEach(([key, data]) => {
    const yaEsta = cuartoFrio.some((p) => norm(p.nombre ?? "") === key);
    if (!yaEsta) {
      const nombreReal = drivers
        .flatMap((d) => (Array.isArray(d.entregas) ? (d.entregas as ProductoItem[]) : []))
        .find((e) => norm(e.nombre ?? "") === key)?.nombre ?? key;
      filas.push({
        nombre:     nombreReal,
        cuartoFrio: 0,
        entregado:  data.total,
        diferencia: -data.total,
        pct:        -100,
        porChofer:  data.porChofer,
      });
    }
  });

  const noHayDatos = cuartoFrio.length === 0 && drivers.length === 0;
  const totalCF   = cuartoFrio.reduce((s, p) => s + (p.cantidad ?? 0), 0);
  const totalEntr = filas.reduce((s, f) => s + f.entregado, 0);
  const totalDiff = totalCF - totalEntr;

  const semGlobal = calcSemaforo(
    cuartoFrio.map((p) => ({
      choferId: "", choferNombre: "", vehiculo: "", ruta: "", producto: p.nombre,
      cantidadCargada: p.cantidad ?? 0,
      cantidadEntregada: entregaMap[norm(p.nombre ?? "")]?.total ?? 0,
      timestamp: new Date(),
    }))
  );

  const semColor = { verde: "text-green-600 bg-green-50 border-green-200",
    amarillo: "text-yellow-700 bg-yellow-50 border-yellow-200",
    rojo: "text-red-600 bg-red-50 border-red-200" }[semGlobal];

  const semIcon  = { verde: "✅", amarillo: "⚠️", rojo: "🚨" }[semGlobal];

  const getWhatsAppMsg = () => {
    const lines = [
      pbHeader(),
      `⚖️ *Comparativo Despacho*`,
      `C.Frío: ${totalCF} · Entregado: ${totalEntr} · Diferencia: ${totalDiff}`,
      "",
      "Productos:",
    ];
    filas.forEach((f) => {
      const icon = Math.abs(f.pct) < 5 ? "✅" : Math.abs(f.pct) < 15 ? "⚠️" : "🚨";
      const chofers = Object.entries(f.porChofer)
        .map(([n, c]) => `${n.split(" ")[0]}:${c}`).join(" ");
      lines.push(`${icon} ${f.nombre}: CF=${f.cuartoFrio} / Ent=${f.entregado} / Diff=${f.diferencia}${chofers ? ` (${chofers})` : ""}`);
    });
    lines.push("", pbFooter());
    return lines.join("\n");
  };

  const getPrintHtml = () => {
    const rows = filas.map((f) => {
      const icon = Math.abs(f.pct) < 5 ? "✓" : Math.abs(f.pct) < 15 ? "⚠" : "✗";
      return [f.nombre, f.cuartoFrio, f.entregado, f.diferencia, `${f.pct.toFixed(1)}%`, icon];
    });
    const body = pbTable(
      ["Producto", "Cuarto Frío", "Entregado", "Diferencia", "% Diff", "Estado"],
      rows,
      ["TOTAL", totalCF, totalEntr, totalDiff, "", ""],
    );
    return pbPrintDoc("COMPARATIVO DESPACHO", `C.Frío: ${totalCF} · Entregado: ${totalEntr} · Diferencia: ${totalDiff}`, body);
  };

  return (
    <div className="space-y-4">
      {/* ── Resumen global ── */}
      {!noHayDatos && (
        <div className={`rounded-xl border px-4 py-3 flex flex-wrap items-center gap-x-8 gap-y-2 ${semColor}`}>
          <span className="text-2xl">{semIcon}</span>
          <div className="text-center">
            <p className="text-xl font-bold">{totalCF}</p>
            <p className="text-xs opacity-75">Cuarto frío</p>
          </div>
          <div className="text-center">
            <p className="text-xl font-bold">{totalEntr}</p>
            <p className="text-xs opacity-75">Entregado</p>
          </div>
          <div className="text-center">
            <p className={`text-xl font-bold ${totalDiff > 0 ? "text-orange-600" : ""}`}>{totalDiff}</p>
            <p className="text-xs opacity-75">Diferencia</p>
          </div>
          {session?.fecha && (
            <div className="text-xs opacity-60 ml-auto">
              Sesión: {toDate(session.fecha).toLocaleString("es-MX", {
                day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit",
              })}
            </div>
          )}
        </div>
      )}

      {noHayDatos ? (
        <div className="bg-white rounded-xl shadow-sm p-12 text-center text-gray-400">
          <p className="text-4xl mb-3">⚖️</p>
          <p className="font-medium text-gray-600">Sin datos para comparar</p>
          <p className="text-sm mt-1">
            Registra el inventario en <strong>Cuarto Frío</strong> y las
            entregas en <strong>Choferes</strong>
          </p>
        </div>
      ) : (
        <div className="bg-white rounded-xl shadow-sm overflow-hidden">
          <div className="px-5 py-3 border-b flex items-center justify-between flex-wrap gap-2">
            <h3 className="font-bold text-gray-800">Cuarto Frío vs. Choferes</h3>
            <div className="flex items-center gap-3">
              <span className="text-xs text-gray-400">{filas.length} productos</span>
              <ShareBar getMessage={getWhatsAppMsg} getPrintHtml={getPrintHtml} />
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50">
                <tr className="text-xs text-gray-500">
                  <th className="text-left px-4 py-2.5">Producto</th>
                  <th className="text-right px-4 py-2.5">C.Frío</th>
                  <th className="text-right px-4 py-2.5">Entregado</th>
                  <th className="text-right px-4 py-2.5">Diff</th>
                  <th className="px-4 py-2.5 text-center w-24">Estado</th>
                  <th className="text-left px-4 py-2.5">Por chofer</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {filas.map((f) => {
                  const icon = Math.abs(f.pct) < 5 ? "✅" : Math.abs(f.pct) < 15 ? "⚠️" : "🚨";
                  const diffClass = f.diferencia > 0
                    ? "text-orange-500 font-semibold"
                    : f.diferencia < 0
                    ? "text-red-500 font-semibold"
                    : "text-gray-400";

                  return (
                    <tr key={f.nombre} className="hover:bg-gray-50">
                      <td className="px-4 py-2.5 font-medium text-gray-800">{f.nombre}</td>
                      <td className="px-4 py-2.5 text-right text-blue-600">{f.cuartoFrio}</td>
                      <td className="px-4 py-2.5 text-right text-green-600">{f.entregado}</td>
                      <td className={`px-4 py-2.5 text-right ${diffClass}`}>
                        {f.diferencia > 0 ? `+${f.diferencia}` : f.diferencia}
                      </td>
                      <td className="px-4 py-2.5 text-center">
                        <span className="text-xl">{icon}</span>
                        {f.cuartoFrio > 0 && (
                          <p className="text-xs text-gray-400">{Math.abs(f.pct).toFixed(0)}%</p>
                        )}
                      </td>
                      <td className="px-4 py-2.5">
                        <div className="flex flex-wrap gap-1">
                          {Object.entries(f.porChofer).map(([nombre, cant]) => (
                            <span
                              key={nombre}
                              className="text-xs bg-cyan-50 text-cyan-700 border border-cyan-100
                                px-1.5 py-0.5 rounded-full"
                            >
                              {nombre.split(" ")[0]}: {cant}
                            </span>
                          ))}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── Resumen por chofer ── */}
      {drivers.length > 0 && (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {drivers.map((d) => {
            const entregas = Array.isArray(d.entregas) ? (d.entregas as ProductoItem[]) : [];
            const total    = entregas.reduce((s, e) => s + (e.cantidad ?? 0), 0);
            return (
              <div key={d.id} className="bg-white rounded-xl shadow-sm p-4">
                <div className="flex items-center gap-2 mb-2">
                  <div className="w-8 h-8 bg-cyan-500 rounded-full flex items-center
                    justify-center text-white font-bold text-sm">
                    {(d.nombre ?? "?").charAt(0).toUpperCase()}
                  </div>
                  <div>
                    <p className="font-semibold text-sm text-gray-800">{d.nombre}</p>
                    <p className="text-xs text-gray-400">{total} uds · {entregas.length} productos</p>
                  </div>
                </div>
                <div className="space-y-1">
                  {entregas.slice(0, 4).map((e, i) => (
                    <div key={i} className="flex justify-between text-xs text-gray-600">
                      <span className="truncate">{e.nombre}</span>
                      <span className="font-medium ml-2">{e.cantidad} {e.unidad ?? ""}</span>
                    </div>
                  ))}
                  {entregas.length > 4 && (
                    <p className="text-xs text-gray-400">+{entregas.length - 4} más</p>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
