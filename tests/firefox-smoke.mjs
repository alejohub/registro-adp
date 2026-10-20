// Prueba real con un perfil nuevo: solo habla con un servidor local ficticio.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, writeFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { Builder, By, until } from 'selenium-webdriver';
import firefox from 'selenium-webdriver/firefox.js';
import JSZip from 'jszip';

const root = new URL('../', import.meta.url);
const days = ['20200106', '20200107', '20200110'];
const rows = new Map(days.map(day => [day, []]));
const row = (day, hh, mi) => [null, null, null, null, null, `${day.slice(6)}/${day.slice(4, 6)}/${day.slice(0, 4)} ${hh}:${mi}:00`, null, null, 'TRABAJO'];
rows.get(days[1]).push(row(days[1], '09', '00'));
const vacations = new Set();
const writes = [];
const base = '/adpnet/m661a43//servlet/';
const calendar = () => days.map(day => {
  const text = vacations.has(day) ? 'Vacaciones' : rows.get(day).length === 2 ? '00:00' : '-08:30';
  return `cpr_regdet?${day},,N'><p class='CPR_DIALNK'>${+day.slice(6)}</p></a></td></tr><tr><td valign='bottom'><p class='calendario_1'>${text}</p>`;
}).join('\n');
const server = createServer(async (req, res) => {
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname === '/mock/save') {
    let data = '';
    for await (const chunk of req) data += chunk;
    const value = JSON.parse(data);
    assert.match(req.headers.cookie || '', /test_session=fixture/);
    writes.push(value);
    if (value.vac) vacations.add(value.day);
    else rows.get(value.day).push(row(value.day, value.hh, value.mi));
    res.end('ok');
  } else if (url.pathname.endsWith('cpr_regcal')) {
    res.end(calendar());
  } else if (url.pathname.endsWith('cpr_regdet')) {
    res.end(`CPR_REGDNI='12345678Z' DatosContainerDataV" value='${JSON.stringify(rows.get(url.search.slice(1, 9)))}'`);
  } else if (/cpr_reg(addreg|aus)$/.test(url.pathname)) {
    const day = url.search.match(/\d{8}/)[0];
    const vac = url.pathname.endsWith('cpr_regaus');
    res.end(`<!doctype html><body>
      <input id="vTIPO" value="0"><input id="vCPR_AUSID"><input id="vCPR_MARID"><input id="vHORAT"><input id="vMINUTOT">
      <button name="BTN_OK">Guardar</button><div id="gxErrorViewer"></div>
      <script>window.gx = {evt:{}};
      document.querySelector('button').onclick = async () => {
        await fetch('/mock/save', {method:'POST', body:JSON.stringify({day:'${day}',vac:${vac},hh:document.getElementById('vHORAT').value,mi:document.getElementById('vMINUTOT').value})});
      };</script></body>`);
  } else {
    res.setHeader('Set-Cookie', 'test_session=fixture; SameSite=Lax; Path=/');
    res.end('<!doctype html><title>ADP ficticio</title><body>Calendario de prueba<script>window.gx={evt:{}};</script></body>');
  }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const address = `http://127.0.0.1:${server.address().port}`;
const temp = await mkdtemp(join(tmpdir(), 'registro-adp-firefox-test-'));
if (!/^registro-adp-firefox-test-[^\\/]+$/.test(relative(tmpdir(), temp))) throw new Error('Ruta temporal no válida');
let driver;
try {
  const zip = await JSZip.loadAsync(await readFile(new URL('dist/registro-adp-firefox-v1.0.2.zip', root)));
  const manifest = JSON.parse(await zip.file('manifest.json').async('string'));
  // Solo el paquete temporal de prueba recibe permiso para el servidor local.
  manifest.host_permissions.push('http://127.0.0.1/*');
  zip.file('manifest.json', JSON.stringify(manifest));
  zip.file('test-setup.js', `
    const originalQuery = browser.tabs.query;
    browser.tabs.query = async () => {
      const tabs = await originalQuery({});
      document.body.dataset.testTabs = JSON.stringify(tabs.map(tab => ({id:tab.id,url:tab.url,title:tab.title})));
      return tabs.filter(tab => tab.url?.startsWith('${address}/'));
    };
    const originalExecute = browser.scripting.executeScript;
    browser.scripting.executeScript = options => originalExecute(options).catch(error => {
      document.body.dataset.testError = error.message;
      throw error;
    });
  `);
  zip.file('popup.html', (await zip.file('popup.html').async('string')).replace('<script src="popup.js">', '<script src="test-setup.js"></script><script src="popup.js">'));
  const archive = join(temp, 'test.xpi');
  await writeFile(archive, await zip.generateAsync({ type: 'nodebuffer' }));
  const options = new firefox.Options().setBrowserVersion(process.env.FIREFOX_VERSION || 'stable')
    .addArguments('-headless');
  const service = new firefox.ServiceBuilder().addArguments('--allow-system-access');
  driver = await new Builder().forBrowser('firefox').setFirefoxOptions(options).setFirefoxService(service).build();
  await driver.manage().setTimeouts({ pageLoad: 20000, script: 10000 });
  const version = (await driver.getCapabilities()).get('browserVersion');
  console.log(`Firefox ${version}: instalando el complemento temporal de prueba…`);
  await driver.installAddon(archive, true);
  console.log('Abriendo el calendario ficticio…');
  await driver.get(address);
  await driver.setContext(firefox.Context.CHROME);
  const uuid = await driver.executeScript(`return JSON.parse(Services.prefs.getStringPref('extensions.webextensions.uuids'))[arguments[0]];`, manifest.browser_specific_settings.gecko.id);
  await driver.setContext(firefox.Context.CONTENT);
  await driver.switchTo().newWindow('tab');
  console.log('Abriendo el popup…');
  await driver.get(`moz-extension://${uuid}/popup.html`);
  const versionLabel = await driver.wait(until.elementLocated(By.id('ver')), 10000, 'No se cargó el popup');
  await driver.wait(until.elementTextIs(versionLabel, 'v1.0.2'), 10000, 'No se inicializó el popup');
  // Al abrir el popup como pestaña para WebDriver, se selecciona explícitamente
  // la pestaña del ADP ficticio. executeScript, MAIN y storage son APIs reales.
  await driver.findElement(By.id('scan')).click();
  console.log('Comprobando el escaneo y los formularios…');
  await driver.wait(async () => (await driver.findElements(By.css('.day'))).length === 3, 10000, 'No se encontraron los días ficticios');
  await driver.findElement(By.css(`[data-ymd="${days[2]}"] .vac`)).click();
  await driver.findElement(By.id('fill')).click();
  await driver.wait(async () => (await driver.findElement(By.id('log')).getText()).includes('Terminado.'), 30000, 'No terminaron los formularios ficticios');
  assert.equal(writes.filter(value => !value.vac).length, 3);
  assert.equal(writes.filter(value => value.vac).length, 1);
  assert.equal(rows.get(days[0]).length, 2);
  assert.equal(rows.get(days[1]).length, 2);
  assert.equal(vacations.has(days[2]), true);
  assert.doesNotMatch(await driver.findElement(By.id('log')).getText(), /ERROR|reintento/);
  const input = driver.findElement(By.id('wkIn'));
  await input.clear();
  await input.sendKeys('0830');
  await driver.findElement(By.id('wkOut')).click();
  await driver.navigate().refresh();
  await driver.wait(async () => (await driver.findElement(By.id('wkIn')).getAttribute('value')) === '08:30', 10000);
  console.log(`Firefox ${version}: popup, escaneo, 3 marcas (incluida jornada parcial), vacaciones, acceso a GeneXus MAIN y persistencia local: OK.`);
  await driver.takeScreenshot().then(data => writeFile(new URL(`dist/firefox-smoke-${version}.png`, root), data, 'base64'));
} catch (error) {
  if (driver) {
    console.error('Estado del popup:', await driver.findElement(By.css('body')).getText().catch(() => '(no disponible)'));
    console.error('Error de inyección:', await driver.findElement(By.css('body')).getAttribute('data-test-error').catch(() => '(no disponible)'));
    console.error('Pestañas de prueba:', await driver.findElement(By.css('body')).getAttribute('data-test-tabs').catch(() => '(no disponible)'));
    console.error('Dirección de prueba:', await driver.getCurrentUrl().catch(() => '(no disponible)'));
  }
  throw error;
} finally {
  if (driver) await driver.quit();
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
  await rm(temp, { recursive: true, force: true });
}
