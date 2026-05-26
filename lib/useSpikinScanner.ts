"use client";

/**
 * useSpikinScanner — Hook para escáner HID (USB/Bluetooth)
 *
 * El escáner actúa como teclado: envía el código de barras + Enter.
 * Este hook captura esa secuencia en un <input> oculto con autoFocus,
 * busca el código en Firestore (colección codigos_cajas),
 * y notifica al componente padre con el producto encontrado.
 *
 * Si el código no existe → dispara onCodigoDesconocido para que el
 * componente muestre un modal de "Nombrar código".
 */

import { useRef, useState, useCallback } from "react";
import { doc, getDoc, setDoc, serverTimestamp } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { CodigoCaja } from "@/lib/types";

export interface ProductoEscaneado {
  codigo:          string;
  producto:        string;
  unidadesPorCaja: number;
  pesoCajaKg:      number | null;
}

interface UseSpikinScannerOptions {
  onProducto:         (p: ProductoEscaneado) => void;
  onCodigoDesconocido:(codigo: string) => void;
}

export function useSpikinScanner({ onProducto, onCodigoDesconocido }: UseSpikinScannerOptions) {
  const inputRef  = useRef<HTMLInputElement>(null);
  const bufferRef = useRef("");
  const [buscando, setBuscando] = useState(false);
  const [focused,  setFocused]  = useState(false);

  const handleKeyDown = useCallback(async (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      const codigo = bufferRef.current.trim();
      bufferRef.current = "";
      if (inputRef.current) inputRef.current.value = "";
      if (!codigo) return;

      setBuscando(true);
      try {
        const snap = await getDoc(doc(db, "codigos_cajas", codigo));
        if (snap.exists()) {
          const d = snap.data() as CodigoCaja;
          onProducto({
            codigo,
            producto:        d.producto,
            unidadesPorCaja: d.unidadesPorCaja,
            pesoCajaKg:      d.pesoCajaKg ?? null,
          });
        } else {
          onCodigoDesconocido(codigo);
        }
      } catch {
        onCodigoDesconocido(codigo);
      } finally {
        setBuscando(false);
      }
    } else {
      bufferRef.current += e.key.length === 1 ? e.key : "";
    }
  }, [onProducto, onCodigoDesconocido]);

  const handleChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    bufferRef.current = e.target.value;
  }, []);

  /** Guarda un código nuevo en Firestore y llama onProducto */
  const guardarCodigo = useCallback(async (
    codigo: string,
    nombre: string,
    unidadesPorCaja: number,
    pesoCajaKg: number | null,
    creadoPor: string,
  ) => {
    const data: CodigoCaja = {
      codigo, producto: nombre, unidadesPorCaja,
      pesoCajaKg: pesoCajaKg ?? undefined,
      creadoPor,
    };
    await setDoc(doc(db, "codigos_cajas", codigo), {
      ...data,
      creadoEn: serverTimestamp(),
    });
    onProducto({ codigo, producto: nombre, unidadesPorCaja, pesoCajaKg });
  }, [onProducto]);

  const refocus = useCallback(() => inputRef.current?.focus(), []);

  return { inputRef, handleKeyDown, handleChange, buscando, focused, setFocused, refocus, guardarCodigo };
}
