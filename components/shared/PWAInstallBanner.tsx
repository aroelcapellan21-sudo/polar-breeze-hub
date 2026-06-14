"use client";

import { useState, useEffect } from "react";

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

interface Props {
  appName: string;
  appIcon: string;
}

/**
 * Banner de instalación PWA — aparece automáticamente cuando el browser
 * dispara el evento beforeinstallprompt (Android/Chrome/Edge).
 * En iOS muestra instrucciones manuales de "Agregar a pantalla de inicio".
 */
export default function PWAInstallBanner({ appName, appIcon }: Props) {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [show, setShow]   = useState(false);
  const [isIOS, setIsIOS] = useState(false);
  const [installed, setInstalled] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;

    // Ya instalada como PWA
    if (window.matchMedia("(display-mode: standalone)").matches) {
      setInstalled(true);
      return;
    }

    // iOS detection
    const ios = /iphone|ipad|ipod/i.test(navigator.userAgent) && !(window as unknown as { MSStream: unknown }).MSStream;
    setIsIOS(ios);

    // Dismissed anteriormente (localStorage)
    const dismissed = localStorage.getItem(`pb-pwa-dismissed-${appName}`);
    if (dismissed) return;

    if (ios) {
      // En iOS mostrar instrucciones si no está instalada
      setTimeout(() => setShow(true), 3000);
      return;
    }

    // Android/Chrome — capturar el evento
    const handler = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
      setShow(true);
    };
    window.addEventListener("beforeinstallprompt", handler);
    return () => window.removeEventListener("beforeinstallprompt", handler);
  }, [appName]);

  const handleInstall = async () => {
    if (!deferredPrompt) return;
    await deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    if (outcome === "accepted") setInstalled(true);
    setShow(false);
    setDeferredPrompt(null);
  };

  const handleDismiss = () => {
    setShow(false);
    localStorage.setItem(`pb-pwa-dismissed-${appName}`, "1");
  };

  if (installed || !show) return null;

  return (
    <div
      className="no-print fixed bottom-24 left-4 right-4 z-[9000] max-w-sm mx-auto
        bg-[#1A1A1A] rounded-2xl shadow-2xl border border-white/10 overflow-hidden
        animate-in slide-in-from-bottom-4 duration-300"
    >
      {/* Banda tricolor */}
      <div className="flex h-1">
        <div className="flex-1 bg-[#F5C800]" />
        <div className="flex-1 bg-[#D42B2B]" />
        <div className="flex-1 bg-[#1E8C3A]" />
      </div>

      <div className="p-4">
        <div className="flex items-start gap-3">
          {/* Icono */}
          <div
            className="w-12 h-12 rounded-xl flex-shrink-0 flex items-center justify-center text-2xl shadow-lg"
            style={{ background: "linear-gradient(135deg, #F5C800 33%, #D42B2B 33% 66%, #1E8C3A 66%)" }}
          >
            {appIcon}
          </div>

          {/* Texto */}
          <div className="flex-1 min-w-0">
            <p className="text-white font-black text-sm">Instalar {appName}</p>
            <p className="text-gray-400 text-xs mt-0.5 leading-tight">
              {isIOS
                ? 'Toca Compartir → "Agregar a inicio" para instalar'
                : "Instala la app en tu pantalla de inicio para acceso rápido y offline"}
            </p>
          </div>

          {/* Cerrar */}
          <button
            onClick={handleDismiss}
            className="text-gray-500 hover:text-white text-lg flex-shrink-0 -mt-1 active:scale-90"
          >
            ✕
          </button>
        </div>

        {/* Botones (no iOS) */}
        {!isIOS && (
          <div className="flex gap-2 mt-3">
            <button
              onClick={handleInstall}
              className="flex-1 py-2.5 rounded-xl text-sm font-black text-[#1A1A1A] active:scale-95 transition-all"
              style={{ background: "linear-gradient(90deg, #F5C800, #D42B2B)" }}
            >
              📲 Instalar ahora
            </button>
            <button
              onClick={handleDismiss}
              className="px-4 py-2.5 rounded-xl text-sm font-semibold text-gray-400
                bg-white/5 hover:bg-white/10 active:scale-95 transition-all"
            >
              Luego
            </button>
          </div>
        )}

        {/* Instrucciones iOS */}
        {isIOS && (
          <div className="mt-3 bg-white/5 rounded-xl px-3 py-2.5 flex items-center gap-2">
            <span className="text-xl">⬆️</span>
            <div className="text-xs text-gray-300">
              Toca <strong className="text-white">Compartir</strong> en Safari y luego{" "}
              <strong className="text-white">&quot;Agregar a pantalla de inicio&quot;</strong>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
