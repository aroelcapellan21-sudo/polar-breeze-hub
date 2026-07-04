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
| 13 | Buscador inteligente por área (`BuscadorArea.tsx`): filtro contextual por tab en Stock, Urgente, Guardados, Reposición y Choferes — insensible a tildes/mayúsculas | `5e20ce9` |
| 15 | Estructura `assets/fotos/` (hub · despachador · encargado · chofer) con `README.md` por área explicando qué fotos van | `df76cf7` |
| 16 | Fotos del catálogo en `assets/fotos/productos/` (paletas: 16 · helados: 12) + `README.md` | `095f9f9` |
| 17 | El rol chofer puede leer sus propios movimientos en `movimientos_loker` (regla Firestore acotada a `choferId == su uid`, solo lectura) | `7d75ba4` |

---

## ⏳ Pendientes

| # | Mejora | Notas |
|---|--------|-------|
| 14 | **Lista de pedido BON visible en Admin** | El pedido que el Encargado hace a BON (lo que se ordena para reponer) visible en el Hub Admin. Relacionado con #8. |
| 18 | **App Choferes propia** | App dedicada para que cada chofer haga su inventario y lo envíe por WhatsApp a un número específico. |
| 19 | **App Despachador — captura de facturas por foto** | Capturar facturas por foto, lectura por voz producto a producto, y carga automática a los choferes. |
| 20 | **Despachador — ícono del botón comparación** | Cambiar el ícono ⚖️ por 🔃 en el botón de comparación. |
| 21 | **Despachador — renombrar "Cuarto Frío" → "Pikin"** | Cambiar el texto "Cuarto Frío" por "Pikin". |
| 22 | **Encargado (Reposición) — recálculo automático** | Recalcular automáticamente el tab Reposición cuando se registra un lote nuevo en Entrada. |
| A | **Encargado (Salida/Picking) — buscador con teclado** | Agregar un buscador con teclado que filtre los productos en tiempo real. |
| B | **Encargado (Salida/Picking) — historial de salidas** | Agregar una sección de historial de salidas filtrable por fecha. |
| C | **Regla general (todos los hubs) — buscador + consulta histórica** | Toda área que tenga buscador debe tener también una sección de consulta histórica relacionada. |
| D | **Encargado → Chofer — habilitación automática** | Los productos asignados en Salida/Picking se habilitan automáticamente en la app de inventario del chofer. |
| E | **Subtab Salida/Picking — rediseño completo** | Buscador de productos + lista de choferes (ficha y nombre) + flujo: seleccionar producto → elegir chofer → confirmar cantidad → registrar, con descuento automático del stock en `movimientos_loker` y la salida apareciendo en el subtab Despacho del chofer. |
| I | **Despachador (Comparar) — color por estado de despacho** | Choferes sin despacho del día con fondo rojo suave; choferes ya despachados con fondo azul. |
| J | **Despachador (Cierre) — scroll automático** | Al cerrar un informe exitosamente, hacer scroll automático hacia arriba. |
| K | **Despachador (Consulta histórica) — nuevo tab** | Tab de consulta con secciones por fecha: anomalías, despachos, cierres e historial del Pikin. |
| L | **Motor de detección de fraudes (Fase 2)** | Motor automático con 4 reglas: Sobreventado, Complementación, Mínimo exacto de puntos, Venta baja histórica. |
| M | **Admin (Reportes) — reorganización por área** | Separar la información por área: Encargado, Despachador y Admin. El Cuarto Frío pertenece al Encargado. |
| N | **Monitor Telegram — errores de Firestore** | Capturar errores `permission-denied` de Firestore en los `onSnapshot` y enviarlos al bot. |
| O | **Despachador (sesión) — restaurar sesión en progreso** | Restaurar automáticamente la sesión en progreso si el usuario sale y vuelve a entrar. |

---

## ⏳ Pendientes — Módulo #23 "Cuentas por Pagar"

Nuevo módulo (Encargado + Hub Admin): facturas de lotes con vencimiento, estados de pago, acciones de cobro/pago e histórico de precios.

| # | Función | Notas |
|---|---------|-------|
| 23.1 | **Registro con vencimiento (Encargado)** | Al registrar un lote, el Encargado puede marcar la factura con **fecha de vencimiento** y **monto a pagar**. |
| 23.2 | **Panel Cuentas por Pagar (Hub Admin / Oliver)** | Oliver ve un panel con estados: **Pendiente**, **Parcialmente pagada**, **Pagada**, **Vencida**. |
| 23.3 | **Acciones sobre cada factura (Oliver)** | Marcar como **pagada**, registrar **pago parcial**, **posponer** y agregar **comentarios**. |
| 23.4 | **Notificaciones de vencimiento** | Avisos automáticos cuando una factura esté **próxima a vencer**. |
| 23.5 | **Historial de precios por producto** | Registrar y consultar el histórico de precios de compra por producto. |

---

*Polar Breeze, S.R.L. · Santiago, Rep. Dom. · mantener este archivo al día con cada mejora.*
