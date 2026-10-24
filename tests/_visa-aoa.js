// Helpers de fixture Visa sintético (copiados de importar-visa.spec.js)

/** Format number as es-AR with 2 decimal places */
function fmtAR(n) {
  return Math.abs(n).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function fmtPesos(n) {
  const s = fmtAR(n);
  return n < 0 ? `$-${s}` : `$${s}`;
}
function fmtUSD(n) {
  return `U$S${fmtAR(n)}`;
}

/**
 * Build a synthetic Visa AOA matching the real fixture structure.
 * cards: [{ nombre, numero, tipo:'titular'|'adicional', movs:[{fecha,desc,cuotaN?,cuotaM?,comp,pesos?,usd?}], totalPesos, totalUSD }]
 * pagos: [{ fecha, desc, pesos?, usd? }]
 * otros: [{ desc, monto }]
 */
function buildVisaAoa({
  cierre = '01/10/2026',
  vencimiento = '09/10/2026',
  proxCierre = '29/10/2026',
  proxVencimiento = '11/11/2026',
  totalPesos = 170621.25,
  totalUSD = 20.78,
  cards = [],
  pagos = [],
  otros = [],
} = {}) {
  const rows = [];
  rows.push(['Movimientos del resumen', '', '', '', '', '']);
  rows.push(['Tarjeta Visa Crédito terminada en 1111', '', '', '', '', '']);
  rows.push(['', '', '', '', '', '']);
  rows.push(['Fecha de cierre', 'Fecha de vencimiento', '', '', '', '']);
  rows.push([cierre, vencimiento, '', '', '', '']);
  rows.push(['Total a pagar', '', '', '', '', '']);
  rows.push([fmtPesos(totalPesos), fmtUSD(totalUSD), '', '', '', '']);
  rows.push(['Mínimo a pagar', '', '', '', '', '']);
  rows.push([fmtPesos(totalPesos), fmtUSD(totalUSD), '', '', '', '']); // ignored
  rows.push(['', '', '', '', '', '']);
  rows.push(['', '', '', '', '', '']);
  rows.push(['Cierres y vencimientos', '', '', '', '', '']);
  rows.push(['Resumen actual', 'Próximo resumen', '', '', '', '']);
  rows.push([`Cierre: ${cierre}`, `Cierre: ${proxCierre}`, '', '', '', '']);
  rows.push([`Vencimiento: ${vencimiento}`, `Vencimiento: ${proxVencimiento}`, '', '', '', '']);
  rows.push(['', '', '', '', '', '']);
  // Pago de tarjeta
  rows.push(['Pago de tarjeta y devoluciones', '', '', '', '', '']);
  rows.push(['Fecha', 'Descripción', 'Cuotas', 'Comprobante', 'Monto en pesos', 'Monto en dólares']);
  for (const p of pagos) {
    rows.push([p.fecha || '', p.desc || '', '', '-',
      p.pesos != null ? fmtPesos(p.pesos) : '',
      p.usd != null ? fmtUSD(p.usd) : '']);
  }
  rows.push(['', '', '', '', '', '']);
  // Card sections
  for (const card of cards) {
    const prefix = card.tipo === 'adicional' ? `Adicional de ${card.nombre}` : `Tarjeta de ${card.nombre}`;
    rows.push([`${prefix} - Visa Crédito terminada en ${card.numero}`, '', '', '', '', '']);
    rows.push(['Fecha', 'Descripción', 'Cuotas', 'Comprobante', 'Monto en pesos', 'Monto en dólares']);
    let lastFecha = '';
    for (const mov of card.movs) {
      const fechaCol = mov.fecha !== lastFecha ? mov.fecha : '';
      if (mov.fecha !== lastFecha) lastFecha = mov.fecha;
      const cuota = (mov.cuotaN != null && mov.cuotaM != null) ? `${mov.cuotaN} de ${mov.cuotaM}` : '';
      rows.push([fechaCol, mov.desc, cuota, mov.comp || '',
        mov.pesos != null ? fmtPesos(mov.pesos) : '',
        mov.usd != null ? fmtUSD(mov.usd) : '']);
    }
    rows.push([`Total de Visa Crédito terminada en ${card.numero}`, '', '', '',
      fmtPesos(card.totalPesos ?? 0), fmtUSD(card.totalUSD ?? 0)]);
    rows.push(['', '', '', '', '', '']);
  }
  // Otros conceptos
  if (otros.length) {
    rows.push(['Otros conceptos', '', '', '', '', '']);
    rows.push(['Descripción', 'Monto en pesos', '', '', '', '']);
    for (const o of otros) {
      rows.push([o.desc, fmtPesos(o.monto), '', '', '', '']);
    }
    rows.push(['Aviso importante: sin validez legal.', '', '', '', '', '']);
  }
  return rows;
}
module.exports = { buildVisaAoa };
