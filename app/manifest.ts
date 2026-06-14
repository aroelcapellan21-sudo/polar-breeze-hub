import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "Polar Breeze Hub",
    short_name: "PB Hub",
    description: "Hub Central — Polar Breeze, S.R.L.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#1A1A1A",
    theme_color: "#F5C800",
    orientation: "portrait-primary",
    icons: [
      { src: "/icon-hub-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icon-hub-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icon-hub-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
    categories: ["business", "productivity"],
    lang: "es-DO",
  };
}
