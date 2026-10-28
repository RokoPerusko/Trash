// Navigacija: navbar / donji izbornik, bocna traka, izbornik s postavkama i tema.
import { $, prefs } from './util.js';

const TITLES = { objects: 'Objekti', routes: 'Rute', zones: 'Zone', alerts: 'Alarmi' };
const MOBILE = window.matchMedia('(max-width: 800px)');

export function createNav(app) {
  let current = null;

  function open(name) {
    if (!TITLES[name]) return close();
    current = name;
    $('sidebar').hidden = false;
    $('sideTitle').textContent = TITLES[name];
    for (const s of document.querySelectorAll('.section')) s.hidden = s.dataset.section !== name;
    for (const b of document.querySelectorAll('.nav-btn')) {
      b.classList.toggle('on', b.dataset.section === name);
    }
    app.alerts?.render();
    prefs.set('section', name);
  }

  function close() {
    current = null;
    $('sidebar').hidden = true;
    for (const b of document.querySelectorAll('.nav-btn')) b.classList.remove('on');
  }

  for (const b of document.querySelectorAll('.nav-btn')) {
    b.addEventListener('click', () =>
      current === b.dataset.section ? close() : open(b.dataset.section),
    );
  }
  $('sideClose').addEventListener('click', close);

  // na mobitelu bocna traka i kartica detalja dijele isti prostor: otvaranje jednog zatvara drugo
  const detailObserver = new MutationObserver(() => {
    if (MOBILE.matches && !$('detail').hidden) close();
  });
  detailObserver.observe($('detail'), { attributes: true, attributeFilter: ['hidden'] });

  // ---------- izbornik ----------
  const menu = $('menu');
  const setMenu = (on) => {
    menu.hidden = !on;
    $('menuBtn').setAttribute('aria-expanded', String(on));
  };
  $('menuBtn').addEventListener('click', (ev) => {
    ev.stopPropagation();
    setMenu(menu.hidden);
  });
  document.addEventListener('click', (ev) => {
    if (!menu.hidden && !menu.contains(ev.target)) setMenu(false);
  });

  // ---------- tema ----------
  function setTheme(theme) {
    document.documentElement.dataset.theme = theme;
    for (const b of document.querySelectorAll('#themeSeg button')) {
      b.classList.toggle('on', b.dataset.themeValue === theme);
    }
    prefs.set('theme', theme);
  }
  for (const b of document.querySelectorAll('#themeSeg button')) {
    b.addEventListener('click', () => setTheme(b.dataset.themeValue));
  }
  setTheme(prefs.get('theme', 'dark') === 'light' ? 'light' : 'dark');

  // ---------- podloga ----------
  const select = $('baseSelect');
  select.textContent = '';
  for (const b of app.map.bases) {
    const opt = document.createElement('option');
    opt.value = b.key;
    opt.textContent = b.label;
    select.appendChild(opt);
  }
  const savedBase = prefs.get('base');
  if (savedBase && app.map.bases.some((b) => b.key === savedBase) && app.map.setBase(savedBase)) {
    select.value = savedBase;
  }
  select.addEventListener('change', () => {
    if (app.map.setBase(select.value)) prefs.set('base', select.value);
  });
  $('baseRow').hidden = app.map.bases.length < 2;

  // ---------- zvuk ----------
  $('soundToggle').checked = prefs.get('sound') === '1';
  $('soundToggle').addEventListener('change', (e) =>
    prefs.set('sound', e.target.checked ? '1' : '0'),
  );

  // pocetno stanje: na racunalu otvoren popis objekata, na mobitelu samo karta
  if (!MOBILE.matches)
    open(prefs.get('section') && TITLES[prefs.get('section')] ? prefs.get('section') : 'objects');

  return { open, close, current: () => current };
}
