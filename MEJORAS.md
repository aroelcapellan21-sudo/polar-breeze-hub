# MEJORAS — Polar Breeze Hub

Hoja de ruta de mejoras acordada con Ariel. Numeración oficial.
Al terminar cada una: marcar ✅, anotar el commit y registrar el detalle en `CHANGELOG.md`.

> Esta lista es independiente de la tabla "BUGS / DEUDA TÉCNICA" de `CONTEXT.md`
> y de la "ORDEN DE EJECUCIÓN" de `CLAUDE.md`.

---

## ✅ Completadas

| # | Mejora | Commit |
|---|--------|--------|
| 1 | Alarma visual — filas de stock negativo parpadean en rojo (Encargado + Hub Admin) | `c50ee3b` |
| 2 | Tab Urgente dedicado en Stock del Encargado (críticos + badge en vivo + Compartir WhatsApp) | `cdca4e6` |
| 3 | Lotes guardados con búsqueda por fecha (tab 🗂️ Guardados, `LotesGuardados.tsx`) | `66b6fa2` |
| 4 | Impresión solo contenido relevante (convención `.no-print` / `.pb-print-band` / `.pb-print-flat`) | `a528c88`, `45d0c23` |
| 5 | Revisión/sincronización manual por chofer con indicador azul (localStorage `pb_revisados_<fecha>`) | `d5f6767` |
| 6 | Salidas por picking en Encargado (tab Lote → Entrada/Salida, `SalidaPicking.tsx`) | `2ba2bea` |

---

## ⏳ Pendientes

| # | Mejora | Notas |
|---|--------|-------|
| 7 | **Despacho directo Encargado → choferes** | Que el Encargado pueda despachar mercancía directamente a un chofer (no solo picking general). Descuenta del loker y queda atribuido al chofer. |
| 8 | **Lista manual del Encargado visible en Hub Admin** | Lo que el Encargado registra manualmente (picking / despacho / pedido) se ve en el Hub Admin. Relacionado con #14. |
| 9 | **Módulo de reposición inteligente** | Sugerir reposición según stock, consumo y mínimos. |
| 10 | **PWA con comportamiento nativo** | Instalable por área, splash, offline, sensación de app nativa. |
| 11 | **Cambio de color en la sub-área Entrada** | Ajustar el color/identidad visual de 📥 Entrada en el tab Lote (hoy verde) para diferenciarla mejor de 📤 Salida (rojo). |
| 12 | **Separar tabs** | Reorganizar/separar mejor los tabs del Encargado para que cada área quede más clara (continuación de Entrada/Salida y de los tabs Guardados/Urgente). |
| 13 | **Buscador inteligente por área** | Además del buscador global, un buscador contextual por área/tab (Lote, Stock, Choferes…) que entienda el contexto en el que está el Encargado. |
| 14 | **Lista de pedido BON visible en Admin** | El pedido que el Encargado hace a BON (lo que se ordena para reponer) visible en el Hub Admin. Relacionado con #8. |

---

*Polar Breeze, S.R.L. · Santiago, Rep. Dom. · mantener este archivo al día con cada mejora.*
