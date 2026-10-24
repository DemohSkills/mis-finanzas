# PENDIENTES — Di-Mi-Trip Pulse Finance

> Archivo de traspaso entre conversaciones. Leerlo ENTERO al empezar; al cerrar cada tarea, actualizarlo
> con un `Edit` puntual (mover el ítem a "Hecho" o agregar uno nuevo), sin releer `HISTORIAL.md`.
> El repo es PÚBLICO: nada de montos, nombres de personas, claves ni datos bancarios en este archivo.

## Estado actual (2026-10-23)
- Rama de trabajo: `trabajo-nocturno`. Publicado en `main`: commit `c8661f1`.
- Tests: 695 (Playwright). Todo en verde al publicar.

## Hecho (publicado)
- Comparativa de gastos (mes anterior vs actual vs próximos), con modo "Al mismo día / Mes completo" y tarjeta "Salida mínima de plata este mes". (`525ec61`, `858154f`, `9086c27`)
- Pestaña Gastos reordenada: Comparativa → Ingresos vs compromisos del mes → Gastos por mes (con ranking de categorías). (`2de8a5b`)
- Evolución reorganizada: Activos vs Deudas rediseñado (neto, barras, cobertura, dona de deuda), Gastos financieros fijos leídos de compromisos, Rendimientos y Fijos reubicados, separador de color y copias plegables de los gráficos de gastos. (`3895706`, `a4c9d83`)
- Icono nuevo (pulso + "Di-Mi-Trip"), PNG any + maskable, nombre corto "Di-Mi-Trip", caché del service worker `finanzas-v2`. (`4467b13`)
- Limpieza de documentación: borrados `icon-192.svg` e `icon-512.svg` (sin uso) y actualizado `CLAUDE.md` (íconos PNG, tamaño de `index.html`, flujo sin push a main, mapa de secciones).

## Pendiente (por orden de prioridad sugerido)
1. **Fijos en otra moneda**: los compromisos fijos no tienen campo `moneda`. Agregarlo (ARS/USD) para cargar suscripciones en dólares. La tarjeta "Gastos financieros fijos" ya ignora los que no son ARS y muestra una nota con la cantidad.
2. **Borradores de gastos para conciliar con resúmenes** (prioridad media): anotar al momento un gasto (fecha, importe, cuenta MP/Santander/Visa, categoría, nota opcional) SIN tocar saldos. Al importar el resumen, cada movimiento se cruza con los borradores (misma cuenta, importe exacto, fecha con ventana de unos días) y toma su categoría; el borrador pasa a usado. Evita duplicar el gasto. Falta: lista de borradores sin cruzar para revisar/borrar, un borrador se consume una sola vez, y (segunda etapa) dividir una compra en varias categorías. Antes: revisar el matching actual del importador para encajarlo ahí.
3. **Importación de Visa**: el 29/10 importar con "📥 Importar Visa (Excel)" (no con el resumen del 1/10).
4. **Regla de interés entre personas (préstamos)**: falta definir tasa y base de cálculo. Necesita una descripción del usuario antes de armar la tarea.
5. **"Mi nombre en los bancos"**: comprobar cómo figura una transferencia Santander → Mercado Pago para que el matching la detecte como transferencia propia. Necesita captura de ambos movimientos.
6. **Cuenta corriente por persona** (posible fusión de Vínculos con Patrimonio): en espera.
7. **Detalles visuales menores**: nombres largos de fijos cortados con "…" en la tarjeta de fijos; el texto del icono "normal" ocupa casi todo el ancho (más margen si se quiere).
8. **Historial git del repo público**: decidir si limpiar valores personales viejos en commits publicados.
9. **Capturas demo**: regenerar (anonimizadas) cuando cambie la UI.
10. **Rediseño con Claude Design**: pospuesto (gasta muchos créditos). Hay brief y capturas guardados por el usuario.
11. **Prueba A/B de modelos** (Sonnet 5.5 vs 4.6) con una tarea chica y `/cost` antes y después de cada una. Baja prioridad: el límite semanal está holgado.
12. **Tabla de claves de localStorage en CLAUDE.md incompleta** (prioridad baja): el código usa ~22 claves y la tabla documenta 11 (faltan tema, pin, ocultar, mi-nombre-banco, backup-meta, backup-snooze, chart-vals, chart-vis, comp-sort, det, var-per).
13. Pedidos anteriores que el usuario recuerde y no estén acá: agregarlos a esta lista.

## Flujo de publicación
- Code trabaja y commitea en `trabajo-nocturno`, sin push.
- Publicar: desde la carpeta `finanzas`, `git status` (limpio y en `trabajo-nocturno`), luego `git checkout main`, `git merge trabajo-nocturno`, `git push origin main`, `git checkout trabajo-nocturno` (debe decir "Switched to branch 'trabajo-nocturno'").
- Antes de publicar, el asesor revisa el resultado con datos reales (no solo los tests).
- Después de publicar: esperar 1–2 min y tocar el botón de actualizar (flechas) en la app.

## Reglas de trabajo acordadas
- Una tarea por conversación de Code, con `/clear` antes (entorno `finanzas`, sin worktree). Un arreglo chico de la misma tarea se hace sin `/clear`.
- Cambios visuales: primero mockup con imágenes, después el prompt.
- Revisar siempre: los 4 temas de la app, modo ojo (importes ocultos), sin overflow horizontal a 360/412/450 px, sin ids duplicados, sin errores de consola.
- No poner datos reales en el código ni en el repo.
- No leer `index.html` ni `HISTORIAL.md` completos: `grep -n` y lectura por tramos; en `HISTORIAL.md` solo agregar al final.

## Referencia de costo (Code, Sonnet 5.5 nivel medio)
- Tarea 1 (Gastos): US$0,78. Tarea 2 + corrección (Evolución): US$2,03. El costo lo domina la relectura del contexto por paso, no el texto generado.
