const { test, expect } = require('@playwright/test');
const path = require('path');

const INDEX = 'file:///' + path.resolve(__dirname, '..', 'index.html').replace(/\\/g, '/');
const iso = (off = 0) => { const d = new Date(); d.setDate(d.getDate() + off); return d.toLocaleDateString('sv'); };

async function load(page, gastos) {
  const estado = {
    iniciales: { 'Banco Santander': 100000 }, gastos, items: [], patrimonioCargado: true,
    compromisos: [], importaciones: {},
  };
  await page.addInitScript(({ estado }) => {
    localStorage.setItem('finanzas-v1', JSON.stringify(estado));
    localStorage.setItem('finanzas-v1-pin', JSON.stringify('1234'));
    window.confirm = () => true; window.alert = () => {};
  }, { estado });
  await page.goto(INDEX);
  for (const d of ['1', '2', '3', '4']) await page.locator(`[data-d="${d}"]`).click();
  await page.waitForSelector('#pinScr', { state: 'hidden' });
}

const G = (id, desc, cat, monto, off, sub) => ({
  id, creado: id, tipo: 'gasto', fecha: iso(off), monto, categoria: cat, medio: 'Banco Santander', descripcion: desc,
  ...(sub ? { subcategoria: sub } : {}),
});

const base = () => [
  G(1, 'YPF Ruta', 'Transporte/Auto', 1000, -5, 'Nafta'),
  G(2, 'Shell', 'Transporte/Auto', 2000, -4, 'Nafta'),
  G(3, 'Autopista', 'Transporte/Auto', 500, -3, 'Peaje'),
  G(4, 'Peaje Norte 1', 'Transporte/Auto', 300, -2),
  G(5, 'Peaje Norte 2', 'Transporte/Auto', 400, -1),
  G(6, 'Super', 'Comida y Delivery', 900, -1),
];

test('formulario: guardar subcategoría y no guardar string vacío', async ({ page }) => {
  await load(page, base());
  const r = await page.evaluate(() => {
    empezarEdicion(6);
    const antes = document.getElementById('subcategoria').value;
    document.getElementById('subcategoria').value = '  Verdura ';
    document.getElementById('subcategoria').dispatchEvent(new Event('input'));
    document.getElementById('form').requestSubmit();
    const g6 = estado.gastos.find(g => g.id === 6).subcategoria;
    empezarEdicion(6);
    document.getElementById('subcategoria').value = '';
    document.getElementById('subcategoria').dispatchEvent(new Event('input'));
    document.getElementById('form').requestSubmit();
    return { antes, g6, despues: estado.gastos.find(g => g.id === 6).subcategoria };
  });
  expect(r.antes).toBe('');
  expect(r.g6).toBe('Verdura');
  expect(r.despues).toBeUndefined();
});

test('chips de la misma categoría ordenados por frecuencia y completan el campo', async ({ page }) => {
  await load(page, base());
  const r = await page.evaluate(() => {
    empezarEdicion(4);
    const chips = [...document.querySelectorAll('#subcatSug .subcat-chip')].map(b => b.textContent);
    document.querySelector('#subcatSug .subcat-chip').click();
    return { chips, val: document.getElementById('subcategoria').value };
  });
  expect(r.chips).toEqual(['Nafta · 2 veces', 'Peaje · 1 vez']);
  expect(r.val).toBe('Nafta');
});

test('aprendizaje por descripción: sugiere al crear y al editar, sin guardar sola', async ({ page }) => {
  await load(page, [...base(), G(7, 'Café Martínez', 'Comida y Delivery', 100, -9, 'Cafetería'), G(8, 'cafe martinez', 'Comida y Delivery', 150, -2, 'Desayuno')]);
  const r = await page.evaluate(() => {
    resetForm();
    const d = document.getElementById('descripcion');
    d.value = 'CAFE MARTINEZ'; d.dispatchEvent(new Event('input'));
    const sug = document.getElementById('subcategoria').value;
    const aviso = !document.getElementById('subcatAviso').hidden;
    d.value = 'otra cosa'; d.dispatchEvent(new Event('input'));
    const trasCambio = document.getElementById('subcategoria').value;
    // edición de un gasto sin subcategoría
    estado.gastos.push({ id: 99, creado: 99, tipo: 'gasto', fecha: iso0(), monto: 10, categoria: 'Comida y Delivery', medio: 'Banco Santander', descripcion: 'Café Martínez' });
    empezarEdicion(99);
    const enEdicion = document.getElementById('subcategoria').value;
    const guardado = estado.gastos.find(g => g.id === 99).subcategoria;
    function iso0() { return new Date().toLocaleDateString('sv'); }
    return { sug, aviso, trasCambio, enEdicion, guardado };
  });
  expect(r.sug).toBe('Desayuno'); // el más reciente
  expect(r.aviso).toBe(true);
  expect(r.trasCambio).toBe('');
  expect(r.enEdicion).toBe('Desayuno');
  expect(r.guardado).toBeUndefined();
});

test('etiqueta tocable en Movimientos abre la edición', async ({ page }) => {
  await load(page, base());
  const r = await page.evaluate(() => {
    mostrarVista('gastos'); renderHistorial();
    const tags = [...document.querySelectorAll('.subcat-tag')];
    const vacia = tags.find(t => t.classList.contains('vacia'));
    vacia.click();
    return { n: tags.length, cancelar: !document.getElementById('btnCancelar').hidden, foco: document.activeElement.id };
  });
  expect(r.n).toBeGreaterThan(0);
  expect(r.cancelar).toBe(true);
  expect(r.foco).toBe('subcategoria');
});

test('informe: filtro por categoría, desglose y secciones de impresión', async ({ page }) => {
  await load(page, base());
  const r = await page.evaluate(() => {
    const o = { desde: iso1(-30), hasta: iso1(0), detalle: 'compacto', inclTransf: false, ocultarNombres: false, otrosNombres: '' };
    function iso1(off) { const d = new Date(); d.setDate(d.getDate() + off); return d.toLocaleDateString('sv'); }
    const sinFiltro = buildInformeHTML(o);
    const una = buildInformeHTML({ ...o, categorias: ['Transporte/Auto'] });
    const dos = buildInformeHTML({ ...o, categorias: ['Transporte/Auto', 'Comida y Delivery'] });
    const grupos = [...new DOMParser().parseFromString(una, 'text/html').querySelectorAll('.inf-grp > summary')].map(s => s.textContent.replace(/\s+/g, ' ').trim());
    return {
      sinDesglose: !sinFiltro.includes('Desglose por tipo'), dosSin: !dos.includes('Desglose por tipo'),
      unaCon: una.includes('Desglose por tipo de gasto'), grupos,
      todos: una.includes('Todos los movimientos (5)'), comidaFuera: !una.includes('Super'),
    };
  });
  expect(r.sinDesglose).toBe(true);
  expect(r.dosSin).toBe(true);
  expect(r.unaCon).toBe(true);
  expect(r.todos).toBe(true);
  expect(r.comidaFuera).toBe(true);
  expect(r.grupos.length).toBe(3); // Nafta, Peaje, y "Peaje Norte" agrupado por descripción similar
  expect(r.grupos[0]).toContain('Nafta');
  expect(r.grupos.some(g => g.includes('Peaje Norte') && g.includes('2 mov.'))).toBe(true);
});

test('informe UI: chips multi-selección y casilla de impresión', async ({ page }) => {
  await load(page, base());
  await page.evaluate(() => { abrirInforme(); });
  await page.locator('.inf-cat-chip[data-c="Transporte/Auto"]').click();
  await expect(page.locator('#infPrDesgloseLbl')).toBeVisible();
  await expect(page.locator('#informePrint .inf-sec-desglose')).toHaveCount(1);
  await page.locator('.inf-cat-chip[data-c="Comida y Delivery"]').click();
  await expect(page.locator('#infPrDesgloseLbl')).toBeHidden();
  await page.locator('#infPrTodos').uncheck();
  await expect(page.locator('#informePrint')).toHaveClass(/no-pr-todos/);
});
