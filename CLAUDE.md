@AGENTS.md

# CLAUDE.md — Polar Breeze Hub

Este archivo es leído automáticamente por Claude Code al abrir el proyecto.
Léelo completo antes de tocar cualquier archivo.

## 🏢 PROYECTO

Sistema de gestión de distribución de helados para **Polar Breeze, S.R.L.**, Santiago, República Dominicana.

- **URL:** https://polar-breeze-hub.vercel.app
- **Firebase:** proyecto `polar-breeze`
- **GitHub:** aroelcapellan21-sudo/polar-breeze-hub
- **Idioma:** Español (es-DO)
- **Moneda:** RD$ (formato `RD$ 1,234.56`)
- **Zona horaria:** `America/Santo_Domingo` (UTC-4)

## ⚠️ REGLAS OBLIGATORIAS — LEE ESTO PRIMERO

- **Antes** de cualquier cambio → verificar que todo funciona
- **Después** de cada cambio → verificar que sigue funcionando
- **NO tocar** lo que ya funciona bien
- **Trabajar área por área** — confirmar con el usuario antes de pasar a la siguiente
- **Nunca mezclar** áreas en un mismo commit
- **Probar en móvil y tablet** antes de hacer commit
- Ante cualquier duda → **preguntar antes de implementar**
- **No dar código al usuario** salvo que lo pida explícitamente
- **Corregir bugs primero**, agregar funciones después
- Commits en español con prefijos: `fix:` `feat:` `refactor:` `style:` `docs:`
- **Push directo a `main`** — sin PR, sin CI automatizado. Los únicos gates son `npx tsc --noEmit` + `npm run build`, ambos en 0 errores antes de pushear

## 🎨 IDENTIDAD VISUAL OFICIAL

```css
--pb-yellow: #F5C800;  /* Color dominante, acentos */
--pb-red:    #D42B2B;  /* FAB principal, alertas, acento fuerte */
--pb-green:  #1E8C3A;  /* Confirmaciones, estados OK */
--pb-white:  #FFFFFF;  /* Fondos primarios */
--pb-cream:  #F9F9F7;  /* Fondo de página */
--pb-text:   #1A1A1A;  /* Texto principal */
```

- **Tipografía:** Nunito (Google Fonts), pesos 400-900
- **Logo:** Cuadro tricolor semitransparente + emoji 🧊 centrado. NUNCA letras "PB"
- **Banda tricolor:** 5px debajo de cada header — amarillo | rojo | verde, sin gradientes
- **Headers:** fondo negro `#1A1A1A`, texto blanco
- **Estilo:** minimalista claro, colores fuertes solo en acentos

## ✅ LO QUE EXISTE — NO TOCAR SIN AUTORIZACIÓN

- **App Despachador:** flujo 4 pasos, Cuarto Frío, tablas de referencia, SPIKINSCAN, FACTURASCAN
- **App Encargado:** registro de lotes (header verde oscuro), guarda en Firebase
- **Hub Admin:** dashboard con datos simulados, menú lateral, deploy en Vercel
- **Portal:** login email+contraseña, 4 roles, redirección automática

## 🐛 BUGS / MEJORAS PENDIENTES

| # | Descripción | Prioridad | Estado |
|---|-------------|-----------|--------|
| 1 | WhatsApp Web en FAB 📤 — separar código de país del número local, selector rápido (+1 RD/US, +52 MX, +34 ES, +57 CO) | Alta | ✅ Hecho — `FloatingFAB.tsx` (CC_OPTIONS) |
| 2 | Campana de alertas no funciona en Dashboard del día | Alta | ✅ Hecho — `admin/Inventario.tsx` (panel alertasPanel) |
| 3 | Modo claro/oscuro roto en app inventario | Media | ✅ Hecho — `polar-breeze-final.html` (toggleTheme + overrides .dark). Pendiente menor: persistir tema |
| 4 | Botón 👥 — nueva función: ver inventarios guardados | Media | ✅ Hecho — `polar-breeze-final.html` (abrirInvReg desde lista 👥) |
| 5 | Verificar flujo completo del Despachador de inicio a fin | Media | 🟡 Cableado correcto; falta prueba en vivo (Firebase + Node 20) |

## 📋 ORDEN DE EJECUCIÓN

| # | Tarea | Estado |
|---|-------|--------|
| 1 | Corregir todos los bugs | ✅ |
| 2 | Aplicar paleta Polar Breeze a App Despachador | ✅ |
| 3 | Corregir mejoras pendientes (ver tabla arriba) | 🔄 En progreso |
| 4 | Construir Dashboard del Encargado | Pendiente |
| 5 | Integrar App Inventario Choferes dentro del Dashboard | Pendiente |
| 6 | Construir módulo Polar Breeze Weight (escáner + báscula BT) | Pendiente |
| 7 | Mejoras SPIKINSCAN (escáner USB/BT + base códigos en Sheets) | Pendiente |
| 8 | Sincronización Weight ↔ SPIKINSCAN vía Google Sheets | Pendiente |
| 9 | Conectar Hub Admin a Firebase real | Pendiente |
| 10 | Construir pantallas internas del Hub Admin | Pendiente |
| 11 | Bot Telegram (reportes choferes + alertas) | Pendiente |
| 12 | Automatización nocturna completa | Pendiente |

## 📤 FAB FLOTANTE — EN TODAS LAS PANTALLAS

Reemplaza el botón morado actual en ABSOLUTAMENTE TODO el sistema:

- **Botón principal:** rojo `#D42B2B` con animación de pulso
- Al tocar abre: 🖨️ Imprimir (amarillo) · 📲 WhatsApp (verde) · 📄 PDF
- Antes de imprimir pregunta el modo:
  - **Factura** — papel blanco + carbón amarillo, sin líneas
  - **Tabla** — con líneas y columnas
  - **Normal** — blanco y negro simple
- Se superpone sobre todo (z-index máximo)
- Se cierra al tocar fuera

## 👥 CHOFERES ACTIVOS (13)

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

## 📚 DOCUMENTACIÓN COMPLETA

El documento maestro completo con toda la arquitectura, diseños aprobados, estructura de Firestore, variables de entorno y especificaciones detalladas está en:

**`POLAR_BREEZE_MASTER_FINAL.md`** — léelo si necesitas más detalle sobre cualquier área.

---

*Polar Breeze, S.R.L. · Santiago, Rep. Dom. · RNC 1-32-19659-6*  
*Sistema diseñado por: Ariel Capellán · Asesoría: Claude (Anthropic)*
