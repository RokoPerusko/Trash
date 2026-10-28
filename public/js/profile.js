// Visinski profil kao SVG (koriste ga mjerenje vidljivosti i rute). Boje se citaju iz teme.
import { themeVar } from './map.js';
import { formatDistance } from './geo.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
const W = 268;
const H = 112;
const PAD = { l: 6, r: 6, t: 12, b: 16 };

function svgEl(name, attrs = {}) {
  const node = document.createElementNS(SVG_NS, name);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v));
  return node;
}

// samples: [{ dist, h, line?, obstructed? }]; h = visina terena, line = linija vidljivosti
// opts: { visible, tooltip(sample) }
export function buildProfileSvg(samples, { visible = true, tooltip } = {}) {
  const heights = samples.flatMap((s) => (s.line === undefined ? [s.h] : [s.h, s.line]));
  const minH = Math.min(...heights);
  const maxH = Math.max(...heights);
  const span = Math.max(1, maxH - minH);
  const n = samples.length - 1;
  const x = (i) => PAD.l + (W - PAD.l - PAD.r) * (i / n);
  const y = (h) => PAD.t + (H - PAD.t - PAD.b) * (1 - (h - minH) / span);

  const svg = svgEl('svg', { viewBox: `0 0 ${W} ${H}`, width: '100%', height: H });
  svg.setAttribute('class', 'profile');

  let d = `M ${x(0)} ${y(samples[0].h)} `;
  samples.forEach((s, i) => {
    d += `L ${x(i)} ${y(s.h)} `;
  });
  d += `L ${x(n)} ${y(minH)} L ${x(0)} ${y(minH)} Z`;
  svg.appendChild(
    svgEl('path', {
      d,
      fill: 'rgba(139,152,176,.22)',
      stroke: themeVar('--muted', '#8b98b0'),
      'stroke-width': 1.2,
    }),
  );

  if (samples[0].line !== undefined) {
    svg.appendChild(
      svgEl('path', {
        d: `M ${x(0)} ${y(samples[0].line)} L ${x(n)} ${y(samples[n].line)}`,
        stroke: visible ? themeVar('--ok', '#3fcf8e') : themeVar('--danger', '#e5484d'),
        'stroke-width': 2,
        fill: 'none',
        'stroke-linecap': 'round',
      }),
    );
  }

  const obstructed = samples.findIndex((s) => s.obstructed);
  if (obstructed > 0) {
    svg.appendChild(
      svgEl('circle', {
        cx: x(obstructed),
        cy: y(samples[obstructed].h),
        r: 3.5,
        fill: themeVar('--danger', '#e5484d'),
      }),
    );
  }

  const cross = svgEl('line', {
    y1: PAD.t,
    y2: H - PAD.b,
    stroke: themeVar('--muted', '#8b98b0'),
    'stroke-width': 1,
  });
  const tip = svgEl('text', { fill: themeVar('--text', '#e9eef7'), 'font-size': 9, y: PAD.t + 9 });
  cross.style.display = 'none';
  tip.style.display = 'none';
  svg.append(cross, tip);

  const label = tooltip || ((s) => `${formatDistance(s.dist)} · ${Math.round(s.h)} m`);
  const move = (ev) => {
    const rect = svg.getBoundingClientRect();
    const px = ((ev.clientX - rect.left) / rect.width) * W;
    const idx = Math.max(0, Math.min(n, Math.round(((px - PAD.l) / (W - PAD.l - PAD.r)) * n)));
    cross.setAttribute('x1', x(idx));
    cross.setAttribute('x2', x(idx));
    cross.style.display = '';
    tip.textContent = label(samples[idx]);
    let tx = x(idx) + 4;
    if (tx > W - 96) tx = x(idx) - 96;
    tip.setAttribute('x', Math.max(2, tx));
    tip.style.display = '';
  };
  svg.addEventListener('pointermove', move);
  svg.addEventListener('pointerdown', move);
  svg.addEventListener('pointerleave', () => {
    cross.style.display = 'none';
    tip.style.display = 'none';
  });
  return svg;
}
