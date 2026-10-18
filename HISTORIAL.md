# Historial de construcción — Mis Finanzas

Registro de cómo se fue armando la app y por qué. Sin datos personales (el repo es público).

## Qué es
PWA de uso personal en un solo archivo (`index.html` + `sw.js` + `manifest.json`). Datos en `localStorage`. Se publica con GitHub Pages. Objetivo: cargar gastos e ingresos en el momento (con voz, porque se usa manejando), categorizar solo, importar resúmenes a fin de mes para conciliar, ver gráficos y patrimonio, y sacar backups y reportes.

## Decisiones de diseño
- Un solo archivo y sin servidor: simple de publicar, pero obliga a leer el archivo con cuidado (ver `CLAUDE.md`, sección "Ahorro de contexto").
- Saldo de un medio = inicial − gastos + ingresos. Los movimientos marcados "Solo historial" se guardan y entran en gráficos, pero NO tocan el saldo.
- Voz: Web Speech API (es-AR) + Claude Haiku llamado desde el navegador con clave propia. La clave queda en el dispositivo; se mitiga con límite mensual de gasto y vencimiento (hay que regenerarla a tiempo).
- Service worker stale-while-revalidate: tras publicar una versión, la primera apertura muestra la vieja; hay que abrir dos veces.
- Evolución del patrimonio: usa "snapshots" que se guardan al abrir la app. No se puede reconstruir el pasado importando movimientos.
- Open Finance no está operativo en Argentina: los resúmenes se importan por CSV.

## Cronología
- 13/10/2026: idea, requisitos y primera versión publicada. Asistente inicial de saldos, categorías y reglas, snapshots, gráficos de evolución.
- 13–14/10: respaldo (exportar/restaurar), exportar CSV, reporte PDF, entrada por voz, importar CSV con detección de duplicados, ingresos además de gastos.
- 14/10: correcciones tras pruebas en el celular:
  - Importes multiplicados por 100 al importar CSV con punto decimal → parser de montos robusto (formato AR y formato decimal con punto).
  - "Importar CSV" no hacía nada → bucle infinito en `parseRow`; reescrito en una sola pasada.
  - "Solo historial" no tenía efecto en el saldo; luego los ingresos "solo historial" seguían sumando → `saldoDe` los ignora.
  - Se verificó una conciliación de resumen de tarjeta contra el PDF (87 movimientos).
- 15/10: compromisos mensuales reales — modelo `estado.compromisos[]` con cuotas y fechas de vencimiento, siembra inicial con datos reales, helpers de proyección por mes, sección de edición en Config, y gráfico "Ingresos vs compromisos del mes" con proyección a 6 meses por entidad. Reemplaza el antiguo rChartIC basado en items.
- 15/10: reemplazados los `prompt()` de `editarCompromiso` y `agregarCompromiso` por un formulario modal único (`#compModal`), reutilizando el patrón `.overlay` + `.wiz-box` ya existente. El modal muestra nombre/entidad/tipo solo al agregar; pago mínimo aparece solo si el tipo es "resumen"; botón "Sin fecha" limpia el campo de vencimiento. Lógica de validación y guardado idéntica a la anterior.
- 16/10: "Compromisos" movido de Config a una vista propia accesible desde una segunda fila de navegación (`.tabs-sec`) debajo de las 4 solapas principales. La fila secundaria usa `flex-wrap` con botones de `calc(25% - 3px)` para envolver cada 4 ítems sin scroll horizontal, preparada para futuras funciones. `mostrarVista` y los listeners de clic se actualizaron para abarcar ambas filas; `renderConfig` ya no llama a `renderCompromisos`.

- 18/10/2026: reorganización de pantalla principal — nueva solapa "Inicio" (vista por defecto) con saldos y cuadros resumen; las dos filas de navegación (`.tabs` y `.tabs-sec`) unificadas en una sola barra con scroll horizontal suave en móvil; "Vínculos" renombrado a "Vínculos Comerciales" (texto de solapa y h2 interno); grilla de saldos forzada a 2 columnas en pantalla ≤480px; valores de los 4 cuadros resumen con `white-space:nowrap` y `font-size:clamp` para evitar cortes en pantalla de 390px. Test Playwright (7 casos) confirmó: sin errores JS, 7 solapas en barra única, Inicio visible por defecto con `#saldos` y `#totNeto`, Movim. sin esos elementos, todas las vistas abribles, "Vínculos Comerciales" en la barra, `#totNeto` en una sola línea a 390px.

## Lecciones
- Un solo pedido grande con muchas funciones gasta mucho contexto y esconde errores. Mejor una tarea por conversación (`/clear` entre tareas).
- Que el asistente marque todo como hecho no equivale a probado: probar la lógica con node y confirmar en el celular.
- No leer `index.html` completo; buscar con grep y leer por tramos.

- 16/10: categorización automática por IA en el flujo de voz — el prompt de parsearVoz ahora incluye ambas listas de categorías (gasto e ingreso) y pide que la IA devuelva "categoria" con el nombre exacto más aproximado al texto. max_tokens subido a 250. mostrarConfirmVoz aplica prioridad: 1) regla del usuario, 2) catIA de la IA si existe en la lista (comparación case-insensitive, devuelve nombre exacto), 3) "Otros/Varios", 4) primer elemento. Verificado con node: cat válida, cat con mayúsculas distintas, cat inventada, regla que pisa a la IA.
- 16/10: deshacer pago de la última cuota — al pagar la última cuota el compromiso ya no se elimina: queda con pendientes=0 y guarda ultimoPago para poder revertir. compromisosMes() ignora compromisos finalizados (pendientes=0, incluso los sin fecha). renderCompromisos muestra los finalizados atenuados (opacity .45) con etiqueta "Finalizado ✓", botón "↩ Deshacer" y botón "Quitar" (borra definitivamente); no muestran Editar ni Pagada. Lógica verificada con node: pagar última cuota → pendientes=0, item=0, compromiso conservado; deshacer → pendientes, proxVenc, monto e item vuelven al estado anterior, gasto eliminado.
- 16/10: "✓ Pagada" en compromisos vinculados a ítems de patrimonio ahora abre un modal de confirmación con cuenta de pago, importe realmente pagado, fecha y opción de actualizar cuota estimada. Al confirmar: crea un gasto categoría "Pago de créditos" en la cuenta elegida, baja el saldo del ítem por la cuota nominal, avanza pendientes y proxVenc. Botón "↩ Deshacer" revierte todo. Compromisos sin vínculo conservan comportamiento anterior. Categoría "Pago de créditos" excluida del gráfico de gastos por categoría. Lógica verificada con node (pago 167000 desde Banco Santander sobre cuota 166523.52: item 500000→333476.48, neto baja 476.48, pendientes 3→2; deshacer restaura estado original).

- 16/10: renderSaldos reorganizado en 3 grupos: ACTIVOS (Efectivo, Mercado Pago, Banco Santander — borde verde izquierdo, monto en verde), DEUDAS (Visa Santander, Mastercard MP — borde rojo izquierdo, monto en rojo, etiqueta "Deuda total", monto en valor absoluto), OTROS (Astropay, American Express — plegable con `<details>`, cerrado por defecto, muestra "OTROS •" si alguno tiene saldo ≠ 0). Se agregó "American Express" a MEDIOS (saldo inicial 0, tratado como tarjeta — no está en MEDIOS_NO_TARJETA, el wizard lo muestra con "(negativo si es deuda)"). Migración automática al cargar. Verificado con node.

- 18/10: botón de voz convertido en FAB (flotante global). El botón inline de la solapa Movim. fue eliminado. Se agregó `<div id="fabVoz">` con `position:fixed` antes de `</body>`, visible en todas las solapas. `voiceStatus` y `voiceConfirm` se movieron al FAB. CSS: `.fab-voz-btn` 56px circular con animación de pulso en estado `listening`. Se oculta automáticamente cuando hay un overlay/modal abierto (`body:has(.overlay:not([hidden])) #fabVoz{display:none}`), en impresión, y respeta `env(safe-area-inset-bottom)`. Lógica JS de voz sin cambios. Test node verifica: un solo btnVoz, ids no duplicados, FAB en el DOM.

- 18/10: creado `.gitignore` con `node_modules/`, `test-results/` y `playwright-report/`. `package-lock.json` ya estaba versionado, no se ignoró. Verificado: `node_modules/` y `test-results/` dejan de aparecer como untracked en `git status`.

- 18/10: (A) secciones plegables en Movim. + (B) botón ojo para ocultar montos. (A) "Cargar movimiento" (form) envuelto en `<details id="det-form">` cerrado por defecto; "Historial de movimientos" en `<details id="det-historial">` abierto por defecto. Estado persistido en localStorage (`finanzas-v1-det-*`). Al iniciar edición el form se abre automáticamente. (B) Botón 👁/🙈 en la barra superior junto a Actualizar. Agrega clase `body.ocultar`; todos los montos en pesos de saldos, resumen, patrimonio, compromisos (Evolución) y vínculos se envuelven en `<span class="amt">` vía `fmtV()` y se ocultan con CSS (`font-size:0 + ::after "••••••"`). Var 7 días también oculta. Gráficos y canvases no enmascarados. Export CSV y backup nunca usan fmtV. Estado del ojo en localStorage (`finanzas-v1-ocultar`). Test node: todos los assertions pasaron.

## Pendiente
- Verificar en el celular: backup/restore y voz.
- Fuentes de ingreso (vincular movimientos a un proveedor) y gráfico por fuente.
- Retoques visuales: botón de actualizar más chico, gráficos en pantalla completa.
- Actualizar este archivo al cerrar cada tarea.
