# POLAR BREEZE HUB — DOCUMENTO MAESTRO

**Versión:** 1.1 (revisado y completado por Claude Opus)  
**Fecha:** 24 mayo 2026  
**Estado:** Listo para Claude Code  
**Autor:** Ariel Capellán · **Revisión técnica:** Claude (Anthropic)

---

## 1. DATOS DE LA EMPRESA

**Polar Breeze, S.R.L.**  
Dirección: Calle 2 Esq. 6 No. 11, Altos de Rafey, Santiago, Rep. Dom.  
Teléfono: 809-923-9010  
RNC: 1-32-19659-6  
Portal: https://polar-breeze-hub.vercel.app  
Firebase project: `polar-breeze`  
GitHub: `aroelcapellan21-sudo/polar-breeze-hub`  
Idioma: Español (es-DO)  
Moneda: Peso dominicano (RD$), formato `RD$ 1,234.56`  
Zona horaria: `America/Santo_Domingo` (UTC-4, sin DST)

---

## 2. IDENTIDAD VISUAL OFICIAL

### 2.1 Paleta de colores (del camión real)

| Token | Hex | Uso |
|-------|-----|-----|
| `--pb-yellow` | `#F5C800` | Color dominante, acentos cálidos |
| `--pb-red` | `#D42B2B` | Acento fuerte, FAB principal, alertas |
| `--pb-green` | `#1E8C3A` | Base, confirmaciones, estados OK |
| `--pb-white` | `#FFFFFF` | Fondos primarios |
| `--pb-cream` | `#F9F9F7` | Fondo de página |
| `--pb-text` | `#1A1A1A` | Texto principal |
| `--pb-text-soft` | `#4A4A4A` | Texto secundario |
| `--pb-border` | `#E5E5E2` | Bordes y separadores |

### 2.2 Logo oficial

Cuadro con los tres colores semitransparentes (amarillo, rojo, verde en bandas verticales o como composición) y el emoji 🧊 centrado. **Nunca usar letras "PB".**

### 2.3 Banda tricolor

Línea decorativa de **5 px** de alto debajo de cada header. Tres tramos iguales: amarillo `#F5C800` · rojo `#D42B2B` · verde `#1E8C3A`. Sin gradientes, bordes nítidos.

### 2.4 Tipografía

- **Familia:** Nunito (Google Fonts)
- **Pesos:** 400, 600, 700, 800, 900
- **Tamaños base:** 16 px (body), 14 px (small), 20 px (h3), 24 px (h2), 28 px (h1)

### 2.5 Estilo general

Minimalista claro. Fondo blanco/crema. Colores fuertes solo en acentos, badges y bordes (con transparencias `rgba` cuando se superponen). Headers oscuros (`#1A1A1A`) con texto blanco. Esquinas redondeadas 12 px en cards, 8 px en botones.

---

## 3. AUTENTICACIÓN Y ROLES

### 3.1 Sistema unificado

Toda la autenticación pasa por **Firebase Auth**, sin PINs locales hardcoded en producción. El "PIN 1234" que aparece en versiones actuales es solo placeholder de desarrollo y debe eliminarse al conectar Firebase.

### 3.2 Login del Portal Operativo

- **URL:** https://polar-breeze-hub.vercel.app
- **Campos:** email + contraseña
- Tras login, Firestore devuelve el `role` del usuario y el frontend redirige a la app correspondiente.

### 3.3 Roles (5 totales)

| Rol | Icono | Acceso |
|-----|-------|--------|
| Admin (Oliver) | 👑 | Hub Admin completo (URL separada o ruta protegida) |
| Despachador | 🚚 | App Despachador |
| Encargado | 🏢 | Dashboard del Encargado (incluye Inventario Choferes, Recepción, etc.) |
| Chofer | 📦 | No entra al portal. Reporta solo por WhatsApp. Su "cuenta" existe en Firestore para vincular reportes, pero no tiene login. |
| (Reservado) | — | Futuro: contador, gerente sucursal, etc. |

> **Aclaración importante:** el rol "Chofer" se mantiene en Firestore para asociar datos (puntos, inventario, sobrantes), pero no aparece como opción de login. El portal solo muestra Admin / Despachador / Encargado.

### 3.4 Bloqueo y recuperación

- 3 intentos fallidos → cuenta bloqueada 15 min.
- Oliver puede desbloquear o revocar acceso desde el Hub Admin en cualquier momento.
- Logs de cada login en `logs/auth/{uid}/{timestamp}`.

---

## 4. ARQUITECTURA DEL SISTEMA

```
┌─────────────────────────────────────────────────────────────┐
│                    HUB ADMIN (Oliver)                       │
│   Dashboard global · Reportes · Anomalías · Gestión users   │
└─────────────────────────────────────────────────────────────┘
              │
              ▼
┌─────────────────────────────────────────────────────────────┐
│              PORTAL OPERATIVO (login)                       │
│           polar-breeze-hub.vercel.app                        │
└─────────────────────────────────────────────────────────────┘
       │                  │                    │
       ▼                  ▼                    ▼
  ┌─────────┐      ┌──────────┐         ┌───────────────┐
  │  ADMIN  │      │DESPACHA- │         │  ENCARGADO    │
  │  (👑)   │      │  DOR 🚚  │         │     🏢        │
  └─────────┘      └──────────┘         └───────┬───────┘
                                                │
                                                ▼ (cards internas)
                          ┌─────────────────────────────────────┐
                          │ Recepción · Inventario Choferes ·   │
                          │ Reportes · Formularios · Puntos ·   │
                          │ Emergencia · Alertas · Weight       │
                          └─────────────────────────────────────┘

  ┌──────────────────────────────────────────────────────────┐
  │  CHOFERES (13) — sin app, solo WhatsApp + Telegram Bot   │
  └──────────────────────────────────────────────────────────┘
```

### 4.1 Hub Admin (solo Oliver)

- Ruta protegida o subdominio separado.
- Dashboard completo: KPIs, anomalías, alertas, accesos sospechosos.
- Gestión de usuarios: crear, bloquear, desbloquear, revocar.
- Generador de enlaces de descarga / instalación de cada app interna.
- Acceso exclusivo: ningún otro rol entra aquí.

### 4.2 Portal Operativo

- Login email + contraseña (Firebase Auth).
- Redirección automática según rol.
- Sin contenido propio más allá del login y selector de rol.

### 4.3 App Despachador

- Flujo lineal de 4 pasos: **Seleccionar chofer → Cargar factura → Analizar con IA → Guardar**.
- Lista de 13 choferes activos.
- Botón "Confrontar antes de despachar" (compara factura vs inventario base del chofer).
- Sección **Cuarto Frío**: inventario por foto (cámara o galería), análisis con Claude API, modo manual de respaldo, historial de sesiones.
- **Tablas de referencia**: puntos por producto y precios de venta (editables solo por Admin).
- Integraciones embebidas: **SPIKINSCAN** y **FACTURASCAN** (ver §6).
- **No tiene Dashboard** — experiencia lineal limpia.
- **Pendiente:** aplicar paleta Polar Breeze y reemplazar el botón morado por el FAB 📤.

### 4.4 App Encargado — Dashboard

Es el jefe de operaciones. Maneja varias áreas desde un dashboard de cards:

| Card | Función | Estado |
|------|---------|--------|
| 📦 Recepción de Lotes | Registrar mercancía entrante | ✅ Construida (header verde oscuro) |
| ⚖️ Polar Breeze Weight | Recepción con escáner + báscula BT | 🔧 Pendiente (ver §5) |
| 🚚 Inventario Choferes | App de inventario embebida | 🔧 Integrar aquí |
| 📊 Reportes | Reportes diarios, semanales, quincena | 🔧 Pendiente |
| 📝 Formularios y requisitos | Documentación operativa | 🔧 Pendiente |
| ⭐ Puntos e inventario choferes | Vista de quincena por chofer | 🔧 Pendiente |
| 🚨 Reporte de Emergencia | Solo si automatismo falla | 🔧 Pendiente |
| 🔔 Alertas | Badge rojo + cápsula de alertas de fraude | 🔧 Pendiente |

### 4.5 App Chofer

- Sin app propia.
- Reporta sobrantes por **nota de voz de WhatsApp** al bot.
- El bot transcribe, parsea y envía al sistema.
- Notificaciones de vuelta vía WhatsApp (resumen del día).

---

## 5. MÓDULO POLAR BREEZE WEIGHT (NUEVO)

Módulo de recepción de mercancía dentro del Dashboard del Encargado.

### 5.1 Hardware soportado

- **Escáner de códigos de barras:** USB o Bluetooth (Honeywell, Zebra, o cualquiera modo HID).
- **Báscula Bluetooth:** conexión vía Web Bluetooth API. Lee peso en kg con 2 decimales.

### 5.2 Flujo

1. Encargado escanea código de caja o paleta.
2. Sistema busca el código en Firestore (`codigos_cajas` o `codigos_paletas`).
   - Si existe: muestra nombre del producto y unidades por caja.
   - Si no existe: abre modal "Nombrar este código" → guarda en Firestore para futuras lecturas.
3. Coloca la mercancía en la báscula → peso se captura automáticamente.
4. Sistema guarda registro: `{codigo, producto, peso_kg, unidades, timestamp, encargado_uid}`.
5. Al cerrar el lote, se sincroniza con **SPIKINSCAN** vía Google Sheets compartido (ver §6.1).

### 5.3 Pantallas

- **Vista principal:** input de escaneo + lectura de báscula en tiempo real + tabla del lote en curso.
- Modal de nombrar código nuevo.
- Historial de lotes recibidos (filtrable por fecha).

---

## 6. INTEGRACIONES SPIKINSCAN Y FACTURASCAN

### 6.1 SPIKINSCAN

App existente que registra entrada/salida de cajas y paletas en el cuarto frío. **Mejoras pendientes:**

- Agregar **escáner USB/Bluetooth** como alternativa a la cámara del teléfono.
- Base de datos de códigos de barras en Google Sheets (o Firestore espejado):
  - Hoja `CODIGOS_CAJAS` — código → producto, unidades, peso unitario.
  - Hoja `CODIGOS_PALETAS` — código → producto, cajas por paleta.
- Al escanear, busca automáticamente. Si el código no existe → modal para nombrarlo → guarda permanentemente.
- **Sincronización bidireccional con Polar Breeze Weight** vía Google Sheets compartido (mismo dataset de códigos).

### 6.2 FACTURASCAN

- Captura de facturas con cámara → OCR con Claude API → estructura datos → carga al flujo del Despachador.
- Reconoce productos, cantidades, precios.
- Modo manual de respaldo si la IA falla.

---

## 7. BOT WHATSAPP Y BOT TELEGRAM

### 7.1 Bot WhatsApp (Baileys)

**Destinatarios:** los 13 choferes.

**Funciones:**
- Recibe nota de voz del chofer al cierre del día con su reporte de sobrantes.
- Transcribe con Whisper (o Gemini) → parsea cantidades por producto.
- Actualiza Firestore con el inventario del chofer.
- Envía de vuelta resumen formateado: "Hoy reportaste: 12 paletas choco, 8 magnum…"
- Envía recordatorios si un chofer no ha reportado pasadas las 9:30 pm.

### 7.2 Bot Telegram

**Destinatarios:** Oliver, Encargado, Despachador.

**Funciones:**
- Notifica anomalías detectadas por el motor de IA (Módulo 4).
- Recibe reportes de choferes (canal paralelo a WhatsApp por si falla).
- Actualiza simultáneamente Polar Breeze Weight y SPIKINSCAN cuando un chofer reporta movimientos de mercancía.

**Comandos:** `/estado`, `/choferes`, `/alertas`, `/resumen_hoy`.

---

## 8. APP INVENTARIO CHOFERES — ESPECIFICACIÓN COMPLETA

### 8.1 Ubicación

Vive **dentro** del Dashboard del Encargado. Al tocar la card 🚚 Inventario Choferes se abre embebida (no en pestaña nueva).

### 8.2 Acceso

- Si la sesión del Encargado está activa, entra directo.
- En desarrollo: PIN 1234 (placeholder). **Eliminar al conectar Firebase Auth.**

### 8.3 Funciones aprobadas

**Barra de progreso del día**
Tricolor (amarillo → rojo → verde) que avanza según choferes completados.

**Chips de choferes (3 estados)**
- ⏳ Amarillo — pendiente
- ✅ Verde — guardado (al tocar muestra inventario registrado del día)
- 🚨 Rojo — tarde (después de las 10:00 pm)

**Layouts**
- Tablet: panel lateral fijo con lista permanente.
- Móvil: botón 👥 abre modal con la lista.

**Interacción con chofer**
- Tocar chofer pendiente → lo carga como **chofer de turno activo**, banner amarillo suave.
- Tocar chofer completado → modal de solo lectura con tabla `Producto / C.Tiene / C.Vendió / Total RD$`.

**Captura de inventario**
- Inventario base por producto, badge rojo `"Base: X"` indicando cantidad teórica.
- Producto fuera del inventario base → campo rojo + advertencia "No es del inventario".
- Modal 📂 con catálogo completo (Paletas / Helados con scroll).

**Confirmaciones obligatorias**
- Limpiar 🗑
- Borrar producto X
- Guardar inventario

**Resumen y totales**
Modal con tabla `Producto / C.Tiene / C.Vendida / Total RD$` y totales agregados: Sobrante / Vendido / Total RD$.

**Otros**
- `Pts {n}` en header — puntos acumulados de la quincena del chofer (de Firestore).
- Selector de fecha para consultar días anteriores.
- Inventario **bloqueado al guardar**; editar requiere reautorización.
- Botón claro/oscuro en header (corregir bug heredado, ver §15).
- FAB 📤 Polar Breeze superpuesto en todas las pantallas.

### 8.4 Choferes activos (13)

| Ficha | Nombre |
|-------|--------|
| 103 | Willie Agustín Báez Germosén |
| 104 | Rafael Aníbal Martínez Ortiz |
| 105 | Eduardo Ventura Medrano |
| 106 | Richard Jordan de la Cruz Toribio |
| 107 | Eriberto Rafael Torres Collado |
| 108 | Eddy Javier |
| 109 | Juan Evangelista Mejía del Rosario |
| 110 | Marco Elías Gerónimo Almánzar |
| 112 | José Alberto Martínez Rosario |
| 113 | Raylin Robles Cruz |
| 118 | Rafael Martínez Durán |
| 119 | Francisco de Jesús Franco Pimentel |
| 120 | Braimen Alexander Alcántara de la Cruz |

> Las fichas 111, 114-117 quedan reservadas (ex-choferes o futuros).

### 8.5 Catálogo de productos

**Paletas (17)**

PALETA CHOCO MANI 32/1 · PALETA CHOCO CREMA 32/1 · PALETA CHOCO CHOCO 32/1 · PALETA CHINOLA CREMA 24/1 · PALETA FRESA CREMA 24/1 · PALETA CHOCO C. DULCE DE LECHE · PALETA FUDGE BIZCOCHO 24/1 · PALETA FUDGE CHOCOLATE 24/1 · PALETA CHOCO CREMA DON ALFONSO 32/1 · PALETA NATURAL DE COCO 24/1 · PALETA NATURAL DE FRESA 24/1 · PALETA NATURAL DE CHINOLA 24/1 · PALETAS BONICE 24/1 · PALETA DE FRAMBUESA 36/1 · PALETA DE AGUA MANZANA 36/1 · PALETA DE AGUA CHERRY 36/1 · PALETA DE UVA 36/1

**Helados (15)**

COPA BON DE FRESA 16/1 · COPA BON CHIPS DE CHOCOLATE · HELADO FRESA C-3.5 ONZ 24/1 · HELADO CHOCOLATE C-3.5 ONZ · HELADO VAINILLA C-3.5 ONZ · MORDISKO CLÁSICO 24/1 · SANDWICH BON VAINILLA 24/1 · MAGNUM ALMENDRAS 25/1 · MAGNUM CLÁSICO 25/1 · MAGNUM COOKIE REMIX 25/1 · HELADO DE BIZCOCHO 1 PINTA · HELADO DE FRESA 1 PINTA · HELADO DE VAINILLA 1 PINTA · HELADO DE RON PASA 1 PINTA · HELADO MERENGUE DE QUISQUEYA

> Los precios y puntos de cada producto viven en `productos/{id}` en Firestore (campos `precio_rd`, `puntos`).

---

## 9. FAB POLAR BREEZE — EN TODAS LAS PANTALLAS

Reemplaza al botón morado actual en **todas** las pantallas del sistema (Despachador, Encargado, Inventario, Recepción, Weight, etc.).

### 9.1 Diseño

- **Botón principal:** rojo `#D42B2B`, círculo de 56 px, sombra suave, animación de pulso sutil (1 ciclo cada 3s).
- **Posición:** `bottom: 24px; right: 24px;` con z-index máximo.
- Al tocar despliega 4 opciones en abanico:

| Opción | Color | Acción |
|--------|-------|--------|
| 🖨️ Imprimir | `#F5C800` | Abre selector de modo (ver §9.2) |
| 📲 WhatsApp | `#1E8C3A` | Comparte contenido por WhatsApp |
| 📄 PDF | blanco/borde | Genera PDF descargable |
| 📋 Lista | blanco/borde | Copia como texto plano |

Se cierra al tocar fuera o sobre el botón principal.

### 9.2 Sistema de impresión — 3 modos

Al tocar 🖨️ pregunta qué modo usar:

- **Modo Factura** — impresora con papel blanco + carbón amarillo. Sin líneas. Datos de empresa arriba + número de factura + cuerpo + totales abajo.
- **Modo Tabla** — con líneas y columnas. Para reportes e inventarios.
- **Modo Normal** — blanco y negro simple, sin formato especial. Para documentos de texto.

---

## 10. INTELIGENCIA ARTIFICIAL

### 10.1 Claude API (backend)

- Análisis de anomalías y fraudes (Módulo 4).
- Lectura automática de facturas (FACTURASCAN).
- Análisis de inventario por foto (Cuarto Frío).
- Generación de reportes redactados.
- Motor de detección de irregularidades.

### 10.2 Gemini API (asistente conversacional) — Módulo 3

- Embebida en las apps de Encargado y Despachador.
- Responde en lenguaje natural sencillo.
- Gratuita vía Google AI Studio.
- Ejemplos:
  - "¿Quién falta por reportar?" → "Faltan Willie y Raylin."
  - "¿Cuánto vendió Eddy esta semana?" → "RD$ 18,450 en 5 días."

### 10.3 Whisper / Gemini para transcripción

- Transcripción de notas de voz de WhatsApp (Bot Choferes).
- Parseo de cantidades y productos del mensaje hablado.

---

## 11. SEGURIDAD — 5 CAPAS

1. **Acceso** — Firebase Auth (email + password), bloqueo tras 3 intentos, logs en `logs/auth`, Oliver puede revocar accesos en segundos.
2. **Datos** — Firestore Security Rules por rol, HTTPS forzado, backups automáticos diarios.
3. **Dispositivo** — sesión cierra por inactividad (30 min), no se guardan contraseñas en localStorage, solo en cookies HttpOnly de Firebase.
4. **Monitoreo** — alertas a Oliver por Telegram si hay accesos sospechosos, registro de operaciones críticas, bot notifica anomalías.
5. **Recuperación** — backups diarios en Firebase, restauración bajo demanda, modo offline con sincronización al volver internet.

### 11.1 Reglas Firestore (resumen)

```
match /productos/{id}              → read: any auth, write: admin
match /choferes/{id}               → read: admin/despachador/encargado, write: admin
match /inventarios/{fecha}/{id}    → read: admin/despachador/encargado
                                   → write: encargado/admin
match /lotes_recepcion/{id}        → read/write: admin/encargado
match /codigos_cajas/{id}          → read: any auth, write: admin/encargado
match /codigos_paletas/{id}        → read: any auth, write: admin/encargado
match /logs/{cualquier_subruta}    → read: admin, write: server only
match /users/{uid}                 → read: own + admin, write: admin
```

---

## 12. AUTOMATIZACIÓN NOCTURNA — Módulo 3

Al completar todos los choferes ✅ del día:
- Sistema envía resumen individual a cada chofer por WhatsApp.
- Sistema envía informe completo del día a Oliver por WhatsApp y Telegram.
- Hub Admin se actualiza en tiempo real.
- Sin intervención humana.

Al cerrar el picking del Encargado:
- Sistema envía automáticamente la **lista del picking al Despachador** como segunda fuente de información, además de la suya propia.

Cron diario a las 23:00:
- Si algún chofer no reportó → marcarlo 🚨 y notificar a Encargado.
- Generar backup de Firestore.
- Calcular puntos acumulados de la quincena para cada chofer.

---

## 13. ESTRUCTURA DE FIRESTORE (referencia para Code)

```
users/{uid}
  ├── email, role, nombre, ficha?, activo, creado_en

productos/{id}
  ├── nombre, categoria (paleta|helado|otro)
  ├── precio_rd, puntos, unidades_por_caja
  ├── codigo_barras_caja, codigo_barras_paleta

choferes/{ficha}
  ├── nombre, telefono, activo
  ├── inventario_base: { producto_id: cantidad }
  ├── puntos_quincena_actual

inventarios/{YYYY-MM-DD}/choferes/{ficha}
  ├── productos: [{ producto_id, c_tiene, c_vendio, total_rd }]
  ├── totales: { sobrante, vendido, total_rd }
  ├── guardado_en, guardado_por, bloqueado

lotes_recepcion/{id}
  ├── fecha, encargado_uid
  ├── items: [{ codigo, producto_id, peso_kg, unidades }]
  ├── estado (en_curso|cerrado)

codigos_cajas/{codigo}
  ├── producto_id, unidades, peso_unitario_kg, creado_por

codigos_paletas/{codigo}
  ├── producto_id, cajas_por_paleta, creado_por

cuarto_frio_sesiones/{id}
  ├── fecha, fotos[], analisis_ia, inventario_resultante

facturas/{id}
  ├── fecha, chofer_ficha, items[], total_rd, raw_image_url, ocr_data

alertas/{id}
  ├── tipo, severidad, mensaje, chofer_ficha?, leida, creada_en

logs/auth/{uid}/{timestamp}
logs/operaciones/{uid}/{timestamp}
```

---

## 14. VARIABLES DE ENTORNO

```bash
# Firebase
NEXT_PUBLIC_FIREBASE_API_KEY=...
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=polar-breeze.firebaseapp.com
NEXT_PUBLIC_FIREBASE_PROJECT_ID=polar-breeze
NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET=polar-breeze.appspot.com
NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=...
NEXT_PUBLIC_FIREBASE_APP_ID=...

# IA
ANTHROPIC_API_KEY=...
GEMINI_API_KEY=...

# Bots
WHATSAPP_BAILEYS_SESSION=...
TELEGRAM_BOT_TOKEN=...
TELEGRAM_ADMIN_CHAT_ID=...
TELEGRAM_ENCARGADO_CHAT_ID=...
TELEGRAM_DESPACHADOR_CHAT_ID=...

# Google Sheets (sincronización SPIKINSCAN ↔ Weight)
GOOGLE_SHEETS_ID=...
GOOGLE_SERVICE_ACCOUNT_EMAIL=...
GOOGLE_PRIVATE_KEY=...

# Otros
N8N_WEBHOOK_URL=...
```

> Las claves se guardan en Vercel (Settings → Environment Variables). **Nunca commiteadas.**

---

## 15. BUGS CONOCIDOS A CORREGIR

| # | Bug | Prioridad |
|---|-----|-----------|
| 1 | Modo claro/oscuro roto en versiones anteriores de la app de inventario | Alta |
| 2 | Botón 👥 necesita nueva función (mostrar inventarios guardados del día) | Alta |
| 3 | Verificar que el flujo completo del Despachador funciona de inicio a fin | Alta |
| 4 | Verificar que el registro de lotes del Encargado guarda en Firebase correctamente | Alta |
| 5 | Verificar que el portal de entrada redirige correctamente según rol | Alta |
| 6 | Botón morado heredado debe reemplazarse por FAB 📤 en TODAS las apps | Media |
| 7 | App Despachador no tiene paleta Polar Breeze aplicada todavía | Media |

---

## 16. PLAN DE MÓDULOS

| Módulo | Descripción | Precio |
|--------|-------------|--------|
| 1 | Base — inventario, roles, choferes | RD$ 40,000 |
| 2 | Despacho completo, apps tablet | RD$ 40,000 |
| 3 | Bot WhatsApp, Bot Telegram, Gemini, n8n | RD$ 50,000 |
| 4 | Motor anomalías ML, dashboard analítico | RD$ 50,000 |
| 5 | Multi-sucursal nacional | RD$ 40,000 |
| **Total proyecto** | | **RD$ 220,000** |
| Mantenimiento mensual | | RD$ 7,500 / mes |

---

## 17. STACK TECNOLÓGICO

| Componente | Tecnología | Costo |
|-----------|-----------|-------|
| Frontend | Next.js 14 + Tailwind CSS | Gratis |
| Base de datos | Firebase Firestore | Gratis (plan Spark) |
| Autenticación | Firebase Auth | Gratis |
| Storage | Firebase Storage (fotos facturas, cuarto frío) | Gratis hasta 5GB |
| Hosting | Vercel | Gratis (plan Hobby) |
| IA backend | Claude API (Anthropic) | ~US$ 3-5 / mes |
| IA conversacional | Gemini API (Google) | Gratis |
| Automatización | n8n self-hosted o cloud | ~US$ 5 / mes |
| Bot WhatsApp | Baileys (Node.js) | Gratis |
| Bot Telegram | Telegram Bot API | Gratis |
| Hardware (Weight) | Web Bluetooth API (báscula) + HID (escáner) | — |
| **Total mensual** | | **~US$ 8-10 / mes** |

---

## 18. REGLAS PARA CLAUDE CODE

- **Antes** de cualquier cambio → verificar que todo lo demás funciona.
- **Después** de cada cambio → verificar que sigue funcionando.
- **No tocar** lo que ya funciona bien.
- **Trabajar área por área**; confirmar antes de pasar a la siguiente.
- **Nunca mezclar** áreas en un mismo commit.
- **Probar en móvil y tablet** antes de hacer commit.
- Ante cualquier duda → **preguntar antes de implementar**.
- **No dar código al usuario** salvo que lo pida explícitamente.
- **Corregir bugs primero**, agregar funciones después.
- Commits en español, prefijos: `fix:`, `feat:`, `refactor:`, `style:`, `docs:`.
- Una rama por área: `feat/dashboard-encargado`, `feat/polar-breeze-weight`, etc.
- Pull request a `main` solo cuando el área esté completa y probada.

---

## 19. ORDEN DE EJECUCIÓN

| # | Tarea | Bloquea a |
|---|-------|-----------|
| 1 | Corregir bugs existentes (§15) | Todo lo demás |
| 2 | Aplicar paleta Polar Breeze a App Despachador | 3 |
| 3 | Reemplazar botón morado por FAB 📤 en todas las apps | 4 |
| 4 | Construir Dashboard del Encargado (cards) | 5, 6 |
| 5 | Integrar App Inventario Choferes dentro del Dashboard | — |
| 6 | Construir módulo **Polar Breeze Weight** (escáner + báscula BT) | 7 |
| 7 | Mejoras SPIKINSCAN (escáner USB/BT + base códigos en Sheets) | 8 |
| 8 | Sincronización Polar Breeze Weight ↔ SPIKINSCAN vía Sheets | 9 |
| 9 | Conectar Hub Admin a Firebase real | 10 |
| 10 | Construir pantallas internas del Hub Admin | 11 |
| 11 | Bot Telegram (reportes choferes + alertas) | 12 |
| 12 | Automatización nocturna (Módulo 3) | — |

---

## 20. PENDIENTES ACTIVOS DE CLAUDE CODE (resumen ejecutivo)

**Polar Breeze Weight**
- Módulo de recepción de mercancía con escáner USB/Bluetooth + báscula Bluetooth alimentando la misma base de datos.
- Conexión con SPIKINSCAN vía Google Sheets compartido.
- Bot Telegram recibe reportes de choferes y actualiza ambas apps simultáneamente.

**SPIKINSCAN**
- Agregar escáner de mano USB/Bluetooth (Honeywell / Zebra) como opción adicional a la cámara.
- Base de datos de códigos de barras en Sheets: `CODIGOS_CAJAS` y `CODIGOS_PALETAS`. Al escanear busca automáticamente; si no existe, pide nombrarlo y guarda.

**Polar Breeze Hub**
- Al cerrar el picking del Encargado, enviar automáticamente la lista del picking al Despachador como segunda fuente de información, además de la suya propia.

**Sistema de impresión**
- Tres modos en el FAB 📤: Factura, Tabla, Normal. El botón pregunta qué modo usar antes de imprimir.

---

## 21. ARCHIVOS DE REFERENCIA GENERADOS

| Archivo | Descripción | Estado |
|---------|-------------|--------|
| `polar-breeze-final.html` | App inventario choferes completa | ✅ Aprobado |
| `encargado-dashboard.html` | Dashboard encargado (parcial) | ✅ Aprobado |
| `polar-breeze-portal-v3.html` | Portal operativo | ✅ Aprobado |
| `fab-polar-breeze.html` | Botón flotante Polar Breeze | ✅ Aprobado |
| `guia-usuario-inventario.html` | Guía de usuario | ✅ Listo |
| `INFORME_DEFINITIVO_CLAUDE_CODE.md` | Informe para Code | ✅ Listo |
| `POLAR_BREEZE_MASTER_OPUS_REV1.md` | Este documento | ✅ Listo |

---

## 22. GLOSARIO

- **FAB** — Floating Action Button (botón flotante 📤 de Polar Breeze).
- **HID** — Human Interface Device (modo de escáner USB que se comporta como teclado).
- **Inventario base** — cantidad teórica que un chofer debe llevar al iniciar la jornada.
- **Picking** — proceso del Encargado de preparar la mercancía para despacho.
- **Quincena** — período de 15 días para cálculo de puntos del chofer.
- **Sobrante** — productos que devuelve el chofer al final del día.
- **Cuarto Frío** — almacén refrigerado de la empresa.

---

## 23. DASHBOARD DEL ENCARGADO — DISEÑO APROBADO

**Diseño visual**
- Header negro con logo tricolor 🧊 y banda amarillo/rojo/verde
- Dos filas en header: "POLAR BREEZE, S.R.L." arriba / "Encargado" abajo
- Logo: cuadro con tres colores semitransparentes y 🧊 en el centro
- 🔔 Campana en header con badge rojo — al tocar abre cápsula de alertas de fraude
- KPIs: Lotes hoy (amarillo), Pendientes (rojo), Completados (verde)
- Botón flotante FAB 📤 Polar Breeze en todas las pantallas

**Cápsula de alertas (al tocar 🔔)**

Muestra alertas de fraude con:
- Ficha del chofer involucrado
- Área donde se detectó
- Descripción del problema
- Hora del evento

**Cards de áreas (6)**

| Card | Ícono | Color | Función |
|------|-------|-------|---------|
| Recepción de Lotes | 📦 | Amarillo | Registrar mercancía entrante — ya existe |
| Inventario Choferes | 🚚 | Rojo | App de inventario embebida aquí |
| Reportes | 📊 | Verde | Reportes diarios, quincena, períodos |
| Formularios | 📝 | Morado | Requisitos y documentación |
| Puntos e Inventario | ⭐ | Azul | Estado y puntos de cada chofer |
| Reporte de Emergencia | 🚨 | Rojo | Solo cuando el sistema automático falle |

**Actividad reciente**

Lista de últimos movimientos con punto de color:
- 🟡 Amarillo — lotes recibidos
- 🟢 Verde — inventarios guardados
- 🔴 Rojo — pendientes y alertas

**Estado del sistema**

Barra inferior oscura con punto amarillo animado indicando conexión al Hub.

---

## 24. APP INVENTARIO CHOFERES — DISEÑO COMPLETO APROBADO

**Ubicación**

Vive DENTRO del Dashboard del Encargado. Al tocar la card 🚚 Inventario Choferes se abre directamente. No es una app independiente.

**Flujo de acceso**

Portal → Encargado → Dashboard → toca 🚚 Inventario Choferes → abre la app

**Header**
- Fondo negro con logo tricolor 🧊
- "POLAR BREEZE, S.R.L." / "Inventario de Choferes" en dos filas
- Botón 🌙/☀️ modo claro/oscuro — esquina izquierda
- Botón 👥 con badge rojo (conteo pendientes) — abre lista de choferes en celular
- Fecha en esquina derecha

**Banda tricolor:** 5px debajo del header: amarillo | rojo | verde

**Barra de progreso de la jornada**
- Label "Progreso de la jornada" + contador X/12
- Barra tricolor animada (amarillo→rojo→verde)
- Chips de choferes clickeables debajo:
  - ⏳ Amarillo — pendiente (al tocar carga ese chofer)
  - ✅ Verde — guardado (al tocar abre su inventario registrado)
  - 🚨 Rojo parpadeante — tarde, después de las 10pm

**Panel lateral (solo tablet)**

Lista permanente de todos los choferes con punto de color y check. Borde izquierdo amarillo `#F5C800`.

**Botón 👥 (solo celular)**

Abre modal desde abajo con lista completa de choferes.
- Choferes completados ✅ → al tocar abre su inventario registrado del día
- Choferes pendientes ⏳ → al tocar los carga como turno activo

**Inventario registrado (al tocar chofer completado)**

Modal con:
- Header negro con nombre y ficha del chofer
- Banda tricolor
- Tabla por categorías (Paletas / Helados):
  - C.Tiene (sobrante) en amarillo
  - C.Vendió en verde
- Totales: Sobrante / Vendido / Total RD$
- FAB 📤 superpuesto para imprimir o enviar por WhatsApp

**Selector de fecha**

Card con input de fecha y botón "Hoy" en rojo. Permite consultar inventarios de días anteriores.

**Card Chofer de turno**
- Input de ficha numérica (103, 108...)
- Al escribir ficha válida: nombre en verde ✅
- Al escribir ficha inválida: error en rojo ⚠
- Banner amarillo suave "En turno: Nombre — registrando inventario"

**Banner bloqueado**

Cuando el inventario ya fue guardado: Banner rojo suave con 🔒 · Botón "Editar" — requiere confirmación con autorización

**Stats en tiempo real**

Tres cajas: Productos / Unidades / Pts 15  
Pts 15 = puntos acumulados de la quincena (vendrá de Firebase)

**Money boxes**

Dos cajas oscuras: ⭐ Puntos venta / 💰 Total RD$. Se actualizan en tiempo real mientras se ingresan cantidades.

**Listas de productos**

Dos columnas: 🍦 Paletas | 🍨 Helados. Cabecera negra con texto blanco. Cada producto tiene:
- Nombre
- Badge rojo `"Base: X"` si tiene inventario base asignado
- Campo numérico de cantidad
- Botón ✕ para borrar (pide confirmación)
- Si se ingresa cantidad en producto fuera del inventario base: campo se pone en rojo + badge "⚠ No es del inventario"

**Footer fijo**
- 🗑 Botón limpiar todo (pide confirmación)
- ✓ Confirmar — amarillo cuando hay datos, verde cuando guardado

**Modal Confirmar (al dar Confirmar)**
- Tabla con todos los productos ingresados: Producto / C.Tiene / C.Vendida / Total RD$
- Totales generales al final
- Botón "✅ Guardar inventario" (pide confirmación)
- Botón "← Volver"

**Modal 📂 Inventario Base**

Al tocar el botón verde 📂 flotante:
- Lista del inventario base del chofer organizada por Paletas y Helados
- Muestra la cantidad asignada a ese chofer para ese día

**Sistema de confirmaciones**

Cuadro de diálogo centrado para:
- Limpiar todo 🗑
- Borrar un producto ✕
- Guardar inventario
- Desbloquear inventario guardado

**FAB 📤 Polar Breeze**
- Botón rojo `#D42B2B` con animación de pulso
- Al tocar abre: 🖨️ Imprimir (amarillo) / 📲 WhatsApp (verde) / 📄 PDF
- Antes de imprimir pregunta el modo: Factura / Tabla / Normal
- Se superpone en todas las pantallas
- Se cierra al tocar fuera

**Modo claro/oscuro**

Toggle 🌙/☀️ en header. Cambia todos los colores del fondo y cards manteniendo los colores Polar Breeze en acentos.

---

*Sistema diseñado por: Ariel Capellán*  
*Asesoría técnica: Claude (Anthropic)*  
*Documento revisado: 24 mayo 2026 · v1.1*
