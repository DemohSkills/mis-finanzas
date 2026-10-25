# Di.Mi.Trip Pulse Finance — Guía para Claude

## Qué es
PWA de finanzas personales (single-page app). Funciona offline. Publicada con GitHub Pages en el repo `finanzas/`.

## Estructura
- `index.html` — toda la lógica (HTML + CSS + JS, sin dependencias externas salvo Chart.js lazy-loaded)
- `sw.js` — service worker para cache offline
- `manifest.json` — metadatos de PWA
- `icon-any-192.png`, `icon-any-512.png` (purpose any) e `icon-maskable-192.png`, `icon-maskable-512.png` (purpose maskable)
- `PENDIENTES.md` — estado, pendientes y reglas (leer al empezar)
- `tests/` — tests Playwright

## Claves de localStorage
| Clave | Contenido |
|---|---|
| `finanzas-v1` | estado principal: `{ iniciales, gastos, items, patrimonioCargado }` |
| `finanzas-v1-snaps` | snapshots diarios de patrimonio |
| `finanzas-v1-cats` | categorías de gasto personalizadas |
| `finanzas-v1-cats-income` | categorías de ingreso personalizadas |
| `finanzas-v1-rules` | reglas de auto-categorización |
| `finanzas-v1-apikey` | API key de Claude Haiku (solo en el dispositivo) |
| `finanzas-v1-backup-date` | fecha ISO del último backup exportado |
| `finanzas-v1-ticker-mode` | velocidad de la cinta: `'v1'`/`'v2'`/`'v3'`/`'pause'` (migra legados `'1x'`/`'2x'`/`'scroll'`→`'v1'`, `'3x'`→`'v2'`, `'fixed'`→`'pause'`) |
| `finanzas-v1-vt-plegado` | boolean — cuadro de variaciones plegado (`true`) o desplegado (`false`, default) |
| `finanzas-v1-gc-modo` | `'dia'` (default, "Al mismo día") o `'mes'` ("Mes completo") — modo de la comparativa de gastos en la pestaña Gastos |
| `finanzas-v1-det-det-ev-cGC_e`, `finanzas-v1-det-det-ev-cIC_e`, `finanzas-v1-det-det-ev-cG_e` | boolean — estado abierto/plegado de las copias de las tarjetas de Gastos dentro de Evolución (default plegadas = `false`). Ids de las copias: sufijo `_e` (ej. `cGC_e`, `gcBrow_e`); se dibujan solo al abrirlas |
| `finanzas-v1-mig-rend-1` | flag de migración one-shot: ingresos "Ingresos extras" con 'rendimiento' en descripción → 'Rendimientos' |
| `finanzas-v1-usd-aviso` | `{ silenciadoComprar, silenciadoPagar: 'YYYY-MM-DD' o null, proxEmergente: ISO o null }` — avisos de USD MEP de la Visa en Inicio |

## Reglas fijas
- Nunca poner datos reales (saldos, nombres, claves) en el código
- No tocar la API key ni el PIN salvo que se pida explícitamente
- No romper datos existentes en localStorage — siempre migrar con valores por defecto
- Trabajar y commitear SOLO en la rama `trabajo-nocturno`. Agregar archivos por nombre (nunca `git add -A`). NUNCA hacer push ni merge a `main`: publicar lo hace el usuario después de la revisión (ver "Flujo de publicación" en `PENDIENTES.md`).
- Al cerrar cada tarea: añadir una línea fechada en `HISTORIAL.md` bajo "Cronología" con qué se cambió y por qué. Sin datos personales (el repo es público). Incluir `HISTORIAL.md` en el mismo commit.

## Ahorro de contexto (leer antes de tocar código)
- `index.html` pesa ~340 KB (~6100 líneas). NO lo leas completo: cada lectura completa consume decenas de miles de tokens.
- Para ubicar algo: `grep -n "nombreFuncion" index.html` y leé solo ese tramo con `Read` (offset/limit). No hay mapa fijo (las líneas cambian). Para ubicar secciones: `grep -n "^// [A-Z]" index.html`; el CSS termina en el primer `</style>` y el JS principal empieza en el segundo `<script>`.
- Hacé ediciones puntuales (`Edit`), no reescribas el archivo entero.
- Una tarea por conversación. Para probar lógica, extraé la función y corrala con `node`; evitá el navegador con capturas salvo que se pida. Los tests Playwright (`npx playwright test`) sí se corren antes de cada commit.
- No leas `HISTORIAL.md` completo: para registrar un cambio solo agregá la entrada nueva al final del archivo, sin releer el resto.
- Al empezar una tarea, leé `PENDIENTES.md` (estado, pendientes y reglas); al cerrarla, actualizalo con un Edit puntual.
