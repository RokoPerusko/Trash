// Video: popis streamova iz OTS-a (MediaMTX), gledanje i slanje s kamere izravno u karti.
// Gledanje (WHEP) i slanje (WHIP) rade preko WebRTC-a, vidi webrtc.js.
import { $, el, clear, api, icon, toast, prefs, emptyState } from './util.js';
import { confirmDialog } from './dialog.js';
import { StreamError, whepPlay, whipPublish } from './webrtc.js';

const NAME_RE = /^[A-Za-z0-9_-]{1,40}$/;
const REFRESH_MS = 4000;
const RETRY_MS = 3000;
const QUALITY = {
  low: { label: 'Niska (480p)', width: 640, height: 480 },
  mid: { label: 'Srednja (720p)', width: 1280, height: 720 },
  high: { label: 'Visoka (1080p)', width: 1920, height: 1080 },
};
const TIMED = (s) => {
  const m = Math.floor(s / 60);
  return `${String(m).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
};

async function copyText(text, what) {
  try {
    await navigator.clipboard.writeText(text);
    toast(`${what} kopirano`, 'ok', 2500);
  } catch {
    toast(text, 'warn', 12000); // bez pristupa clipboardu barem prikazi adresu
  }
}

export function createVideo(app) {
  const root = $('videoRoot');
  let streams = [];
  let base = '';
  let hlsBase = '';
  let error = null;
  let mode = 'list'; // list | watch | broadcast
  let leave = null; // cisti trenutni prikaz (zatvara veze i kameru)
  let leaveGuard = null; // vraca true ako se prikaz smije napustiti

  const endpoint = (path, kind) => `${base}${encodeURIComponent(path)}/${kind}`;
  const liveFirst = (a, b) => Number(b.ready) - Number(a.ready) || a.name.localeCompare(b.name);

  async function sync() {
    try {
      const d = await api('GET', '/api/video');
      streams = (d.streams || []).sort(liveFirst);
      base = d.publishBase || '';
      hlsBase = d.hlsBase || '';
      error = null;
    } catch (e) {
      error = e.message;
    }
    if (mode === 'list') renderList();
    return streams;
  }

  async function show(view) {
    if (leaveGuard && !(await leaveGuard())) return;
    leave?.();
    leave = leaveGuard = null;
    clear(root);
    view();
  }

  const head = (title, onBack, ...extra) =>
    el(
      'div',
      { class: 'vp-head' },
      el(
        'button',
        { type: 'button', class: 'icon-btn', title: 'Natrag', onclick: onBack },
        icon('chevron-left'),
      ),
      el('div', { class: 'grow vp-title', text: title }),
      ...extra,
    );

  const badge = (text, kind) => el('span', { class: `vp-badge ${kind}`, text });

  // ---------------------------------------------------------------- popis
  function showList() {
    mode = 'list';
    const timer = setInterval(() => app.nav?.current() === 'video' && sync(), REFRESH_MS);
    leave = () => clearInterval(timer);
    root.append(
      el(
        'button',
        { type: 'button', class: 'btn primary wide vp-start', onclick: () => show(showBroadcast) },
        icon('video'),
        'Pokreni stream',
      ),
      el('div', { id: 'vpList' }),
    );
    renderList();
    sync();
  }

  function renderList() {
    const box = $('vpList');
    if (!box) return;
    clear(box);
    if (error) {
      box.append(emptyState({ icon: 'video', title: 'Video nije dostupan', text: error }));
      return;
    }
    if (!streams.length) {
      box.append(
        emptyState({
          icon: 'video',
          title: 'Trenutno nema streamova',
          text: 'Pokreni novi gore ili pošalji video iz iTAK-a ili ATAK-a.',
        }),
      );
      return;
    }
    const groups = [
      ['Uživo', streams.filter((s) => s.ready)],
      ['Nisu aktivni', streams.filter((s) => !s.ready)],
    ];
    for (const [title, items] of groups) {
      if (!items.length) continue;
      box.append(el('div', { class: 'sub-h', text: `${title} (${items.length})` }));
      const ul = el('ul', { class: 'list vp-list' });
      for (const s of items) {
        ul.append(
          el(
            'li',
            { onclick: () => show(() => showWatch(s.path)), tabindex: 0 },
            el('span', { class: `vp-dot${s.ready ? ' live' : ''}` }),
            el(
              'div',
              { class: 'grow' },
              el('div', { class: 'vp-name', text: s.name }),
              el('div', { class: 'vp-sub', text: s.ready ? 'uživo' : 'nitko ne šalje' }),
            ),
            el(
              'button',
              {
                type: 'button',
                class: 'icon-btn vp-del',
                title: 'Obriši stream',
                'aria-label': `Obriši stream ${s.name}`,
                onclick: (ev) => {
                  ev.stopPropagation();
                  removeStream(s);
                },
              },
              icon('trash'),
            ),
            icon('play'),
          ),
        );
      }
      box.append(ul);
    }
  }

  async function removeStream(s) {
    const ok = await confirmDialog({
      title: 'Obrisati stream?',
      message: `Stream "${s.name}" bit će trajno uklonjen s OTS-a${s.ready ? ' i prekinut za sve koji ga gledaju' : ''}.`,
      okText: 'Obriši',
      danger: true,
    });
    if (!ok) return;
    try {
      await api('POST', '/api/video/delete', { path: s.path });
      toast(`Stream "${s.name}" je obrisan`, 'ok', 3000);
    } catch (e) {
      toast(`Brisanje nije uspjelo: ${e.message}`, 'bad');
    }
    sync();
  }

  // ---------------------------------------------------------------- poveznice
  function linkButtons(s) {
    const items = [
      ['WebRTC', s.viewUrl],
      ['HLS', s.hlsUrl],
      ['RTSP', s.rtspUrl],
    ].filter(([, url]) => url);
    return el(
      'div',
      { class: 'vp-links' },
      el('div', { class: 'sub-h', text: 'Kopiraj poveznicu' }),
      el(
        'div',
        { class: 'row wrap vp-linkrow' },
        items.map(([label, url]) =>
          el(
            'button',
            { type: 'button', class: 'btn small', onclick: () => copyText(url, `${label} adresa`) },
            icon('copy'),
            label,
          ),
        ),
      ),
      el('p', {
        class: 'vp-note',
        text: 'U iTAK-u i ATAK-u koristi HLS ili RTSP adresu (WebRTC radi samo u pregledniku).',
      }),
    );
  }

  // ---------------------------------------------------------------- gledanje
  function showWatch(path) {
    mode = 'watch';
    const info = () => streams.find((x) => x.path === path) || { path, name: path };
    const video = el('video', {
      class: 'vp-video',
      autoplay: true,
      playsinline: true,
      muted: true,
    });
    video.muted = true;
    const overlayText = el('div', { class: 'vp-overlay-text' });
    const retryBtn = el('button', { type: 'button', class: 'btn small', text: 'Pokušaj ponovno' });
    const spinner = el('span', { class: 'vp-spinner' });
    const overlay = el('div', { class: 'vp-overlay' }, spinner, overlayText, retryBtn);
    const muteBtn = el(
      'button',
      { type: 'button', class: 'vp-ctl', title: 'Zvuk' },
      icon('volume'),
    );
    const fsBtn = el(
      'button',
      { type: 'button', class: 'vp-ctl', title: 'Cijeli zaslon' },
      icon('maximize'),
    );
    const stage = el(
      'div',
      { class: 'vp-stage' },
      video,
      overlay,
      el('div', { class: 'vp-ctls' }, muteBtn, fsBtn),
    );

    let player = null;
    let retryTimer = null;
    let closed = false;
    let attempt = 0;

    const statusSlot = el('span', { class: 'vp-status' });
    const paint = (kind, text) => {
      clear(statusSlot).append(
        kind === 'live'
          ? badge('UŽIVO', 'live')
          : kind === 'error'
            ? badge('greška', 'bad')
            : badge(kind === 'wait' ? 'čeka' : 'spajanje', 'idle'),
      );
      overlay.hidden = kind === 'live';
      spinner.hidden = !(kind === 'connecting' || kind === 'wait');
      retryBtn.hidden = kind !== 'error';
      overlayText.textContent = text || '';
    };

    async function connect() {
      clearTimeout(retryTimer);
      if (closed) return;
      const mine = ++attempt;
      paint('connecting', 'Spajanje na stream…');
      try {
        const p = await whepPlay(endpoint(path, 'whep'), video, (state) => {
          if (closed || mine !== attempt) return;
          if (state === 'failed' || state === 'closed')
            schedule('Veza je prekinuta, spajam ponovno…');
        });
        if (closed || mine !== attempt) return p.stop();
        player = p;
        paint('live');
        video.play().catch(() => {});
      } catch (e) {
        if (closed || mine !== attempt) return;
        if (e instanceof StreamError && e.code === 'not-live') {
          paint('wait', 'Čekam da netko počne slati…');
          retryTimer = setTimeout(connect, RETRY_MS);
        } else {
          paint('error', e.message || 'Neuspjelo spajanje.');
        }
      }
    }
    function schedule(text) {
      player?.stop();
      player = null;
      paint('connecting', text);
      clearTimeout(retryTimer);
      retryTimer = setTimeout(connect, RETRY_MS);
    }

    retryBtn.addEventListener('click', connect);
    muteBtn.addEventListener('click', () => {
      video.muted = !video.muted;
      muteBtn.classList.toggle('off', video.muted);
    });
    muteBtn.classList.add('off');
    fsBtn.addEventListener('click', () => {
      if (document.fullscreenElement) document.exitFullscreen();
      else (stage.requestFullscreen || video.webkitEnterFullscreen)?.call(stage);
    });

    leave = () => {
      closed = true;
      clearTimeout(retryTimer);
      player?.stop();
    };

    const links = el('div');
    const renderLinks = () => clear(links).append(linkButtons(info()));
    const header = head(info().name, () => show(showList), statusSlot);
    root.append(header, stage, links);
    renderLinks();
    sync().then(() => {
      if (mode === 'watch') {
        clear(header.querySelector('.vp-title')).append(info().name);
        renderLinks();
      }
    });
    connect();
  }

  // ---------------------------------------------------------------- slanje
  function showBroadcast() {
    mode = 'broadcast';
    let media = null;
    let publisher = null;
    let live = false;
    let timer = null;
    let startedAt = 0;
    let closed = false;

    const video = el('video', { class: 'vp-video mirror', autoplay: true, playsinline: true });
    video.muted = true;
    const overlay = el('div', { class: 'vp-overlay' });
    const overlayMsg = (text) => {
      overlay.hidden = !text;
      overlay.textContent = text || '';
    };
    const liveBadge = el('span', { class: 'vp-status' });
    const stage = el('div', { class: 'vp-stage portrait' }, video, overlay);

    const nameInput = el('input', {
      type: 'text',
      class: 'vp-input',
      maxlength: '40',
      autocomplete: 'off',
      autocapitalize: 'none',
      spellcheck: 'false',
      value: prefs.get('streamName') || `karta_${Date.now().toString(36).slice(-4)}`,
    });
    const nameHint = el('div', { class: 'vp-hint' });
    const camSelect = el('select', { class: 'vp-input' });
    const flipBtn = el(
      'button',
      { type: 'button', class: 'btn small', title: 'Zamijeni kameru' },
      icon('flip'),
      'Zamijeni',
    );
    const qualitySelect = el(
      'select',
      { class: 'vp-input' },
      Object.entries(QUALITY).map(([k, q]) => el('option', { value: k, text: q.label })),
    );
    qualitySelect.value =
      prefs.get('streamQuality') in QUALITY ? prefs.get('streamQuality') : 'mid';
    const micBtn = el('button', { type: 'button', class: 'btn small on' }, icon('mic'), 'Mikrofon');
    let micOn = prefs.get('streamMic') !== '0';
    const paintMic = () => {
      micBtn.classList.toggle('on', micOn);
      clear(micBtn).append(
        icon(micOn ? 'mic' : 'mic-off'),
        micOn ? 'Mikrofon uključen' : 'Bez zvuka',
      );
      for (const t of media?.getAudioTracks() || []) t.enabled = micOn;
    };

    const goBtn = el('button', { type: 'button', class: 'btn primary wide vp-go' }, icon('video'));
    const goLabel = el('span', { text: 'Kreni uživo' });
    goBtn.append(goLabel);
    const msg = el('p', { class: 'vp-note', role: 'status' });
    const afterLive = el('div', { hidden: true });
    const settings = el(
      'div',
      { class: 'vp-form' },
      el(
        'label',
        { class: 'vp-field' },
        el('span', { text: 'Naziv streama' }),
        nameInput,
        nameHint,
      ),
      el('label', { class: 'vp-field' }, el('span', { text: 'Kamera' }), camSelect),
      el('div', { class: 'row wrap vp-rowtools' }, flipBtn, micBtn),
      el('label', { class: 'vp-field' }, el('span', { text: 'Kvaliteta' }), qualitySelect),
    );

    function stopMedia() {
      for (const t of media?.getTracks() || []) t.stop();
      media = null;
      video.srcObject = null;
    }

    async function openCamera() {
      stopMedia();
      if (!navigator.mediaDevices?.getUserMedia) {
        overlayMsg('Kamera radi samo na HTTPS adresi.');
        goBtn.disabled = true;
        return;
      }
      const q = QUALITY[qualitySelect.value];
      overlayMsg('Pokrećem kameru…');
      try {
        media = await navigator.mediaDevices.getUserMedia({
          video: {
            ...(camSelect.value
              ? { deviceId: { exact: camSelect.value } }
              : { facingMode: 'user' }),
            width: { ideal: q.width },
            height: { ideal: q.height },
            frameRate: { ideal: 30 },
          },
          audio: { echoCancellation: true, noiseSuppression: true },
        });
      } catch (e) {
        // bez mikrofona i dalje se moze slati samo slika
        if (e.name === 'NotFoundError' || e.name === 'OverconstrainedError') {
          try {
            media = await navigator.mediaDevices.getUserMedia({ video: true });
          } catch (e2) {
            e = e2;
          }
        }
        if (!media) {
          goBtn.disabled = true;
          overlayMsg(
            e.name === 'NotAllowedError'
              ? 'Kamera je blokirana. Dopusti pristup kameri u pregledniku i pokušaj ponovno.'
              : e.name === 'NotFoundError'
                ? 'Kamera nije pronađena.'
                : `Kamera nije dostupna: ${e.message}`,
          );
          return;
        }
      }
      if (closed) return stopMedia();
      video.srcObject = media;
      overlayMsg('');
      goBtn.disabled = false;
      const track = media.getVideoTracks()[0];
      const facing = track?.getSettings().facingMode;
      video.classList.toggle('mirror', facing !== 'environment');
      // popis kamera (nazivi su dostupni tek nakon dopustenja)
      const cams = (await navigator.mediaDevices.enumerateDevices()).filter(
        (d) => d.kind === 'videoinput',
      );
      const current = track?.getSettings().deviceId;
      clear(camSelect).append(
        ...cams.map((c, i) =>
          el('option', { value: c.deviceId, text: c.label || `Kamera ${i + 1}` }),
        ),
      );
      if (current) camSelect.value = current;
      flipBtn.hidden = cams.length < 2;
      paintMic();
    }

    function checkName() {
      const ok = NAME_RE.test(nameInput.value);
      nameHint.textContent = ok ? '' : 'Samo slova, brojevi, _ i - (najviše 40 znakova).';
      nameHint.classList.toggle('bad', !ok);
      return ok;
    }

    function tick() {
      clear(liveBadge).append(
        badge(`UŽIVO ${TIMED(Math.floor((Date.now() - startedAt) / 1000))}`, 'live'),
      );
    }

    function setLive(on, name) {
      live = on;
      settings.hidden = on;
      afterLive.hidden = !on;
      goBtn.classList.toggle('danger', on);
      goBtn.classList.toggle('primary', !on);
      goLabel.textContent = on ? 'Zaustavi stream' : 'Kreni uživo';
      clearInterval(timer);
      if (on) {
        startedAt = Date.now();
        tick();
        timer = setInterval(tick, 1000);
        clear(afterLive).append(
          linkButtons({
            viewUrl: `${base}${encodeURIComponent(name)}/`,
            hlsUrl: hlsBase && `${hlsBase}${encodeURIComponent(name)}/`,
            rtspUrl: null,
          }),
        );
      } else {
        clear(liveBadge);
      }
    }

    async function startLive() {
      if (!checkName()) return nameInput.focus();
      if (!media) return;
      const name = nameInput.value;
      goBtn.disabled = true;
      goLabel.textContent = 'Spajanje…';
      msg.textContent = '';
      try {
        publisher = await whipPublish(endpoint(name, 'whip'), media, (state) => {
          if (closed || !live) return;
          if (state === 'failed' || state === 'closed') {
            stopLive();
            toast('Veza sa serverom je prekinuta, stream je zaustavljen.', 'bad');
          }
        });
        prefs.set('streamName', name);
        prefs.set('streamQuality', qualitySelect.value);
        prefs.set('streamMic', micOn ? '1' : '0');
        setLive(true, name);
        sync();
      } catch (e) {
        goLabel.textContent = 'Kreni uživo';
        msg.textContent =
          e instanceof StreamError && e.code === 'conflict'
            ? 'Taj naziv već netko koristi. Promijeni naziv.'
            : `Slanje nije uspjelo: ${e.message}`;
      }
      goBtn.disabled = false;
    }

    function stopLive() {
      publisher?.stop();
      publisher = null;
      if (!closed) {
        setLive(false);
        sync();
      }
    }

    goBtn.addEventListener('click', () => (live ? stopLive() : startLive()));
    nameInput.addEventListener('input', checkName);
    micBtn.addEventListener('click', () => {
      micOn = !micOn;
      paintMic();
    });
    camSelect.addEventListener('change', openCamera);
    qualitySelect.addEventListener('change', openCamera);
    flipBtn.addEventListener('click', () => {
      const opts = [...camSelect.options];
      camSelect.selectedIndex = (camSelect.selectedIndex + 1) % opts.length;
      openCamera();
    });

    leaveGuard = async () =>
      !live ||
      confirmDialog({
        title: 'Zaustaviti stream?',
        message: 'Napuštanjem ovog prikaza stream se prekida.',
        okText: 'Zaustavi',
        danger: true,
      });
    leave = () => {
      closed = true;
      clearInterval(timer);
      publisher?.stop();
      stopMedia();
    };

    root.append(
      head('Novi stream', () => show(showList), liveBadge),
      stage,
      settings,
      goBtn,
      msg,
      afterLive,
    );
    checkName();
    paintMic();
    goBtn.disabled = true;
    openCamera();
  }

  // pri odlasku na drugi odjeljak gledanje se prekida, a slanje nastavlja
  function pause() {
    if (mode === 'watch') show(showList);
  }

  showList();
  return { sync, pause };
}
