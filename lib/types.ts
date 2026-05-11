export type UserRole = "admin" | "despachador" | "chofer";

export interface UserProfile {
  uid: string;
  email: string;
  role: UserRole;
  nombre: string;
  ficha?: string;
  activo?: boolean;
  createdAt: Date;
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
  cantidad: number;
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
