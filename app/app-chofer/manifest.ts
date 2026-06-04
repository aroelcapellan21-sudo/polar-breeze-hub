import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "App Chofer — Polar Breeze",
    short_name: "Chofer PB",
    description: "Inventario · Ruta · Cierre del día",
    start_url: "/app-chofer",
    display: "standalone",
    background_color: "#1A1A1A",
    theme_color: "#F5C800",
    orientation: "portrait-primary",
    icons: [
      { src: "/icon-chofer.svg", sizes: "any", type: "image/svg+xml", purpose: "any" },
      { src: "/icon-chofer.svg", sizes: "any", type: "image/svg+xml", purpose: "maskable" },
    ],
    categories: ["business", "productivity"],
    lang: "es-DO",
    shortcuts: [
      {
        name: "Mi inventario",
        url: "/app-chofer",
        description: "Ver inventario del día",
      },
    ],
  };
}
