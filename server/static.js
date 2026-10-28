// Statične datoteke iz public/ (sucelje). Ne izlaze se skrivene datoteke ni putanje van public/.
import { readFile } from 'node:fs/promises';
import { extname, join, normalize, sep } from 'node:path';
import { PUBLIC_DIR } from './config.js';
import { SECURITY_HEADERS } from './http.js';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
};

export async function serveStatic(req, res, url) {
  const rel = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
  const file = normalize(join(PUBLIC_DIR, rel));
  if (!file.startsWith(PUBLIC_DIR + sep) || rel.split('/').some((seg) => seg.startsWith('.'))) {
    res.writeHead(403, SECURITY_HEADERS);
    return res.end('zabranjeno');
  }
  const data = await readFile(file);
  res.writeHead(200, {
    ...SECURITY_HEADERS,
    'Content-Type': MIME[extname(file)] || 'application/octet-stream',
    'Cache-Control': 'no-store',
  });
  res.end(data);
}
