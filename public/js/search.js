// Globalna pretraga (/ ili Ctrl+K): objekti, zone i rute odmah, a mjesta i adrese tek na Enter.
import { $, el, clear, api, icon, toast } from './util.js';
import { searchLocal } from './search-core.js';
import { KINDS } from './kinds.js';

export function createSearch(app) {
  const { Cesium, viewer } = app.map;
  const box = $('searchPalette');
  const input = $('searchInput');
  const results = $('searchResults');
  let rows = []; // { group, label, sub, run }
  let active = 0;
  let places = null; // null: nije traženo; [] nema rezultata
  let busy = false;

  const isOpen = () => !box.hidden;

  function open() {
    box.hidden = false;
    $('searchScrim').hidden = false;
    input.value = '';
    places = null;
    render();
    input.focus();
  }
  function close() {
    box.hidden = true;
    $('searchScrim').hidden = true;
  }

  function flyToPlace(p) {
    viewer.camera.flyTo({
      destination: Cesium.Cartesian3.fromDegrees(p.lon, p.lat, 2500),
      orientation: { heading: 0, pitch: Cesium.Math.toRadians(-50), roll: 0 },
      duration: 1.5,
    });
  }

  function buildRows() {
    const q = input.value.trim();
    const local = searchLocal(q, {
      items: app.items.all(),
      zones: app.zones.list(),
      routes: app.routes.list(),
    }).map((r) => ({
      group: r.group,
      label: r.label,
      sub: r.type === 'item' ? KINDS[r.kind]?.label : null,
      run: () => {
        if (r.type === 'item') app.items.select(r.id, true);
        else if (r.type === 'zone') app.zones.focus(r.id);
        else {
          app.nav.open('routes');
          app.routes.select(r.id, true);
        }
      },
    }));
    const out = [...local];
    if (places) {
      for (const p of places)
        out.push({ group: 'Mjesta', label: p.name, run: () => flyToPlace(p) });
    } else if (q.length >= 2) {
      out.push({
        group: 'Mjesta',
        label: `Traži mjesto ili adresu "${q}"`,
        run: searchPlaces,
        place: true,
      });
    }
    return out;
  }

  async function searchPlaces() {
    const q = input.value.trim();
    if (q.length < 2 || busy) return;
    busy = true;
    try {
      places = (await api('GET', `/api/geocode?q=${encodeURIComponent(q)}`)).places || [];
      if (!places.length) toast('Nema pronađenih mjesta', 'warn', 2500);
    } catch (e) {
      toast(`Traženje mjesta nije uspjelo: ${e.message}`, 'bad');
      places = null;
    }
    busy = false;
    active = 0;
    render(true);
  }

  function render(keepActive = false) {
    rows = buildRows();
    if (!keepActive) active = Math.min(active, Math.max(0, rows.length - 1));
    clear(results);
    if (!rows.length) {
      results.append(
        el('div', {
          class: 'search-hint',
          text: input.value.trim()
            ? 'Nema rezultata.'
            : 'Upiši naziv objekta, zone, rute ili mjesta. Prečac: / ili Ctrl+K.',
        }),
      );
      return;
    }
    let group = null;
    rows.forEach((r, i) => {
      if (r.group !== group) {
        group = r.group;
        results.append(el('div', { class: 'sub-h', text: group }));
      }
      results.append(
        el(
          'button',
          {
            type: 'button',
            class: `search-row${i === active ? ' on' : ''}`,
            onclick: () => choose(i),
            onmousemove: () => active !== i && setActive(i),
          },
          icon(r.place ? 'search' : r.group === 'Mjesta' ? 'pin' : 'target'),
          el('span', { class: 'grow', text: r.label }),
          r.sub && el('span', { class: 'tag', text: r.sub }),
        ),
      );
    });
  }

  function setActive(i) {
    active = i;
    [...results.querySelectorAll('.search-row')].forEach((b, j) =>
      b.classList.toggle('on', j === i),
    );
    results.querySelectorAll('.search-row')[i]?.scrollIntoView({ block: 'nearest' });
  }

  function choose(i) {
    const r = rows[i];
    if (!r) return;
    if (r.place) return r.run(); // traženje mjesta ostavlja paletu otvorenom
    close();
    r.run();
  }

  input.addEventListener('input', () => {
    places = null;
    active = 0;
    render();
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (rows.length)
        setActive((active + (e.key === 'ArrowDown' ? 1 : rows.length - 1)) % rows.length);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      choose(active);
    } else if (e.key === 'Escape') close();
  });
  $('searchScrim').addEventListener('click', close);
  $('toolSearch').addEventListener('click', () => (isOpen() ? close() : open()));
  document.addEventListener('keydown', (e) => {
    const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName);
    if ((e.key === '/' && !typing) || ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k')) {
      e.preventDefault();
      open();
    } else if (e.key === 'Escape' && isOpen()) close();
  });

  return { open, close };
}
