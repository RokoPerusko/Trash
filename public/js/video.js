// Video: popis streamova iz OTS-a (MediaMTX), gledanje i pokretanje streama iz preglednika.
// Gledanje i slanje su stranice koje poslužuje sam OTS (WebRTC), ovdje se samo ugraduju (iframe).
import { $, el, clear, api, icon, toast } from './util.js';
import { askText } from './dialog.js';

const NAME_RE = /^[A-Za-z0-9_-]{1,40}$/;
const REFRESH_MS = 5000;

export function createVideo(app) {
  let streams = [];
  let publishBase = '';
  let error = null;
  let playing = false; // otvoren je player (popis se tada ne ponovno crta)

  function renderList() {
    const list = clear($('videoList'));
    if (error) {
      list.append(el('li', { class: 'empty', text: `Video nije dostupan: ${error}` }));
      return;
    }
    if (!streams.length) {
      list.append(el('li', { class: 'empty', text: 'Nema streamova. Pokreni novi.' }));
      return;
    }
    for (const s of streams) {
      list.append(
        el(
          'li',
          { onclick: () => play(s) },
          el('span', { class: 'adot', style: `background:${s.ready ? '#3fcf8e' : '#8b98b0'}` }),
          el('div', { class: 'grow' }, el('div', { text: s.name })),
          el('span', { class: 'tag', text: s.ready ? 'uživo' : 'nije aktivan' }),
        ),
      );
    }
  }

  async function sync() {
    try {
      const d = await api('GET', '/api/video');
      streams = d.streams || [];
      publishBase = d.publishBase || '';
      error = null;
    } catch (e) {
      error = e.message;
    }
    if (!playing) renderList();
  }

  function showPlayer(title, frame, note) {
    playing = true;
    $('videoListView').hidden = true;
    const box = clear($('videoPlayer'));
    box.hidden = false;
    box.append(
      el(
        'div',
        { class: 'video-head' },
        el(
          'button',
          { type: 'button', class: 'icon-btn', title: 'Natrag', onclick: back },
          icon('chevron-left'),
        ),
        el('div', { class: 'grow', text: title }),
      ),
      frame,
      note && el('p', { class: 'video-note', text: note }),
    );
  }

  function back() {
    playing = false;
    clear($('videoPlayer')).hidden = true; // uklanja iframe: kamera i veza se zatvaraju
    $('videoListView').hidden = false;
    renderList();
    sync();
  }

  function play(s) {
    const frame = el('iframe', {
      class: 'video-frame',
      src: s.viewUrl,
      title: s.name,
      allow: 'autoplay; fullscreen',
    });
    showPlayer(
      s.name,
      frame,
      s.ready
        ? 'Ako je slika crna, prihvati certifikat OTS-a otvaranjem njegove adrese u pregledniku.'
        : 'Stream trenutno nitko ne šalje.',
    );
  }

  async function start() {
    if (!publishBase) await sync();
    if (!publishBase) return toast('Video nije dostupan', 'bad');
    const suggestion = `karta_${Date.now().toString(36).slice(-4)}`;
    const name = await askText({
      title: 'Pokreni stream',
      label: 'Naziv streama (slova, brojevi, _ i -)',
      value: suggestion,
      okText: 'Pokreni',
    });
    if (!name) return;
    if (!NAME_RE.test(name)) return toast('Naziv smije imati samo slova, brojeve, _ i -', 'bad');
    const frame = el('iframe', {
      class: 'video-frame publish',
      src: `${publishBase}${encodeURIComponent(name)}/publish`,
      title: `Slanje: ${name}`,
      allow: 'camera; microphone; autoplay; fullscreen',
    });
    showPlayer(
      `Slanje: ${name}`,
      frame,
      'Dopusti kameru u pregledniku. Kamera radi samo na HTTPS-u. Stream se zatvara gumbom Natrag.',
    );
  }

  $('videoStart').addEventListener('click', start);
  setInterval(() => {
    if (app.nav?.current() === 'video' && !playing) sync();
  }, REFRESH_MS);

  return { sync };
}
