# MEJORAS — Polar Breeze Hub

> ⚠️ **LEE ESTE ARCHIVO AL INICIO DE CADA SESIÓN Y ACTUALÍZALO ANTES DE HACER PUSH. Si agregas una mejora márcala ⏳, si la completas márcala ✅.**

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
| 7 | Despacho directo Encargado → chofer (botón 🚚 en tab Choferes, `DespachoChofer.tsx`) | `c467981` |
| 8 | Lista manual del Encargado visible en Hub Admin (tab Encargados → Salidas manuales: picking + despacho) | `aec0e9f` |
| 9 | Módulo de reposición inteligente (tab ♻️ Reposición, mínimo manual por producto, `Reposicion.tsx`) | `ff74e6c` |
| 10 | PWA con comportamiento nativo (Admin instalable + SW, banner chofer, deep-link `?tab=` de shortcuts) | `6388f9d` |

---

## ✅ Completadas (cont.)

| # | Mejora | Commit |
|---|--------|--------|
| 11 | Sombreado de la sub-área Entrada (Registro de Lotes) en azul, para diferenciarla de la lista de productos (verde) | `7f20765` |
| 12 | Separar los tabs del Encargado de la fila de arriba (padding superior + divisor sutil en la fila de tabs) | `6c55b8e` |
| 15 | Estructura `assets/fotos/` (hub · despachador · encargado · chofer) con `README.md` por área explicando qué fotos van | `PENDIENTE_HASH` |

---

## ⏳ Pendientes

| # | Mejora | Notas |
|---|--------|-------|
| 13 | **Buscador inteligente por área** | Además del buscador global, un buscador contextual por área/tab (Lote, Stock, Choferes…) que entienda el contexto en el que está el Encargado. |
| 14 | **Lista de pedido BON visible en Admin** | El pedido que el Encargado hace a BON (lo que se ordena para reponer) visible en el Hub Admin. Relacionado con #8. |

---

*Polar Breeze, S.R.L. · Santiago, Rep. Dom. · mantener este archivo al día con cada mejora.*
