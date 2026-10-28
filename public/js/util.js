// Pomocne funkcije sucelja. DOM se gradi iskljucivo preko textContent/atributa (nikad
// innerHTML), pa podaci s OTS-a ne mogu ubaciti HTML.

export const $ = (id) => document.getElementById(id);

const SVG_NS = 'http://www.w3.org/2000/svg';

export function icon(name, className = 'ic') {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('class', className);
  const use = document.createElementNS(SVG_NS, 'use');
  use.setAttribute('href', `#i-${name}`);
  svg.appendChild(use);
  return svg;
}

// el('div', { class: 'x', text: 'tekst', onclick: fn, title: '...' }, dijete1, 'tekst')
export function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (value === undefined || value === null || value === false) continue;
    if (key === 'class') node.className = value;
    else if (key === 'text') node.textContent = value;
    else if (key.startsWith('on')) node.addEventListener(key.slice(2), value);
    else node.setAttribute(key, value === true ? '' : value);
  }
  for (const child of children.flat()) {
    if (child === undefined || child === null || child === false) continue;
    node.append(child);
  }
  return node;
}

export function clear(node) {
  node.textContent = '';
  return node;
}

export function ago(t) {
  const ms = Date.parse(t);
  if (!t || Number.isNaN(ms)) return null;
  const s = Math.max(0, Math.round((Date.now() - ms) / 1000));
  if (s < 60) return `prije ${s} s`;
  if (s < 3600) return `prije ${Math.round(s / 60)} min`;
  if (s < 86400) return `prije ${Math.round(s / 3600)} h`;
  return new Date(ms).toLocaleString('hr-HR');
}

export const fmtClock = (t) => new Date(t).toLocaleString('hr-HR');

const COMPASS = ['S', 'SI', 'I', 'JI', 'J', 'JZ', 'Z', 'SZ'];
export const compass = (deg) => COMPASS[Math.round((((deg % 360) + 360) % 360) / 45) % 8];

// JSON API poziv; ne-GET zahtjevi nose X-TAK-App (zastita od poziva s drugih stranica)
export async function api(method, url, body) {
  const headers = {};
  if (method !== 'GET') headers['X-TAK-App'] = '1';
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const res = await fetch(url, {
    method,
    headers,
    cache: 'no-store',
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let json = null;
  try {
    json = await res.json();
  } catch {
    /* odgovor nije JSON */
  }
  // sesija je istekla ili je server restartan: main.js ponovno ucitava stranicu (prijava)
  if (res.status === 401 && url !== '/api/login')
    window.dispatchEvent(new Event('tak-auth-expired'));
  if (!res.ok || json?.ok === false) {
    throw new Error(json?.error || json?.response?.error || `HTTP ${res.status}`);
  }
  return json;
}

// trajne postavke po pregledniku (privatni nacin rada moze blokirati pohranu)
export const prefs = {
  get(key, fallback = null) {
    try {
      return localStorage.getItem(`tak.${key}`) ?? fallback;
    } catch {
      return fallback;
    }
  },
  set(key, value) {
    try {
      localStorage.setItem(`tak.${key}`, String(value));
    } catch {
      /* ignoriraj */
    }
  },
};

export function toast(message, kind = 'ok', ms = 5000) {
  const node = el('div', { class: `toast ${kind}`, role: 'status' }, el('div', { text: message }));
  $('toasts').appendChild(node);
  setTimeout(() => node.remove(), ms);
}

// kratki zvucni signal (WebAudio), samo ako je korisnik ukljucio zvuk
let audio = null;
export function beep() {
  try {
    audio = audio || new AudioContext();
    const osc = audio.createOscillator();
    const gain = audio.createGain();
    osc.frequency.value = 880;
    gain.gain.setValueAtTime(0.0001, audio.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.15, audio.currentTime + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, audio.currentTime + 0.4);
    osc.connect(gain).connect(audio.destination);
    osc.start();
    osc.stop(audio.currentTime + 0.42);
  } catch {
    /* zvuk nije dostupan */
  }
}
