// Cuenta "Reservas MP": activo aparte, suma al patrimonio, NO entra en "Disponible hoy"
const { test, expect } = require('@playwright/test');
const path = require('path');

const INDEX = 'file:///' + path.resolve(__dirname, '..', 'index.html').split(path.sep).join('/');
const SK = 'finanzas-v1';
const PIN_KEY = 'finanzas-v1-pin';
const TEST_PIN = '1234';

// Estado viejo: sin 'Reservas MP' en iniciales
function estadoViejo() {
  return {
    iniciales: { 'Banco Santander': 100000, 'Mercado Pago': 50000, 'Visa Santander': -30000,
      'Mastercard MP': -10000, 'American Express': 0, 'Astropay': 0, 'Efectivo': 5000 },
    gastos: [], items: [], compromisos: [], patrimonioCargado: true,
  };
}

async function abrir(page, estado) {
  await page.addInitScript(({ sk, pk, pin, data }) => {
    if (!localStorage.getItem(sk)) localStorage.setItem(sk, JSON.stringify(data));
    localStorage.setItem(pk, JSON.stringify(pin));
  }, { sk: SK, pk: PIN_KEY, pin: TEST_PIN, data: estado });
  await page.goto(INDEX);
  for (const d of TEST_PIN) await page.click(`button[data-d="${d}"]`);
  await page.waitForSelector('#pinScr', { state: 'hidden' });
}

const snapshot = (page) => page.evaluate(() => ({
  rmp: saldoDe('Reservas MP'), mp: saldoDe('Mercado Pago'),
  disp: disponibleHoy(), t: totales(),
}));

test.describe('Reservas MP', () => {
  test('estado viejo: cuenta en ACTIVOS con saldo 0, sin errores', async ({ page }) => {
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await abrir(page, estadoViejo());
    expect(errors).toEqual([]);
    const caja = page.locator('#saldos .saldo-activo', { hasText: 'Reservas MP' });
    await expect(caja).toHaveCount(1);
    const s = await snapshot(page);
    expect(s.rmp).toBe(0);
    expect(await page.evaluate(() => estado.iniciales['Reservas MP'])).toBe(0);
    // dentro del grupo ACTIVOS (antes del título DEUDAS)
    const orden = await page.$$eval('#saldos .saldo-grupo-titulo, #saldos .saldo .nombre',
      els => els.map(e => e.textContent.trim()));
    expect(orden.indexOf('Reservas MP')).toBeGreaterThan(orden.indexOf('ACTIVOS'));
    expect(orden.indexOf('Reservas MP')).toBeLessThan(orden.indexOf('DEUDAS'));
  });

  test('transferir 10.000 MP → Reservas: neto igual, Disponible hoy baja 10.000', async ({ page }) => {
    await abrir(page, estadoViejo());
    const a = await snapshot(page);
    await page.evaluate(() => _ejecutarTransf('Mercado Pago', 'Reservas MP', 10000, hoy(), '', 'transferir'));
    const b = await snapshot(page);
    expect(b.mp).toBe(a.mp - 10000);
    expect(b.rmp).toBe(a.rmp + 10000);
    expect(b.t.neto).toBe(a.t.neto);
    expect(b.disp).toBe(a.disp - 10000);
  });

  test('transferir aparece en el modal con Reservas MP como origen y destino', async ({ page }) => {
    await abrir(page, estadoViejo());
    await page.evaluate(() => abrirTransModal('transferir'));
    expect(await page.$$eval('#transOrigen option', o => o.map(x => x.textContent))).toContain('Reservas MP');
    expect(await page.$$eval('#transDestino option', o => o.map(x => x.textContent))).toContain('Reservas MP');
  });

  test('ingreso de 100 en Reservas MP: sube activos y neto, no toca MP ni Disponible hoy', async ({ page }) => {
    await abrir(page, estadoViejo());
    const a = await snapshot(page);
    await page.evaluate(() => {
      estado.gastos.push({ id: nuevoId(), creado: Date.now(), monto: 100, fecha: hoy(),
        categoria: 'Rendimientos', medio: 'Reservas MP', descripcion: 'x', tipo: 'ingreso', soloHistorial: false });
      guardar(); render();
    });
    const b = await snapshot(page);
    expect(b.rmp).toBe(100);
    expect(b.t.activos).toBe(a.t.activos + 100);
    expect(b.t.neto).toBe(a.t.neto + 100);
    expect(b.mp).toBe(a.mp);
    expect(b.disp).toBe(a.disp);
  });

  test('formulario: medio Reservas MP disponible y categorías de ingreso presentes', async ({ page }) => {
    await abrir(page, estadoViejo());
    const r = await page.evaluate(() => {
      $('tipo').value = 'ingreso'; $('tipo').dispatchEvent(new Event('change'));
      return { medios: [...$('medio').options].map(o => o.textContent), cats: [...$('categoria').options].map(o => o.textContent) };
    });
    expect(r.medios).toContain('Reservas MP');
    expect(r.cats).toContain('Rendimientos');
  });

  test('backup exportar/importar conserva el saldo; backup viejo carga con 0', async ({ page }) => {
    await abrir(page, estadoViejo());
    page.on('dialog', d => d.accept());
    await page.evaluate(() => {
      estado.iniciales['Reservas MP'] = 2500; guardar(); render();
    });
    const json = await page.evaluate(() => buildBackupJson());
    expect(JSON.parse(json).estado.iniciales['Reservas MP']).toBe(2500);
    // limpiar y restaurar
    await page.evaluate(() => { estado.iniciales['Reservas MP'] = 0; guardar(); });
    await page.evaluate((j) => restaurarBackup(new File([j], 'b.json', { type: 'application/json' })), json);
    await page.waitForFunction(() => saldoDe('Reservas MP') === 2500);
    // backup viejo (sin la cuenta)
    const viejo = JSON.stringify({ version: 1, fecha: '2024-01-01', estado: estadoViejo(), snaps: [] });
    await page.evaluate((j) => restaurarBackup(new File([j], 'v.json', { type: 'application/json' })), viejo);
    await page.waitForFunction(() => estado.iniciales['Reservas MP'] === 0 && saldoDe('Mercado Pago') === 50000);
  });

  test('borradores/dictado: _medioValido reconoce Reservas MP y "reserva" no rompe', async ({ page }) => {
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await abrir(page, estadoViejo());
    const r = await page.evaluate(() => ({
      exacto: _medioValido('Reservas MP'), parcial: _medioValido('reservas'),
      desconocido: _medioValido('reserva de la casa'),
    }));
    expect(r.exacto).toBe('Reservas MP');
    expect(r.parcial).toBe('Reservas MP');
    expect(typeof r.desconocido).toBe('string');
    expect(await page.$$eval('#borrMedio option', o => o.map(x => x.textContent))).toContain('Reservas MP');
    // cruce de borrador con medio Reservas MP no rompe
    await page.evaluate(() => {
      estado.borradores = [{ id: 'b1', creado: Date.now(), fecha: hoy(), monto: 10, medio: 'Reservas MP', categoria: 'Otros', nota: '' }];
      _cruzarBorradores([{ tipo: 'gasto', monto: 10, fecha: hoy(), medio: 'Reservas MP' }], 'Reservas MP');
    });
    expect(errors).toEqual([]);
  });
});
