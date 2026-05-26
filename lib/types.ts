export type UserRole = "admin" | "despachador" | "chofer" | "encargado";

export interface InventarioBaseItem {
  nombre:      string;
  producto_id: string;
  cantidad:    number;
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

export function toProductoId(nombre: string): string {
  return nombre.trim().toLowerCase().replace(/\s+/g, "_").replace(/[^a-z0-9_áéíóúñü]/g, "");
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

// ─── Polar Breeze Weight ─────────────────────────────────────────────────────

/** Registro de un código de barras conocido (colección codigos_cajas) */
export interface CodigoCaja {
  codigo:          string;   // código de barras (document ID)
  producto:        string;   // nombre del producto
  unidadesPorCaja: number;   // unidades dentro de cada caja/fardo
  pesoCajaKg?:     number;   // peso de referencia de la caja (kg)
  creadoEn?:       Date | { seconds: number };
  creadoPor?:      string;
}

/** Un ítem dentro de un lote Weight */
export interface WeightItem {
  codigo:     string;
  producto:   string;
  nCajas:     number;
  unidades:   number;          // nCajas × unidadesPorCaja
  peso_kg:    number | null;   // peso total capturado por la báscula
  timestamp:  Date | { seconds: number };
}

/** Un lote de recepción de mercancía (colección lotes_weight) */
export interface LoteWeight {
  id?:             string;
  numero:          string;   // "#W001", "#W002", …
  proveedor?:      string;
  items:           WeightItem[];
  totalUnidades:   number;
  totalPesoKg:     number | null;
  encargadoId:     string;
  encargadoNombre: string;
  timestamp:       Date | { seconds: number };
  estado:          "activo" | "cerrado";
  notas?:          string;
}
