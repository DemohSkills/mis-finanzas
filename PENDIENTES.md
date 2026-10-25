# PENDIENTES — Di-Mi-Trip Pulse Finance

> Archivo de traspaso entre conversaciones. Leerlo ENTERO al empezar; al cerrar cada tarea, actualizarlo
> con un `Edit` puntual (mover el ítem a "Hecho" o agregar uno nuevo), sin releer `HISTORIAL.md`.
> El repo es PÚBLICO: nada de montos, nombres de personas, claves ni datos bancarios en este archivo.

## Estado actual (2026-10-25)
- Rama de trabajo: `trabajo-nocturno`. Publicado en `main`: commit `44b9f4d`.
- Tests: 781 (Playwright). Todo en verde al publicar.

## Hecho (publicado)
- Comparativa de gastos (mes anterior vs actual vs próximos), con modo "Al mismo día / Mes completo" y tarjeta "Salida mínima de plata este mes". (`525ec61`, `858154f`, `9086c27`)
- Pestaña Gastos reordenada: Comparativa → Ingresos vs compromisos del mes → Gastos por mes (con ranking de categorías). (`2de8a5b`)
- Evolución reorganizada: Activos vs Deudas rediseñado (neto, barras, cobertura, dona de deuda), Gastos financieros fijos leídos de compromisos, Rendimientos y Fijos reubicados, separador de color y copias plegables de los gráficos de gastos. (`3895706`, `a4c9d83`)
- Icono nuevo (pulso + "Di-Mi-Trip"), PNG any + maskable, nombre corto "Di-Mi-Trip", caché del service worker `finanzas-v2`. (`4467b13`)
- Limpieza de documentación: borrados `icon-192.svg` e `icon-512.svg` (sin uso) y actualizado `CLAUDE.md` (íconos PNG, tamaño de `index.html`, flujo sin push a main, mapa de secciones).
- Estados de los USD del resumen de la Visa: falta comprar / comprados (con cotización MEP y costo en pesos opcionales, modal "Ya compré los USD") / pagados. Sin avisos, sin tocar totales ni gastos.

- Costo de los dólares MEP por el débito real del Santander: categoría nueva "En dólares" (gasto normal) y regla en el importador (débito con "titulos publicos" → "En dólares", sin revisar). Se sacó el botón "Ya pagué los USD" de "falta comprar": hay que pasar por "Ya compré los USD". (`6e88516`)
- Avisos en Inicio por los USD MEP de la Visa: banner "falta comprar" (días de mercado, amarillo/rojo/vencido) con emergente a pantalla completa lun–vie 11 a 16 hs repetido cada 30 min, y banner "comprados, falta pagarlos" (sin emergente). Constantes `USD_*` junto a `BACKUP_SNOOZE_K`. (`44b9f4d`)
- Retoques de los avisos de USD (en `trabajo-nocturno`, sin publicar): "Hoy no hay mercado" silencia solo el emergente del día (campo `silenciadoEmergente`; el banner sigue) y el aviso de pagar vencido ya no repite la fecha. Tabla de claves de localStorage de `CLAUDE.md` completa.
- Color de la barra de estado (meta `theme-color`) aplicado al arrancar según el tema guardado y, con tema auto, siguiendo `prefers-color-scheme`; función única `_themeColorPara` en el script inline del `<head>`. Tests en `tests/theme-color.spec.js` (en `trabajo-nocturno`, sin publicar).

## Pendiente (por orden de prioridad sugerido)
1. **Fijos en otra moneda**: los compromisos fijos no tienen campo `moneda`. Agregarlo (ARS/USD) para cargar suscripciones en dólares. La tarjeta "Gastos financieros fijos" ya ignora los que no son ARS y muestra una nota con la cantidad.
2. ~~**Borradores de gastos para conciliar con resúmenes**~~ ✅ Hecho (etapa 1, 2026-10-25): sección «📝 Borradores» en Movimientos (`estado.borradores`), cruce al importar Santander/Mercado Pago/Visa vía `_cruzarBorradores` (reglas en CLAUDE.md) y lupa en el buscador. Etapas siguientes, todavía pendientes:
   - 2a. **Cargar borradores por dictado de voz.**
   - 2b. **Borradores con cuotas**: una compra en N cuotas cruza con el importe de cada cuota (total/N), mes a mes.
   - 2c. **Dividir una compra en varias categorías.**
3. **Importación de Visa**: el 29/10 importar con "📥 Importar Visa (Excel)" (no con el resumen del 1/10).
4. **Regla de interés entre personas (préstamos)**: falta definir tasa y base de cálculo. Necesita una descripción del usuario antes de armar la tarea.
5. **"Mi nombre en los bancos"**: comprobar cómo figura una transferencia Santander → Mercado Pago para que el matching la detecte como transferencia propia. Necesita captura de ambos movimientos.
6. **Cuenta corriente por persona** (posible fusión de Vínculos con Patrimonio): en espera.
7. **Detalles visuales menores**: nombres largos de fijos cortados con "…" en la tarjeta de fijos; el texto del icono "normal" ocupa casi todo el ancho (más margen si se quiere).
8. **Historial git del repo público**: decidir si limpiar valores personales viejos en commits publicados.
9. **Capturas demo**: regenerar (anonimizadas) cuando cambie la UI.
10. **Rediseño con Claude Design**: pospuesto (gasta muchos créditos). Hay brief y capturas guardados por el usuario.
11. **Prueba A/B de modelos** (Sonnet 5.5 vs 4.6) con una tarea chica y `/cost` antes y después de cada una. Baja prioridad: el límite semanal está holgado.
12. ~~**Dólar de referencia en Configuración** (para estimar el costo de los USD cuando no se cargó cotización).~~ Hecho 2026-10-25: precarga el modal "Ya compré los USD".
13. **Verificar la regla "titulos publicos"** con la próxima compra real de dólares MEP (el texto del débito en pesos no estaba confirmado).
14. ~~Brave: pantalla completa e icono~~ **CERRADO**: probado con reinstalación limpia. En Chrome la barra de estado toma el color de la app; en Brave no, porque Brave dibuja su propia barra (limitación de Brave, no se puede forzar desde la app). El icono de Brave (círculo blanco) también se descarta.
15. Pedidos anteriores que el usuario recuerde y no estén acá: agregarlos a esta lista.

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
