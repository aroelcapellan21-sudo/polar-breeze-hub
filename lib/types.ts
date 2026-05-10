export type UserRole = "admin" | "despachador" | "chofer";

export interface UserProfile {
  uid: string;
  email: string;
  role: UserRole;
  nombre: string;
  createdAt: Date;
}

export interface SpikinScanRecord {
  id?: string;
  despachadorId: string;
  despachadorNombre: string;
  producto: string;
  cantidad: number;
  destino: string;
  timestamp: Date;
  estado: "pendiente" | "despachado" | "entregado";
}

export interface FacturaScanRecord {
  id?: string;
  despachadorId: string;
  despachadorNombre: string;
  facturaNumero: string;
  cliente: string;
  monto: number;
  timestamp: Date;
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
  timestamp: Date;
  ruta: string;
}
