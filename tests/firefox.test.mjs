import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import JSZip from 'jszip';

const source = await readFile(new URL('../dist/firefox/popup.js', import.meta.url), 'utf8');
const calendar = (text = '-08:30') => `cpr_regdet?20261019,,N'><p class='CPR_DIALNK'>19</p></a></td></tr><tr><td valign='bottom'><p class='calendario_1'>${text}</p>`;
const details = rows => `CPR_REGDNI='12345678Z' DatosContainerDataV" value='${JSON.stringify(rows)}'`;
const mark = time => [null, null, null, null, null, `19/10/2026 ${time}:00`, null, null, 'TRABAJO'];

function context(overrides = {}) {
  const elements = new Map();
  const element = id => {
    if (!elements.has(id)) elements.set(id, {
      value: '09:00', textContent: '', disabled: false,
      classList: { contains: () => false, toggle() {} },
      addEventListener() {}, querySelectorAll: () => [], appendChild() {},
    });
    return elements.get(id);
  };
  const browser = {
    runtime: { getManifest: () => ({ version: '1.0.2' }) },
    storage: { local: { get: async defaults => defaults, set: async () => {} } },
    tabs: { query: async () => [{ id: 7 }] },
    scripting: { executeScript: async () => [{ result: { ok: true } }] },
  };
  const sandbox = vm.createContext({
    browser, document: { getElementById: element },
    setTimeout: fn => queueMicrotask(fn), ...overrides,
  });
  vm.runInContext(source, sandbox);
  return { sandbox, browser, element, run: expression => vm.runInContext(expression, sandbox) };
}

test('el paquete tiene el manifiesto en la raíz y conserva los recursos de Chrome', async () => {
  const zip = await JSZip.loadAsync(await readFile(new URL('../dist/registro-adp-firefox-v1.0.2.zip', import.meta.url)));
  const manifest = JSON.parse(await zip.file('manifest.json').async('string'));
  assert.equal(manifest.version, '1.0.2');
  assert.equal(manifest.browser_specific_settings.gecko.strict_min_version, '158.0');
  assert.deepEqual(manifest.host_permissions, ['https://www.adpnet.esp.adp.com/*']);
  for (const name of ['popup.html', 'popup.css', 'icons/icon16.png', 'icons/icon32.png', 'icons/icon48.png', 'icons/icon128.png', 'icons/icon512.png']) {
    assert.deepEqual(await zip.file(name).async('nodebuffer'), await readFile(new URL(`../extension/${name}`, import.meta.url)));
  }
  assert.doesNotMatch(source, /\bchrome\.|storage\.sync/);
});

test('Firefox usa browser, almacenamiento local e inyección MAIN con argumentos', async () => {
  const { browser, run, element } = context();
  let options;
  browser.scripting.executeScript = async input => { options = input; return [{ result: { cells: [] } }]; };
  await run('inTab("scan")');
  assert.equal(options.world, 'MAIN');
  assert.equal(options.target.tabId, 7);
  assert.equal(options.func.name, 'adpRun');
  assert.deepEqual(Array.from(options.args), ['scan']);
  assert.equal(element('ver').textContent, 'v1.0.2');
});

test('se muestran los errores de ADP y de pestaña inaccesible', async () => {
  const { browser, run } = context();
  browser.scripting.executeScript = async () => [{ result: { error: 'Sesión caducada' } }];
  await assert.rejects(run('inTab("scan")'), /Sesión caducada/);
  browser.scripting.executeScript = async () => { throw new Error('Missing host permission'); };
  await assert.rejects(run('inTab("scan")'), /Abre esta extensión desde una pestaña de ADP/);
});

test('el escaneo reintenta fallos de red y HTTP 5xx', async () => {
  let calls = 0;
  const { run } = context({ fetch: async () => {
    calls++;
    if (calls === 1) throw new Error('offline');
    if (calls === 2) return { ok: false, status: 503 };
    return { ok: true, text: async () => calendar() };
  } });
  const result = await run('adpRun("scan")');
  assert.equal(calls, 3);
  assert.equal(result.cells[0].ymd, '20261019');
});

test('HTTP 4xx no se reintenta y el límite de 5xx es de cuatro intentos', async () => {
  for (const [status, expected] of [[403, 1], [503, 4]]) {
    let calls = 0;
    const { run } = context({ fetch: async () => { calls++; return { ok: false, status }; } });
    assert.match((await run('adpRun("scan")')).error, new RegExp(`HTTP ${status}`));
    assert.equal(calls, expected);
  }
});

test('no duplica marcas y omite jornadas con horas diferentes o vacaciones con trabajo', async () => {
  for (const [rows, action, message] of [
    [[mark('09:00'), mark('18:30')], 'work', /ya tiene esas marcas/],
    [[mark('10:00')], 'work', /otras horas/],
    [[mark('09:00')], 'vac', /tiene marcas de TRABAJO/],
  ]) {
    const { run } = context({ fetch: async () => ({ ok: true, text: async () => details(rows) }) });
    const result = await run(`adpRun("${action}", "20261019", [["09","00"],["18","30"]])`);
    assert.match(result.skipped, message);
  }
});

test('mantiene los horarios de lunes a jueves, viernes y agosto', async () => {
  const { run, element } = context();
  await Promise.resolve();
  const values = { wkIn: '09:00', wkOut: '18:30', frIn: '08:00', frOut: '15:00', agIn: '08:00', agOut: '15:15' };
  for (const [key, value] of Object.entries(values)) element(key).value = value;
  for (const [ymd, expected] of [['20261019', ['09:00', '18:30']], ['20261016', ['08:00', '15:00']], ['20260807', ['08:00', '15:15']]]) {
    assert.deepEqual(Array.from(run(`scheduleFor("${ymd}")`)), expected);
  }
  assert.equal(run('normHM("0905")'), '09:05');
  assert.equal(run('normHM("25:00")'), null);
});
