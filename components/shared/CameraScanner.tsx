"use client";

import { useEffect, useRef, useState, useCallback } from "react";

interface Props {
  onResult: (code: string) => void;
  onClose: () => void;
  title?: string;
}

// ── Tipos para BarcodeDetector (API nativa del navegador) ─────────────────────
interface DetectedBarcode {
  rawValue: string;
  format: string;
}

interface BarcodeDetectorInstance {
  detect(source: HTMLVideoElement): Promise<DetectedBarcode[]>;
}

interface BarcodeDetectorConstructor {
  new (options?: { formats: string[] }): BarcodeDetectorInstance;
  getSupportedFormats(): Promise<string[]>;
}

declare global {
  interface Window {
    BarcodeDetector?: BarcodeDetectorConstructor;
  }
}

// Formatos soportados por la API — barcode + QR
const TODOS_FORMATOS = [
  "qr_code", "code_128", "code_39", "code_93", "codabar",
  "ean_13", "ean_8", "upc_a", "upc_e", "itf",
  "data_matrix", "pdf417", "aztec",
];

type Estado = "iniciando" | "activo" | "error" | "sin_soporte";

export default function CameraScanner({ onResult, onClose, title = "Escanear código" }: Props) {
  const videoRef  = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const timerRef  = useRef<ReturnType<typeof setInterval> | null>(null);
  const doneRef   = useRef(false);
  const [estado,   setEstado]   = useState<Estado>("iniciando");
  const [errorMsg, setErrorMsg] = useState("");

  const detener = useCallback(() => {
    if (timerRef.current) clearInterval(timerRef.current);
    streamRef.current?.getTracks().forEach(t => t.stop());
    streamRef.current = null;
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;

    if (!window.BarcodeDetector) {
      setEstado("sin_soporte");
      return;
    }

    let detector: BarcodeDetectorInstance;

    const init = async () => {
      try {
        const soportados = await window.BarcodeDetector!.getSupportedFormats().catch(() => TODOS_FORMATOS);
        const formatos   = TODOS_FORMATOS.filter(f => soportados.includes(f));
        detector = new window.BarcodeDetector!({ formats: formatos.length > 0 ? formatos : TODOS_FORMATOS });

        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: "environment", width: { ideal: 1280 }, height: { ideal: 720 } },
        });
        streamRef.current = stream;

        if (!videoRef.current) return;
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
        setEstado("activo");

        // Escanear cada 250 ms — equilibrio entre velocidad y batería
        timerRef.current = setInterval(async () => {
          if (doneRef.current || !videoRef.current) return;
          if (videoRef.current.readyState < 2) return;
          try {
            const codes = await detector.detect(videoRef.current);
            if (codes.length > 0 && !doneRef.current) {
              doneRef.current = true;
              detener();
              onResult(codes[0].rawValue);
              onClose();
            }
          } catch { /* silencioso */ }
        }, 250);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.includes("NotAllowed") || msg.includes("Permission")) {
          setErrorMsg("Permiso de cámara denegado. Actívalo en la configuración del navegador.");
        } else {
          setErrorMsg("No se pudo acceder a la cámara. Verifica que no esté en uso.");
        }
        setEstado("error");
      }
    };

    init();
    return detener;
  }, [detener, onResult, onClose]);

  return (
    <div className="fixed inset-0 z-[9999] flex flex-col bg-black">

      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 bg-[#1A1A1A] flex-shrink-0">
        <div>
          <p className="text-white font-bold text-sm">📷 {title}</p>
          <p className="text-gray-400 text-xs">Apunta al código de barras o QR</p>
        </div>
        <button
          onClick={() => { detener(); onClose(); }}
          className="w-8 h-8 rounded-lg bg-white/10 flex items-center justify-center
            text-white text-lg hover:bg-white/20 active:scale-90 transition-all"
        >
          ✕
        </button>
      </div>

      {/* Banda tricolor */}
      <div className="h-[3px] flex flex-shrink-0">
        <div className="flex-1 bg-[#F5C800]" />
        <div className="flex-1 bg-[#D42B2B]" />
        <div className="flex-1 bg-[#1E8C3A]" />
      </div>

      {/* Área de cámara / estado */}
      <div className="flex-1 flex items-center justify-center relative overflow-hidden">

        {/* Video (siempre montado, oculto hasta que esté activo) */}
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted
          className={`absolute inset-0 w-full h-full object-cover transition-opacity duration-300 ${
            estado === "activo" ? "opacity-100" : "opacity-0"
          }`}
        />

        {/* Overlay de guía (solo en estado activo) */}
        {estado === "activo" && (
          <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
            {/* Oscurecer fuera del recuadro */}
            <div className="absolute inset-0 bg-black/40" />

            {/* Recuadro de escaneo */}
            <div className="relative w-64 h-64 z-10">
              <div className="absolute inset-0 rounded-2xl border border-white/20" />
              {/* Esquinas amarillas */}
              <div className="absolute top-0 left-0 w-10 h-10 border-t-4 border-l-4 border-[#F5C800] rounded-tl-2xl" />
              <div className="absolute top-0 right-0 w-10 h-10 border-t-4 border-r-4 border-[#F5C800] rounded-tr-2xl" />
              <div className="absolute bottom-0 left-0 w-10 h-10 border-b-4 border-l-4 border-[#F5C800] rounded-bl-2xl" />
              <div className="absolute bottom-0 right-0 w-10 h-10 border-b-4 border-r-4 border-[#F5C800] rounded-br-2xl" />
              {/* Línea de escaneo animada */}
              <div
                className="absolute inset-x-4 h-0.5 bg-[#D42B2B] opacity-80 animate-bounce"
                style={{ top: "50%" }}
              />
            </div>

            <p className="z-10 mt-6 text-white text-xs font-medium bg-black/60 px-4 py-2 rounded-full">
              Centra el código en el recuadro
            </p>
          </div>
        )}

        {/* Estado: iniciando */}
        {estado === "iniciando" && (
          <div className="text-center z-10">
            <p className="text-4xl mb-3 animate-pulse">📷</p>
            <p className="text-white text-sm font-medium">Iniciando cámara…</p>
          </div>
        )}

        {/* Estado: error */}
        {estado === "error" && (
          <div className="text-center px-8 z-10">
            <p className="text-4xl mb-3">🚫</p>
            <p className="text-white font-bold text-sm mb-2">Error de cámara</p>
            <p className="text-gray-300 text-xs mb-5 leading-relaxed">{errorMsg}</p>
            <button
              onClick={() => { detener(); onClose(); }}
              className="px-6 py-2.5 bg-[#D42B2B] text-white rounded-xl text-sm font-bold
                active:scale-95 transition-all"
            >
              Cerrar
            </button>
          </div>
        )}

        {/* Estado: sin soporte */}
        {estado === "sin_soporte" && (
          <div className="text-center px-8 z-10">
            <p className="text-4xl mb-3">📱</p>
            <p className="text-white font-bold text-sm mb-2">Escáner de cámara no disponible</p>
            <p className="text-gray-300 text-xs mb-1 leading-relaxed">
              Tu navegador no soporta la detección de códigos por cámara.
            </p>
            <p className="text-gray-400 text-xs mb-5">
              Usa Google Chrome o Samsung Internet para activar esta función.
            </p>
            <button
              onClick={() => { detener(); onClose(); }}
              className="px-6 py-2.5 bg-white/20 text-white rounded-xl text-sm font-semibold
                active:scale-95 transition-all"
            >
              Cerrar
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
