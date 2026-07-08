"use client";

import { useState, useEffect, useRef } from "react";
import {
  collection, addDoc, getDocs, Timestamp, getDoc, doc, setDoc, serverTimestamp,
} from "firebase/firestore";
import { db, auth } from "@/lib/firebase";
import { useAuth } from "@/lib/auth-context";
import { PrecioProducto, LoteLoker, ProductoItem, toProductoId, toDate, resolverProductoEnCatalogo } from "@/lib/types";
import CameraScanner from "@/components/shared/CameraScanner";
import { ImageUploader, AiButton } from "@/components/despachador/shared";
import SearchableSelect from "@/components/shared/SearchableSelect";

interface ProductoLote {
  nombre:          string;
  producto_id:     string;
  cajas:           number;
  unidades:        number;
  unidadesPorCaja: number;
  total:           number;
  costoUnitario?:  number;
  reconocido:      boolean;  // false = detectado por IA sin match confiable en config/precios
}

// Fecha de hoy en formato YYYY-MM-DD (hora local del dispositivo, RD = UTC-4)
function hoyISO(): string {
  const n = new Date();
  const p = (x: number) => String(x).padStart(2, "0");
  return `${n.getFullYear()}-${p(n.getMonth() + 1)}-${p(n.getDate())}`;
}

// Convierte la fecha elegida (YYYY-MM-DD) en Timestamp. Si es hoy, conserva la
// hora actual (para que los filtros de "hoy" funcionen); si es una fecha pasada,
// usa el mediodía local para evitar saltos de día por zona horaria.
function fechaAStamp(fechaISO: string): Timestamp {
  const [y, m, d] = fechaISO.split("-").map(Number);
  const n = new Date();
  if (y === n.getFullYear() && m === n.getMonth() + 1 && d === n.getDate()) {
    return Timestamp.now();
  }
  return Timestamp.fromDate(new Date(y, m - 1, d, 12, 0, 0));
}

export default function RegistroLote() {
  const { profile } = useAuth();

  const [catalogo,    setCatalogo]    = useState<PrecioProducto[]>([]);
  // Diccionario inteligente: clave normalizada (texto detectado) → producto_id canónico ya asignado a mano
  const [aliases,     setAliases]     = useState<Record<string, string>>({});
  // Panel abierto por ítem no reconocido (keyed por producto_id del ítem, que mientras no está
  // reconocido ES la clave normalizada del texto detectado)
  const [panelAbierto, setPanelAbierto] = useState<Record<string, "vincular" | "nuevo">>({});
  const [formNuevo,    setFormNuevo]    = useState<Record<string, { codigo: string; nombre: string; precio: string }>>({});
  const [guardandoNuevo, setGuardandoNuevo] = useState<string | null>(null);
  const [selProd,     setSelProd]     = useState("");
  const [busqueda,    setBusqueda]    = useState("");
  const [showDrop,    setShowDrop]    = useState(false);
  const [cajasStr,    setCajasStr]    = useState("");
  const [unidsStr,    setUnidsStr]    = useState("");
  const [udsCajaStr,  setUdsCajaStr]  = useState("1");
  const [costoStr,    setCostoStr]    = useState("");
  // Mapa producto_id → unidadesPorCaja, leído de codigos_cajas (tabla de conversión)
  const [convMap,     setConvMap]     = useState<Record<string, number>>({});
  const [catalogoErr, setCatalogoErr] = useState<string | null>(null);
  const [items,       setItems]       = useState<ProductoLote[]>([]);
  const [proveedor,   setProveedor]   = useState("");
  const [factNum,     setFactNum]     = useState("");
  const [factOk,      setFactOk]      = useState(false);
  const [notas,       setNotas]       = useState("");
  const [fechaStr,    setFechaStr]    = useState(hoyISO());
  const [guardando,   setGuardando]   = useState(false);
  const [msg,         setMsg]         = useState<{ type: "ok" | "err"; text: string } | null>(null);
  const [guardado,    setGuardado]    = useState<LoteLoker | null>(null);
  const [waNum,       setWaNum]       = useState("");

  // Escáner del Nº de factura (código de barras)
  const [showScanner,  setShowScanner]  = useState(false);
  const [scanFocused,  setScanFocused]  = useState(false);
  const [scanValue,    setScanValue]    = useState("");
  const [showCamera,   setShowCamera]   = useState(false);
  const scanRef = useRef<HTMLInputElement>(null);

  // Escaneo de factura BON por foto (IA) — igual al picking del Despachador
  const [showFactScan,  setShowFactScan]  = useState(false);
  const [imgFactura,    setImgFactura]    = useState<{ base64: string; mimeType: string } | null>(null);
  const [previewFact,   setPreviewFact]   = useState<string | null>(null);
  const [analizandoFac, setAnalizandoFac] = useState(false);

  // Dropdown de búsqueda de productos
  const dropRef = useRef<HTMLDivElement>(null);

  // Filtra catálogo en tiempo real
  const catalogoFiltrado = catalogo.filter(p => {
    const q = busqueda.trim().toLowerCase();
    if (!q || q === selProd.toLowerCase()) return true;
    return (
      p.nombre.toLowerCase().includes(q) ||
      toProductoId(p.nombre).includes(q.replace(/\s+/g, "_"))
    );
  });

  // Producto "efectivo": el seleccionado, o el que coincide exacto con lo escrito,
  // o el único resultado del filtro. Permite agregar sin tener que tocar el dropdown.
  const prodEfectivo = selProd || (() => {
    const q = toProductoId(busqueda);
    if (!q) return "";
    const exacto = catalogo.find(p => toProductoId(p.nombre) === q);
    if (exacto) return exacto.nombre;
    if (catalogoFiltrado.length === 1) return catalogoFiltrado[0].nombre;
    return "";
  })();

  useEffect(() => {
    // Tabla de conversión cajas→unidades (compartida con SPIKINSCAN/Weight).
    // Indexada por código de barras: derivamos un mapa por producto_id (nombre normalizado).
    // Las entradas propias "prod_<producto_id>" (override del Encargado) ganan sobre las de barras.
    getDocs(collection(db, "codigos_cajas")).then((snap) => {
      const base: Record<string, number> = {};
      const overrides: Record<string, number> = {};
      snap.forEach((docu) => {
        const d = docu.data();
        const uds = Number(d.unidadesPorCaja);
        if (!uds || uds < 1) return;
        if (docu.id.startsWith("prod_")) {
          overrides[docu.id.slice(5)] = uds;
        } else if (d.producto) {
          base[toProductoId(String(d.producto))] = uds;
        }
      });
      setConvMap({ ...base, ...overrides });
    }).catch(() => { /* sin conversión → default 1 */ });

    getDoc(doc(db, "config", "precios")).then((snap) => {
      if (snap.exists()) {
        const d = snap.data();
        const prods: PrecioProducto[] = d.productos ?? [];
        setCatalogo(prods);
        setCatalogoErr(prods.length === 0 ? "El catálogo está vacío. Pide al Admin que agregue productos." : null);
        if (prods.length > 0) {
          setSelProd(prods[0].nombre);
          setBusqueda(prods[0].nombre);
        }
      } else {
        setCatalogoErr("No existe el catálogo (config/precios). Pide al Admin que lo configure.");
      }
    }).catch((e) => {
      setCatalogoErr(
        e?.code === "permission-denied"
          ? "Sin permiso para leer el catálogo. Despliega las reglas Firestore (config/*)."
          : "No se pudo cargar el catálogo de productos."
      );
    });
    getDoc(doc(db, "config", "main")).then((snap) => {
      if (snap.exists()) {
        const d = snap.data();
        const num = d.whatsappNumero ?? d.whatsappBot?.numero ?? d.whatsapp ?? "";
        setWaNum(String(num));
      }
    });

    // Diccionario inteligente: alias ya asignados a mano en sesiones anteriores
    getDocs(collection(db, "alias_productos")).then((snap) => {
      const map: Record<string, string> = {};
      snap.forEach((d) => {
        const pid = d.data().producto_id;
        if (pid) map[d.id] = pid;
      });
      setAliases(map);
    }).catch(() => { /* sin alias → sigue funcionando con match exacto/parcial normal */ });
  }, []);

  // Autocompletar uds/caja desde la tabla de conversión al fijar el producto.
  // Usa prodEfectivo (no solo selProd) para que también funcione cuando el
  // producto se resuelve al escribir el nombre exacto sin tocar el dropdown;
  // antes quedaba en "1" y el total subcontaba el stock (mismo tipo que bug #15).
  useEffect(() => {
    if (!prodEfectivo) return;
    const uds = convMap[toProductoId(prodEfectivo)];
    setUdsCajaStr(uds && uds > 1 ? String(uds) : "1");
  }, [prodEfectivo, convMap]);

  // Bug #40: cuando el producto NO tiene conversión registrada en `codigos_cajas`,
  // "Uds/caja" cae en "1" por defecto sin avisar — visualmente igual a un producto
  // que de verdad se vende de a 1 por caja. Si el Encargado no corrige el campo a
  // mano, 1 caja termina sumando 1 sola unidad al stock. Distinguimos ambos casos
  // para poder advertir en vez de fallar en silencio.
  const sinConversionConocida = !!prodEfectivo && !convMap[toProductoId(prodEfectivo)];

  // Cerrar dropdown al hacer click fuera
  useEffect(() => {
    if (!showDrop) return;
    const handler = (e: MouseEvent) => {
      if (dropRef.current && !dropRef.current.contains(e.target as Node)) {
        setShowDrop(false);
        // Si no hay producto seleccionado, restaurar busqueda al selProd anterior
        if (!selProd) setBusqueda("");
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [showDrop, selProd]);

  // Al abrir el escáner: limpiar valor anterior y enfocar
  useEffect(() => {
    if (showScanner) {
      setScanValue("");
      setTimeout(() => scanRef.current?.focus(), 80);
    }
  }, [showScanner]);

  function handleScanKey(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") {
      const val = scanValue.trim();
      if (val) {
        setFactNum(val);
        setScanValue("");
        setShowScanner(false);
      }
    }
  }

  function handleCameraResult(code: string) {
    setFactNum(code);
    setShowCamera(false);
    setShowScanner(false);
  }

  function selectProd(nombre: string) {
    setSelProd(nombre);
    setBusqueda(nombre);
    setShowDrop(false);
  }

  function agregar() {
    const prod = prodEfectivo;
    if (!prod) return;
    const cajas = Math.max(0, parseInt(cajasStr) || 0);
    const unids = Math.max(0, parseInt(unidsStr) || 0);
    if (cajas === 0 && unids === 0) {
      setMsg({ type: "err", text: "Ingresa al menos 1 caja o 1 unidad." });
      return;
    }
    setMsg(null);
    const costo  = parseFloat(costoStr) || null;
    const resuelto = resolverProductoEnCatalogo(prod, catalogo);
    const pid = resuelto.producto_id;
    // Si el campo uds/caja quedó vacío, usa la conversión conocida del producto
    const udsCaja = Math.max(1, parseInt(udsCajaStr) || convMap[pid] || 1);
    const total  = cajas * udsCaja + unids;
    setItems(prev => {
      const idx = prev.findIndex(i => i.producto_id === pid);
      if (idx >= 0) {
        return prev.map((it, i) => i === idx
          ? { ...it, cajas: it.cajas + cajas, unidades: it.unidades + unids,
              unidadesPorCaja: udsCaja, total: it.total + total,
              costoUnitario: costo ?? it.costoUnitario }
          : it
        );
      }
      // La selección viene del dropdown del catálogo → siempre reconocido
      return [...prev, { nombre: resuelto.nombre, producto_id: pid, cajas, unidades: unids,
        unidadesPorCaja: udsCaja, total, reconocido: resuelto.reconocido,
        ...(costo != null ? { costoUnitario: costo } : {}) }];
    });
    setCajasStr(""); setUnidsStr(""); setCostoStr("");
  }

  function quitarItem(idx: number) {
    setItems(prev => prev.filter((_, i) => i !== idx));
  }

  // Descarta el lote en progreso y reinicia el formulario (con confirmación si ya hay productos)
  function limpiarTodo() {
    if (items.length > 0 && !window.confirm("¿Limpiar todo el lote en progreso? Se descartarán los productos agregados.")) return;
    setItems([]);
    setProveedor(""); setFactNum(""); setFactOk(false); setNotas(""); setFechaStr(hoyISO());
    setCajasStr(""); setUnidsStr(""); setCostoStr(""); setMsg(null);
    if (catalogo.length > 0) { setSelProd(catalogo[0].nombre); setBusqueda(catalogo[0].nombre); }
    else { setSelProd(""); setBusqueda(""); }
  }

  // Edición inline de un item ya en la lista (cajas / uds-caja / unidades / costo)
  function editarItem(idx: number, campo: "cajas" | "unidadesPorCaja" | "unidades" | "costoUnitario", valor: string) {
    setItems(prev => prev.map((it, i) => {
      if (i !== idx) return it;
      if (campo === "costoUnitario") {
        const c = parseFloat(valor);
        const next = { ...it };
        if (isNaN(c) || c <= 0) delete next.costoUnitario; else next.costoUnitario = c;
        return next;
      }
      const n = Math.max(campo === "unidadesPorCaja" ? 1 : 0, parseInt(valor) || 0);
      const merged = { ...it, [campo]: campo === "unidadesPorCaja" ? Math.max(1, n) : n };
      merged.total = merged.cajas * merged.unidadesPorCaja + merged.unidades;
      return merged;
    }));
  }

  // Vuelca los productos detectados en la factura a la lista del lote (editable)
  function aplicarDetectados(detectados: ProductoItem[]) {
    let agregados = 0;
    setItems(prev => {
      const next = [...prev];
      for (const d of detectados) {
        if (!d?.nombre) continue;
        const resuelto = resolverProductoEnCatalogo(d.nombre, catalogo, aliases);
        const pid = resuelto.producto_id;
        const cajas   = Math.max(0, Math.round(Number(d.cantidad) || 0));
        if (cajas === 0) continue;
        const udsCaja = Math.max(1, convMap[pid] || 1);
        const costo   = d.precio != null && Number(d.precio) > 0 ? Number(d.precio) : undefined;
        const idx = next.findIndex(i => i.producto_id === pid);
        if (idx >= 0) {
          next[idx] = { ...next[idx], cajas: next[idx].cajas + cajas,
            total: next[idx].total + cajas * udsCaja,
            costoUnitario: costo ?? next[idx].costoUnitario };
        } else {
          next.push({ nombre: resuelto.nombre, producto_id: pid, cajas, unidades: 0,
            unidadesPorCaja: udsCaja, total: cajas * udsCaja, reconocido: resuelto.reconocido,
            ...(costo != null ? { costoUnitario: costo } : {}) });
        }
        agregados++;
      }
      return next;
    });
    return agregados;
  }

  // Re-resuelve todos los ítems aún no reconocidos contra el catálogo/alias actualizado —
  // así un producto nuevo recién registrado (o un alias recién asignado) resuelve de una
  // vez todas las filas que compartían el mismo texto detectado, sin volver a analizar la imagen.
  function reresolverPendientes(catalogoActual: PrecioProducto[], aliasesActuales: Record<string, string>) {
    setItems(prev => prev.map(it => {
      if (it.reconocido) return it;
      const r = resolverProductoEnCatalogo(it.nombre, catalogoActual, aliasesActuales);
      return { ...it, nombre: r.nombre, producto_id: r.producto_id, reconocido: r.reconocido };
    }));
  }

  function abrirPanel(item: ProductoLote, modo: "vincular" | "nuevo") {
    setPanelAbierto(prev => ({ ...prev, [item.producto_id]: modo }));
    if (modo === "nuevo") {
      setFormNuevo(prev => ({
        ...prev,
        [item.producto_id]: prev[item.producto_id] ?? {
          codigo: String(catalogo.reduce((max, p) => Math.max(max, p.codigo), 0) + 1),
          nombre: item.nombre,
          precio: String(item.costoUnitario ?? 0),
        },
      }));
    }
  }

  function cerrarPanel(item: ProductoLote) {
    setPanelAbierto(prev => { const n = { ...prev }; delete n[item.producto_id]; return n; });
  }

  // Vincula un ítem no reconocido a un producto existente del catálogo — guarda el alias
  // permanentemente para que la próxima vez que aparezca ese mismo texto se reconozca solo.
  async function vincularExistente(item: ProductoLote, elegido: PrecioProducto) {
    const claveAlias = item.producto_id; // mientras no reconocido, ES toProductoId(texto detectado)
    try {
      await setDoc(doc(db, "alias_productos", claveAlias), {
        producto_id:    elegido.producto_id,
        nombreCanonico: elegido.nombre,
        textoOriginal:  item.nombre,
        creadoPor:      profile?.nombre ?? "Encargado",
        creadoEn:       serverTimestamp(),
      });
      const nuevosAliases = { ...aliases, [claveAlias]: elegido.producto_id };
      setAliases(nuevosAliases);
      reresolverPendientes(catalogo, nuevosAliases);
      cerrarPanel(item);
    } catch {
      setMsg({ type: "err", text: "No se pudo guardar la relación. Intenta de nuevo." });
    }
  }

  // Registra un producto genuinamente nuevo en config/precios (vía endpoint server-side,
  // el Encargado no tiene permiso de escritura directo ahí) y re-resuelve lo pendiente.
  async function registrarProductoNuevo(item: ProductoLote) {
    const form = formNuevo[item.producto_id];
    if (!form) return;
    const codigo = parseInt(form.codigo, 10);
    const precio = parseFloat(form.precio);
    if (!form.nombre.trim() || !Number.isFinite(codigo) || codigo <= 0 || !Number.isFinite(precio) || precio < 0) {
      setMsg({ type: "err", text: "Completa código, nombre y precio válidos para el producto nuevo." });
      return;
    }
    setGuardandoNuevo(item.producto_id);
    try {
      const idToken = await auth.currentUser?.getIdToken();
      if (!idToken) throw new Error("Sesión inválida, vuelve a iniciar sesión.");
      const res = await fetch("/api/registrar-producto-nuevo", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ idToken, codigo, nombre: form.nombre.trim(), precio }),
      });
      const data = await res.json();
      if (!res.ok || data.error) throw new Error(data.error ?? "Error al registrar el producto.");
      const catalogoActualizado: PrecioProducto[] = data.catalogo;
      setCatalogo(catalogoActualizado);
      reresolverPendientes(catalogoActualizado, aliases);
      cerrarPanel(item);
      setMsg({ type: "ok", text: `Producto "${form.nombre.trim()}" registrado en el catálogo.` });
    } catch (e) {
      setMsg({ type: "err", text: e instanceof Error ? e.message : "Error al registrar el producto." });
    } finally {
      setGuardandoNuevo(null);
    }
  }

  async function analizarFactura() {
    if (!imgFactura) return;
    setAnalizandoFac(true);
    setMsg(null);
    try {
      const res = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tipo: "factura", imageBase64: imgFactura.base64, mimeType: imgFactura.mimeType }),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      const dets: ProductoItem[] = Array.isArray(data.productos) ? data.productos : [];
      if (dets.length === 0) {
        setMsg({ type: "err", text: "No se detectaron productos. Agrégalos manualmente." });
        return;
      }
      const n = aplicarDetectados(dets);
      if (data.cliente && typeof data.cliente === "string" && !proveedor.trim()) setProveedor(data.cliente);
      setImgFactura(null); setPreviewFact(null); setShowFactScan(false);
      setMsg({ type: "ok", text: `Factura analizada: ${n} producto${n !== 1 ? "s" : ""} agregado${n !== 1 ? "s" : ""}. Revisa cantidades y guarda.` });
    } catch (e) {
      setMsg({ type: "err", text: e instanceof Error ? e.message : "Error al analizar la factura." });
    } finally {
      setAnalizandoFac(false);
    }
  }

  async function guardar() {
    if (items.length === 0) {
      setMsg({ type: "err", text: "Agrega al menos un producto." });
      return;
    }
    if (items.some(i => !i.reconocido)) {
      setMsg({ type: "err", text: "Hay productos no reconocidos — resuélvelos antes de guardar el lote." });
      return;
    }
    setGuardando(true);
    setMsg(null);
    try {
      const lotesSnap = await getDocs(collection(db, "lotes_loker"));
      // Correlativo robusto: max(numero existente) + 1, no size + 1.
      // Con size+1, borrar un lote reutiliza un número y choca con uno existente.
      let maxNum = 0;
      lotesSnap.forEach((d) => {
        const n = parseInt(String(d.data().numero ?? "").replace(/\D/g, ""), 10);
        if (!isNaN(n) && n > maxNum) maxNum = n;
      });
      const numero    = `#${String(maxNum + 1).padStart(3, "0")}`;
      const ts        = fechaAStamp(fechaStr);
      const nombre    = profile?.nombre ?? "Encargado";
      const uid       = profile?.uid    ?? "";

      const loteData: Omit<LoteLoker, "id"> = {
        numero,
        ...(proveedor.trim() ? { proveedor: proveedor.trim() } : {}),
        ...(factNum.trim()   ? { facturaNumero: factNum.trim() } : {}),
        facturaEntregada: factOk,
        // unidadesPorCaja no se guarda en el lote (LoteLoker estable); el total ya viene convertido
        productos: items.map((it) => ({
          nombre:      it.nombre,
          producto_id: it.producto_id,
          cajas:       it.cajas,
          unidades:    it.unidades,
          total:       it.total,
          ...(it.costoUnitario != null ? { costoUnitario: it.costoUnitario } : {}),
        })),
        registradoPor:   nombre,
        registradoPorId: uid,
        timestamp:       ts,
        ...(notas.trim() ? { notas: notas.trim() } : {}),
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

      // Persistir las conversiones editadas en codigos_cajas (key prod_<producto_id>),
      // solo cuando el factor es > 1 y difiere del valor leído. Falla en silencio: nunca
      // debe tumbar el guardado del lote ya confirmado.
      try {
        const nuevos: Record<string, number> = {};
        await Promise.all(items
          .filter(it => it.unidadesPorCaja > 1 && convMap[it.producto_id] !== it.unidadesPorCaja)
          .map(it => {
            nuevos[it.producto_id] = it.unidadesPorCaja;
            return setDoc(doc(db, "codigos_cajas", `prod_${it.producto_id}`), {
              codigo:          `prod_${it.producto_id}`,
              producto:        it.nombre,
              unidadesPorCaja: it.unidadesPorCaja,
              creadoPor:       nombre,
              creadoEn:        serverTimestamp(),
            }, { merge: true });
          })
        );
        if (Object.keys(nuevos).length > 0) setConvMap(prev => ({ ...prev, ...nuevos }));
      } catch { /* permisos u otro fallo: la conversión no se persiste, el lote ya se guardó */ }

      setGuardado({ ...loteData, id: loteRef.id });
      setItems([]); setProveedor(""); setFactNum(""); setFactOk(false); setNotas(""); setFechaStr(hoyISO());
      setMsg({ type: "ok", text: `Lote ${numero} guardado correctamente.` });
    } catch (e) {
      setMsg({ type: "err", text: e instanceof Error ? e.message : "Error al guardar." });
    } finally {
      setGuardando(false);
    }
  }

  function buildWa(lote: LoteLoker) {
    const fecha = toDate(lote.timestamp).toLocaleDateString("es-MX", { day: "2-digit", month: "short", year: "numeric" });
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

  const hayNoReconocidos = items.some(i => !i.reconocido);

  return (
    <div className="space-y-4 max-w-lg mx-auto">

      {/* Banner de alerta — no se puede cerrar, solo desaparece cuando todo queda resuelto */}
      {hayNoReconocidos && (
        <div className="sticky top-0 z-30 bg-red-600 text-white px-4 py-2.5 rounded-xl shadow-lg
          flex items-center gap-2 text-sm font-bold">
          <span className="text-lg flex-shrink-0">⚠️</span>
          <span>Hay productos no reconocidos en la lista — resuélvelos (vincula o registra como
            nuevos) antes de poder guardar el lote.</span>
        </div>
      )}

      {/* Escáner por cámara */}
      {showCamera && (
        <CameraScanner
          title="Escanear Nº Factura"
          onResult={handleCameraResult}
          onClose={() => setShowCamera(false)}
        />
      )}

      <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">

        {/* ── Header con botón escáner ── */}
        <div className="px-4 py-3 bg-gradient-to-r from-blue-600 to-blue-800 flex items-center justify-between gap-2">
          <div>
            <h2 className="text-white font-bold text-sm">📦 Registrar nuevo lote</h2>
            <p className="text-blue-200 text-xs mt-0.5">El número se genera automáticamente</p>
          </div>
          <button
            type="button"
            title="Escanear número de factura"
            onClick={() => setShowScanner(v => !v)}
            className={`w-9 h-9 rounded-lg flex items-center justify-center text-base flex-shrink-0 transition-all active:scale-95 ${
              showScanner
                ? "bg-white text-blue-700 shadow-inner"
                : "bg-white/20 border border-white/30 text-white hover:bg-white/30"
            }`}
          >
            🔲
          </button>
        </div>

        {/* ── Panel escáner de factura ── */}
        {showScanner && (
          <div className="bg-blue-50 border-b border-blue-200 px-4 py-3 space-y-2">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <span className="text-sm font-semibold text-blue-800">📄 Escanear Nº Factura</span>
                <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                  scanFocused ? "bg-blue-100 text-blue-700" : "bg-gray-100 text-gray-500"
                }`}>
                  {scanFocused ? "Listo ●" : "Sin foco"}
                </span>
              </div>
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => setShowCamera(true)}
                  title="Escanear con cámara"
                  className="text-xs bg-blue-700 hover:bg-blue-800 active:scale-95 text-white
                    px-2.5 py-1 rounded-lg transition-all font-medium"
                >
                  📷 Cámara
                </button>
                <button
                  type="button"
                  onClick={() => setShowScanner(false)}
                  className="text-xs text-blue-600 hover:text-blue-800 font-semibold px-2 py-1 rounded"
                >
                  ✕
                </button>
              </div>
            </div>
            <input
              ref={scanRef}
              value={scanValue}
              onChange={(e) => setScanValue(e.target.value)}
              onFocus={() => setScanFocused(true)}
              onBlur={() => setScanFocused(false)}
              onKeyDown={handleScanKey}
              placeholder="Apunta el escáner HID o escribe el número…"
              autoComplete="off"
              spellCheck={false}
              className="w-full border border-blue-300 rounded-lg px-3 py-2 text-sm
                focus:outline-none focus:ring-2 focus:ring-blue-400 bg-white font-mono"
            />
            <p className="text-xs text-blue-600">
              Escáner HID: apunta y presiona el gatillo · Cámara: toca 📷 para usar la cámara del dispositivo.
            </p>
          </div>
        )}

        <div className="p-4 space-y-4">

          {/* ── Fecha de recepción ── */}
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">
              Fecha de recepción
            </label>
            <input
              type="date"
              value={fechaStr}
              max={hoyISO()}
              onChange={(e) => setFechaStr(e.target.value)}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm
                focus:outline-none focus:ring-2 focus:ring-blue-400"
            />
          </div>

          {/* ── Proveedor y factura ── */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">
                Proveedor <span className="text-gray-400 font-normal">(opcional)</span>
              </label>
              <input
                value={proveedor} onChange={(e) => setProveedor(e.target.value)}
                placeholder="Nombre del proveedor"
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm
                  focus:outline-none focus:ring-2 focus:ring-blue-400"
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
                  focus:outline-none focus:ring-2 focus:ring-blue-400"
              />
            </div>
          </div>

          {/* ── Factura entregada ── */}
          <button
            type="button"
            onClick={() => setFactOk(v => !v)}
            className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl border-2
              transition-all duration-100 active:scale-95 ${
              factOk
                ? "border-blue-400 bg-blue-50 text-blue-800"
                : "border-gray-200 bg-gray-50 text-gray-500"
            }`}
          >
            <span className={`w-5 h-5 rounded flex items-center justify-center text-xs font-bold flex-shrink-0 ${
              factOk ? "bg-blue-500 text-white" : "bg-white border-2 border-gray-300 text-transparent"
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

          {/* ── Escanear factura BON con IA (igual al picking del Despachador) ── */}
          <div className="border border-blue-200 rounded-xl overflow-hidden">
            <button
              type="button"
              onClick={() => setShowFactScan(v => !v)}
              className="w-full flex items-center justify-between gap-2 px-4 py-2.5 bg-blue-50
                text-blue-800 active:scale-[0.99] transition-all"
            >
              <span className="text-sm font-semibold">📄 Escanear factura BON (IA)</span>
              <span className="text-blue-500 text-xs">{showFactScan ? "▲ Ocultar" : "▼ Abrir"}</span>
            </button>
            {showFactScan && (
              <div className="p-3 space-y-3 border-t border-blue-100">
                <p className="text-xs text-gray-500">
                  Toma o sube una foto de la factura. La IA extrae los productos y los agrega a la lista;
                  luego puedes <strong>ajustar las cantidades manualmente</strong> antes de guardar.
                </p>
                <ImageUploader
                  preview={previewFact}
                  onFile={(b, m, p) => { setImgFactura({ base64: b, mimeType: m }); setPreviewFact(p); }}
                  onClear={() => { setImgFactura(null); setPreviewFact(null); }}
                />
                <AiButton
                  onClick={analizarFactura}
                  loading={analizandoFac}
                  disabled={!imgFactura}
                  label="Analizar factura"
                />
              </div>
            )}
          </div>

          {/* ── Agregar producto con buscador inteligente ── */}
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-2">Agregar producto</label>

            {catalogoErr && (
              <div className="mb-2 text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
                ⚠️ {catalogoErr}
              </div>
            )}

            {/* Buscador tipo "configuración del celular" */}
            <div className="relative mb-2" ref={dropRef}>
              <input
                type="text"
                value={busqueda}
                onChange={(e) => {
                  const val = e.target.value;
                  setBusqueda(val);
                  setShowDrop(true);
                  // Si el usuario edita algo diferente al producto seleccionado, deselecciona
                  if (val !== selProd) setSelProd("");
                }}
                onFocus={() => setShowDrop(true)}
                placeholder={
                  catalogo.length === 0
                    ? "Sin catálogo configurado"
                    : "🔍 Buscar producto por nombre o código…"
                }
                disabled={catalogo.length === 0}
                className={`w-full border rounded-lg px-3 py-2 text-sm
                  focus:outline-none focus:ring-2 focus:ring-blue-400 pr-8 ${
                  selProd
                    ? "border-blue-400 bg-blue-50 text-blue-900 font-medium"
                    : "border-gray-300 bg-white"
                }`}
              />
              {/* Botón limpiar selección */}
              {busqueda && (
                <button
                  type="button"
                  onClick={() => { setBusqueda(""); setSelProd(""); setShowDrop(true); }}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400
                    hover:text-gray-600 text-lg leading-none w-5 h-5 flex items-center justify-center"
                >
                  ×
                </button>
              )}

              {/* Dropdown de resultados */}
              {showDrop && catalogo.length > 0 && (
                <div className="absolute z-20 left-0 right-0 top-full mt-1 bg-white border border-gray-200
                  rounded-xl shadow-2xl max-h-52 overflow-y-auto">
                  {catalogoFiltrado.length === 0 ? (
                    <div className="px-4 py-3 text-sm text-gray-400 text-center">
                      Sin resultados para &ldquo;{busqueda}&rdquo;
                    </div>
                  ) : (
                    catalogoFiltrado.map(p => (
                      <button
                        key={p.nombre}
                        type="button"
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => selectProd(p.nombre)}
                        className={`w-full text-left px-3 py-2.5 text-sm border-b border-gray-100
                          last:border-0 transition-colors ${
                          selProd === p.nombre
                            ? "bg-blue-50 text-blue-800 font-semibold"
                            : "text-gray-800 hover:bg-blue-50 active:bg-blue-100"
                        }`}
                      >
                        <span className="flex items-center justify-between gap-2">
                          <span className="flex-1">{p.nombre}</span>
                          {selProd === p.nombre && (
                            <span className="text-blue-500 text-base flex-shrink-0">✓</span>
                          )}
                        </span>
                      </button>
                    ))
                  )}
                </div>
              )}
            </div>

            {/* Cantidad: cajas × uds/caja + unidades · costo */}
            <div className="flex flex-wrap gap-2 items-start">
              <div className="flex-1 min-w-[64px]">
                <input
                  type="number" value={cajasStr}
                  onChange={(e) => setCajasStr(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && agregar()}
                  placeholder="Cajas" min="0"
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm
                    focus:outline-none focus:ring-2 focus:ring-blue-400"
                />
                <p className="text-xs text-gray-400 mt-0.5 text-center">cajas</p>
              </div>
              <div className="flex items-start pt-2.5 text-gray-400 font-bold">×</div>
              <div className="flex-1 min-w-[64px]">
                <input
                  type="number" value={udsCajaStr}
                  onChange={(e) => setUdsCajaStr(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && agregar()}
                  placeholder="Uds/caja" min="1"
                  className={`w-full rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 ${
                    sinConversionConocida
                      ? "border-2 border-amber-400 bg-amber-50 focus:ring-amber-400"
                      : "border border-blue-300 bg-blue-50/40 focus:ring-blue-400"
                  }`}
                />
                <p className={`text-xs mt-0.5 text-center ${sinConversionConocida ? "text-amber-600 font-semibold" : "text-gray-400"}`}>
                  uds/caja
                </p>
              </div>
              <div className="flex items-start pt-2.5 text-gray-400 font-bold">+</div>
              <div className="flex-1 min-w-[64px]">
                <input
                  type="number" value={unidsStr}
                  onChange={(e) => setUnidsStr(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && agregar()}
                  placeholder="Unidades" min="0"
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm
                    focus:outline-none focus:ring-2 focus:ring-blue-400"
                />
                <p className="text-xs text-gray-400 mt-0.5 text-center">unidades</p>
              </div>
              <div className="flex items-start pt-2.5 text-gray-300 font-bold">·</div>
              <div className="flex-1 min-w-[64px]">
                <input
                  type="number" value={costoStr}
                  onChange={(e) => setCostoStr(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && agregar()}
                  placeholder="Costo" min="0" step="0.01"
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm
                    focus:outline-none focus:ring-2 focus:ring-blue-400"
                />
                <p className="text-xs text-gray-400 mt-0.5 text-center">$/unidad</p>
              </div>
              <button
                type="button" onClick={agregar}
                disabled={!prodEfectivo || catalogo.length === 0}
                className="px-4 py-2 bg-blue-600 text-white rounded-lg text-lg font-bold
                  active:scale-95 transition-all duration-100 self-start disabled:opacity-50"
              >
                +
              </button>
            </div>

            {/* Preview en vivo del total convertido */}
            {((parseInt(cajasStr) || 0) > 0 || (parseInt(unidsStr) || 0) > 0) && (
              <p className="text-xs text-blue-700 mt-1.5 font-medium">
                = {(parseInt(cajasStr) || 0) * Math.max(1, parseInt(udsCajaStr) || 1) + (parseInt(unidsStr) || 0)} unidades
                {(parseInt(cajasStr) || 0) > 0 && (
                  <span className="text-gray-400 font-normal">
                    {" "}({parseInt(cajasStr) || 0} × {Math.max(1, parseInt(udsCajaStr) || 1)}
                    {(parseInt(unidsStr) || 0) > 0 ? ` + ${parseInt(unidsStr) || 0}` : ""})
                  </span>
                )}
              </p>
            )}
            {sinConversionConocida && (parseInt(cajasStr) || 0) > 0 && (
              <p className="text-xs text-amber-700 font-semibold mt-1 flex items-start gap-1">
                <span>⚠️</span>
                <span>
                  "{prodEfectivo}" no tiene una conversión caja→unidades registrada — "uds/caja" quedó en{" "}
                  {Math.max(1, parseInt(udsCajaStr) || 1)} por defecto. Confirma el número real antes de agregar
                  (o pide a Admin → Gestión de Códigos que lo registre para la próxima vez).
                </span>
              </p>
            )}
          </div>

          {/* ── Lista de productos del lote (editable inline) ── */}
          {items.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs font-semibold text-gray-600">
                Productos en este lote ({items.length}) · toca los campos para editar:
              </p>
              {items.map((it, idx) => {
                // Bug #40: mismo caso que el selector de arriba, pero para ítems ya
                // agregados — incluye los que llegaron por "Escanear factura BON (IA)",
                // que nunca pasan por el aviso del selector manual.
                const itemSinConversion = it.cajas > 0 && it.unidadesPorCaja === 1 && !convMap[it.producto_id];
                return (
                <div key={it.producto_id}
                  className={it.reconocido
                    ? "bg-emerald-50 border border-emerald-200 rounded-xl px-3 py-2.5"
                    : "bg-red-50 border-2 border-red-300 rounded-xl px-3 py-2.5"}
                >
                  <div className="flex items-center gap-2">
                    <p className={`text-sm font-medium truncate flex-1 min-w-0 ${
                      it.reconocido ? "text-emerald-900" : "text-red-900"}`}>{it.nombre}</p>
                    <span className={`text-xs font-bold tabular-nums flex-shrink-0 ${
                      it.reconocido ? "text-emerald-700" : "text-red-700"}`}>
                      {it.total} uds
                    </span>
                    <button
                      onClick={() => quitarItem(idx)}
                      title="Quitar"
                      className="text-red-400 hover:text-red-600 active:scale-95 transition-all
                        text-xl leading-none flex-shrink-0 w-7 h-7 flex items-center justify-center"
                    >
                      ×
                    </button>
                  </div>
                  {!it.reconocido && (
                    <span className="inline-block text-[11px] font-bold text-red-700 bg-red-100
                      border border-red-200 rounded-full px-2 py-0.5 mt-1">
                      <span className="pb-icon-pulse inline-block">⚠️</span> No reconocido
                    </span>
                  )}
                  {itemSinConversion && (
                    <span className="inline-block text-[11px] font-bold text-amber-700 bg-amber-100
                      border border-amber-200 rounded-full px-2 py-0.5 mt-1">
                      ⚠️ Sin conversión — confirma "uds/caja", quedó en 1 por defecto
                    </span>
                  )}
                  <div className="flex flex-wrap items-end gap-1.5 mt-2">
                    <label className="flex flex-col">
                      <span className="text-[10px] text-gray-400 mb-0.5">cajas</span>
                      <input
                        type="number" min="0" value={it.cajas}
                        onChange={(e) => editarItem(idx, "cajas", e.target.value)}
                        className="w-16 border border-gray-300 rounded-lg px-2 py-1.5 text-sm
                          focus:outline-none focus:ring-2 focus:ring-emerald-400 bg-white"
                      />
                    </label>
                    <span className="text-gray-400 font-bold pb-1.5">×</span>
                    <label className="flex flex-col">
                      <span className="text-[10px] text-gray-400 mb-0.5">uds/caja</span>
                      <input
                        type="number" min="1" value={it.unidadesPorCaja}
                        onChange={(e) => editarItem(idx, "unidadesPorCaja", e.target.value)}
                        className={`w-16 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-2 ${
                          itemSinConversion
                            ? "border-2 border-amber-400 bg-amber-50 focus:ring-amber-400"
                            : "border border-emerald-300 bg-emerald-50/40 focus:ring-emerald-400"
                        }`}
                      />
                    </label>
                    <span className="text-gray-400 font-bold pb-1.5">+</span>
                    <label className="flex flex-col">
                      <span className="text-[10px] text-gray-400 mb-0.5">unidades</span>
                      <input
                        type="number" min="0" value={it.unidades}
                        onChange={(e) => editarItem(idx, "unidades", e.target.value)}
                        className="w-16 border border-gray-300 rounded-lg px-2 py-1.5 text-sm
                          focus:outline-none focus:ring-2 focus:ring-emerald-400 bg-white"
                      />
                    </label>
                    <span className="text-gray-300 font-bold pb-1.5">·</span>
                    <label className="flex flex-col">
                      <span className="text-[10px] text-gray-400 mb-0.5">$/ud</span>
                      <input
                        type="number" min="0" step="0.01"
                        value={it.costoUnitario ?? ""}
                        placeholder="—"
                        onChange={(e) => editarItem(idx, "costoUnitario", e.target.value)}
                        className="w-20 border border-gray-300 rounded-lg px-2 py-1.5 text-sm
                          focus:outline-none focus:ring-2 focus:ring-emerald-400 bg-white"
                      />
                    </label>
                  </div>
                  {it.costoUnitario != null && (
                    <p className="text-xs text-amber-600 font-semibold mt-1">
                      ${it.costoUnitario.toFixed(2)}/ud · ${(it.costoUnitario * it.total).toFixed(2)} total
                    </p>
                  )}

                  {/* ── Resolución de "no reconocido": vincular a existente o registrar nuevo ── */}
                  {!it.reconocido && (
                    <div className="mt-2 pt-2 border-t border-red-200">
                      {!panelAbierto[it.producto_id] && (
                        <div className="flex gap-1.5">
                          <button
                            type="button"
                            onClick={() => abrirPanel(it, "vincular")}
                            className="flex-1 text-xs font-semibold bg-white border border-red-300
                              text-red-700 rounded-lg py-1.5 active:scale-95 transition-all"
                          >
                            🔗 Vincular a existente
                          </button>
                          <button
                            type="button"
                            onClick={() => abrirPanel(it, "nuevo")}
                            className="flex-1 text-xs font-semibold bg-red-600 text-white
                              rounded-lg py-1.5 active:scale-95 transition-all"
                          >
                            🆕 Registrar nuevo
                          </button>
                        </div>
                      )}

                      {panelAbierto[it.producto_id] === "vincular" && (
                        <div className="space-y-1.5">
                          <SearchableSelect
                            value=""
                            onChange={(pid) => {
                              const elegido = catalogo.find(p => p.producto_id === pid);
                              if (elegido) vincularExistente(it, elegido);
                            }}
                            options={catalogo.map(p => ({ id: p.producto_id, label: p.nombre }))}
                            placeholder="Buscar producto…"
                            emptyLabel="Selecciona el producto correcto…"
                          />
                          <button
                            type="button"
                            onClick={() => cerrarPanel(it)}
                            className="text-xs text-gray-500 hover:text-gray-700"
                          >
                            Cancelar
                          </button>
                        </div>
                      )}

                      {panelAbierto[it.producto_id] === "nuevo" && formNuevo[it.producto_id] && (
                        <div className="space-y-1.5">
                          <div className="flex gap-1.5">
                            <input
                              value={formNuevo[it.producto_id].codigo}
                              onChange={(e) => setFormNuevo(prev => ({ ...prev,
                                [it.producto_id]: { ...prev[it.producto_id], codigo: e.target.value } }))}
                              placeholder="Código" inputMode="numeric"
                              className="w-16 border border-red-300 rounded-lg px-2 py-1.5 text-sm bg-white"
                            />
                            <input
                              value={formNuevo[it.producto_id].nombre}
                              onChange={(e) => setFormNuevo(prev => ({ ...prev,
                                [it.producto_id]: { ...prev[it.producto_id], nombre: e.target.value } }))}
                              placeholder="Nombre del producto"
                              className="flex-1 border border-red-300 rounded-lg px-2 py-1.5 text-sm bg-white"
                            />
                          </div>
                          <div className="flex gap-1.5 items-center">
                            <input
                              value={formNuevo[it.producto_id].precio}
                              onChange={(e) => setFormNuevo(prev => ({ ...prev,
                                [it.producto_id]: { ...prev[it.producto_id], precio: e.target.value } }))}
                              placeholder="Precio" type="number" min="0" step="0.01"
                              className="w-24 border border-red-300 rounded-lg px-2 py-1.5 text-sm bg-white"
                            />
                            <span className="text-[11px] text-gray-400 flex-1">
                              provisional — Admin lo puede ajustar en Configuración
                            </span>
                          </div>
                          <div className="flex gap-1.5">
                            <button
                              type="button"
                              onClick={() => registrarProductoNuevo(it)}
                              disabled={guardandoNuevo === it.producto_id}
                              className="flex-1 text-xs font-bold bg-red-600 text-white rounded-lg py-1.5
                                active:scale-95 transition-all disabled:opacity-50"
                            >
                              {guardandoNuevo === it.producto_id ? "Guardando…" : "✓ Confirmar producto nuevo"}
                            </button>
                            <button
                              type="button"
                              onClick={() => cerrarPanel(it)}
                              disabled={guardandoNuevo === it.producto_id}
                              className="text-xs text-gray-500 hover:text-gray-700 px-2"
                            >
                              Cancelar
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
                );
              })}
            </div>
          )}

          {/* ── Notas ── */}
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

          {/* ── Registrado por ── */}
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

          {items.length > 0 && items.some(i => i.costoUnitario != null) && (
            <div className="flex items-center justify-between bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
              <span className="text-xs text-amber-700 font-medium">Inversión total estimada:</span>
              <span className="text-sm font-bold text-amber-800">
                ${items.reduce((s, i) => s + (i.costoUnitario ?? 0) * i.total, 0).toFixed(2)}
              </span>
            </div>
          )}

          <button
            onClick={guardar}
            disabled={guardando || items.length === 0 || hayNoReconocidos}
            className="w-full bg-gradient-to-r from-emerald-600 to-emerald-800 hover:from-emerald-500
              hover:to-emerald-700 text-white font-bold py-3 rounded-xl text-sm transition-all
              duration-100 active:scale-95 disabled:opacity-60"
          >
            {guardando ? "Guardando…" : `Registrar lote (${items.length} producto${items.length !== 1 ? "s" : ""})`}
          </button>

          {(items.length > 0 || proveedor.trim() || factNum.trim() || notas.trim()) && (
            <button
              type="button"
              onClick={limpiarTodo}
              disabled={guardando}
              className="w-full py-2.5 rounded-xl border border-gray-200 text-sm text-gray-500
                hover:bg-gray-50 hover:text-red-600 active:scale-95 transition-all duration-100 disabled:opacity-60"
            >
              Limpiar todo
            </button>
          )}
        </div>
      </div>

      {/* ── Tarjeta de éxito + WhatsApp ── */}
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
                <span className="font-medium text-gray-800 flex-1 truncate mr-2">{p.nombre}</span>
                <div className="text-right flex-shrink-0">
                  <span className="text-emerald-700 font-semibold">
                    {[p.cajas > 0 ? `${p.cajas} caj` : null, p.unidades > 0 ? `${p.unidades} uds` : null]
                      .filter(Boolean).join(" + ")}
                  </span>
                  {p.costoUnitario != null && (
                    <p className="text-xs text-amber-600">
                      ${p.costoUnitario.toFixed(2)}/ud · ${(p.costoUnitario * p.total).toFixed(2)}
                    </p>
                  )}
                </div>
              </div>
            ))}
            {guardado.productos.some(p => p.costoUnitario != null) && (
              <div className="flex items-center justify-between bg-amber-50 rounded-lg px-3 py-2">
                <span className="text-xs font-semibold text-amber-700">Total invertido:</span>
                <span className="text-sm font-bold text-amber-800">
                  ${guardado.productos.reduce((s, p) => s + (p.costoUnitario ?? 0) * p.total, 0).toFixed(2)}
                </span>
              </div>
            )}
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
