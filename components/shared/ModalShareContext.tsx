"use client";

import {
  createContext, useContext, useRef, useState, useCallback, useEffect,
  type ReactNode, type MutableRefObject,
} from "react";

interface ModalFns {
  getMessage:   () => string;
  getPrintHtml: () => string;
}

interface Ctx {
  isOpen:  boolean;
  fnsRef:  MutableRefObject<ModalFns | null>;
  register: (fns: ModalFns | null) => void;
}

const ModalShareCtx = createContext<Ctx>({
  isOpen:  false,
  fnsRef:  { current: null },
  register: () => {},
});

export function ModalShareProvider({ children }: { children: ReactNode }) {
  const [isOpen, setIsOpen] = useState(false);
  const fnsRef = useRef<ModalFns | null>(null);

  const register = useCallback((fns: ModalFns | null) => {
    fnsRef.current = fns;
    setIsOpen(fns !== null);
  }, []);

  return (
    <ModalShareCtx.Provider value={{ isOpen, fnsRef, register }}>
      {children}
    </ModalShareCtx.Provider>
  );
}

export function useModalShare() {
  return useContext(ModalShareCtx);
}

/**
 * Llama en cualquier componente que tenga un modal con datos para compartir.
 * Registra las funciones cuando isOpen es true; las limpia cuando cierra.
 * Los refs internos siempre capturan las últimas versiones de las funciones.
 */
export function useRegisterModal(
  isOpen:       boolean,
  getMessage:   () => string,
  getPrintHtml?: () => string,
) {
  const { register } = useModalShare();

  // Refs que se actualizan en cada render → los wrappers registrados
  // siempre llaman a la versión más reciente de cada función.
  const msgRef   = useRef(getMessage);
  const printRef = useRef(getPrintHtml);
  msgRef.current   = getMessage;
  printRef.current = getPrintHtml;

  useEffect(() => {
    if (!isOpen) return;
    register({
      getMessage:   () => msgRef.current(),
      getPrintHtml: () => printRef.current?.() ?? "",
    });
    return () => register(null);
  }, [isOpen, register]);
}
