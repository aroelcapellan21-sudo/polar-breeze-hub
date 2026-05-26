"use client";

import { useEffect } from "react";
import { doc, setDoc, serverTimestamp } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useAuth } from "@/lib/auth-context";

interface Props {
  /** Scope de la PWA (p.ej. "/app-despachador") */
  scope?: string;
}

/**
 * Registra el Service Worker y guarda la suscripción push en Firestore.
 * Montado dentro de cada PWA-page para que funcione por scope.
 */
export default function PWAServiceWorker({ scope = "/" }: Props) {
  const { profile } = useAuth();

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!("serviceWorker" in navigator)) return;

    const register = async () => {
      try {
        const reg = await navigator.serviceWorker.register("/sw.js", {
          scope: "/",
          updateViaCache: "none",
        });

        // Guardar presencia en Firestore (para que Admin vea quién tiene el SW)
        if (profile?.uid) {
          await setDoc(
            doc(db, "pwa_sessions", profile.uid),
            {
              uid:        profile.uid,
              nombre:     profile.nombre,
              role:       profile.role,
              scope,
              userAgent:  navigator.userAgent,
              standalone: window.matchMedia("(display-mode: standalone)").matches,
              updatedAt:  serverTimestamp(),
            },
            { merge: true }
          ).catch(() => {/* non-critical */});
        }

        // Verificar si hay actualización disponible
        reg.addEventListener("updatefound", () => {
          const newWorker = reg.installing;
          if (!newWorker) return;
          newWorker.addEventListener("statechange", () => {
            if (newWorker.state === "installed" && navigator.serviceWorker.controller) {
              console.log("[PB SW] Nueva versión disponible — recargando…");
              // Recarga silenciosa si ya está instalado
              setTimeout(() => window.location.reload(), 2000);
            }
          });
        });

      } catch (err) {
        console.warn("[PB SW] Registro fallido:", err);
      }
    };

    register();
  }, [profile, scope]);

  return null; // No renderiza nada
}
