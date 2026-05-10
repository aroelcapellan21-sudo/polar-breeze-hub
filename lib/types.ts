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
