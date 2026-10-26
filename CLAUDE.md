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
| `finanzas-v1-usd-aviso` | `{ silenciadoComprar, silenciadoPagar, silenciadoEmergente: 'YYYY-MM-DD' o null, proxEmergente: ISO o null }` — avisos de USD MEP de la Visa en Inicio (`silenciadoEmergente` silencia solo el emergente del día; los valores viejos sin ese campo siguen válidos) |
| `finanzas-v1-usd-ref` | `{ cotizacion: number, fecha: 'YYYY-MM-DD' }` — dólar de referencia (Configuración); solo precarga la cotización de "Ya compré los USD", nunca se aplica solo. Va en el backup (campo `usdRef`) |
| `finanzas-v1-tema` | `'auto'` (default) / `'claro'` / `'oscuro'` / `'negro'` / `'neon-azul'` / `'neon-turquesa'` / `'neon-violeta'` — tema de la app; un valor desconocido cae en `'auto'`. Los neón: fondo `#060914` (también `theme-color`), brillo ESTÁTICO (regla fija: sin animaciones continuas, por batería; solo reacciona a `:active`); el turquesa usa `--ok` lima (`#b6ff5c`) para no confundir saldos positivos con el acento. Lista única `TEMAS_VALIDOS` en index.html |
| `finanzas-v1-pin` | PIN de acceso (string de dígitos) |
| `finanzas-v1-ocultar` | boolean — modo ojo (montos ocultos) |
| `finanzas-v1-mi-nombre-banco` | string — cómo figura el nombre del usuario en los bancos (para detectar transferencias propias) |
| `finanzas-v1-backup-meta` | `{ ts: ISO, method }` — cuándo y cómo se exportó el último backup |
| `finanzas-v1-backup-snooze` | ISO — el aviso de backup queda pospuesto hasta esa fecha/hora |
| `finanzas-v1-chart-vals` | boolean — mostrar valores sobre los gráficos |
| `finanzas-v1-chart-vis-<id>` | boolean — gráfico `<id>` oculto (`true`) o visible |
| `finanzas-v1-comp-sort` | `'venc'` (default) / `'entidad'` / `'monto'` — orden de la lista de compromisos |
| `finanzas-v1-det-<id>` | boolean — sección plegable `<id>` abierta o plegada (las copias de Gastos en Evolución usan `finanzas-v1-det-det-ev-…`, ver fila anterior) |
| `finanzas-v1-var-per` | `1` (default) / `7` / `30` / `90` — período en días del cuadro de variaciones |

## Borradores de gastos
- `estado.borradores = [{id, creado, fecha, monto, medio, categoria, nota}]` vive dentro de `finanzas-v1` (sin clave nueva de localStorage); viaja en el backup (`estado.borradores`) y `cargar()` lo migra a `[]`.
- Un borrador NO es un gasto: no entra en `estado.gastos`, saldos, totales, gráficos, historial ni búsqueda.
- Cruce: `_cruzarBorradores(candidatos, medio)` se llama tras la deduplicación en los importadores (Santander/MP desde `_deduplicarImp`; Visa dentro de `_visaArmarCandidatos`). Un borrador cruza con un candidato gasto no duplicado (ni agrupable) si coincide el medio, el importe (dif < 0,01) y la fecha está a ±5 días; si hay varios, gana la fecha más cercana. Cada borrador se usa una sola vez y cada candidato toma como máximo uno; el candidato toma su categoría (pisa a las reglas) y queda `c.deBorrador = id`.
- El preview NO consume: es idempotente y se recalcula. Los borradores se eliminan recién al confirmar la importación y solo los de movimientos efectivamente importados. Al confirmar, el registro del lote (`estado.importaciones[medio].borradoresUsados`) guarda una copia completa de los borradores consumidos; deshacer la importación (Santander/MP y Visa) los devuelve a `estado.borradores` sin duplicar por id.

## Borradores con cuotas (versión mínima)
- Campo opcional `b.cuotas` (entero 2–60) en el borrador; `b.monto` sigue siendo el TOTAL de la compra. `_cuotasDeBorrador(b)` devuelve el entero o 0; si no hay campo pero la nota termina en ` · N cuotas` (borradores viejos) usa ese N. La lista muestra ` · N cuotas` derivado del campo (sin duplicar si la nota ya lo trae). Carga manual: input `#borrCuotas` (vacío = pago único, valor inválido → alert); dictado: guarda `cuotas` y la nota ya no lleva sufijo.
- Cruce (solo Visa, porque Santander/MP no tienen columna de cuotas): un borrador con cuotas M cruza únicamente con un candidato con `c.cuota` `{n:1, m:M}`, mismo medio, fecha ±5 días e importe con `|c.monto − monto/M| ≤ max(2,00; 1 % de monto/M)`; gana la fecha más cercana; uso único. La vista previa dice «📝 cruzó con borrador: <cat> (cuota 1/M)» (`c.deBorradorCuotas`).
- Un borrador sin cuotas nunca cruza con candidatos de un plan (`c.cuota.m > 1`); con filas sin cuota o «1 de 1» sigue igual (importe exacto, ±5 días).
- Las cuotas 2..N NO se cruzan todavía: siguen como siempre (pendiente: que hereden la categoría de la cuota 1). Deshacer restaura el objeto completo, `cuotas` incluido.

## Editar borradores
- Formulario dentro de `<details id="det-borr-manual">` («✍️ Carga manual», cerrado al iniciar, estado no persistido); ✎ lo abre; guardar/cancelar no lo cierran. Botón ✎ (`.borr-edit`) en cada fila de `renderBorradores`: `editarBorrador(id)` carga el borrador en `#formBorrador` (abre la sección, scroll al formulario). Estado de edición en la variable `_borrEditId` (no se persiste); el botón de guardar pasa a «Guardar cambios», aparece `#btnCancelarBorrador` y la fila lleva `.borr-editando`.
- `anotarBorrador` con `_borrEditId` actualiza el MISMO objeto (id y `creado` no cambian; `cuotas` se agrega o se quita) con las mismas validaciones. Si el borrador deja de existir (borrado, consumido por una importación), `renderBorradores` llama `_salirEdicionBorrador()` y el formulario vuelve a modo normal. No toca `_cruzarBorradores` ni saldos.

## Dictado en modo borrador
- Si el transcript coincide con `/\bborrador(es)?\b/i` (código, no IA) y el modelo devuelve tipo `gasto`, `parsearVoz` muestra `mostrarConfirmBorradorVoz` ("¿Confirmás este borrador?") en lugar del panel de movimiento; con tipo `ingreso` o sin la palabra, el flujo es el de siempre.
- El prompt de Haiku pide además `cuotas` (entero, 0 si no hay) y `dias_atras` (0 hoy, 1 ayer…); si faltan se asumen 0. Fecha del borrador = hoy menos `dias_atras`.
- El medio que devuelve el modelo se valida con `_medioValido` (exacto, luego coincidencia parcial, si no `MEDIOS[0]`) y se puede cambiar en el select de Cuenta. Monto ≤ 0 o inválido: no se muestra el panel ni se guarda.
- Al guardar: `estado.borradores.push({id, creado, fecha, monto, medio, categoria, nota})`; no toca `estado.gastos` ni saldos. Con `cuotas>1` se guarda `b.cuotas` (la nota no lleva sufijo) y el panel avisa que cruza con la primera cuota del resumen (ver «Borradores con cuotas»).

- Tarjeta unificada (`mostrarConfirmVoz(monto, medio, desc, tipo, catIA, {cuotas, fecha})`, sin `mostrarConfirmBorradorVoz`): selector `.vc-tipos` de 3 botones (Gasto/Ingreso/Borrador, el activo con `.primary`). Tipo inicial: borrador si hay palabra «borrador» y la IA no dice ingreso; si no, el tipo de la IA. Cambiar de tipo redibuja conservando monto (`#vozBorrMonto`), cuenta (`#vozBorrMedio`), fecha (`#vozFecha`, input date), descripción/nota (`#vozDesc`) y categoría si existe en la nueva lista (si no: regla → categoría de la IA → Otros/Varios). No guarda con monto ≤ 0 ni fecha inválida/futura (mensaje en `#vozMsg`). Gasto/ingreso entran en `estado.gastos` con la fecha elegida; borrador en `estado.borradores`.
- Fecha hablada: el prompt incluye la fecha de hoy y pide `fecha` (YYYY-MM-DD, vacía si no hay); `_fechaVoz(fecha, dias_atras)` la valida (formato real, no futura, no anterior a 5 años); si falla usa `dias_atras`, y si no, hoy. La lista de borradores se ordena por fecha desc y, a igual fecha, `creado` desc.
## Importador Mastercard MP (PDF)
- Botón «📥 Importar Mastercard MP (PDF)» en Configuración. Lee el PDF con `_cargarPDFJS` + `_extraerLineasPDF` (los mismos del importador de Santander/MP) y `parseMastercardMP(lineas, hoyStr)` arma `{cierre, vencimiento, minimo, totalPesos, consol, movs, impuestos, omitidasUsd, difSuma, avisoPagos}`. Medio de los gastos: `Mastercard MP`.
- Formato: el «DETALLE DE MOVIMIENTOS» trae «Composición del saldo del periodo anterior» (se ignora), «Consumos» (filas `d/mmm Descripción [N de M] Operación $ pesos US$ dólares` hasta «Subtotal», sin importar el subtítulo), «Impuestos e intereses» (gasto con categoría `Impuestos e Intereses`) y «Pagos anticipados»/«Ajustes y reembolsos» (se ignoran; si el Consolidado los trae ≠ 0, aviso en el preview). Los totales se leen del bloque «Consolidado» (los del encabezado a veces vienen sin coma).
- Año: las filas no lo traen. Año del cierre = año actual, salvo que el mes de cierre esté a más de 2 meses en el futuro respecto de hoy (entonces el año anterior); una fecha de fila posterior al cierre resta un año; vencimiento < cierre suma un año.
- La fecha de cada fila es la de la compra original, también en cuotas 2..N. Fecha del gasto: la de compra si es pago único o cuota 1; la fecha de cierre si cuota n>1 (como Visa). Consumos solo en USD se omiten (se cuentan en el preview).
- La «Operación» CAMBIA todos los meses para la misma compra: NO vincula cuotas; solo forma parte del `ref` (`fecha|desc|n/m|importe|operación`) que detecta reimportar el mismo PDF. El gasto guarda `cuota {n,m}` y `plan {desc, fecha de compra, m}`.
- Categoría: reglas existentes (`_categorizarVisa`); si cuota n>1 y sin regla, hereda la de un gasto ya importado del mismo plan (descripción normalizada + fecha original + m) con cuota anterior de importe parecido (≤ max(2,00; 1 %), gana el más cercano) y el preview marca «↺ categoría heredada»; si no, queda para revisar. Dos planes con igual descripción y fecha se distinguen por importe.
- Verificación: consumos (pesos) + impuestos vs «Total a pagar» del Consolidado; diferencia > $1 → aviso amarillo (igual se puede importar), si no «✓ Suma verificada».
- Cruce con borradores, deduplicación (`_deduplicarVisaImp`), «conciliado hasta» y deshacer: igual que Visa. Saldos: los gastos entran como gastos normales (`soloHistorial:false`) del medio, como en Visa; el saldo de la deuda se ajusta a mano con «Ajustar saldo». Compromiso `resumen` de `Mastercard MP`: se actualiza (monto, cierre, proxVenc, pagoMinimo) o se crea si no existe; deshacer lo restaura o lo quita.

## Configuración (vista-config)
- 12 secciones `<details class="cfg-section" id="cfg-…" data-cfg="cfg-…">` (fotos: `id="detFotos"`, `data-cfg="cfg-fotos"`) en este orden: apariencia, informe, importar (título «🏦 Importar resúmenes»), backup, usdref, reglas, cats-gastos, cats-ingresos, pin, nombre, apikey, fotos. Todas plegadas cada vez que se ENTRA a la vista (`mostrarVista`), estado no persistido; `renderConfig` nunca cambia `open`.
- Para llevar al usuario a un ajuste: `abrirCfg('cfg-xxx',{foco:'idInput'})` (abre la sección, scroll y foco); nunca solo `mostrarVista('config')`.

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

## Gráficos neón
- `mkChart` es el único punto de creación de gráficos. Con tema `neon-*` (`_esNeon()`) llama a `_neonizar(cfg,id)` y agrega el plugin `neonGrafico` (degradés recreados en `beforeDraw` con la geometría actual; brillo `shadowBlur` solo en líneas, en `beforeDatasetDraw`/`afterDatasetDraw`). El gráfico queda marcado con `chart.$neon` y `canvas.dataset.neon='1'`; en los demás temas no se toca nada.
- Solo `cP` y `cG`/`cG_e` toman el tono del tema (`--neon-a`); el resto conserva sus colores con significado (rojo deuda/gasto, verde ingreso, paletas por categoría/entidad).
- `aplicarTema` recrea los gráficos (Evolución y Gastos) y descarta las copias `_e` plegadas para que se redibujen al abrirlas.
