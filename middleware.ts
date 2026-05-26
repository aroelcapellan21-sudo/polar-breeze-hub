/**
 * Middleware — Polar Breeze Hub
 * Enruta subdominios a sus rutas PWA correspondientes:
 *
 *   despachador.polarbreezeapp.com  →  /app-despachador
 *   encargado.polarbreezeapp.com    →  /app-encargado
 *   hub.polarbreezeapp.com          →  / (hub admin)
 *
 * En localhost / polar-breeze-hub.vercel.app las rutas son directas:
 *   /app-despachador   → PWA Despachador
 *   /app-encargado     → PWA Encargado
 */

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

/** Dominios base permitidos (configura el dominio real cuando lo tengas) */
const DOMAIN_MAP: Record<string, string> = {
  despachador: "/app-despachador",
  encargado:   "/app-encargado",
  hub:         "/",
};

export function middleware(request: NextRequest) {
  const host     = request.headers.get("host") ?? "";
  const hostname = host.split(":")[0]; // quitar puerto
  const parts    = hostname.split(".");
  const subdomain = parts.length >= 3 ? parts[0] : null;

  // Solo actuar si hay un subdominio reconocido
  if (subdomain && DOMAIN_MAP[subdomain]) {
    const targetBase = DOMAIN_MAP[subdomain];
    const url = request.nextUrl.clone();

    // No reescribir si ya está en la ruta correcta
    if (!url.pathname.startsWith(targetBase)) {
      const trailingPath = url.pathname === "/" ? "" : url.pathname;
      url.pathname = `${targetBase}${trailingPath}`;
      return NextResponse.rewrite(url);
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    /*
     * Excluir rutas internas de Next.js y archivos estáticos
     */
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|mp4|woff2?|ttf|eot)).*)",
  ],
};
