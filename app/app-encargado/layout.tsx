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
  title: "App Encargado — Polar Breeze",
  description: "Lotes · Weight · Stock · Inventario Choferes",
  manifest: "/app-encargado/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "Encargado",
  },
};

export const viewport: Viewport = {
  themeColor: "#1E8C3A",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
};

export default function EncargadoPWALayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es" className={nunito.className}>
      <head>
        <link rel="apple-touch-icon" href="/icon-encargado.svg" />
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
