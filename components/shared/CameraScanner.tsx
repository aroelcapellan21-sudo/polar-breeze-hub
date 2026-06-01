"use client";

import { useEffect, useRef, useState, useCallback } from "react";

interface Props {
  onResult: (code: string) => void;
  onClose: () => void;
  title?: string;
}

interface DetectedBarcode {
  rawValue: string;
  format: string;
}

interface BarcodeDetectorInstance {
  detect(source: HTMLVideoElement | HTMLCanvasElement): Promise<DetectedBarcode[]>;
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

interface ExtendedConstraintSet extends MediaTrackConstraintSet {
  focusMode?: string;
  focusDistance?: number;
  torch?: boolean;
  zoom?: number;
}

interface ExtendedCapabilities extends MediaTrackCapabilities {
  focusMode?: string[];
  torch?: boolean;
  zoom?: { min: number; max: number; step: number };
}

const TODOS_FORMATOS = [
  "qr_code", "code_128", "code_39", "code_93", "codabar",
  "ean_13", "ean_8", "upc_a", "upc_e", "itf",
  "data_matrix", "pdf417", "aztec",
];

type Estado = "iniciando" | "activo" | "error" | "sin_soporte";

// Esperar a que el video tenga un frame decodificado listo
function esperarFrame(video: HTMLVideoElement): Promise<void> {
  return new Promise(resolve => {
    if (video.readyState >= 4) { resolve(); return; }
    video.addEventListener("canplaythrough", () => resolve(), { once: true });
  });
}

export default function CameraScanner({ onResult, onClose, title = "Escanear código" }: Props) {
  const videoRef   = useRef<HTMLVideoElement>(null);
  const canvasRef  = useRef<HTMLCanvasElement>(null);
  const streamRef  = useRef<MediaStream | null>(null);
  const timerRef   = useRef<ReturnType<typeof setInterval> | null>(null);
  const doneRef    = useRef(false);

  const [estado,      setEstado]      = useState<Estado>("iniciando");
  const [errorMsg,    setErrorMsg]    = useState("");
  const [tieneTorch,  setTieneTorch]  = useState(false);
  const [torchActivo, setTorchActivo] = useState(false);

  const detener = useCallback(() => {
    if (timerRef.current) clearInterval(timerRef.current);
    streamRef.current?.getTracks().forEach(t => t.stop());
    streamRef.current = null;
  }, []);

  // ── Aplica autofocus continuo + zoom mínimo ───────────────────────────────
  // Llamar SIEMPRE después de que el video esté reproduciéndose.
  const aplicarFoco = useCallback(async (track: MediaStreamTrack) => {
    try {
      const caps = track.getCapabilities() as ExtendedCapabilities;
      const set: ExtendedConstraintSet = {};

      if (caps.focusMode?.includes("continuous")) {
        set.focusMode = "continuous";
      } else if (caps.focusMode?.includes("manual")) {
        set.focusMode    = "manual";
        set.focusDistance = 0;   // enfoque cercano
      }

      // Sin zoom digital — evita pixelado que parece borroso
      if (caps.zoom) set.zoom = caps.zoom.min;

      if (Object.keys(set).length > 0) {
        await track.applyConstraints({ advanced: [set as MediaTrackConstraintSet] });
      }

      if (caps.torch) setTieneTorch(true);
    } catch { /* silencioso */ }
  }, []);

  // ── Toggle linterna ───────────────────────────────────────────────────────
  const toggleTorch = useCallback(async () => {
    const track = streamRef.current?.getVideoTracks()[0];
    if (!track) return;
    const sig = !torchActivo;
    try {
      await track.applyConstraints({ advanced: [{ torch: sig } as MediaTrackConstraintSet] });
      setTorchActivo(sig);
    } catch { /* no disponible */ }
  }, [torchActivo]);

  // ── Re-enfoca al tocar la pantalla ────────────────────────────────────────
  const reEnfocar = useCallback(async () => {
    const track = streamRef.current?.getVideoTracks()[0];
    if (!track) return;
    const caps = track.getCapabilities() as ExtendedCapabilities;
    // Ciclo manual→continuo para forzar re-enfoque en algunos dispositivos
    if (caps.focusMode?.includes("continuous")) {
      try {
        await track.applyConstraints({ advanced: [{ focusMode: "manual" } as MediaTrackConstraintSet] });
        await new Promise(r => setTimeout(r, 100));
        await track.applyConstraints({ advanced: [{ focusMode: "continuous" } as MediaTrackConstraintSet] });
      } catch { /* silencioso */ }
    }
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

        // Pedir la mayor resolución posible — más píxeles = mejor detección
        let stream: MediaStream;
        try {
          stream = await navigator.mediaDevices.getUserMedia({
            video: {
              facingMode: { ideal: "environment" },
              width:  { ideal: 1920, min: 640 },
              height: { ideal: 1080, min: 480 },
              advanced: [
                { focusMode: "continuous" } as MediaTrackConstraintSet,
              ],
            },
          });
        } catch {
          // Fallback sin advanced constraints
          stream = await navigator.mediaDevices.getUserMedia({
            video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 }, height: { ideal: 720 } },
          });
        }

        streamRef.current = stream;

        if (!videoRef.current) return;
        videoRef.current.srcObject = stream;
        await videoRef.current.play();

        // ── ESPERAR a que haya un frame real antes de aplicar constraints ──
        // applyConstraints en un track cuyo video no está corriendo aún es
        // ignorado silenciosamente por Chrome/Android.
        await esperarFrame(videoRef.current);

        const track = stream.getVideoTracks()[0];
        if (track) await aplicarFoco(track);

        setEstado("activo");

        // ── Bucle de detección sobre canvas a resolución nativa ──────────
        // Capturar en canvas en lugar de pasar el <video> directamente:
        // el video está escalado por CSS — el canvas usa la resolución real.
        timerRef.current = setInterval(async () => {
          if (doneRef.current || !videoRef.current || !canvasRef.current) return;
          if (videoRef.current.readyState < 4) return;

          const video  = videoRef.current;
          const canvas = canvasRef.current;

          // Ajustar canvas a la resolución real del frame de cámara
          if (canvas.width !== video.videoWidth || canvas.height !== video.videoHeight) {
            canvas.width  = video.videoWidth;
            canvas.height = video.videoHeight;
          }

          const ctx = canvas.getContext("2d", { willReadFrequently: true });
          if (!ctx) return;
          ctx.drawImage(video, 0, 0);

          try {
            const codes = await detector.detect(canvas);
            if (codes.length > 0 && !doneRef.current) {
              doneRef.current = true;
              detener();
              onResult(codes[0].rawValue);
              onClose();
            }
          } catch { /* silencioso */ }
        }, 150);

      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        setErrorMsg(
          msg.includes("NotAllowed") || msg.includes("Permission")
            ? "Permiso de cámara denegado. Actívalo en la configuración del navegador."
            : "No se pudo acceder a la cámara. Verifica que no esté en uso.",
        );
        setEstado("error");
      }
    };

    init();
    return detener;
  }, [detener, aplicarFoco, onResult, onClose]);

  return (
    <div className="fixed inset-0 z-[9999] flex flex-col bg-black">

      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 bg-[#1A1A1A] flex-shrink-0">
        <div>
          <p className="text-white font-bold text-sm">📷 {title}</p>
          <p className="text-gray-400 text-xs">Apunta al código · toca para enfocar</p>
        </div>
        <div className="flex items-center gap-2">
          {tieneTorch && (
            <button
              onClick={toggleTorch}
              title={torchActivo ? "Apagar linterna" : "Encender linterna"}
              className={`w-8 h-8 rounded-lg flex items-center justify-center text-base
                transition-all active:scale-90 ${
                torchActivo ? "bg-[#F5C800] text-[#1A1A1A]" : "bg-white/10 text-white hover:bg-white/20"
              }`}
            >
              🔦
            </button>
          )}
          <button
            onClick={() => { detener(); onClose(); }}
            className="w-8 h-8 rounded-lg bg-white/10 flex items-center justify-center
              text-white text-lg hover:bg-white/20 active:scale-90 transition-all"
          >
            ✕
          </button>
        </div>
      </div>

      {/* Banda tricolor */}
      <div className="h-[3px] flex flex-shrink-0">
        <div className="flex-1 bg-[#F5C800]" />
        <div className="flex-1 bg-[#D42B2B]" />
        <div className="flex-1 bg-[#1E8C3A]" />
      </div>

      {/* Área de cámara */}
      <div className="flex-1 flex items-center justify-center relative overflow-hidden">

        {/* Video visible al usuario */}
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted
          onClick={reEnfocar}
          className={`absolute inset-0 w-full h-full object-cover transition-opacity duration-300
            cursor-pointer ${estado === "activo" ? "opacity-100" : "opacity-0"}`}
        />

        {/* Canvas oculto — captura frames a resolución nativa para BarcodeDetector */}
        <canvas ref={canvasRef} className="hidden" />

        {/* Overlay guía */}
        {estado === "activo" && (
          <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
            <div className="absolute inset-0 bg-black/40" />
            <div className="relative w-64 h-64 z-10">
              <div className="absolute top-0 left-0 w-10 h-10 border-t-4 border-l-4 border-[#F5C800] rounded-tl-2xl" />
              <div className="absolute top-0 right-0 w-10 h-10 border-t-4 border-r-4 border-[#F5C800] rounded-tr-2xl" />
              <div className="absolute bottom-0 left-0 w-10 h-10 border-b-4 border-l-4 border-[#F5C800] rounded-bl-2xl" />
              <div className="absolute bottom-0 right-0 w-10 h-10 border-b-4 border-r-4 border-[#F5C800] rounded-br-2xl" />
              <div className="absolute inset-x-4 h-0.5 bg-[#D42B2B] opacity-80 animate-bounce"
                style={{ top: "50%" }} />
            </div>
            <p className="z-10 mt-6 text-white text-xs font-medium bg-black/60 px-4 py-2 rounded-full">
              Centra el código · toca la pantalla para enfocar
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
            <button onClick={() => { detener(); onClose(); }}
              className="px-6 py-2.5 bg-[#D42B2B] text-white rounded-xl text-sm font-bold active:scale-95 transition-all">
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
            <button onClick={() => { detener(); onClose(); }}
              className="px-6 py-2.5 bg-white/20 text-white rounded-xl text-sm font-semibold active:scale-95 transition-all">
              Cerrar
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
