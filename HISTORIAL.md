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

## Lecciones
- Un solo pedido grande con muchas funciones gasta mucho contexto y esconde errores. Mejor una tarea por conversación (`/clear` entre tareas).
- Que el asistente marque todo como hecho no equivale a probado: probar la lógica con node y confirmar en el celular.
- No leer `index.html` completo; buscar con grep y leer por tramos.

## Pendiente
- Verificar en el celular: backup/restore y voz.
- Fuentes de ingreso (vincular movimientos a un proveedor) y gráfico por fuente.
- Retoques visuales: botón de actualizar más chico, gráficos en pantalla completa.
- Actualizar este archivo al cerrar cada tarea.
