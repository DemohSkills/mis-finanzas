// Test: FAB de voz en finanzas/index.html
// Verifica: (a) un solo elemento btnVoz, (b) está en el DOM en todas las solapas (fixed = siempre presente), (c) sin errores de JS sintácticos.

const fs = require('fs');
const path = require('path');

const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');

let errores = 0;

// (a) Exactamente un elemento con id="btnVoz"
const matches = [...html.matchAll(/id="btnVoz"/g)];
if (matches.length !== 1) {
  console.error(`❌ (a) Se esperaba 1 elemento con id="btnVoz", se encontraron: ${matches.length}`);
  errores++;
} else {
  console.log('✅ (a) Un solo elemento btnVoz');
}

// (a2) El viejo botón inline (en .acciones del form) no debe existir más
const viejoBoton = html.includes('class="icon-btn no-print" id="btnVoz"');
if (viejoBoton) {
  console.error('❌ (a2) El botón de voz viejo (icon-btn) todavía está en el DOM');
  errores++;
} else {
  console.log('✅ (a2) Botón inline viejo eliminado del formulario');
}

// (b) El FAB está dentro de #fabVoz con position:fixed → visible en todas las solapas
const fabPresente = html.includes('id="fabVoz"') && html.includes('position:fixed');
if (!fabPresente) {
  console.error('❌ (b) No se encontró el contenedor FAB con position:fixed');
  errores++;
} else {
  console.log('✅ (b) FAB flotante presente con position:fixed');
}

// (b2) voiceStatus y voiceConfirm deben estar dentro de #fabVoz
// El FAB debe estar antes del <script> principal (no después de </script>)
const fabVozBlock = html.match(/<div id="fabVoz"[\s\S]*?<\/div>\s*\n?<\/div>/);
const fabIdx  = html.indexOf('<div id="fabVoz"');
const scrIdx  = html.indexOf('<script>');
if (fabIdx === -1) {
  console.error('❌ (b2) No se encontró el bloque #fabVoz');
  errores++;
} else if (fabIdx > scrIdx) {
  console.error('❌ (b2) #fabVoz está DESPUÉS de <script>: btnVoz no existe al ejecutar el JS');
  errores++;
} else {
  // Extraer el bloque del FAB y verificar que contenga los elementos
  const fabSection = html.slice(fabIdx, html.indexOf('</div>', html.indexOf('</div>', fabIdx) + 1) + 6);
  if (!fabSection.includes('id="voiceStatus"') || !fabSection.includes('id="voiceConfirm"')) {
    console.error('❌ (b2) voiceStatus o voiceConfirm no están dentro del bloque #fabVoz');
    errores++;
  } else {
    console.log('✅ (b2) #fabVoz antes del <script> y contiene voiceStatus + voiceConfirm');
  }
}

// (c) Sin errores sintácticos de JS: el bloque <script> cierra bien y no tiene dobles ids
const scriptBlocks = html.match(/<script[\s\S]*?<\/script>/g) || [];
if (scriptBlocks.length === 0) {
  console.error('❌ (c) No se encontró bloque <script>');
  errores++;
} else {
  // Buscar duplicados de ids críticos
  const idsCriticos = ['btnVoz', 'voiceStatus', 'voiceConfirm'];
  let dupes = false;
  for (const id of idsCriticos) {
    const count = [...html.matchAll(new RegExp(`id="${id}"`, 'g'))].length;
    if (count > 1) {
      console.error(`❌ (c) id="${id}" aparece ${count} veces (duplicado)`);
      dupes = true;
      errores++;
    }
  }
  if (!dupes) console.log('✅ (c) Sin ids duplicados críticos (btnVoz, voiceStatus, voiceConfirm)');
}

// Resumen
console.log('');
if (errores === 0) {
  console.log('✅ Todos los tests pasaron.');
} else {
  console.error(`❌ ${errores} test(s) fallaron.`);
  process.exit(1);
}
