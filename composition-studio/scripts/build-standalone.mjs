import { readFile, writeFile, readdir } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { gzipSync } from 'node:zlib';
const root = fileURLToPath(new URL('../', import.meta.url));
execFileSync(process.execPath, [path.join(root, 'node_modules/vite/bin/vite.js'), 'build'], {cwd:root,stdio:'inherit'});
const read = relative => readFile(path.join(root,relative),'utf8');
// The wasm is gzipped like the models: raw base64 costs ~9.7 MB of the page.
const wasm = gzipSync(await readFile(path.join(root,'public/vendor/occt-import-js.wasm')), {level:9}).toString('base64');
const samples = {};
for (const name of ['rorra-aqm.step','rorra-dd.step','rorra-shower.stp']) samples['/models/'+name] = gzipSync(await readFile(path.join(root,'public/models',name)), {level:9}).toString('base64');
const worker = (await read('public/vendor/occt-import-js.js')) + '\n' + (await read('public/step-worker.js')).replace("importScripts('/vendor/occt-import-js.js');",'').replace("occtimportjs({ locateFile: name => '/vendor/' + name })",`(async () => occtimportjs({ wasmBinary: new Uint8Array(await new Response(new Blob([Uint8Array.from(atob(${JSON.stringify(wasm)}), c => c.charCodeAt(0))]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer()) }))()`);
const bootstrap = `const workerSource = ${JSON.stringify(worker)};const modelData = ${JSON.stringify(samples)};\nwindow.__RORRA_OFFLINE = { workerURL: URL.createObjectURL(new Blob([workerSource], {type:'text/javascript'})), sampleBuffer: async source => { const bytes=Uint8Array.from(atob(modelData[source]), c => c.charCodeAt(0)); return new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer(); } };`;
let html = await read('dist/index.html');
const scripts = [...html.matchAll(/<script\b[^>]*src="([^"]+)"[^>]*><\/script>/g)];
for (const match of scripts) {
 const js = await read('dist/'+match[1].replace(/^\//,''));
 if (/\bfrom\s*["']\.\//.test(js)) throw new Error('Unexpected split JS chunk; standalone requires one bundle.');
 html = html.replace(match[0], () => '<script type="module">'+(bootstrap+'\n'+js).replace(/<\/script/gi,'<\\/script')+'</script>');
}
for (const match of [...html.matchAll(/<link\b[^>]*href="([^"]+\.css)"[^>]*>/g)]) {
 const css = (await read('dist/'+match[1].replace(/^\//,''))).replace(/@import\s+(?:url\([^)]*\)|"[^"]*"|'[^']*');?/g,'');
 html = html.replace(match[0], () => '<style>'+css+'</style>');
}
html = html.replace('href="/"','href="#"');
const license = await read('public/vendor/LICENSE.occt-import-js.md');
html = html.replace('</body>',()=>'<script type="text/plain" id="occt-license">'+license.replace(/<\/script/gi,'<\\/script')+'</script></body>');
const output=path.resolve(root,'../Rorra.html');
await writeFile(output,html);
await writeFile(path.resolve(root,'../index.html'),html);
console.log('Standalone HTML: '+output+' ('+(Buffer.byteLength(html)/1024/1024).toFixed(1)+' MB)');
