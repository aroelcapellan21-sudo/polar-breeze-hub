"use client";

import { useState, useEffect } from "react";
import {
  collection, query, where, onSnapshot,
  doc, setDoc, addDoc, updateDoc, increment, Timestamp, getDoc,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useAuth } from "@/lib/auth-context";
import { ProductoItem, UserProfile, FsDriver, FsSession } from "@/lib/types";
import {
  ImageUploader, ProductTable, ModeToggle, AiButton,
  WhatsAppPrint, ProgressSteps,
} from "./shared";

const STEPS = [
  { label: "Seleccionar" },
  { label: "Factura" },
  { label: "Analizar IA" },
  { label: "Revisar" },
  { label: "Guardar" },
];

const norm = (s: string) => s.toLowerCase().trim().replace(/\s+/g, " ");

interface Props {
  onChoferSelect?: (c: UserProfile | null) => void;
}

export default function Choferes({ onChoferSelect }: Props) {
  const { profile } = useAuth();
  const [choferes,      setChoferes]      = useState<UserProfile[]>([]);
  const [drivers,       setDrivers]       = useState<FsDriver[]>([]);
  const [session,       setSession]       = useState<FsSession | null>(null);
  const [sel,           setSel]           = useState<UserProfile | null>(null);
  const [mode,          setMode]          = useState<"foto" | "manual">("foto");
  const [preview,       setPreview]       = useState<string | null>(null);
  const [imgData,       setImgData]       = useState<{ base64: string; mimeType: string } | null>(null);
  const [texto,         setTexto]         = useState("");
  const [productos,     setProductos]     = useState<ProductoItem[]>([]);
  const [observaciones, setObservaciones] = useState("");
  const [analizando,    setAnalizando]    = useState(false);
  const [guardando,     setGuardando]     = useState(false);
  const [msg,           setMsg]           = useState<{ type: "ok" | "err"; text: string } | null>(null);

  // Confrontar modal
  const [showConfronta,  setShowConfronta]  = useState(false);

  useEffect(() => {
    const uChof = onSnapshot(
      query(collection(db, "usuarios"), where("role", "==", "chofer"), where("activo", "!=", false)),
      (s) => setChoferes(s.docs.map((d) => d.data() as UserProfile))
    );
    const uDrv = onSnapshot(
      collection(db, "drivers"),
      (s) => setDrivers(s.docs.map((d) => ({ id: d.id, ...d.data() } as FsDriver)))
    );
    const uSess = onSnapshot(doc(db, "session", "despacho"), (snap) => {
      setSession(snap.exists() ? (snap.data() as FsSession) : null);
    });
    return () => { uChof(); uDrv(); uSess(); };
  }, []);

  const flash = (type: "ok" | "err", text: string) => {
    setMsg({ type, text });
    setTimeout(() => setMsg(null), 4000);
  };

  const resetEntrada = () => {
    setPreview(null); setImgData(null); setTexto(""); setProductos([]); setObservaciones("");
  };

  const selectChofer = (c: UserProfile) => {
    setSel(c); resetEntrada(); setMode("foto");
    onChoferSelect?.(c);
  };

  const analizar = async () => {
    setAnalizando(true);
    try {
      const body = imgData
        ? { tipo: "factura", imageBase64: imgData.base64, mimeType: imgData.mimeType }
        : { tipo: "factura", texto };
      const res  = await fetch("/api/analyze", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      if (Array.isArray(data.productos) && data.productos.length > 0) {
        setProductos(data.productos);
        flash("ok", `IA detectó ${data.productos.length} productos`);
      } else {
        flash("err", "Sin productos detectados. Edita manualmente.");
      }
    } catch (e) {
      flash("err", e instanceof Error ? e.message : "Error");
    } finally {
      setAnalizando(false);
    }
  };

  const guardar = async () => {
    if (!profile || !sel || productos.length === 0) return;
    setGuardando(true);
    try {
      const totalEntregado = productos.reduce((s, p) => s + (p.cantidad ?? 0), 0);
      const totalMonto     = productos.reduce((s, p) => s + ((p.precio ?? 0) * (p.cantidad ?? 0)), 0);

      await setDoc(doc(db, "drivers", sel.uid), {
        uid: sel.uid, nombre: sel.nombre, ficha: sel.ficha ?? "",
        entregas: productos, observaciones: observaciones || null,
        totalEntregado, totalMonto: totalMonto || null,
        updatedAt: Timestamp.now(), activo: true,
      });

      try {
        await updateDoc(doc(db, "session", "despacho"), {
          totalDespachos: increment(1),
          totalMonto:     increment(totalMonto),
          totalUnidades:  increment(totalEntregado),
        });
      } catch { /* sesión no existe aún */ }

      await addDoc(collection(db, "history"), {
        tipo:              "entrega_chofer",
        choferId:          sel.uid, choferNombre: sel.nombre,
        productos, observaciones: observaciones || null,
        totalEntregado, totalMonto: totalMonto || null,
        despachadorId:     profile.uid, despachadorNombre: profile.nombre,
        timestamp:         Timestamp.now(),
      });

      await addDoc(collection(db, "talonario"), {
        choferId:          sel.uid, choferNombre: sel.nombre, choferFicha: sel.ficha ?? "",
        productos, observaciones: observaciones || null,
        tipo: "retirada", fuente: "despacho",
        despachadorId: profile.uid, despachadorNombre: profile.nombre,
        timestamp: Timestamp.now(),
      });

      await addDoc(collection(db, "facturascan"), {
        despachadorId:     profile.uid, despachadorNombre: profile.nombre,
        facturaNumero:     `FS-${sel.ficha ?? sel.uid.slice(0, 4)}-${Date.now().toString().slice(-5)}`,
        cliente:           sel.nombre, monto: totalMonto,
        timestamp:         Timestamp.now(), estado: "procesada",
      });

      flash("ok", `Entrega de ${sel.nombre} guardada — ${totalEntregado} unidades`);
      resetEntrada();
    } catch (e) {
      flash("err", e instanceof Error ? e.message : "Error al guardar");
    } finally {
      setGuardando(false);
    }
  };

  const driverMap: Record<string, FsDriver> = {};
  drivers.forEach((d) => { if (d.id) driverMap[d.id] = d; });

  const canAnalyze  = mode === "foto" ? !!imgData : texto.trim().length > 10;
  const totalUnid   = productos.reduce((s, p) => s + (p.cantidad ?? 0), 0);
  const currentStep = !sel ? 0
    : !canAnalyze && productos.length === 0 ? 1
    : analizando ? 2
    : productos.length === 0 ? 2 : 3;

  const getWhatsAppMsg = () => {
    if (!sel) return "";
    const lines = [
      `🚛 *Entrega — ${sel.nombre}* (Ficha ${sel.ficha ?? "—"})`,
      `👤 Despachador: ${profile?.nombre}`,
      `📅 ${new Date().toLocaleString("es-MX")}`, "",
    ];
    productos.forEach((p) => {
      const visto = p.visto === "ok" ? "✅" : p.visto === "mal" ? "❌" : "•";
      lines.push(`${visto} ${p.nombre}: ${p.cantidad} ${p.unidad ?? ""}`);
    });
    lines.push(`\nTotal: ${totalUnid} uds`);
    if (observaciones) lines.push(`\n📝 ${observaciones}`);
    return lines.join("\n");
  };

  // Confrontar: cuarto frío vs suma de entregas por producto
  const cuartoFrio: ProductoItem[] = Array.isArray(session?.cuartoFrio)
    ? (session!.cuartoFrio as ProductoItem[])
    : [];

  const entregaMap: Record<string, number> = {};
  drivers.forEach((d) => {
    const entregas = Array.isArray(d.entregas) ? (d.entregas as ProductoItem[]) : [];
    entregas.forEach((e) => {
      const key = norm(e.nombre ?? "");
      entregaMap[key] = (entregaMap[key] ?? 0) + (e.cantidad ?? 0);
    });
  });

  const confrontaFilas = cuartoFrio.map((p) => {
    const key     = norm(p.nombre ?? "");
    const entr    = entregaMap[key] ?? 0;
    const diff    = (p.cantidad ?? 0) - entr;
    return { nombre: p.nombre, cf: p.cantidad ?? 0, entr, diff };
  });

  // Products only in deliveries (not in cold room)
  Object.keys(entregaMap).forEach((key) => {
    const yaEsta = cuartoFrio.some((p) => norm(p.nombre ?? "") === key);
    if (!yaEsta) {
      const nombreReal = drivers
        .flatMap((d) => (Array.isArray(d.entregas) ? (d.entregas as ProductoItem[]) : []))
        .find((e) => norm(e.nombre ?? "") === key)?.nombre ?? key;
      confrontaFilas.push({ nombre: nombreReal, cf: 0, entr: entregaMap[key], diff: -entregaMap[key] });
    }
  });

  const selDriver = sel ? driverMap[sel.uid] : null;
  const selEntregas: ProductoItem[] = Array.isArray(selDriver?.entregas)
    ? (selDriver!.entregas as ProductoItem[])
    : [];

  return (
    <div className="space-y-4">
      {/* Progreso */}
      <ProgressSteps steps={STEPS} current={currentStep} />

      {/* Confrontar button */}
      <div className="flex justify-end">
        <button
          onClick={() => setShowConfronta(true)}
          className="flex items-center gap-2 px-4 py-2 bg-orange-500 hover:bg-orange-600 active:scale-95 text-white rounded-lg text-sm font-medium transition-all duration-100"
        >
          ⚖️ Confrontar antes de despachar
        </button>
      </div>

      <div className="grid lg:grid-cols-3 gap-5">

        {/* ── Lista de choferes ── */}
        <div className="bg-white rounded-xl shadow-sm p-5">
          <h2 className="font-bold text-blue-700 mb-3">
            👥 Choferes ({choferes.length})
          </h2>
          {choferes.length === 0 ? (
            <p className="text-sm text-gray-400 text-center py-8">
              Sin choferes activos.<br />Crea uno desde el Admin.
            </p>
          ) : (
            <div className="space-y-2">
              {choferes.map((c) => {
                const driver     = driverMap[c.uid];
                const tieneDatos = !!driver?.entregas;
                return (
                  <button
                    key={c.uid}
                    onClick={() => selectChofer(c)}
                    className={`w-full flex items-center gap-3 p-3 rounded-xl border-2 text-left
                      transition-all duration-100 active:scale-95 ${
                      sel?.uid === c.uid
                        ? "border-blue-500 bg-blue-50"
                        : "border-gray-100 hover:border-gray-200 bg-white"
                    }`}
                  >
                    <div className="w-9 h-9 rounded-full flex items-center justify-center
                      text-white font-bold text-sm flex-shrink-0 bg-cyan-500">
                      {c.nombre.charAt(0).toUpperCase()}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-semibold text-sm text-gray-800 truncate">{c.nombre}</p>
                      <p className="text-xs text-gray-400">Ficha {c.ficha ?? "—"}</p>
                    </div>
                    <span className={`text-lg flex-shrink-0 ${tieneDatos ? "" : "opacity-20"}`}>
                      {tieneDatos ? "✅" : "○"}
                    </span>
                  </button>
                );
              })}
            </div>
          )}

          {/* Lista del día del chofer seleccionado */}
          {sel && selEntregas.length > 0 && (
            <div className="mt-4 pt-4 border-t border-gray-100">
              <p className="text-xs font-semibold text-blue-600 mb-2">
                📋 Lista actual — {sel.nombre.split(" ")[0]}
              </p>
              <div className="space-y-1.5 max-h-48 overflow-y-auto">
                {selEntregas.map((e, i) => (
                  <div key={i} className="flex items-center justify-between text-xs px-2 py-1.5 bg-blue-50 rounded-lg">
                    <span className="text-gray-700 truncate mr-2">{e.nombre}</span>
                    <span className="font-semibold text-blue-700 flex-shrink-0">
                      {e.cantidad} {e.unidad ?? ""}
                    </span>
                  </div>
                ))}
              </div>
              {typeof selDriver?.observaciones === "string" && selDriver.observaciones && (
                <p className="mt-2 text-xs text-gray-500 bg-gray-50 rounded px-2 py-1">
                  📝 {selDriver.observaciones}
                </p>
              )}
            </div>
          )}
        </div>

        {/* ── Panel de entrada ── */}
        <div className="bg-white rounded-xl shadow-sm p-5 space-y-4">
          {!sel ? (
            <div className="flex flex-col items-center justify-center h-full py-16 text-gray-400">
              <p className="text-3xl mb-2">👈</p>
              <p className="text-sm">Selecciona un chofer para<br />registrar su entrega</p>
            </div>
          ) : (
            <>
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="font-bold text-blue-700">{sel.nombre}</h3>
                  <p className="text-xs text-gray-400">Ficha {sel.ficha ?? "—"}</p>
                </div>
                <ModeToggle mode={mode} onChange={(m) => { setMode(m); resetEntrada(); }} />
              </div>

              {mode === "foto" ? (
                <ImageUploader
                  preview={preview}
                  onFile={(b, m, p) => { setImgData({ base64: b, mimeType: m }); setPreview(p); }}
                  onClear={() => { setPreview(null); setImgData(null); }}
                />
              ) : (
                <textarea
                  value={texto}
                  onChange={(e) => setTexto(e.target.value)}
                  placeholder={"Pega o escribe la factura / lista.\nEjemplo:\n- Leche 12 cajas $120\n- Queso 6 piezas"}
                  className="w-full h-44 px-3 py-2 border border-gray-300 rounded-lg text-sm
                    text-gray-800 focus:ring-2 focus:ring-blue-400 outline-none resize-none"
                />
              )}

              <AiButton onClick={analizar} loading={analizando} disabled={!canAnalyze} label="Leer factura con IA" />

              {msg && (
                <div className={`text-sm px-3 py-2 rounded-lg ${
                  msg.type === "ok"
                    ? "bg-green-50 text-green-700 border border-green-200"
                    : "bg-red-50 text-red-700 border border-red-200"
                }`}>{msg.text}</div>
              )}
            </>
          )}
        </div>

        {/* ── Tabla + observaciones + guardar ── */}
        <div className="bg-white rounded-xl shadow-sm p-5 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="font-bold text-gray-700">
              Productos entregados
              {productos.length > 0 && (
                <span className="ml-2 text-sm font-normal text-gray-400">{totalUnid} uds</span>
              )}
            </h3>
            {productos.length > 0 && (
              <button
                onClick={() => setProductos([])}
                className="text-xs text-gray-400 hover:text-red-400 active:scale-95 transition-all duration-100"
              >Limpiar</button>
            )}
          </div>

          {!sel ? (
            <p className="text-sm text-gray-400 text-center py-10">Selecciona un chofer primero</p>
          ) : productos.length === 0 ? (
            <div className="text-center py-10 text-gray-400 text-sm">
              <p className="text-3xl mb-2">🧾</p>
              <p>Agrega foto de factura y presiona</p>
              <p className="font-medium">✨ Leer factura con IA</p>
            </div>
          ) : (
            <>
              <ProductTable
                productos={productos}
                onChange={setProductos}
                showVisto={true}
                showPrecio={false}
              />
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">
                  📝 Observaciones — sobrantes y faltantes
                </label>
                <textarea
                  value={observaciones}
                  onChange={(e) => setObservaciones(e.target.value)}
                  placeholder="Ej: 2 cajas sobrantes de leche, cliente rechazó queso..."
                  rows={2}
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm
                    text-gray-800 focus:ring-2 focus:ring-blue-400 outline-none resize-none"
                />
              </div>
            </>
          )}

          <button
            type="button"
            onClick={guardar}
            disabled={guardando || !sel || productos.length === 0}
            className="w-full py-3 bg-blue-600 hover:bg-blue-700 active:scale-95 text-white
              rounded-xl font-semibold transition-all duration-100 disabled:opacity-50"
          >
            {guardando ? "Guardando..." : `💾 Guardar entrega${sel ? ` — ${sel.nombre}` : ""}`}
          </button>

          {productos.length > 0 && sel && (
            <WhatsAppPrint getMessage={getWhatsAppMsg} />
          )}
        </div>
      </div>

      {/* ── Modal Confrontar ── */}
      {showConfronta && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={() => setShowConfronta(false)}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[85vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 py-4 border-b flex-shrink-0">
              <div>
                <h2 className="font-bold text-gray-800 text-lg">⚖️ Confrontar antes de despachar</h2>
                <p className="text-xs text-gray-500">Cuarto Frío vs. facturas registradas de choferes</p>
              </div>
              <button onClick={() => setShowConfronta(false)} className="text-gray-400 hover:text-gray-600 text-2xl leading-none active:scale-95">×</button>
            </div>
            <div className="flex-1 overflow-y-auto p-5">
              {cuartoFrio.length === 0 && Object.keys(entregaMap).length === 0 ? (
                <div className="text-center py-12 text-gray-400">
                  <p className="text-3xl mb-3">⚖️</p>
                  <p className="font-medium">Sin datos para confrontar</p>
                  <p className="text-sm mt-1">Registra el inventario en Cuarto Frío primero</p>
                </div>
              ) : (
                <div className="space-y-4">
                  {/* Resumen */}
                  <div className="grid grid-cols-3 gap-3">
                    <div className="bg-blue-50 rounded-xl p-3 text-center">
                      <p className="text-xl font-bold text-blue-700">{cuartoFrio.reduce((s, p) => s + (p.cantidad ?? 0), 0)}</p>
                      <p className="text-xs text-blue-500">Total Cuarto Frío</p>
                    </div>
                    <div className="bg-green-50 rounded-xl p-3 text-center">
                      <p className="text-xl font-bold text-green-700">{Object.values(entregaMap).reduce((s, v) => s + v, 0)}</p>
                      <p className="text-xs text-green-500">Total Facturas</p>
                    </div>
                    <div className="bg-orange-50 rounded-xl p-3 text-center">
                      <p className="text-xl font-bold text-orange-700">
                        {confrontaFilas.reduce((s, f) => s + f.diff, 0)}
                      </p>
                      <p className="text-xs text-orange-500">Diferencia neta</p>
                    </div>
                  </div>

                  {/* Tabla */}
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead className="bg-gray-50">
                        <tr className="text-xs text-gray-500">
                          <th className="text-left px-3 py-2.5">Producto</th>
                          <th className="text-right px-3 py-2.5">C.Frío</th>
                          <th className="text-right px-3 py-2.5">Facturas</th>
                          <th className="text-right px-3 py-2.5">Diferencia</th>
                          <th className="px-3 py-2.5 text-center">Estado</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-50">
                        {confrontaFilas.map((f) => {
                          const alcanza = f.diff >= 0;
                          const icon = f.diff === 0 ? "✅" : f.diff > 0 ? "🟡" : "🚨";
                          return (
                            <tr key={f.nombre} className="hover:bg-gray-50">
                              <td className="px-3 py-2.5 font-medium text-gray-800">{f.nombre}</td>
                              <td className="px-3 py-2.5 text-right text-blue-600">{f.cf}</td>
                              <td className="px-3 py-2.5 text-right text-green-600">{f.entr}</td>
                              <td className={`px-3 py-2.5 text-right font-semibold ${
                                f.diff > 0 ? "text-yellow-600" : f.diff < 0 ? "text-red-600" : "text-gray-400"
                              }`}>
                                {f.diff > 0 ? `+${f.diff} sobra` : f.diff < 0 ? `${f.diff} falta` : "justo"}
                              </td>
                              <td className="px-3 py-2.5 text-center text-xl">{icon}</td>
                            </tr>
                          );
                        })}
                        {confrontaFilas.length === 0 && (
                          <tr><td colSpan={5} className="text-center py-6 text-gray-400 text-sm">Sin productos registrados</td></tr>
                        )}
                      </tbody>
                    </table>
                  </div>

                  {/* Leyenda */}
                  <div className="flex flex-wrap gap-3 text-xs text-gray-500">
                    <span>✅ = cantidad exacta</span>
                    <span>🟡 = sobra en cuarto frío</span>
                    <span>🚨 = falta en cuarto frío</span>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
