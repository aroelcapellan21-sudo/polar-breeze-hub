export type UserRole = "admin" | "despachador" | "chofer" | "encargado";

export interface InventarioBaseItem {
  nombre:      string;
  producto_id: string;
  cantidad:    number;
  codigo?:     number;  // lo agrega BON (api/index.js) al despachar — preservar, nunca soltar en el Hub
}

export interface UserProfile {
  uid: string;
  email: string;
  role: UserRole;
  nombre: string;
  ficha?: string;
  telefono?: string;
  activo?: boolean;
  createdAt: Date;
  inventario_base?:    InventarioBaseItem[];
  inventarioBaseDate?: Date | { seconds: number };
}

export interface SpikinScanRecord {
  id?: string;
  despachadorId: string;
  despachadorNombre: string;
  producto: string;
  cantidad: number;
  destino: string;
  timestamp: Date | { seconds: number };
  estado: "pendiente" | "despachado" | "entregado";
}

export interface FacturaScanRecord {
  id?: string;
  despachadorId: string;
  despachadorNombre: string;
  facturaNumero: string;
  cliente: string;
  monto: number;
  timestamp: Date | { seconds: number };
  estado: "pendiente" | "procesada" | "pagada";
}

export interface ImbentarioRecord {
  id?: string;
  choferId: string;
  choferNombre: string;
  vehiculo: string;
  producto: string;
  cantidadCargada: number;
  cantidadEntregada: number;
  cajas?: number;
  peso?: number;
  monto?: number;
  timestamp: Date | { seconds: number };
  ruta: string;
}

export interface WeightAlert {
  id?: string;
  choferId: string;
  choferNombre: string;
  producto: string;
  pesoCargado: number;
  pesoEntregado: number;
  diferencia: number;
  porcentaje: number;
  timestamp: Date | { seconds: number };
  severity: "warning" | "critical";
}

// ─── FacturaScan Pro — producto individual ────────────────────────────────────

export interface ProductoItem {
  nombre:   string;
  cantidad: number;   // unidades sueltas
  cajas?:   number;   // número de cajas (cuarto frío)
  unidad?:  string;
  peso?:    number | null;
  precio?:  number | null;
  puntos?:  number | null;
  visto?:   "ok" | "mal" | null;
}

// ─── Talonario — registro de movimiento por producto ──────────────────────────

export interface TalonarioDoc {
  id?:               string;
  choferId:          string;
  choferNombre:      string;
  choferFicha?:      string;
  productos:         ProductoItem[];
  observaciones?:    string;
  tipo:              "retirada" | "agregada";
  fuente:            "cuarto_frio" | "despacho" | "admin";
  despachadorId:     string;
  despachadorNombre: string;
  timestamp:         Date | { seconds: number };
}

// ─── Puntos por producto (config/puntos) ──────────────────────────────────────

export interface PuntoProducto {
  nombre:  string;
  puntos:  number;
}

export interface PuntosConfig {
  productos: PuntoProducto[];
  meta?:     number;
}

// ─── Precios de venta (config/precios) ────────────────────────────────────────

export interface PrecioProducto {
  codigo:      number;
  nombre:      string;
  producto_id: string;   // toProductoId(nombre)
  precio:      number;
  moneda:      string;   // "RD$"
}

export interface PreciosConfig {
  productos:     PrecioProducto[];
  moneda:        string;
  actualizadoEl?: Date | { seconds: number };
}

// ─── Colecciones adicionales de FacturaScan ──────────────────────────────────

/** Documento session/despacho — resumen de la sesión activa */
export interface FsSession {
  totalDespachos?: number;
  totalMonto?:     number;
  totalUnidades?:  number;
  totalPeso?:      number;
  fecha?:          Date | { seconds: number };
  estado?:         string;
  despachador?:    string;
  [key: string]:   unknown;
}

/** Colección drivers — choferes registrados en FacturaScan */
export interface FsDriver {
  id?:             string;
  nombre?:         string;
  ficha?:          string;
  vehiculo?:       string;
  placa?:          string;
  totalEntregado?: number;
  totalCargado?:   number;
  totalPeso?:      number;
  activo?:         boolean;
  rutas?:          string[];
  [key: string]:   unknown;
}

/** Colección history — registro histórico de FacturaScan */
export interface FsHistory {
  id?:               string;
  tipo?:             string;   // "despacho" | "factura" | "peso" | "inventario"
  timestamp?:        Date | { seconds: number };
  monto?:            number;
  producto?:         string;
  cantidad?:         number;
  peso?:             number;
  choferNombre?:     string;
  choferId?:         string;
  despachadorNombre?: string;
  cliente?:          string;
  facturaNumero?:    string;
  [key: string]:     unknown;
}

/** Documento config/main — configuración global de FacturaScan */
export interface FsConfig {
  nombreEmpresa?:      string;
  maxDiferenciaPeso?:  number;
  alertaWarning?:      number;   // % de diferencia para warning
  alertaCritical?:     number;   // % de diferencia para crítico
  moneda?:             string;
  [key: string]:       unknown;
}

// ─── Inventario Loker — ledger inmutable de movimientos ───────────────────────

export interface MovimientoLoker {
  id?: string;
  tipo: "entrada_interior" | "entrada_consignacion_inicial" | "devolucion_chofer" | "salida_despacho" | "merma" | "ajuste";
  categoria?: "retiro_despacho" | "agregado_1" | "agregado_0";
  generaPuntos?: boolean;
  producto_id: string;
  nombre: string;
  cantidad: number;   // positivo = entrada, negativo = salida
  responsable: string;
  timestamp: Date | { seconds: number };
  notas?: string;
  motivo?: string;
  // poblados en salida_despacho y devolucion_chofer
  choferId?: string;
  choferNombre?: string;
  // referencia al lote de origen (entrada_interior desde encargado)
  loteNumero?: string;
  loteId?: string;
}

// ─── Lote de almacén (colección lotes_loker) ─────────────────────────────────

export interface LoteLoker {
  id?: string;
  numero: string;           // "#001", "#002", …
  proveedor?: string;
  facturaNumero?: string;
  facturaEntregada: boolean;
  productos: {
    nombre:        string;
    producto_id:   string;
    cajas:         number;
    unidades:      number;
    total:         number;    // cajas + unidades (usado en movimientos_loker)
    costoUnitario?: number;   // costo real por unidad en este lote
  }[];
  registradoPor:   string;
  registradoPorId: string;
  timestamp: Date | { seconds: number };
  notas?: string;
}

// ─── Nota de crédito (colección notas_credito) ───────────────────────────────

export interface NotaCredito {
  id?: string;
  numero: string;            // "NC-001", "NC-002", …
  loteId?: string;
  loteNumero?: string;
  facturaNumero?: string;
  proveedor?: string;
  motivo: string;            // "Productos dañados" | "Faltantes" | "Otro"
  productos: {
    nombre:      string;
    producto_id: string;
    cantidad:    number;
    costoUnitario?: number;
    subtotal?:   number;
  }[];
  totalUnidades: number;
  totalMonto?:   number;
  registradoPor:   string;
  registradoPorId: string;
  timestamp: Date | { seconds: number };
  notas?: string;
  estado: "pendiente" | "aprobada" | "rechazada";
}

// ─── Códigos de cajas (colección codigos_cajas) ───────────────────────────────

export interface CodigoCaja {
  codigo:          string;            // código de barras — es el id del documento
  producto:        string;            // nombre legible del producto
  unidadesPorCaja: number;            // cuántas unidades entran en una caja
  pesoCajaKg?:     number | null;     // peso por caja en kg (opcional)
  creadoPor?:      string;
  creadoEn?:       Date | { seconds: number };
}

export function toProductoId(nombre: string): string {
  return nombre.trim().toLowerCase().replace(/\s+/g, "_").replace(/[^a-z0-9_áéíóúñü]/g, "");
}

// Umbral mínimo de cobertura para aceptar un match parcial (ver más abajo):
// la porción compartida debe cubrir al menos este % del string más corto
// Y del más largo involucrados, para evitar que un fragmento corto/genérico
// se "cuele" dentro de un producto_id mucho más largo sin relación real
// (bug crítico reportado por Oliver en producción: "LENGUILETTA FRUTOS
// ROJOS 24/1" — producto ya eliminado del catálogo — se asignó mal a otro
// producto existente por un match parcial sin ningún umbral).
const MIN_LONGITUD_PARCIAL = 4;
const MIN_COBERTURA_PARCIAL = 0.6;

// Ancla un nombre libre (texto/IA) contra un catálogo — busca, en orden:
// 1) alias explícito ya asignado a mano (máxima prioridad y confianza),
// 2) match exacto por producto_id,
// 3) match parcial (substring en cualquier dirección) SOLO si la porción
//    compartida cubre una fracción significativa de ambos strings y no hay
//    más de un candidato posible (ambigüedad = no se asigna nada).
// Si nada de eso aplica, devuelve el texto libre tal cual con
// reconocido:false — nunca adivina. Evita que nombre y producto_id se
// calculen por separado y diverjan silenciosamente (bug D-1b en Choferes.tsx).
export function resolverProductoEnCatalogo<T extends { nombre: string; producto_id?: string }>(
  nombreLibre: string,
  catalogo: T[],
  aliases?: Record<string, string>  // clave normalizada → producto_id canónico
): { nombre: string; producto_id: string; match: T | null; reconocido: boolean } {
  const idDe = (p: T) => p.producto_id ?? toProductoId(p.nombre);
  const pid = toProductoId(nombreLibre);

  const aliasId = aliases?.[pid];
  if (aliasId) {
    const viaAlias = catalogo.find((p) => idDe(p) === aliasId);
    if (viaAlias) return { nombre: viaAlias.nombre, producto_id: idDe(viaAlias), match: viaAlias, reconocido: true };
  }

  if (catalogo.length > 0) {
    const exacto = catalogo.find((p) => idDe(p) === pid);
    if (exacto) return { nombre: exacto.nombre, producto_id: idDe(exacto), match: exacto, reconocido: true };

    if (pid.length >= MIN_LONGITUD_PARCIAL) {
      const candidatos = catalogo.filter((p) => {
        const catId = idDe(p);
        if (catId.length < MIN_LONGITUD_PARCIAL) return false;
        const catContieneAlLibre = catId.includes(pid);
        const libreContieneAlCat = pid.includes(catId);
        if (!catContieneAlLibre && !libreContieneAlCat) return false;
        const corto = catContieneAlLibre ? pid.length : catId.length;
        const largo = catContieneAlLibre ? catId.length : pid.length;
        return corto / largo >= MIN_COBERTURA_PARCIAL;
      });
      if (candidatos.length === 1) {
        const p = candidatos[0];
        return { nombre: p.nombre, producto_id: idDe(p), match: p, reconocido: true };
      }
    }
  }

  return { nombre: nombreLibre.trim(), producto_id: pid, match: null, reconocido: false };
}

// ─── Semáforo ─────────────────────────────────────────────────────────────────

export type Semaforo = "verde" | "amarillo" | "rojo";

export function toDate(ts: Date | { seconds: number } | undefined): Date {
  if (!ts) return new Date(0);
  if (ts instanceof Date) return ts;
  return new Date((ts as { seconds: number }).seconds * 1000);
}

export function calcSemaforo(records: ImbentarioRecord[]): Semaforo {
  if (records.length === 0) return "verde";
  const cargado   = records.reduce((s, r) => s + (r.cantidadCargada ?? 0), 0);
  const entregado = records.reduce((s, r) => s + (r.cantidadEntregada ?? 0), 0);
  if (cargado === 0) return "verde";
  const diff = (cargado - entregado) / cargado;
  if (diff < 0.05)  return "verde";
  if (diff < 0.15)  return "amarillo";
  return "rojo";
}

export function fmtDate(ts: Date | { seconds: number } | undefined): string {
  const d = toDate(ts);
  if (!d.getTime()) return "—";
  return d.toLocaleDateString("es-MX", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
}

// ─── Polar Breeze Weight + SPIKINSCAN — lotes ─────────────────────────────────

export interface WeightItem {
  codigo:    string;
  producto:  string;
  nCajas:    number;
  unidades:  number;
  peso_kg:   number | null;
  timestamp: Date | { seconds: number };
}

export interface LoteWeight {
  id?:               string;
  numero:            string;
  proveedor?:        string;
  items:             WeightItem[];
  totalUnidades:     number;
  totalPesoKg:       number | null;
  encargadoId:       string;
  encargadoNombre:   string;
  timestamp:         Date | { seconds: number };
  estado:            "activo" | "cerrado";
  notas?:            string;
}

// ─── Factura de proveedor (recepción fiscal, Encargado) ────────────────────────
// Registro fiscal solamente — NO afecta movimientos_loker/lotes_loker.

export interface FacturaProveedorLinea {
  codigo:              string;
  descripcion:         string;
  cantidad:            number;
  precioUnitario:      number;   // precio unitario SIN ITBIS
  descuentoD1?:        number;   // % descuento 1 (Bon trae D1/D2 separados)
  descuentoD2?:        number;   // % descuento 2
  precioNetoUnitario?: number;   // precio neto unitario sin ITBIS (tras descuento)
  royalties?:          number;   // royalties de esta línea
  itbis?:              number;   // ITBIS de esta línea (distinto del total con ITBIS)
  valorTotalConItbis:  number;
}

export interface FacturaProveedorTotales {
  valorBruto:      number;
  totalDescuento:  number;
  royaltyHelado?:  number;
  royaltyYogan?:   number;
  subtotalGravado: number;
  subtotalExento:  number;
  totalItbis:      number;
  valorTotal:      number;
  valorAPagar:     number;
}

export interface FacturaProveedor {
  id?:                 string;
  proveedor?:          string;
  rncProveedor?:       string;
  numeroFactura?:      string;
  ncf?:                string;   // ej. "E310000585685"
  tipoFactura?:        string;   // ej. "Crédito Fiscal Electrónica"
  fecha?:              string;   // fecha de emisión, como texto (YYYY-MM-DD)
  validoHasta?:        string;
  condicionPago?:      string;   // ej. "CREDITO"
  fechaVencimiento?:   string;   // texto (YYYY-MM-DD), para mostrar
  fechaVencimientoTs?: Date | { seconds: number } | null; // parseada, para filtrar/ordenar (Cuentas por Pagar)
  vendedor?:           string;
  cliente?:            string;
  rncCliente?:         string;
  direccionCliente?:   string;
  lineas:              FacturaProveedorLinea[];
  totales:             FacturaProveedorTotales;
  sumaLineas:          number;
  diferencia:          number;
  // Total Cajas/Cnts + Total Unidades Sueltas impresos al pie de la factura (distintos
  // del resumen de totales en RD$) — chequeo cruzado independiente contra Σ cantidad
  // de las líneas, para detectar cantidades mal leídas que la validación de RD$ no ve
  // (una fila puede tener el monto correcto pero la cantidad/código de otra fila).
  totalCajas?:            number;
  totalUnidadesSueltas?:  number;
  sumaCantidades?:        number;
  diferenciaCantidades?:  number;
  revisarManualmente:  boolean;
  registradoPor:       string;
  registradoPorId:     string;
  timestamp:           Date | { seconds: number };
}
