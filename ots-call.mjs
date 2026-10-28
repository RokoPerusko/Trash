// Alat za rucno testiranje OpenTAKServer API-ja (isti .env kao server.js).
//
// Koristenje:
//   node --env-file=.env ots-call.mjs GET /api/markers
//   node --env-file=.env ots-call.mjs DELETE /api/markers --query uid=abc-123
//   node --env-file=.env ots-call.mjs DELETE /api/markers --json '{"uid":"abc-123"}'
//   node --env-file=.env ots-call.mjs POST /api/markers --json '{...}'
//
// Ispisuje HTTP status i odgovor. Nista se ne radi osim poziva koji sami zadate.

import { createOtsClient } from './ots-client.js';

const env = process.env;
const OTS_URL = (env.OTS_URL || 'https://localhost').replace(/\/+$/, '');
const body = { username: env.OTS_USERNAME || '', password: env.OTS_PASSWORD || '' };

const insecure = env.OTS_INSECURE === '1';

const args = process.argv.slice(2);
const [method, path] = args;
if (!method || !path || !path.startsWith('/')) {
  console.error(
    "Koristenje: node --env-file=.env ots-call.mjs METHOD /putanja [--query k=v]... [--json '{...}']",
  );
  process.exit(2);
}
const query = new URLSearchParams();
let jsonBody;
for (let i = 2; i < args.length; i++) {
  if (args[i] === '--query' && args[i + 1]) {
    const [k, ...v] = args[++i].split('=');
    query.append(k, v.join('='));
  } else if (args[i] === '--json' && args[i + 1]) {
    try {
      jsonBody = JSON.parse(args[++i]);
    } catch {
      console.error('--json nije ispravan JSON');
      process.exit(2);
    }
  } else {
    console.error(`Nepoznat argument: ${args[i]}`);
    process.exit(2);
  }
}

const client = createOtsClient({
  url: OTS_URL,
  username: body.username,
  password: body.password,
  insecure,
  log: (s) => console.error(s),
});
try {
  await client.login();
} catch (e) {
  console.error(e.message);
  process.exit(1);
}
const path_ = `${path}${query.size ? '?' + query : ''}`;
const method_ = method.toUpperCase();

console.error(
  `[zahtjev] ${method_} ${OTS_URL}${path_}${jsonBody !== undefined ? '  tijelo: ' + JSON.stringify(jsonBody) : ''}`,
);
let r;
try {
  r = await client.request(method_, path_, { json: jsonBody });
} catch (e) {
  console.error('Zahtjev nije uspio:', e.cause?.code || e.code || e.message);
  process.exit(1);
}
console.log(`HTTP ${r.status}`);
console.log(r.json ? JSON.stringify(r.json, null, 2) : r.text.slice(0, 2000));
