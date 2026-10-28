// Upravitelj alata na karti (marker, mjerenje, zona, ruta): u jednom trenutku je aktivan
// najvise jedan, klik na kartu ide aktivnom alatu, a Esc ga prekida. Uputa se prikazuje
// u traci na vrhu karte.
import { $, el, clear, icon } from './util.js';

export function createModes(app) {
  const { viewer, Cesium } = app.map;
  const tools = new Map();
  let active = null;

  function register(name, tool) {
    tools.set(name, tool);
    tool.button?.addEventListener('click', () => set(active === name ? null : name));
  }

  function set(name) {
    if (active === name) return;
    const prev = active;
    active = null;
    if (prev) tools.get(prev).exit?.();
    clearHint();
    active = name && tools.has(name) ? name : null;
    for (const [n, t] of tools) t.button?.classList.toggle('on', n === active);
    viewer.canvas.style.cursor = active ? 'crosshair' : '';
    if (active) tools.get(active).enter?.();
  }

  // actions: [{ label, onClick, primary, icon, disabled }]
  function hint(text, actions = []) {
    $('hint').hidden = false;
    $('hintText').textContent = text;
    const box = clear($('hintActions'));
    for (const a of actions) {
      box.appendChild(
        el(
          'button',
          {
            type: 'button',
            class: `btn small${a.primary ? ' primary' : ''}`,
            disabled: a.disabled,
            onclick: a.onClick,
          },
          a.icon ? icon(a.icon) : null,
          a.label,
        ),
      );
    }
  }
  function clearHint() {
    $('hint').hidden = true;
  }

  const canvasPos = (ev) => {
    const rect = viewer.canvas.getBoundingClientRect();
    return new Cesium.Cartesian2(ev.clientX - rect.left, ev.clientY - rect.top);
  };

  viewer.canvas.addEventListener('click', (ev) => {
    if (active) tools.get(active).click?.(canvasPos(ev), ev);
  });
  viewer.canvas.addEventListener('dblclick', (ev) => {
    if (active) tools.get(active).dblclick?.(canvasPos(ev), ev);
  });
  document.addEventListener('keydown', (ev) => {
    if (ev.key === 'Escape' && active && !$('dialog').open) set(null);
  });

  return { register, set, hint, clearHint, current: () => active };
}
