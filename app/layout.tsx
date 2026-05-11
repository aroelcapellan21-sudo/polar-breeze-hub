import type { Metadata } from "next";
import { Geist } from "next/font/google";
import "./globals.css";
import { AuthProvider } from "@/lib/auth-context";
import ErrorBoundary from "@/components/shared/ErrorBoundary";

const geist = Geist({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Polar Breeze Hub",
  description: "Portal Central del Ecosistema Polar Breeze",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es" className={geist.className}>
      <body>
        <ErrorBoundary>
          <AuthProvider>{children}</AuthProvider>
        </ErrorBoundary>
      </body>
    </html>
  );
}
