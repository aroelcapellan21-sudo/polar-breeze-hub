import type { Metadata } from "next";
import { Nunito } from "next/font/google";
import "./globals.css";
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
  title: "Polar Breeze Hub",
  description: "Portal Central del Ecosistema Polar Breeze",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es" className={nunito.className}>
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
