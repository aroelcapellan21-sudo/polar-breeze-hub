"use client";

import { useState, useEffect } from "react";
import {
  collection, query, where, onSnapshot,
  doc, setDoc, addDoc, updateDoc, increment, Timestamp,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useAuth } from "@/lib/auth-context";
import { ProductoItem, UserProfile, FsDriver } from "@/lib/types";
import { ImageUploader, ProductTable, ModeToggle, AiButton } from "./shared";

export default function Choferes() {
  const { profile } = useAuth();
  const [choferes,   setChoferes]   = useState<UserProfile[]>([]);
  const [drivers,    setDrivers]    = useState<FsDriver[]>([]);
  const [sel,        setSel]        = useState<UserProfile | null>(null);
  const [mode,       setMode]       = useState<"foto" | "manual">("foto");
  const [preview,    setPreview]    = useState<string | null>(null);
  const [imgData,    setImgData]    = useState<{ base64: string; mimeType: string } | null>(null);
  const [texto,      setTexto]      = useState("");
  const [productos,  setProductos]  = useState<ProductoItem[]>([]);
  const [analizando, setAnalizando] = useState(false);
  const [guardando,  setGuardando]  = useState(false);
  const [msg,        setMsg]        = useState<{ type: "ok" | "err"; text: string } | null>(null);

  useEffect(() => {
    const uChof = onSnapshot(
      query(collection(db, "usuarios"), where("role", "==", "chofer"), where("activo", "!=", false)),
      (s) => setChoferes(s.docs.map((d) => d.data() as UserProfile))
    );
    const uDrv = onSnapshot(
      collection(db, "drivers"),
      (s) => setDrivers(s.docs.map((d) => ({ id: d.id, ...d.data() } as FsDriver)))
    );
    return () => { uChof(); uDrv(); };
  }, []);

  const flash = (type: "ok" | "err", text: string) => {
    setMsg({ type, text });
    setTimeout(() => setMsg(null), 4000);
  };

  const resetEntrada = () => {
    setPreview(null); setImgData(null); setTexto(""); setProductos([]);
  };

  const selectChofer = (c: UserProfile) => {
    setSel(c); resetEntrada();
    setMode("foto");
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

      // drivers/{uid} — datos del chofer en FacturaScan
      await setDoc(doc(db, "drivers", sel.uid), {
        uid:            sel.uid,
        nombre:         sel.nombre,
        ficha:          sel.ficha ?? "",
        entregas:       productos,
        totalEntregado,
        totalMonto:     totalMonto || null,
        updatedAt:      Timestamp.now(),
        activo:         true,
      });

      // session/despacho — actualizar totales acumulados
      try {
        await updateDoc(doc(db, "session", "despacho"), {
          totalDespachos: increment(1),
          totalMonto:     increment(totalMonto),
          totalUnidades:  increment(totalEntregado),
        });
      } catch {
        // si no existe la sesión todavía, ignorar
      }

      // history — registro histórico
      await addDoc(collection(db, "history"), {
        tipo:              "entrega_chofer",
        choferId:          sel.uid,
        choferNombre:      sel.nombre,
        productos,
        totalEntregado,
        totalMonto:        totalMonto || null,
        despachadorId:     profile.uid,
        despachadorNombre: profile.nombre,
        timestamp:         Timestamp.now(),
      });

      // facturascan (Hub) — para que el admin vea en feed en tiempo real
      await addDoc(collection(db, "facturascan"), {
        despachadorId:     profile.uid,
        despachadorNombre: profile.nombre,
        facturaNumero:     `FS-${sel.ficha ?? sel.uid.slice(0, 4)}-${Date.now().toString().slice(-5)}`,
        cliente:           sel.nombre,
        monto:             totalMonto,
        timestamp:         Timestamp.now(),
        estado:            "procesada",
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

  const canAnalyze = mode === "foto" ? !!imgData : texto.trim().length > 10;
  const totalUnid  = productos.reduce((s, p) => s + (p.cantidad ?? 0), 0);

  return (
    <div className="grid lg:grid-cols-3 gap-5">

      {/* ── Lista de choferes ── */}
      <div className="bg-white rounded-xl shadow-sm p-5">
        <h2 className="font-bold text-blue-700 mb-3">
          👥 Choferes ({choferes.length})
        </h2>
        {choferes.length === 0 ? (
          <p className="text-sm text-gray-400 text-center py-8">
            Sin choferes activos.<br/>Crea uno desde el Admin.
          </p>
        ) : (
          <div className="space-y-2">
            {choferes.map((c) => {
              const driver  = driverMap[c.uid];
              const tieneDatos = !!driver?.entregas;
              return (
                <button
                  key={c.uid}
                  onClick={() => selectChofer(c)}
                  className={`w-full flex items-center gap-3 p-3 rounded-xl border-2 text-left transition ${
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
      </div>

      {/* ── Panel de entrada (foto/manual) ── */}
      <div className="bg-white rounded-xl shadow-sm p-5 space-y-4">
        {!sel ? (
          <div className="flex flex-col items-center justify-center h-full py-16 text-gray-400">
            <p className="text-3xl mb-2">👈</p>
            <p className="text-sm">Selecciona un chofer para<br/>registrar su entrega</p>
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

      {/* ── Tabla editable + guardar ── */}
      <div className="bg-white rounded-xl shadow-sm p-5 space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="font-bold text-gray-700">
            Productos entregados
            {productos.length > 0 && (
              <span className="ml-2 text-sm font-normal text-gray-400">
                {totalUnid} uds
              </span>
            )}
          </h3>
          {productos.length > 0 && (
            <button
              onClick={() => setProductos([])}
              className="text-xs text-gray-400 hover:text-red-400"
            >Limpiar</button>
          )}
        </div>

        {!sel ? (
          <p className="text-sm text-gray-400 text-center py-10">
            Selecciona un chofer primero
          </p>
        ) : productos.length === 0 ? (
          <div className="text-center py-10 text-gray-400 text-sm">
            <p className="text-3xl mb-2">🧾</p>
            <p>Agrega foto de factura y presiona</p>
            <p className="font-medium">✨ Leer factura con IA</p>
          </div>
        ) : (
          <ProductTable productos={productos} onChange={setProductos} />
        )}

        <button
          type="button"
          onClick={guardar}
          disabled={guardando || !sel || productos.length === 0}
          className="w-full py-3 bg-blue-600 hover:bg-blue-700 text-white rounded-xl
            font-semibold transition disabled:opacity-50"
        >
          {guardando ? "Guardando..." : `💾 Guardar entrega${sel ? ` — ${sel.nombre}` : ""}`}
        </button>
      </div>
    </div>
  );
}
