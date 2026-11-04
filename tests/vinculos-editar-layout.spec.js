// Vínculos: botón ✎ en cada ítem y filas cuyo nombre nunca se parte a mitad de palabra (también en Patrimonio)
const { test, expect } = require('@playwright/test');
const path = require('path');

const INDEX = 'file:///' + path.resolve(__dirname, '..', 'index.html').split(path.sep).join('/');

function estado() {
  return {
    iniciales: {}, gastos: [], patrimonioCargado: true,
    items: [
      { id: 'b1', nombre: 'Boris', tipo: 'activo', monto: 1234567, grupo: 'Préstamos con personas', persona: 'Boris',
        refInicial: 1000, montoOriginal: 1234567, historial: [] },
      { id: 'b2', nombre: 'Boris Alejandro Fernández', tipo: 'activo', monto: 98765432, grupo: 'Préstamos con personas', persona: 'Boris',
        refInicial: 1000, montoOriginal: 98765432, historial: [] },
      { id: 'b3', nombre: 'Cobro Boris', tipo: 'activo', monto: 50000, grupo: 'Cobros pendientes', persona: 'Boris', historial: [] },
      { id: 'b4', nombre: 'Otro ítem', tipo: 'pasivo', monto: 700, grupo: 'Otros', persona: 'Boris' },
    ],
  };
}

async function abrir(page, ancho) {
  const err = [];
  page.on('pageerror', e => err.push(String(e)));
  await page.setViewportSize({ width: ancho, height: 844 });
  await page.addInitScript(est => {
    localStorage.setItem('finanzas-v1', JSON.stringify(est));
    localStorage.setItem('finanzas-v1-pin', JSON.stringify('1234'));
  }, estado());
  await page.goto(INDEX);
  for (const d of '1234') await page.click(`button[data-d="${d}"]`);
  await page.waitForTimeout(300);
  return err;
}

// Devuelve, para cada elemento de nombre, si alguna PALABRA queda partida en más de una línea
// y cuántas líneas ocupa el nombre; además si los botones no se salen de la fila.
const MEDIR = ({ selFila, selNom }) => {
  return [...document.querySelectorAll(selFila)].map(fila => {
    const nom = fila.querySelector(selNom);
    const tw = document.createTreeWalker(nom, NodeFilter.SHOW_TEXT);
    let partida = false, n;
    while ((n = tw.nextNode())) {
      const re = /\S+/g; let m;
      while ((m = re.exec(n.nodeValue))) {
        const r = document.createRange(); r.setStart(n, m.index); r.setEnd(n, m.index + m[0].length);
        const tops = new Set([...r.getClientRects()].map(x => Math.round(x.top)));
        if (tops.size > 1) partida = true;
      }
    }
    const fr = fila.getBoundingClientRect();
    const botones = [...fila.querySelectorAll('button')].map(b => b.getBoundingClientRect());
    return {
      nombre: nom.textContent.trim(), partida,
      lineas: Math.round(nom.getBoundingClientRect().height / parseFloat(getComputedStyle(nom).lineHeight || 16)),
      botonesDentro: botones.every(b => b.left >= fr.left - 1 && b.right <= fr.right + 1),
      sinScroll: document.documentElement.scrollWidth <= document.documentElement.clientWidth,
    };
  });
};

for (const ancho of [360, 390, 412]) {
  test(`Vínculos a ${ancho}px: el nombre no se parte a mitad de palabra y los botones no se salen`, async ({ page }) => {
    const err = await abrir(page, ancho);
    await page.locator('nav.tabs button[data-vista="vinculos"]').click();
    await page.evaluate(() => document.querySelectorAll('#vinculos details').forEach(d => d.open = true));
    await page.waitForTimeout(150);
    const r = await page.evaluate(MEDIR, { selFila: '#vinculos .persona > ul > li', selNom: '.vinc-nom' });
    expect(r.length).toBe(4);
    for (const f of r) {
      expect(f.partida, `palabra partida en «${f.nombre}»`).toBe(false);
      expect(f.botonesDentro, `botones fuera de la fila de «${f.nombre}»`).toBe(true);
      expect(f.sinScroll).toBe(true);
    }
    expect(err).toEqual([]);
  });

  test(`Patrimonio a ${ancho}px: el nombre no se parte a mitad de palabra y los botones no se salen`, async ({ page }) => {
    const err = await abrir(page, ancho);
    await page.locator('nav.tabs button[data-vista="patrimonio"]').click();
    await page.evaluate(() => document.querySelectorAll('#vista-patrimonio details').forEach(d => d.open = true));
    await page.waitForTimeout(150);
    const r = await page.evaluate(MEDIR, { selFila: '#vista-patrimonio .item', selNom: '.nom' });
    const boris = r.filter(f => /Boris/.test(f.nombre));
    expect(boris.length).toBeGreaterThanOrEqual(3);
    for (const f of boris) {
      expect(f.partida, `palabra partida en «${f.nombre}»`).toBe(false);
      expect(f.botonesDentro, `botones fuera de la fila de «${f.nombre}»`).toBe(true);
    }
    expect(err).toEqual([]);
  });
}

test('si los botones no entran al lado del nombre, bajan enteros a una segunda línea', async ({ page }) => {
  await abrir(page, 360);
  await page.locator('nav.tabs button[data-vista="vinculos"]').click();
  await page.evaluate(() => document.querySelectorAll('#vinculos details').forEach(d => d.open = true));
  const r = await page.evaluate(() => {
    const li = [...document.querySelectorAll('#vinculos .persona > ul > li')].find(l => /Alejandro/.test(l.textContent));
    const main = li.querySelector('.vinc-main').getBoundingClientRect(), acc = li.querySelector('.vinc-acc').getBoundingClientRect();
    return { mainBottom: main.bottom, accTop: acc.top, mainW: main.width, liW: li.getBoundingClientRect().width };
  });
  expect(r.accTop).toBeGreaterThanOrEqual(r.mainBottom - 1); // los botones quedan debajo, no apretando el nombre
  expect(r.mainW).toBeGreaterThan(r.liW * 0.9);               // el nombre + monto usan la línea completa
});

test('Vínculos: ✎ en cada ítem abre el formulario de edición en Patrimonio con los datos cargados', async ({ page }) => {
  const err = await abrir(page, 390);
  await page.locator('nav.tabs button[data-vista="vinculos"]').click();
  await page.evaluate(() => document.querySelectorAll('#vinculos details').forEach(d => d.open = true));
  // un ✎ por ítem (4), incluido el que no tiene otros botones
  expect(await page.locator('#vinculos .persona > ul > li > .vinc-acc > .edit').count()).toBe(4);
  const li = page.locator('#vinculos .persona > ul > li', { hasText: 'Cobro Boris' });
  await li.locator('.edit').click();
  await page.waitForTimeout(400);
  expect(await page.evaluate(() => document.querySelector('.tabs button[aria-selected="true"]').dataset.vista)).toBe('patrimonio');
  await expect(page.locator('#formItem')).toBeVisible();
  await expect(page.locator('#itemNombre')).toHaveValue('Cobro Boris');
  await expect(page.locator('#itemTitulo')).toHaveText('Editar: Cobro Boris');
  expect(await page.evaluate(() => document.activeElement && document.activeElement.id)).toBe('itemMonto');
  // ✎ de un préstamo con referencia de fondo: carga refInicial
  await page.locator('nav.tabs button[data-vista="vinculos"]').click();
  await page.evaluate(() => document.querySelectorAll('#vinculos details').forEach(d => d.open = true));
  await page.locator('#vinculos .persona > ul > li', { hasText: 'Boris Alejandro' }).locator('.edit').click();
  await page.waitForTimeout(300);
  await expect(page.locator('#itemNombre')).toHaveValue('Boris Alejandro Fernández');
  await expect(page.locator('#itemRefInicial')).toHaveValue(/1\.?000/);
  expect(err).toEqual([]);
});

test('Vínculos: los botones ± Ajustar / Fondo / Cobré siguen funcionando con el ✎ al lado', async ({ page }) => {
  await abrir(page, 390);
  await page.locator('nav.tabs button[data-vista="vinculos"]').click();
  await page.evaluate(() => document.querySelectorAll('#vinculos details').forEach(d => d.open = true));
  const prest = page.locator('#vinculos .persona > ul > li', { hasText: 'Boris Alejandro' });
  await prest.locator('button.mini:not(.fondo-btn)').click();
  await expect(page.locator('#ajusteModal')).toBeVisible();
  await page.evaluate(() => document.querySelector('#ajusteModal').hidden = true);
  await prest.locator('.fondo-btn').click();
  await expect(page.locator('#fondoModal')).toBeVisible();
});
