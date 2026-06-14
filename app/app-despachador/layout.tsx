import type { Metadata, Viewport } from "next";
import { Nunito } from "next/font/google";
import "../globals.css";
import { AuthProvider } from "@/lib/auth-context";
import ErrorBoundary from "@/components/shared/ErrorBoundary";
import { ModalShareProvider } from "@/components/shared/ModalShareContext";

const nunito = Nunito({
  subsets: ["latin"],
  weight: ["400", "600", "700", "800", "900"],
  variable: "--font-nunito",
  display: "swap",
});

export const metadata: Metadata = {
  title: "App Despachador — Polar Breeze",
  description: "Cuarto Frío · Despacho · Choferes · Anomalías",
  manifest: "/app-despachador/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "Despachador",
  },
};

export const viewport: Viewport = {
  themeColor: "#D42B2B",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
};

export default function DespachadorPWALayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es" className={nunito.className}>
      <head>
        <link rel="apple-touch-icon" href="/icon-despachador-maskable-512.png" />
        <meta name="mobile-web-app-capable" content="yes" />
      </head>
      <body>
        <ErrorBoundary>
          <ModalShareProvider>
            <AuthProvider>{children}</AuthProvider>
          </ModalShareProvider>
        </ErrorBoundary>
      </body>
    </html>
  );
}
