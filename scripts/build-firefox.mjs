import { readFile, writeFile, mkdir, rm, readdir } from 'node:fs/promises';
import { dirname, join, resolve, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import JSZip from 'jszip';
import { createHash } from 'node:crypto';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const output = join(root, 'dist', 'firefox');
// Solo se limpia la carpeta generada dentro de este repositorio.
if (relative(root, output) !== ['dist', 'firefox'].join(sep)) throw new Error('Ruta de salida no válida');
await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });

const manifest = {
  ...JSON.parse(await readFile(join(root, 'extension', 'manifest.json'), 'utf8')),
  ...JSON.parse(await readFile(join(root, 'firefox', 'manifest.overrides.json'), 'utf8')),
};
const zip = new JSZip();
const add = async (name, content) => {
  await mkdir(dirname(join(output, name)), { recursive: true });
  await writeFile(join(output, name), content);
  // Fechas fijas para poder reproducir y verificar el paquete.
  zip.file(name, content, { date: new Date('2026-01-01T00:00:00Z'), createFolders: false });
};
await add('manifest.json', JSON.stringify(manifest, null, 2) + '\n');
for (const name of ['popup.html', 'popup.css']) {
  await add(name, await readFile(join(root, 'extension', name)));
}
const source = await readFile(join(root, 'extension', 'popup.js'), 'utf8');
// Firefox usa la API nativa de promesas y guarda el horario solo en este perfil.
const popup = source.replace(/\bchrome\./g, 'browser.').replace(/browser\.storage\.sync\b/g, 'browser.storage.local');
await add('popup.js', popup);
for (const name of (await readdir(join(root, 'extension', 'icons'))).sort()) {
  if (!/^icon\d+\.png$/.test(name)) throw new Error(`Icono inesperado: ${name}`);
  await add(`icons/${name}`, await readFile(join(root, 'extension', 'icons', name)));
}
const archive = join(root, 'dist', `registro-adp-firefox-v${manifest.version}.zip`);
const contents = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE', compressionOptions: { level: 9 } });
await writeFile(archive, contents);
await writeFile(`${archive}.sha256`, `${createHash('sha256').update(contents).digest('hex')}  registro-adp-firefox-v${manifest.version}.zip\n`);
console.log(`Firefox ${manifest.version}: ${relative(root, archive)} (sin firma; carga temporal)`);
