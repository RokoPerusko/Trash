// Dimni test sucelja u headless pregledniku (Chromium: Brave/Chrome/Edge) preko DevTools
// protokola. Otvara aplikaciju, ceka da se ucita, sprema snimku zaslona i ispisuje greske iz
// konzole; izlazni kod je 1 ako ih ima. Nema npm ovisnosti (koristi globalni WebSocket Nodea).
//
//   npm start            (u drugom terminalu; za lazni OTS: npm run mock)
//   npm run ui-check -- [url] [izlaz.png] [sirina] [visina]
//   (uz obaveznu prijavu: TAK_USER=korisnik TAK_PASS=lozinka npm run ui-check)
//
// Preglednik se trazi u uobicajenim putanjama ili preko BROWSER_BIN.
import { spawn } from 'node:child_process';
import { existsSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const [url = 'http://127.0.0.1:3000/', out = 'ui-check.png', width = '1400', height = '850'] =
  process.argv.slice(2);
const CANDIDATES = [
  process.env.BROWSER_BIN,
  '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
].filter(Boolean);
const bin = CANDIDATES.find((p) => existsSync(p));
if (!bin) {
  console.error('Nije pronađen preglednik; postavi BROWSER_BIN.');
  process.exit(2);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const port = 9300 + Math.floor(Math.random() * 500);
const profile = mkdtempSync(join(tmpdir(), 'tak-ui-check-'));
const browser = spawn(
  bin,
  [
    '--headless=new',
    '--no-sandbox',
    '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader',
    '--ignore-gpu-blocklist',
    `--window-size=${width},${height}`,
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${profile}`,
    'about:blank',
  ],
  { stdio: 'ignore' },
);

let targets = [];
for (let i = 0; i < 40 && !targets.length; i++) {
  try {
    targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
  } catch {
    await sleep(500);
  }
}
const page = targets.find((t) => t.type === 'page');
if (!page) {
  browser.kill();
  console.error('Preglednik se nije pokrenuo.');
  process.exit(2);
}

const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((resolve) => (ws.onopen = resolve));
let nextId = 0;
const waiting = new Map();
const problems = [];
// poruke koje headless SwiftShader sam stvara i ne ukazuju na gresku aplikacije
const IGNORE = /GPU stall|GL Driver Message|favicon/i;

ws.onmessage = (event) => {
  const msg = JSON.parse(event.data);
  if (msg.id && waiting.has(msg.id)) {
    waiting.get(msg.id)(msg);
    waiting.delete(msg.id);
  } else if (msg.method === 'Log.entryAdded' && msg.params.entry.level === 'error') {
    problems.push(msg.params.entry.text);
  } else if (msg.method === 'Runtime.exceptionThrown') {
    const d = msg.params.exceptionDetails;
    problems.push(d.exception?.description || d.text);
  } else if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') {
    problems.push(msg.params.args.map((a) => a.value ?? a.description ?? '').join(' '));
  }
};
const send = (method, params = {}) =>
  new Promise((resolve) => {
    const id = ++nextId;
    waiting.set(id, resolve);
    ws.send(JSON.stringify({ id, method, params }));
  });

await send('Runtime.enable');
await send('Log.enable');
await send('Page.enable');
await send('Emulation.setDeviceMetricsOverride', {
  width: Number(width),
  height: Number(height),
  deviceScaleFactor: 1,
  mobile: Number(width) < 700,
});
await send('Page.navigate', { url });
await sleep(15000);

// ako je prijava obavezna, prijavi se s TAK_USER / TAK_PASS (npr. racun s lazni OTS-a)
const evaluate = async (expression) =>
  (await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })).result
    ?.result?.value;
if ((await evaluate(`!document.getElementById('login')?.hidden`)) && process.env.TAK_USER) {
  await evaluate(
    `document.getElementById('loginUser').value = ${JSON.stringify(process.env.TAK_USER)};
     document.getElementById('loginPass').value = ${JSON.stringify(process.env.TAK_PASS || '')};
     document.getElementById('loginSubmit').click()`,
  );
  await sleep(12000);
}

const shot = await send('Page.captureScreenshot', { format: 'png' });
writeFileSync(out, Buffer.from(shot.result.data, 'base64'));
const pill = await send('Runtime.evaluate', {
  expression: `document.getElementById('pillText')?.textContent`,
  returnByValue: true,
});
ws.close();
browser.kill();

const real = [...new Set(problems)].filter((p) => !IGNORE.test(p));
console.log(`Snimka: ${out} · status u navbaru: ${pill.result?.result?.value ?? '?'}`);
if (real.length) {
  console.error(`Greške u konzoli (${real.length}):\n- ${real.join('\n- ')}`);
  process.exit(1);
}
console.log('Konzola je bez grešaka.');
process.exit(0);
