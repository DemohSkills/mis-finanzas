# Di.Mi.Trip Pulse Finance — Guía para Claude

## Qué es
PWA de finanzas personales (single-page app). Funciona offline. Publicada con GitHub Pages en el repo `finanzas/`.

## Estructura
- `index.html` — toda la lógica (HTML + CSS + JS, sin dependencias externas salvo Chart.js lazy-loaded)
- `sw.js` — service worker para cache offline
- `manifest.json` — metadatos de PWA
- `icon-192.svg`, `icon-512.svg` — íconos

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

## Reglas fijas
- Nunca poner datos reales (saldos, nombres, claves) en el código
- No tocar la API key ni el PIN salvo que se pida explícitamente
- No romper datos existentes en localStorage — siempre migrar con valores por defecto
- Al terminar un cambio: `git add -A && git commit -m "..."` y `git push origin main`

## Ahorro de contexto (leer antes de tocar código)
- `index.html` pesa ~84 KB (~1550 líneas). NO lo leas completo: cada lectura completa consume decenas de miles de tokens.
- Para ubicar algo: `grep -n "nombreFuncion" index.html` y leé solo ese tramo con `Read` (offset/limit). Mapa aproximado (las líneas se corren al editar): CSS 10–172, HTML 174–491, JS 492–fin. Secciones del JS: constantes, utilidades, categorías, reglas, estado/storage, wizard, render, config, CSV, backup, PDF, snapshots, voz, evolución, wireEvents. Para regenerar el mapa: `grep -n "^// [A-Z]" index.html`.
- Hacé ediciones puntuales (`Edit`), no reescribas el archivo entero.
- Una tarea por conversación. Para probar lógica, extraé la función y corrala con `node`; evitá el navegador con capturas salvo que se pida.
