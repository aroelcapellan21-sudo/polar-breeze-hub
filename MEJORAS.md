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
| 24 | **Inventario real del chofer (ledger de movimientos, Fase 1B)** | El inventario del chofer debe reflejar TODOS los movimientos, no solo la declaración inicial: lo despachado (**+**), lo vendido según reporte nocturno (**-**), agregados del Encargado (**+**), retiros del Despachador (**-**) y ajustes post-cierre autorizados por Oliver. Relacionado con el cruce `inventario_base` vs `reportes_chofer` (Fase 2, ya hecho) y con la cuenta viva del stock del Loker (`PLAN-CONEXION-ECOSISTEMA.md`, Fase 1B). |
| 25 | 🔄 **(Prioridad 1) Hub (transversal) — nombre completo de producto** | En todo el Hub donde se registren lotes, movimientos o productos debe mostrarse el nombre completo del producto (no siglas ni categoría). El nombre canónico viene de `config/precios`. **Checkpoint (2026-07-06b):** auditoría completa (ver detalle abajo, líneas 25.1-25.3). Hallazgo crítico: `config/puntos` y `config/precios` son catálogos independientes que pueden divergir para el mismo producto físico (ej. real en seeds: "COPA FRESA 16/1" vs "COPA BON DE FRESA 16/1"), y `RegistroLote.tsx`/`CuartoFrio.tsx` anclan contra `config/puntos`, no `config/precios` — esto puede estar partiendo el stock del mismo producto en dos `producto_id` distintos en producción. Plan dividido en 3 sub-fases (25.1 truncamiento UI — hecha; 25.2 unificar catálogo de anclaje — hecha; 25.3 canonicalizar puntos de entrada 100% texto libre — pendiente). **Próximo paso: 25.3** (ver detalle en la fila 25.3). |
| 25.1 | ✅ Fix de truncamiento en UI (sub-fase de #25, sin riesgo) | Corregidos los 4 sitios que cortaban el nombre a la primera palabra con `.split(" ")[0]`: `admin/Inventario.tsx:1147` (badges de Lotes registrados), `admin/Inventario.tsx:1695` (badges de Notas de crédito), `admin/GestionEncargados.tsx:171` (tabla impresa/compartida) y `admin/GestionEncargados.tsx:544` (vista detalle Encargado). Ahora muestran `p.nombre` completo. `tsc --noEmit` + `npm run build` en 0 errores. |
| 25.2 | ✅ Unificar catálogo de anclaje nombre/producto_id (sub-fase de #25, riesgo medio) | `RegistroLote.tsx` y `CuartoFrio.tsx` usan `config/puntos` para `resolverProductoEnCatalogo`/`toProductoId`, en vez de `config/precios` (que sí usa `Choferes.tsx`). `CuartoFrio.tsx` además ni siquiera usa `resolverProductoEnCatalogo` (usa `toProductoId` crudo, mismo bug D-1b ya corregido en otros lados). **Checkpoint (2026-07-06d): datos ✅ — unificación de Firestore completada.** Se investigó `bon/` buscando "nombres canónicos de factura BON"; conclusión: no existe lista propia, el backend de BON (`bon/api/index.js`) ya trata `config/precios` como canónico. Se corrió `unificar-catalogos.mjs` (dry-run + `--confirmar`, Ariel desde su terminal): eliminados los 3 huérfanos de `config/puntos` sin match en precios (`LENGUILETTA FRUTOS ROJOS 24/1`, `HELADO DE CHOCOLATE 1 PINTA 6/1`, `MAGNUM BLANCA ALMENDRA 25/1`), y el resto de `config/puntos.productos` reescrito con `nombre`+`producto_id` idénticos a `config/precios` (conservando cada `puntos`). `config/precios` no se tocó (ya era canónico). **Checkpoint (2026-07-06e): `RegistroLote.tsx` (Encargado) ✅.** Migrado de `config/puntos` a `config/precios` (import `PrecioProducto` en vez de `PuntoProducto`, carga desde `getDoc(doc(db,"config","precios"))`). No dependía del campo `puntos` en ningún lado del archivo (confirmado por grep). `tsc --noEmit` + `npm run build` en 0 errores. **Checkpoint (2026-07-06f): `CuartoFrio.tsx` (Despachador) ✅ — 25.2 completa.** Mismo cambio de catálogo (`config/precios`), y corregido el bug D-1b: en `guardar()` ya no calculaba `producto_id` con `toProductoId(p.nombre)` crudo — ahora usa `resolverProductoEnCatalogo(p.nombre, catalogo)` para anclar nombre+producto_id antes de escribir en `movimientos_loker` (modo foto/IA y manual). `tsc --noEmit` + `npm run build` en 0 errores. **25.2 cerrada. Pendiente: 25.3** (canonicalizar entradas 100% texto libre). |
| 25.3 | 🔄 Canonicalizar puntos de entrada 100% texto libre (sub-fase de #25, alcance grande) | Sin catálogo ni validación alguna: `admin/Inventario.tsx` (form "Registrar movimiento" y "Nota de Crédito"), `encargado/PolarBreezeWeight.tsx` (nombre de producto al escanear código nuevo, con su propio `toProductoId` inline en vez de la función compartida), `admin/GestionCodigos.tsx`, `admin/AnomaliasDespachador.tsx`. Cualquier texto tecleado (sigla, typo, categoría genérica) queda tal cual y se propaga a todas las pantallas de solo-lectura (la mayoría del Hub hereda esto en vez de recanonizar al leer). Dividido en 4 sub-pasos por archivo, orden por impacto en integridad del stock: 25.3.a `PolarBreezeWeight.tsx` (mayor riesgo) → 25.3.b `Inventario.tsx` (2 formularios) → 25.3.c `GestionCodigos.tsx` (tabla de conversión) → 25.3.d `AnomaliasDespachador.tsx` (bajo impacto, solo texto de reporte). UX acordada: input con sugerencias (`<datalist>` contra `config/precios`) que igual permite escribir libre para productos genuinamente nuevos — nunca bloquea. **Checkpoint (2026-07-06g): 25.3.a `PolarBreezeWeight.tsx` ✅.** Agregada carga de `config/precios` (antes no lo cargaba), `<datalist>` de sugerencias en el modal "Nombrar código nuevo", `guardarCodigoNuevo()` ancla el nombre al catálogo si matchea (si no, guarda el texto nuevo tal cual), y `cerrarLote()` reemplaza la fórmula de `producto_id` duplicada a mano por `resolverProductoEnCatalogo()` antes de escribir en `movimientos_loker`. `tsc --noEmit` + `npm run build` en 0 errores. **Checkpoint (2026-07-06h): 25.3.b `admin/Inventario.tsx` ✅.** Agregada carga de `config/precios` (antes no lo cargaba en absoluto). `ncAgregarItem()` (Nota de Crédito) y `handleGuardar()` (Registrar movimiento) ya no calculan `producto_id` con `toProductoId` crudo — ambos usan `resolverProductoEnCatalogo()`. `<datalist>` de sugerencias agregado a los dos inputs de producto (`catalogo-precios-nc`, `catalogo-precios-mov`), sin bloquear texto libre para productos nuevos. `tsc --noEmit` + `npm run build` en 0 errores. **Checkpoint (2026-07-06i): 25.3.c `admin/GestionCodigos.tsx` ✅.** Agregada carga de `config/precios`. `guardar()` ancla `fProducto` con `resolverProductoEnCatalogo()` antes de escribir en `codigos_cajas.producto` (usado por `RegistroLote.tsx`/`convMap` para la conversión cajas→unidades). `<datalist>` de sugerencias agregado al input, sin bloquear texto libre. `tsc --noEmit` + `npm run build` en 0 errores. **Pendiente: 25.3.d (`AnomaliasDespachador.tsx`, bajo impacto — no toca stock).** |
| 26 | **(Prioridad 2) Admin (Configuración) — WhatsApp de alertas de negocio** | Agregar en Configuración un campo donde Oliver pueda poner el número de WhatsApp que recibirá las alertas **operativas/de negocio** (stock bajo, producto agotado, etc.) — **distinto** al número de facturación ya existente. Prerrequisito de #27 y #29. **Nota:** estas son alertas de negocio/operación; las alertas técnicas del sistema son un sistema aparte, no se mezclan aquí. |
| 27 | **(Prioridad 3) Admin / Loker — alerta de stock bajo** | Cuando un producto en el Loker baje de un umbral configurable: mostrar alerta visible en el Hub Y enviar notificación por WhatsApp (número de #26) y por el bot de Telegram. La alerta persiste hasta que Oliver la atienda / restablezca el producto (#28). |
| 28 | **(Prioridad 4) Admin — restablecimiento manual de producto** | Botón en Hub Admin para restablecer manualmente el stock de un producto agotado o bajo, cerrando la alerta. Necesario para cerrar la alerta persistente de #27/#29. |
| 29 | **(Prioridad 5) Admin / Loker — alerta de producto agotado** | Cuando un producto llegue a cero en el Loker, alerta inmediata por los mismos canales que #27 (Hub + WhatsApp + Telegram). |
| 30 | **(Prioridad 6) Encargado (Registro de Lote) — BUG: falso match en `resolverProductoEnCatalogo()`** | Pedido de Oliver. El matching parcial (substring) puede asignar un producto existente a algo que no reconoce cuando la similitud es baja. Revisar/ajustar el umbral de similitud: si no hay match claro, marcar el producto como "no reconocido" en vez de asignarle un nombre incorrecto. Afecta `hub/lib/types.ts` (`resolverProductoEnCatalogo`), usado en `RegistroLote.tsx` y `Choferes.tsx`. Base de #31-33. |
| 31 | **(Prioridad 7) Encargado (Registro de Lote) — productos no reconocidos: fila roja + bloqueo de guardado** | Pedido de Oliver. Cuando el OCR no reconoce un producto, mostrar la fila en rojo y bloquear el guardado del lote hasta que el usuario lo identifique manualmente. Depende de #30. |
| 32 | **(Prioridad 8) Encargado (Registro de Lote) — edición de productos no reconocidos** | Pedido de Oliver. Facilitar que el usuario pueda editar e identificar productos no reconocidos antes de pasarlos al inventario del cuarto frío. Depende de #30/#31. |
| 33 | **(Prioridad 9) Encargado (Registro de Lote) — notificación pre-guardado de no reconocidos** | Pedido de Oliver. Notificar al usuario cuando hay productos no reconocidos antes de guardar el lote. Depende de #30/#31. |
| 34 | **(Prioridad 10) Encargado (Registro de Lote) — diccionario inteligente + sistema de confianza** | Pedido de Oliver. Replicar en el Hub Encargado el diccionario inteligente y el sistema de confianza/calificación de productos que ya existe en APP-DICTADA-A-VOZ (BON). Alcance grande, se apoya en #30-33. |

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
