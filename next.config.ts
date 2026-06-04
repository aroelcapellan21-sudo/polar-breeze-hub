import type { NextConfig } from "next";
import path from "path";

const nextConfig: NextConfig = {
  turbopack: {
    root: path.resolve(__dirname),
  },
  async redirects() {
    return [
      { source: "/despachador", destination: "/app-despachador", permanent: false },
      { source: "/encargado",   destination: "/app-encargado",   permanent: false },
      { source: "/chofer",      destination: "/app-chofer",      permanent: false },
    ];
  },
};

export default nextConfig;
