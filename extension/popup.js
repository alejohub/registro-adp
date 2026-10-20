// Función que se inyecta en la pestaña de ADP (debe ser autocontenida).
// Se ejecuta en el mundo MAIN para poder ver el JavaScript de GeneXus (window.gx) de ADP.
// Nunca lanza: devuelve {error} porque executeScript convierte una promesa rechazada en un resultado vacío.
//   action 'scan' → {cells: [{ymd, cls, text}]} del mes que ADP tenga seleccionado
//   action 'work' → añade las marcas de TRABAJO que falten (marks = [[hh, mi], ...])
//   action 'vac'  → registra el día como Vacaciones (toda la jornada)
async function adpRun(action, ymd, marks) {
  const base = '/adpnet/m661a43//servlet/';
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  // Hasta 3 reintentos ante errores de red o HTTP 5xx.
  const fetchText = async path => {
    const name = path.split('?')[0];
    for (let attempt = 0; ; attempt++) {
      let r, netErr;
      try {
        r = await fetch(base + path, { credentials: 'include', cache: 'no-store' });
      } catch (e) {
        netErr = e;
      }
      if (r && r.ok) return r.text();
      if (r && r.status < 500) throw new Error(`${name}: HTTP ${r.status}`);
      const msg = r ? `${name}: HTTP ${r.status}` : `${name}: error de red (${netErr.message})`;
      if (attempt >= 3) throw new Error(`${msg} (tras 3 reintentos)`);
      await sleep(1500 * (attempt + 1));
    }
  };
  const cellsOf = html => {
    const re = /cpr_regdet\?(\d{8}),,N'><p class='CPR_DIALNK'>\d+<\/p><\/a><\/td>\s*<\/tr>\s*<tr>\s*<td valign='bottom'>\s*<p class='(calendario_\d+)'>\s*([^<]*?)\s*<\/p>/g;
    const out = [];
    let m;
    while ((m = re.exec(html))) out.push({ ymd: m[1], cls: m[2], text: m[3] });
    return out;
  };
  const rowsOf = html => {
    const m = html.match(/DatosContainerDataV" value='([^']*)'/);
    if (!m) throw new Error('No se pudo leer la lista de registros del día');
    return JSON.parse(m[1].replace(/&quot;/g, '"').replace(/&amp;/g, '&'));
  };
  // Carga un formulario de ADP en un iframe oculto y espera a que GeneXus lo deje listo.
  const openForm = async (path, readyId) => {
    const fr = document.createElement('iframe');
    fr.style.cssText = 'position:fixed;left:-10000px;top:0;width:700px;height:500px;border:0';
    document.body.appendChild(fr);
    await new Promise((res, rej) => {
      fr.onload = res;
      fr.onerror = () => rej(new Error('No cargó el formulario de ADP'));
      fr.src = base + path;
    });
    for (let i = 0; i < 50; i++) {
      const d = fr.contentDocument, w = fr.contentWindow;
      if (d && d.getElementById(readyId) && d.getElementsByName('BTN_OK')[0] && w.gx && w.gx.evt) return { fr, d, w };
      await sleep(200);
    }
    fr.remove();
    throw new Error('El formulario de ADP no terminó de cargar');
  };
  const set = (d, w, id, v) => {
    const el = d.getElementById(id);
    el.focus();
    el.value = v;
    el.dispatchEvent(new w.Event('change', { bubbles: true }));
    el.blur();
    if (el.value !== v) throw new Error(`No se pudo poner ${id}=${v}`);
  };
  const formError = d => ((d.getElementById('gxErrorViewer') || {}).textContent || '').trim();

  try {
    if (action === 'scan') {
      const cells = cellsOf(await fetchText('cpr_regcal'));
      if (!cells.length) throw new Error('No se encontró el calendario. ¿Sesión caducada?');
      return { cells };
    }

    let det = await fetchText(`cpr_regdet?${ymd},,N`);
    let rows = rowsOf(det);
    const dniM = det.match(/CPR_REGDNI[^A-Za-z0-9]{1,8}([0-9A-Za-z]{8,10})/);
    if (!dniM) throw new Error('No se pudo obtener el identificador del empleado');
    const dni = dniM[1];
    const worked = rows.filter(r => r[8] === 'TRABAJO');

    if (action === 'vac') {
      if (worked.length) return { skipped: 'tiene marcas de TRABAJO; no se marca como vacaciones' };
      const cell = cellsOf(await fetchText('cpr_regcal')).find(c => c.ymd === ymd) || null;
      // Evita duplicar la ausencia si un intento anterior sí llegó a guardarla.
      if (cell && !/^-\d{1,2}:\d{2}$/.test(cell.text)) return { skipped: 'ya no está pendiente' };
      const cellBefore = JSON.stringify(cell);
      const { fr, d, w } = await openForm(`cpr_regaus?1,${ymd},${dni},gxPopupLevel%3D0%3B`, 'vCPR_AUSID');
      try {
        if (d.getElementById('vTIPO') && d.getElementById('vTIPO').value !== '0') set(d, w, 'vTIPO', '0'); // Toda la jornada
        set(d, w, 'vCPR_AUSID', '07'); // Vacaciones
        await sleep(800);
        d.getElementsByName('BTN_OK')[0].click();
        for (let i = 0; i < 12; i++) {
          await sleep(1000);
          const now = cellsOf(await fetchText('cpr_regcal')).find(c => c.ymd === ymd) || null;
          if (JSON.stringify(now) !== cellBefore) return { ok: true, label: 'vacaciones registradas' };
        }
        throw new Error(`No se confirmó la ausencia. ${formError(d)}`.trim());
      } finally {
        fr.remove();
      }
    }

    // action === 'work'. Fila: [..., 5: "DD/MM/YYYY HH:MM:SS", ..., 8: tipo de marcaje, ...]
    const hasMark = (hh, mi) => worked.some(r => String(r[5]).includes(` ${hh}:${mi}:`));
    const todo = marks.filter(([hh, mi]) => !hasMark(hh, mi));
    if (!todo.length) return { skipped: 'ya tiene esas marcas' };
    if (worked.length && worked.length + todo.length !== marks.length) {
      return { skipped: 'tiene marcas de TRABAJO con otras horas; revísalo a mano' };
    }
    for (const [hh, mi] of todo) {
      const before = rows.length;
      const { fr, d, w } = await openForm(`cpr_regaddreg?${ymd},${dni},gxPopupLevel%3D0%3B`, 'vHORAT');
      try {
        set(d, w, 'vCPR_MARID', '1'); // TRABAJO
        set(d, w, 'vHORAT', hh);
        set(d, w, 'vMINUTOT', mi);
        d.getElementsByName('BTN_OK')[0].click();
        let saved = false;
        for (let i = 0; i < 12 && !saved; i++) {
          await sleep(1000);
          rows = rowsOf(await fetchText(`cpr_regdet?${ymd},,N`));
          saved = rows.length > before;
        }
        if (!saved) throw new Error(`No se confirmó el registro de las ${hh}:${mi}. ${formError(d)}`.trim());
      } finally {
        fr.remove();
      }
    }
    return { ok: true, label: `${todo.length} marca/s añadidas y verificadas` };
  } catch (e) {
    return { error: e.message };
  }
}

// ---------------------------------------------------------------- Popup

const $ = id => document.getElementById(id);
const DEFAULTS = { wkIn: '09:00', wkOut: '18:30', frIn: '08:00', frOut: '15:00', agIn: '08:00', agOut: '15:15' };
const DIAS = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'];
let pending = [];

function log(msg, cls) {
  const s = document.createElement('div');
  if (cls) s.className = cls;
  s.textContent = msg;
  $('log').appendChild(s);
}

async function inTab(...args) {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  let res;
  try {
    [res] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, world: 'MAIN', func: adpRun, args });
  } catch (e) {
    throw new Error('Abre esta extensión desde una pestaña de ADP (www.adpnet.esp.adp.com) con la sesión iniciada.');
  }
  const r = res && res.result;
  if (!r) throw new Error('La página de ADP no devolvió respuesta (¿se recargó la pestaña?)');
  if (r.error) throw new Error(r.error);
  return r;
}

function settings() {
  const v = {};
  for (const k of Object.keys(DEFAULTS)) v[k] = $(k).value;
  return v;
}

const toDate = ymd => new Date(+ymd.slice(0, 4), +ymd.slice(4, 6) - 1, +ymd.slice(6));

// Agosto: mismo horario todos los días. Resto del año: viernes distinto.
function scheduleFor(ymd) {
  const t = settings();
  const d = toDate(ymd);
  if (d.getMonth() === 7) return [t.agIn, t.agOut];
  return d.getDay() === 5 ? [t.frIn, t.frOut] : [t.wkIn, t.wkOut];
}

const fmt = ymd => `${DIAS[toDate(ymd).getDay()]} ${ymd.slice(6)}/${ymd.slice(4, 6)}`;

function render() {
  const box = $('days');
  const prev = {};
  for (const row of box.querySelectorAll('.day')) {
    prev[row.dataset.ymd] = { on: row.querySelector('.on').checked, vac: row.querySelector('.vac').checked };
  }
  box.textContent = '';
  for (const ymd of pending) {
    const st = prev[ymd] || { on: true, vac: false };
    const row = document.createElement('div');
    row.className = 'day';
    row.dataset.ymd = ymd;
    const on = Object.assign(document.createElement('input'), { type: 'checkbox', className: 'on', checked: st.on, title: 'Rellenar este día' });
    const name = Object.assign(document.createElement('span'), { className: 'name', textContent: fmt(ymd) });
    const what = Object.assign(document.createElement('span'), { className: 'what' });
    const vacL = Object.assign(document.createElement('label'), { className: 'vacl', title: 'Registrar como vacaciones' });
    const vac = Object.assign(document.createElement('input'), { type: 'checkbox', className: 'vac', checked: st.vac });
    vacL.append(vac, ' Vacaciones');
    const paint = () => {
      const [a, b] = scheduleFor(ymd);
      what.textContent = vac.checked ? '🌴 Vacaciones' : `${a}–${b}`;
      row.classList.toggle('isvac', vac.checked);
      row.classList.toggle('off', !on.checked);
    };
    on.addEventListener('change', paint);
    vac.addEventListener('change', paint);
    paint();
    row.append(on, name, what, vacL);
    box.appendChild(row);
  }
  $('fill').disabled = !pending.length;
}

$('scan').addEventListener('click', async () => {
  $('log').textContent = '';
  try {
    const { cells } = await inTab('scan');
    const n = new Date();
    const today = `${n.getFullYear()}${String(n.getMonth() + 1).padStart(2, '0')}${String(n.getDate()).padStart(2, '0')}`;
    pending = cells
      .filter(c => c.ymd < today && /^-\d{1,2}:\d{2}$/.test(c.text))
      .map(c => c.ymd);
    $('days').textContent = '';
    render();
    const mes = cells[0].ymd.slice(4, 6) + '/' + cells[0].ymd.slice(0, 4);
    log(pending.length ? `${pending.length} día(s) pendiente(s) en ${mes}.` : `No hay días pendientes en ${mes}.`);
    log('(Se usa el mes que tengas seleccionado en el calendario de ADP.)');
  } catch (e) {
    log(e.message, 'err');
  }
});

$('fill').addEventListener('click', async () => {
  $('log').textContent = '';
  if (!allValid()) return log('Corrige las horas marcadas en rojo (formato HH:MM, 24 h).', 'err');
  $('fill').disabled = true; $('scan').disabled = true;
  const chosen = [...$('days').querySelectorAll('.day')]
    .filter(row => row.querySelector('.on').checked)
    .map(row => ({ ymd: row.dataset.ymd, vac: row.querySelector('.vac').checked }));
  // Reintenta el día hasta 3 veces. Es seguro: cada intento vuelve a leer las marcas
  // existentes y solo añade lo que falte.
  const withRetries = async (ymd, run) => {
    for (let attempt = 0; ; attempt++) {
      try {
        return await run();
      } catch (e) {
        if (attempt >= 3) throw e;
        log(`${fmt(ymd)}: ${e.message} — reintento ${attempt + 1}/3…`, 'err');
        await new Promise(r => setTimeout(r, 2000 * (attempt + 1)));
      }
    }
  };
  try {
    for (const { ymd, vac } of chosen) {
      let r;
      if (vac) {
        log(`${fmt(ymd)}: registrando vacaciones…`);
        r = await withRetries(ymd, () => inTab('vac', ymd, null));
      } else {
        const [a, b] = scheduleFor(ymd);
        log(`${fmt(ymd)}: registrando ${a}–${b}…`);
        r = await withRetries(ymd, () => inTab('work', ymd, [a, b].map(t => t.split(':'))));
      }
      if (r.skipped) log(`${fmt(ymd)}: omitido (${r.skipped})`);
      else log(`${fmt(ymd)}: OK (${r.label})`, 'ok');
    }
    log('Terminado. Revisa el calendario de ADP.', 'ok');
  } catch (e) {
    log('ERROR: ' + e.message + ' — proceso detenido.', 'err');
  } finally {
    $('scan').disabled = false;
  }
});

$('ver').textContent = 'v' + chrome.runtime.getManifest().version;

// Horas en formato 24 h ("9:5" o "0905" → "09:05"); null si no es válida.
function normHM(s) {
  const m = String(s).trim().match(/^(\d{1,2})[:.,h]?(\d{2})$/);
  if (!m || +m[1] > 23 || +m[2] > 59) return null;
  return `${m[1].padStart(2, '0')}:${m[2]}`;
}

const allValid = () => Object.keys(DEFAULTS).every(k => !$(k).classList.contains('bad'));

// Persistir horario
chrome.storage.sync.get(DEFAULTS).then(v => {
  for (const k of Object.keys(DEFAULTS)) $(k).value = normHM(v[k]) || DEFAULTS[k];
  render();
});
for (const k of Object.keys(DEFAULTS)) {
  $(k).addEventListener('change', () => {
    const v = normHM($(k).value);
    $(k).classList.toggle('bad', !v);
    if (v) $(k).value = v;
    if (allValid()) { chrome.storage.sync.set(settings()); render(); }
    else $('fill').disabled = true;
  });
}
