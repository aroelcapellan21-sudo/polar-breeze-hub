"use client";

/**
 * PolarBreezeWeight — Módulo de recepción de mercancía con escáner + báscula BT
 *
 * Flujo:
 *  1. Encargado escanea código (escáner HID o manual).
 *  2. Sistema busca en Firestore (codigos_cajas/{codigo}).
 *     - Encontrado → muestra producto + unidades. Captura peso de báscula.
 *     - No encontrado → modal "Nombrar código" → guarda en Firestore.
 *  3. Encargado confirma → ítem se agrega al lote activo.
 *  4. Al cerrar el lote → guarda en lotes_weight con totales.
 *
 * Hardware:
 *  - Escáner USB/BT HID: funciona como teclado. El input recibe el código + Enter.
 *  - Báscula BT: Web Bluetooth API (servicio 0x181D Weight Scale).
 *    Fallback: entrada manual de peso.
 */

import { useState, useEffect, useRef, useCallback } from "react";
import {
  doc, getDoc, setDoc, addDoc, collection, getDocs,
  onSnapshot, query, orderBy, limit, Timestamp,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useAuth } from "@/lib/auth-context";
import { CodigoCaja, WeightItem, LoteWeight, toDate } from "@/lib/types";

// ─── Tipos locales ────────────────────────────────────────────────────────────

type Seccion = "escanear" | "historial";

type BtEstado = "desconectado" | "conectando" | "conectado" | "error";

interface ItemPendiente {
  codigo:   CodigoCaja;
  nCajas:   string;   // editable antes de confirmar
}

// ─── Helper ───────────────────────────────────────────────────────────────────

function fmtPeso(kg: number | null): string {
  if (kg === null) return "—";
  return `${kg.toFixed(2)} kg`;
}

function numeroLote(n: number): string {
  return `#W${String(n).padStart(3, "0")}`;
}

// ─── Bluetooth: Weight Scale Profile ─────────────────────────────────────────
// Servicio estándar 0x181D (Weight Scale), característica 0x2A9D (Weight Measurement)
// Byte 0: flags  |  Bytes 1-2: weight (uint16, resolución 0.005 kg o 0.01 kg según flag)

function parsearPesosBle(value: DataView): number | null {
  if (value.byteLength < 3) return null;
  const flags     = value.getUint8(0);
  const masUnidad = (flags & 0x01) === 0; // 0 = kg, 1 = lb
  const rawWeight = value.getUint16(1, true); // little-endian
  if (!masUnidad) return null; // por ahora solo kg
  // resolución: si flag bit 1 = 0 → 0.005 kg, si = 1 → 0.01 kg
  const resolution = (flags & 0x02) ? 0.01 : 0.005;
  return parseFloat((rawWeight * resolution).toFixed(3));
}

// ─── Componente ───────────────────────────────────────────────────────────────

export default function PolarBreezeWeight() {
  const { profile } = useAuth();

  // ── Sección activa ────────────────────────────────────────────────────────
  const [seccion, setSeccion] = useState<Seccion>("escanear");

  // ── Escáner ───────────────────────────────────────────────────────────────
  const [codigoInput,   setCodigoInput]   = useState("");
  const [buscando,      setBuscando]      = useState(false);
  const [itemPendiente, setItemPendiente] = useState<ItemPendiente | null>(null);
  const [errorCodigo,   setErrorCodigo]   = useState("");
  const scanInputRef = useRef<HTMLInputElement>(null);

  // ── Modal nombrar código ──────────────────────────────────────────────────
  const [modalNombrar,   setModalNombrar]   = useState(false);
  const [codigoNuevo,    setCodigoNuevo]    = useState("");
  const [nombreNuevo,    setNombreNuevo]    = useState("");
  const [unidadesNuevo,  setUnidadesNuevo]  = useState("1");
  const [pesoRefNuevo,   setPesoRefNuevo]   = useState("");
  const [guardandoCod,   setGuardandoCod]   = useState(false);

  // ── Báscula Bluetooth ─────────────────────────────────────────────────────
  const [btEstado,      setBtEstado]      = useState<BtEstado>("desconectado");
  const [btNombreDisp,  setBtNombreDisp]  = useState("");
  const [pesoActual,    setPesoActual]    = useState<number | null>(null);
  const [pesoManual,    setPesoManual]    = useState("");
  const [modoManual,    setModoManual]    = useState(false);
  const btDeviceRef  = useRef<BluetoothDevice | null>(null);
  const btCharRef    = useRef<BluetoothRemoteGATTCharacteristic | null>(null);

  // ── Lote activo ───────────────────────────────────────────────────────────
  const [loteItems,    setLoteItems]    = useState<WeightItem[]>([]);
  const [proveedor,    setProveedor]    = useState("");
  const [notas,        setNotas]        = useState("");
  const [cerrandoLote, setCerrandoLote] = useState(false);
  const [msgLote,      setMsgLote]      = useState<{ type: "ok"|"err"; text: string } | null>(null);

  // ── Historial ─────────────────────────────────────────────────────────────
  const [historial,    setHistorial]    = useState<LoteWeight[]>([]);
  const [cargandoHist, setCargandoHist] = useState(false);
  const [histAbierto,  setHistAbierto]  = useState<string | null>(null);

  // ─── Auto-focus del input de escaneo ─────────────────────────────────────
  useEffect(() => {
    if (seccion === "escanear" && !modalNombrar) {
      setTimeout(() => scanInputRef.current?.focus(), 100);
    }
  }, [seccion, modalNombrar, itemPendiente]);

  // ─── Cargar historial al cambiar de sección ───────────────────────────────
  useEffect(() => {
    if (seccion !== "historial") return;
    setCargandoHist(true);
    const q = query(collection(db, "lotes_weight"), orderBy("timestamp", "desc"), limit(30));
    const unsub = onSnapshot(q, (snap) => {
      setHistorial(snap.docs.map(d => ({ id: d.id, ...d.data() } as LoteWeight)));
      setCargandoHist(false);
    });
    return unsub;
  }, [seccion]);

  // ─── Bluetooth: desconectar al desmontar ──────────────────────────────────
  useEffect(() => {
    return () => {
      if (btCharRef.current) {
        btCharRef.current.stopNotifications().catch(() => {});
      }
      if (btDeviceRef.current?.gatt?.connected) {
        btDeviceRef.current.gatt.disconnect();
      }
    };
  }, []);

  // ─── Handler de lectura BLE ───────────────────────────────────────────────
  const handleBleNotification = useCallback((event: Event) => {
    const target = event.target as BluetoothRemoteGATTCharacteristic;
    if (!target.value) return;
    const kg = parsearPesosBle(target.value);
    if (kg !== null && kg > 0) setPesoActual(kg);
  }, []);

  // ─── Conectar báscula BT ──────────────────────────────────────────────────
  const conectarBascula = async () => {
    if (!navigator.bluetooth) {
      setModoManual(true);
      return;
    }
    setBtEstado("conectando");
    try {
      const device = await navigator.bluetooth.requestDevice({
        filters: [{ services: ["weight_scale"] }],
        optionalServices: ["weight_scale"],
      }).catch(async () => {
        // Si el filtro falla, intentar sin filtro (algunas básculas no anuncian el servicio)
        return navigator.bluetooth.requestDevice({
          acceptAllDevices: true,
          optionalServices: ["weight_scale", "0000181d-0000-1000-8000-00805f9b34fb"],
        });
      });

      btDeviceRef.current = device;
      setBtNombreDisp(device.name ?? "Báscula BT");

      device.addEventListener("gattserverdisconnected", () => {
        setBtEstado("desconectado");
        setBtNombreDisp("");
        setPesoActual(null);
      });

      const server  = await device.gatt!.connect();
      const service = await server.getPrimaryService("weight_scale")
        .catch(() => server.getPrimaryService("0000181d-0000-1000-8000-00805f9b34fb"));
      const char    = await service.getCharacteristic("weight_measurement")
        .catch(() => service.getCharacteristic("00002a9d-0000-1000-8000-00805f9b34fb"));

      btCharRef.current = char;
      await char.startNotifications();
      char.addEventListener("characteristicvaluechanged", handleBleNotification);
      setBtEstado("conectado");
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("cancelled") || msg.includes("chosen")) {
        setBtEstado("desconectado"); // usuario canceló
      } else {
        setBtEstado("error");
        // Fallback a modo manual
        setTimeout(() => { setBtEstado("desconectado"); setModoManual(true); }, 3000);
      }
    }
  };

  const desconectarBascula = () => {
    btCharRef.current?.stopNotifications().catch(() => {});
    btDeviceRef.current?.gatt?.disconnect();
    setBtEstado("desconectado");
    setBtNombreDisp("");
    setPesoActual(null);
  };

  // ─── Peso efectivo (BT o manual) ─────────────────────────────────────────
  const pesoEfectivo = modoManual
    ? (parseFloat(pesoManual) || null)
    : pesoActual;

  // ─── Buscar código en Firestore ───────────────────────────────────────────
  const buscarCodigo = async (rawCodigo: string) => {
    const codigo = rawCodigo.trim();
    if (!codigo) return;
    setBuscando(true);
    setErrorCodigo("");
    setItemPendiente(null);
    try {
      const snap = await getDoc(doc(db, "codigos_cajas", codigo));
      if (snap.exists()) {
        setItemPendiente({ codigo: snap.data() as CodigoCaja, nCajas: "1" });
      } else {
        setCodigoNuevo(codigo);
        setNombreNuevo("");
        setUnidadesNuevo("1");
        setPesoRefNuevo("");
        setModalNombrar(true);
      }
    } catch {
      setErrorCodigo("Error al buscar el código. Intenta de nuevo.");
    } finally {
      setBuscando(false);
      setCodigoInput("");
    }
  };

  // ─── Guardar nuevo código ─────────────────────────────────────────────────
  const guardarCodigoNuevo = async () => {
    if (!nombreNuevo.trim() || !unidadesNuevo) return;
    setGuardandoCod(true);
    try {
      const nuevoCodigo: CodigoCaja = {
        codigo:          codigoNuevo,
        producto:        nombreNuevo.trim(),
        unidadesPorCaja: parseInt(unidadesNuevo) || 1,
        ...(pesoRefNuevo ? { pesoCajaKg: parseFloat(pesoRefNuevo) } : {}),
        creadoEn:        Timestamp.now(),
        creadoPor:       profile?.nombre ?? "",
      };
      await setDoc(doc(db, "codigos_cajas", codigoNuevo), nuevoCodigo);
      setModalNombrar(false);
      setItemPendiente({ codigo: nuevoCodigo, nCajas: "1" });
    } catch {
      // silencioso — el modal permanece abierto
    } finally {
      setGuardandoCod(false);
    }
  };

  // ─── Agregar ítem al lote ─────────────────────────────────────────────────
  const agregarItem = () => {
    if (!itemPendiente) return;
    const nCajas   = Math.max(1, parseInt(itemPendiente.nCajas) || 1);
    const unidades = nCajas * itemPendiente.codigo.unidadesPorCaja;

    const nuevoItem: WeightItem = {
      codigo:    itemPendiente.codigo.codigo,
      producto:  itemPendiente.codigo.producto,
      nCajas,
      unidades,
      peso_kg:   pesoEfectivo,
      timestamp: Timestamp.now(),
    };

    setLoteItems(prev => {
      // Si ya existe el mismo código, acumular
      const idx = prev.findIndex(i => i.codigo === nuevoItem.codigo);
      if (idx >= 0) {
        return prev.map((it, i) => i === idx ? {
          ...it,
          nCajas:   it.nCajas + nCajas,
          unidades: it.unidades + unidades,
          peso_kg:  it.peso_kg !== null && pesoEfectivo !== null
            ? parseFloat((it.peso_kg + pesoEfectivo).toFixed(3))
            : (pesoEfectivo ?? it.peso_kg),
        } : it);
      }
      return [...prev, nuevoItem];
    });

    setItemPendiente(null);
    setMsgLote(null);
    // Re-enfocar el input para el próximo escaneo
    setTimeout(() => scanInputRef.current?.focus(), 80);
  };

  // ─── Quitar ítem del lote ─────────────────────────────────────────────────
  const quitarItem = (idx: number) => {
    setLoteItems(prev => prev.filter((_, i) => i !== idx));
  };

  // ─── Cerrar lote ─────────────────────────────────────────────────────────
  const cerrarLote = async () => {
    if (loteItems.length === 0) return;
    setCerrandoLote(true);
    setMsgLote(null);
    try {
      const snap      = await getDocs(collection(db, "lotes_weight"));
      const numero    = numeroLote(snap.size + 1);
      const totalUds  = loteItems.reduce((s, i) => s + i.unidades, 0);
      const totalPeso = loteItems.every(i => i.peso_kg !== null)
        ? parseFloat(loteItems.reduce((s, i) => s + (i.peso_kg ?? 0), 0).toFixed(3))
        : null;

      const loteDoc: Omit<LoteWeight, "id"> = {
        numero,
        ...(proveedor.trim() ? { proveedor: proveedor.trim() } : {}),
        ...(notas.trim()     ? { notas:     notas.trim()     } : {}),
        items:           loteItems,
        totalUnidades:   totalUds,
        totalPesoKg:     totalPeso,
        encargadoId:     profile?.uid     ?? "",
        encargadoNombre: profile?.nombre  ?? "Encargado",
        timestamp:       Timestamp.now(),
        estado:          "cerrado",
      };

      await addDoc(collection(db, "lotes_weight"), loteDoc);

      // También registrar cada ítem como entrada_interior en movimientos_loker
      for (const item of loteItems) {
        await addDoc(collection(db, "movimientos_loker"), {
          tipo:        "entrada_interior",
          producto_id: item.producto.trim().toLowerCase().replace(/\s+/g, "_").replace(/[^a-z0-9_áéíóúñü]/g, ""),
          nombre:      item.producto,
          cantidad:    item.unidades,
          responsable: profile?.nombre ?? "Encargado",
          timestamp:   Timestamp.now(),
          notas:       `Weight ${numero}${proveedor.trim() ? ` — ${proveedor.trim()}` : ""}`,
          loteNumero:  numero,
          peso_kg:     item.peso_kg,
        });
      }

      setMsgLote({ type: "ok", text: `Lote ${numero} cerrado — ${totalUds} uds · ${totalPeso !== null ? fmtPeso(totalPeso) : "sin peso"}` });
      setLoteItems([]);
      setProveedor("");
      setNotas("");
    } catch (e) {
      setMsgLote({ type: "err", text: e instanceof Error ? e.message : "Error al cerrar el lote." });
    } finally {
      setCerrandoLote(false);
    }
  };

  // ─── Totales del lote activo ──────────────────────────────────────────────
  const totalUds  = loteItems.reduce((s, i) => s + i.unidades, 0);
  const totalPeso = loteItems.some(i => i.peso_kg !== null)
    ? loteItems.reduce((s, i) => s + (i.peso_kg ?? 0), 0)
    : null;

  // ═══════════════════════════════════════════════════════════════════════════
  //  RENDER
  // ═══════════════════════════════════════════════════════════════════════════

  return (
    <div className="space-y-4">

      {/* ── Sub-tabs ── */}
      <div className="bg-white rounded-xl shadow-sm overflow-hidden">
        <div className="flex border-b border-gray-100">
          {([
            { key: "escanear",  icon: "⚖️", label: "Escanear" },
            { key: "historial", icon: "📋", label: "Historial" },
          ] as { key: Seccion; icon: string; label: string }[]).map((s) => (
            <button
              key={s.key}
              onClick={() => setSeccion(s.key)}
              className={`flex-1 py-2.5 text-xs font-semibold flex flex-col items-center gap-0.5
                transition-all active:scale-95 ${
                  seccion === s.key
                    ? "bg-[#F5C800] text-[#1A1A1A] border-b-2 border-[#D42B2B]"
                    : "text-gray-500 hover:bg-gray-50"
                }`}
            >
              <span className="text-base">{s.icon}</span>
              <span>{s.label}</span>
            </button>
          ))}
        </div>
      </div>

      {/* ═══════════════════════════════════════════════════════════
          SECCIÓN: ESCANEAR
      ═══════════════════════════════════════════════════════════ */}
      {seccion === "escanear" && (
        <div className="space-y-3">

          {/* ── Input de escaneo ── */}
          <div className="bg-white rounded-xl shadow-sm overflow-hidden">
            <div className="px-4 py-3 bg-[#1A1A1A] flex items-center justify-between">
              <div>
                <h2 className="text-white font-bold text-sm">📷 Escanear código</h2>
                <p className="text-gray-400 text-xs">Conecta el escáner HID o escribe el código</p>
              </div>
              {buscando && (
                <span className="text-xs text-[#F5C800] animate-pulse">Buscando…</span>
              )}
            </div>
            <div className="h-0.5 flex">
              <div className="flex-1 bg-[#F5C800]" />
              <div className="flex-1 bg-[#D42B2B]" />
              <div className="flex-1 bg-[#1E8C3A]" />
            </div>
            <div className="p-4">
              <div className="flex gap-2">
                <input
                  ref={scanInputRef}
                  value={codigoInput}
                  onChange={(e) => setCodigoInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && codigoInput.trim()) {
                      buscarCodigo(codigoInput);
                    }
                  }}
                  placeholder="Escanea o escribe el código de barras…"
                  autoComplete="off"
                  spellCheck={false}
                  className="flex-1 px-3 py-2.5 border-2 border-gray-200 rounded-lg text-sm
                    outline-none focus:ring-2 focus:ring-[#F5C800] focus:border-[#F5C800]
                    font-mono tracking-widest bg-gray-50"
                />
                <button
                  onClick={() => codigoInput.trim() && buscarCodigo(codigoInput)}
                  disabled={!codigoInput.trim() || buscando}
                  className="px-4 py-2.5 bg-[#1A1A1A] text-white rounded-lg text-sm font-bold
                    active:scale-95 transition-all disabled:opacity-40"
                >
                  🔍
                </button>
              </div>
              {errorCodigo && (
                <p className="text-xs text-red-500 mt-2">{errorCodigo}</p>
              )}
              <p className="text-xs text-gray-400 mt-2">
                💡 El escáner USB/BT envía el código automáticamente al hacer Enter
              </p>
            </div>
          </div>

          {/* ── Producto encontrado (pendiente de agregar) ── */}
          {itemPendiente && (
            <div className="bg-white rounded-xl shadow-sm overflow-hidden border-2 border-[#F5C800]">
              <div className="px-4 py-2.5 bg-[#F5C800] flex items-center gap-2">
                <span className="text-lg">📦</span>
                <p className="font-bold text-[#1A1A1A] text-sm">Producto encontrado</p>
              </div>
              <div className="p-4 space-y-3">
                <div>
                  <p className="text-base font-bold text-gray-800">{itemPendiente.codigo.producto}</p>
                  <p className="text-xs text-gray-400 font-mono">{itemPendiente.codigo.codigo}</p>
                  <p className="text-xs text-gray-500 mt-0.5">
                    {itemPendiente.codigo.unidadesPorCaja} uds/caja
                    {itemPendiente.codigo.pesoCajaKg
                      ? ` · ref. ${itemPendiente.codigo.pesoCajaKg} kg/caja`
                      : ""}
                  </p>
                </div>

                <div className="flex items-end gap-3">
                  <div className="flex-1">
                    <label className="block text-xs font-medium text-gray-600 mb-1">
                      N° de cajas recibidas
                    </label>
                    <input
                      type="number"
                      min="1"
                      value={itemPendiente.nCajas}
                      onChange={(e) =>
                        setItemPendiente({ ...itemPendiente, nCajas: e.target.value })
                      }
                      onKeyDown={(e) => e.key === "Enter" && agregarItem()}
                      className="w-full px-3 py-2.5 border-2 border-gray-200 rounded-lg text-sm
                        text-center font-bold outline-none focus:ring-2 focus:ring-[#F5C800]"
                    />
                  </div>
                  <div className="flex-1">
                    <p className="text-xs font-medium text-gray-600 mb-1">Total unidades</p>
                    <div className="px-3 py-2.5 bg-gray-50 border border-gray-200 rounded-lg text-sm
                      font-bold text-center text-gray-700">
                      {(parseInt(itemPendiente.nCajas) || 0) * itemPendiente.codigo.unidadesPorCaja}
                    </div>
                  </div>
                </div>

                {/* Peso capturado */}
                <div className={`flex items-center justify-between px-3 py-2 rounded-lg ${
                  pesoEfectivo !== null
                    ? "bg-[#1E8C3A]/10 border border-[#1E8C3A]/30"
                    : "bg-gray-50 border border-gray-200"
                }`}>
                  <div className="flex items-center gap-2">
                    <span className="text-base">⚖️</span>
                    <div>
                      <p className="text-xs font-medium text-gray-600">Peso capturado</p>
                      <p className={`text-sm font-bold ${
                        pesoEfectivo !== null ? "text-[#1E8C3A]" : "text-gray-400"
                      }`}>
                        {pesoEfectivo !== null ? fmtPeso(pesoEfectivo) : "Sin peso"}
                      </p>
                    </div>
                  </div>
                  {pesoEfectivo === null && (
                    <p className="text-xs text-gray-400 text-right">
                      Conecta la báscula<br/>o usa entrada manual
                    </p>
                  )}
                </div>

                <div className="flex gap-2">
                  <button
                    onClick={() => setItemPendiente(null)}
                    className="flex-1 py-2.5 rounded-xl border border-gray-200 text-sm text-gray-500
                      hover:bg-gray-50 active:scale-95 transition-all"
                  >
                    Cancelar
                  </button>
                  <button
                    onClick={agregarItem}
                    className="flex-2 px-6 py-2.5 bg-[#1A1A1A] text-white rounded-xl text-sm
                      font-bold active:scale-95 transition-all flex items-center gap-2"
                  >
                    <span>✅ Agregar al lote</span>
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* ── Báscula Bluetooth ── */}
          <div className="bg-white rounded-xl shadow-sm overflow-hidden">
            <div className="px-4 py-3 bg-gradient-to-r from-blue-600 to-blue-800 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="text-base">⚖️</span>
                <div>
                  <p className="text-white font-bold text-sm">Báscula Bluetooth</p>
                  {btEstado === "conectado" && btNombreDisp && (
                    <p className="text-blue-200 text-xs">{btNombreDisp}</p>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-2">
                {btEstado === "error" && (
                  <span className="text-xs text-red-300 font-medium">Error</span>
                )}
                {btEstado === "conectado" ? (
                  <button
                    onClick={desconectarBascula}
                    className="text-xs bg-red-500/80 hover:bg-red-500 text-white px-3 py-1.5
                      rounded-lg active:scale-95 transition-all font-medium"
                  >
                    Desconectar
                  </button>
                ) : btEstado === "conectando" ? (
                  <span className="text-xs text-blue-200 animate-pulse">Conectando…</span>
                ) : (
                  <button
                    onClick={conectarBascula}
                    disabled={false}
                    className="text-xs bg-white/20 hover:bg-white/30 text-white px-3 py-1.5
                      rounded-lg active:scale-95 transition-all font-medium disabled:opacity-50"
                  >
                    📶 Conectar BT
                  </button>
                )}
              </div>
            </div>

            <div className="p-4">
              {/* Indicador de peso BT */}
              {btEstado === "conectado" ? (
                <div className="text-center py-3">
                  <p className={`text-4xl font-black font-mono tabular-nums tracking-tight ${
                    pesoActual !== null ? "text-[#1E8C3A]" : "text-gray-300"
                  }`}>
                    {pesoActual !== null ? `${pesoActual.toFixed(2)} kg` : "— — kg"}
                  </p>
                  <p className="text-xs text-gray-400 mt-1">
                    {pesoActual !== null ? "⚡ Lectura en tiempo real" : "Esperando lectura…"}
                  </p>
                </div>
              ) : (
                <div className="text-center py-2 text-sm text-gray-400">
                  {btEstado === "error"
                    ? "No se pudo conectar. Activa Bluetooth e intenta de nuevo."
                    : "Báscula desconectada"}
                </div>
              )}

              {/* Modo manual (toggle) */}
              <div className="mt-3 border-t border-gray-100 pt-3">
                <button
                  onClick={() => setModoManual(v => !v)}
                  className="flex items-center gap-2 text-xs text-gray-500 hover:text-gray-700 transition-colors"
                >
                  <span className={`w-4 h-4 rounded flex items-center justify-center text-xs ${
                    modoManual ? "bg-[#1A1A1A] text-white" : "border border-gray-300"
                  }`}>{modoManual ? "✓" : ""}</span>
                  Entrada manual de peso
                </button>
                {modoManual && (
                  <div className="flex items-center gap-2 mt-2">
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      value={pesoManual}
                      onChange={(e) => setPesoManual(e.target.value)}
                      placeholder="0.00"
                      className="flex-1 px-3 py-2 border-2 border-gray-200 rounded-lg text-sm
                        font-mono text-center outline-none focus:ring-2 focus:ring-[#F5C800]"
                    />
                    <span className="text-sm text-gray-500 font-medium">kg</span>
                    {pesoManual && (
                      <button
                        onClick={() => setPesoManual("")}
                        className="text-gray-400 hover:text-red-500 transition-colors text-lg leading-none"
                      >×</button>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* ── Lote activo ── */}
          <div className="bg-white rounded-xl shadow-sm overflow-hidden">
            <div className="px-4 py-3 bg-[#1A1A1A] flex items-center justify-between">
              <div>
                <h2 className="text-white font-bold text-sm">
                  📦 Lote en curso
                  {loteItems.length > 0 && (
                    <span className="ml-2 text-xs font-normal text-[#F5C800]">
                      {loteItems.length} producto{loteItems.length !== 1 ? "s" : ""}
                    </span>
                  )}
                </h2>
                {loteItems.length > 0 && (
                  <p className="text-gray-400 text-xs">
                    {totalUds} uds
                    {totalPeso !== null ? ` · ${fmtPeso(totalPeso)}` : ""}
                  </p>
                )}
              </div>
              {loteItems.length > 0 && (
                <button
                  onClick={cerrarLote}
                  disabled={cerrandoLote}
                  className="bg-[#D42B2B] hover:bg-[#b82424] active:scale-95 text-white text-xs
                    font-bold px-3 py-1.5 rounded-lg transition-all disabled:opacity-60"
                >
                  {cerrandoLote ? "Cerrando…" : "🔒 Cerrar lote"}
                </button>
              )}
            </div>
            <div className="h-0.5 flex">
              <div className="flex-1 bg-[#F5C800]" />
              <div className="flex-1 bg-[#D42B2B]" />
              <div className="flex-1 bg-[#1E8C3A]" />
            </div>

            {loteItems.length === 0 ? (
              <div className="px-4 py-8 text-center">
                <p className="text-2xl mb-1">📦</p>
                <p className="text-sm text-gray-400">Lote vacío — escanea el primer código</p>
              </div>
            ) : (
              <>
                {/* Proveedor (opcional) */}
                <div className="px-4 pt-3 pb-2">
                  <input
                    value={proveedor}
                    onChange={(e) => setProveedor(e.target.value)}
                    placeholder="Proveedor (opcional)…"
                    className="w-full px-3 py-2 border border-gray-200 rounded-lg text-xs
                      outline-none focus:ring-2 focus:ring-[#F5C800] text-gray-700"
                  />
                </div>

                {/* Tabla de ítems */}
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="bg-gray-50 border-y border-gray-100">
                        <th className="px-4 py-2 text-left font-semibold text-gray-500">Producto</th>
                        <th className="px-3 py-2 text-center font-semibold text-gray-500">Cajas</th>
                        <th className="px-3 py-2 text-center font-semibold text-gray-500">Uds</th>
                        <th className="px-3 py-2 text-center font-semibold text-gray-500">Peso</th>
                        <th className="px-2 py-2" />
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-50">
                      {loteItems.map((item, idx) => (
                        <tr key={`${item.codigo}-${idx}`} className="hover:bg-gray-50">
                          <td className="px-4 py-2.5">
                            <p className="font-medium text-gray-800 truncate max-w-[140px]">{item.producto}</p>
                            <p className="text-gray-400 font-mono text-[10px]">{item.codigo}</p>
                          </td>
                          <td className="px-3 py-2.5 text-center font-bold text-gray-700">{item.nCajas}</td>
                          <td className="px-3 py-2.5 text-center font-bold text-[#1E8C3A]">{item.unidades}</td>
                          <td className="px-3 py-2.5 text-center font-bold text-blue-600">
                            {fmtPeso(item.peso_kg)}
                          </td>
                          <td className="px-2 py-2.5 text-center">
                            <button
                              onClick={() => quitarItem(idx)}
                              className="text-gray-300 hover:text-red-500 active:scale-95
                                transition-all text-base leading-none"
                            >×</button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr className="bg-gray-50 border-t-2 border-gray-200">
                        <td className="px-4 py-2 text-xs font-bold text-gray-600">Total</td>
                        <td className="px-3 py-2 text-center text-xs font-bold text-gray-600">
                          {loteItems.reduce((s, i) => s + i.nCajas, 0)}
                        </td>
                        <td className="px-3 py-2 text-center text-xs font-bold text-[#1E8C3A]">
                          {totalUds}
                        </td>
                        <td className="px-3 py-2 text-center text-xs font-bold text-blue-600">
                          {fmtPeso(totalPeso)}
                        </td>
                        <td />
                      </tr>
                    </tfoot>
                  </table>
                </div>

                {/* Notas + mensaje */}
                <div className="px-4 py-3 space-y-2 border-t border-gray-100">
                  <input
                    value={notas}
                    onChange={(e) => setNotas(e.target.value)}
                    placeholder="Notas del lote (opcional)…"
                    className="w-full px-3 py-2 border border-gray-200 rounded-lg text-xs
                      outline-none focus:ring-2 focus:ring-[#F5C800] text-gray-700"
                  />
                  {msgLote && (
                    <div className={`text-xs px-3 py-2 rounded-lg ${
                      msgLote.type === "ok"
                        ? "bg-green-50 text-[#1E8C3A] border border-green-200"
                        : "bg-red-50 text-red-600 border border-red-200"
                    }`}>
                      {msgLote.text}
                    </div>
                  )}
                  <button
                    onClick={cerrarLote}
                    disabled={cerrandoLote || loteItems.length === 0}
                    className="w-full py-3 bg-[#D42B2B] hover:bg-[#b82424] active:scale-95 text-white
                      rounded-xl text-sm font-bold transition-all disabled:opacity-60"
                  >
                    {cerrandoLote ? "Cerrando lote…" : `🔒 Cerrar lote (${loteItems.length} prod · ${totalUds} uds)`}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* ═══════════════════════════════════════════════════════════
          SECCIÓN: HISTORIAL
      ═══════════════════════════════════════════════════════════ */}
      {seccion === "historial" && (
        <div className="bg-white rounded-xl shadow-sm overflow-hidden">
          <div className="px-4 py-3 bg-[#1A1A1A]">
            <h2 className="text-white font-bold text-sm">📋 Historial de lotes Weight</h2>
            <p className="text-gray-400 text-xs">Últimos 30 lotes recibidos</p>
          </div>
          <div className="h-0.5 flex">
            <div className="flex-1 bg-[#F5C800]" />
            <div className="flex-1 bg-[#D42B2B]" />
            <div className="flex-1 bg-[#1E8C3A]" />
          </div>

          {cargandoHist ? (
            <div className="px-4 py-10 text-center">
              <p className="text-sm text-gray-400 animate-pulse">Cargando historial…</p>
            </div>
          ) : historial.length === 0 ? (
            <div className="px-4 py-10 text-center">
              <p className="text-2xl mb-2">📦</p>
              <p className="text-sm text-gray-400">Sin lotes registrados aún.</p>
            </div>
          ) : (
            <div className="divide-y divide-gray-50">
              {historial.map((lote) => {
                const abierto = histAbierto === lote.id;
                const fecha   = toDate(lote.timestamp);
                return (
                  <div key={lote.id}>
                    <button
                      onClick={() => setHistAbierto(abierto ? null : (lote.id ?? null))}
                      className="w-full px-4 py-3 flex items-center gap-3 text-left hover:bg-gray-50
                        active:scale-[0.99] transition-all"
                    >
                      {/* Indicador de estado */}
                      <div className={`w-2 h-2 rounded-full flex-shrink-0 ${
                        lote.estado === "cerrado" ? "bg-[#1E8C3A]" : "bg-amber-400 animate-pulse"
                      }`} />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <p className="text-sm font-bold text-gray-800">{lote.numero}</p>
                          {lote.proveedor && (
                            <span className="text-xs text-gray-400">· {lote.proveedor}</span>
                          )}
                        </div>
                        <p className="text-xs text-gray-400">
                          {fecha.toLocaleDateString("es-DO", { day: "2-digit", month: "short", year: "numeric" })}
                          {" · "}
                          {fecha.toLocaleTimeString("es-DO", { hour: "2-digit", minute: "2-digit" })}
                        </p>
                      </div>
                      <div className="text-right flex-shrink-0">
                        <p className="text-sm font-bold text-gray-700">{lote.totalUnidades} uds</p>
                        {lote.totalPesoKg !== null && (
                          <p className="text-xs text-blue-600">{fmtPeso(lote.totalPesoKg)}</p>
                        )}
                      </div>
                      <span className="text-gray-400 text-xs flex-shrink-0">{abierto ? "▲" : "▼"}</span>
                    </button>

                    {abierto && (
                      <div className="px-4 pb-3 pt-1 bg-gray-50 border-t border-gray-100">
                        <p className="text-xs text-gray-500 mb-2">
                          👤 {lote.encargadoNombre}
                          {lote.notas && ` · ${lote.notas}`}
                        </p>
                        <div className="space-y-1">
                          {lote.items.map((item, j) => (
                            <div
                              key={j}
                              className="flex items-center justify-between text-xs bg-white
                                border border-gray-100 rounded-lg px-3 py-2"
                            >
                              <div className="flex-1 min-w-0">
                                <p className="font-medium text-gray-800 truncate">{item.producto}</p>
                                <p className="text-gray-400 font-mono text-[10px]">{item.codigo}</p>
                              </div>
                              <div className="flex gap-3 flex-shrink-0 text-right">
                                <span className="text-gray-500">{item.nCajas} caj</span>
                                <span className="font-bold text-[#1E8C3A]">{item.unidades} uds</span>
                                <span className="text-blue-600">{fmtPeso(item.peso_kg)}</span>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ═══════════════════════════════════════════════════════════
          MODAL: NOMBRAR CÓDIGO NUEVO
      ═══════════════════════════════════════════════════════════ */}
      {modalNombrar && (
        <div
          className="fixed inset-0 bg-black/60 flex items-end sm:items-center justify-center z-50 p-4"
          onClick={(e) => e.target === e.currentTarget && setModalNombrar(false)}
        >
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-5 space-y-4"
            onClick={(e) => e.stopPropagation()}>

            <div className="text-center">
              <p className="text-3xl mb-1">🏷️</p>
              <h3 className="font-bold text-gray-800 text-lg">Código nuevo</h3>
              <p className="text-xs text-gray-400 mt-1">
                Este código no está en el sistema.<br />
                Nómbralo para recordarlo en futuras lecturas.
              </p>
              <div className="mt-2 inline-block bg-gray-100 rounded-lg px-3 py-1">
                <code className="text-sm font-mono font-bold text-gray-700">{codigoNuevo}</code>
              </div>
            </div>

            <div className="space-y-3">
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">
                  Nombre del producto <span className="text-red-400">*</span>
                </label>
                <input
                  autoFocus
                  value={nombreNuevo}
                  onChange={(e) => setNombreNuevo(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && nombreNuevo.trim() && guardarCodigoNuevo()}
                  placeholder="Ej: Paleta Chocolate Grande"
                  className="w-full px-3 py-2.5 border-2 border-gray-200 rounded-xl text-sm
                    outline-none focus:ring-2 focus:ring-[#F5C800] focus:border-[#F5C800]"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-gray-600 mb-1">
                    Uds / caja <span className="text-red-400">*</span>
                  </label>
                  <input
                    type="number"
                    min="1"
                    value={unidadesNuevo}
                    onChange={(e) => setUnidadesNuevo(e.target.value)}
                    placeholder="24"
                    className="w-full px-3 py-2.5 border-2 border-gray-200 rounded-xl text-sm
                      text-center font-bold outline-none focus:ring-2 focus:ring-[#F5C800]"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-600 mb-1">
                    Peso ref. (kg)
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    value={pesoRefNuevo}
                    onChange={(e) => setPesoRefNuevo(e.target.value)}
                    placeholder="12.50"
                    className="w-full px-3 py-2.5 border-2 border-gray-200 rounded-xl text-sm
                      text-center outline-none focus:ring-2 focus:ring-[#F5C800]"
                  />
                </div>
              </div>
            </div>

            <div className="flex gap-2 pt-1">
              <button
                onClick={() => setModalNombrar(false)}
                disabled={guardandoCod}
                className="flex-1 py-2.5 rounded-xl border border-gray-200 text-sm text-gray-600
                  hover:bg-gray-50 active:scale-95 transition-all disabled:opacity-50"
              >
                Cancelar
              </button>
              <button
                onClick={guardarCodigoNuevo}
                disabled={guardandoCod || !nombreNuevo.trim() || !unidadesNuevo}
                className="flex-1 py-2.5 bg-[#1A1A1A] text-white rounded-xl text-sm font-bold
                  active:scale-95 transition-all disabled:opacity-50"
              >
                {guardandoCod ? "Guardando…" : "💾 Guardar"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
