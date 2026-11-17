// Video: popis streamova iz OTS-a (MediaMTX), gledanje i slanje s kamere izravno u karti.
// Gledanje (WHEP) i slanje (WHIP) rade preko WebRTC-a, vidi webrtc.js.
import { $, el, clear, api, icon, toast, prefs, emptyState, appUrl } from './util.js';
import { confirmDialog } from './dialog.js';
import { StreamError, whepPlay, whipPublish } from './webrtc.js';
import { AUDIO_LABELS, VIDEO_LABELS, codecNames } from './codecs.js';
import { HEIGHT, MODES, adjustCap, effectiveLevel, initialCap } from './quality.js';

const NAME_RE = /^[A-Za-z0-9_-]{1,40}$/;
const REFRESH_MS = 4000;
const RETRY_MS = 3000;
// kamera uvijek snima u 720p; slanje se po potrebi smanjuje na 240p (vidi quality.js)
const CAPTURE = { width: 1280, height: 720 };
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
    const gearBtn = el(
      'button',
      {
        type: 'button',
        class: 'vp-ctl',
        title: 'Postavke videa',
        'aria-haspopup': 'true',
        'aria-expanded': 'false',
      },
      icon('sliders'),
    );
    const resChip = el('button', { type: 'button', class: 'vp-chip', title: 'Kvaliteta slike' });
    const menu = el('div', { class: 'vp-menu', hidden: true });
    const hdNote = el('p', { class: 'vp-note', hidden: true });
    const stage = el(
      'div',
      { class: 'vp-stage' },
      video,
      overlay,
      resChip,
      el('div', { class: 'vp-ctls' }, gearBtn, muteBtn, fsBtn),
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

    // HD na zahtjev: dok je ukljucen, svakih nekoliko sekundi se obnavlja zahtjev; posiljatelj
    // ga cita i podize kvalitetu, a kad prestane (ili odemo) vraca se na nisku
    const viewerId = `v${Math.random().toString(36).slice(2, 12)}`;
    let hd = false;
    let hdTimer = null;
    const sendHd = (on, keepalive = false) =>
      fetch(appUrl('/api/video/quality'), {
        method: 'POST',
        headers: { 'X-TAK-App': '1', 'Content-Type': 'application/json' },
        body: JSON.stringify({ path, viewerId, hd: on }),
        keepalive,
      }).catch(() => {});
    function setHd(on) {
      if (hd === on) return;
      hd = on;
      clearInterval(hdTimer);
      sendHd(hd);
      if (hd) hdTimer = setInterval(() => sendHd(true), 5000);
      updateRes();
    }

    const dims = () => ({ w: video.videoWidth || 0, h: video.videoHeight || 0 });
    function updateRes() {
      const { w, h } = dims();
      resChip.hidden = !w;
      resChip.textContent = w ? `${h}p${h >= 700 ? ' HD' : ''}` : '';
      resChip.classList.toggle('hd', h >= 700);
      hdNote.hidden = !hd;
      hdNote.textContent =
        h >= 700
          ? 'HD je aktivan. Vrijedi za sve koji gledaju ovaj stream.'
          : 'HD je zatražen. Pošiljatelj prilagođava kvalitetu, što može potrajati nekoliko sekundi. Radi samo za streamove pokrenute iz ove karte.';
      if (!menu.hidden) renderMenu();
    }
    video.addEventListener('resize', updateRes);
    video.addEventListener('loadedmetadata', updateRes);
    const resTimer = setInterval(updateRes, 1500);

    const menuRow = (iconName, label, onClick, hint) =>
      el(
        'button',
        { type: 'button', class: 'vp-menu-row', role: 'menuitem', onclick: onClick },
        icon(iconName),
        el('span', { class: 'grow', text: label }),
        hint && el('small', { text: hint }),
      );
    const qualityRow = (value, label, hint) =>
      el(
        'button',
        {
          type: 'button',
          class: `vp-menu-row vp-opt${hd === (value === 'high') ? ' on' : ''}`,
          role: 'menuitemradio',
          'aria-checked': String(hd === (value === 'high')),
          onclick: () => setHd(value === 'high'),
        },
        icon('check'),
        el('span', { class: 'grow', text: label }),
        el('small', { text: hint }),
      );

    function renderMenu() {
      const { w, h } = dims();
      clear(menu).append(
        el('div', { class: 'vp-menu-h', text: 'Kvaliteta' }),
        qualityRow('low', 'Niska · 240p', 'štedi podatke'),
        qualityRow('high', 'HD · 720p', 'oštrija slika'),
        el('div', {
          class: 'vp-menu-note',
          text: w ? `Trenutno stiže ${w}×${h}` : 'Slika još nije stigla',
        }),
        el('div', { class: 'vp-menu-sep' }),
        menuRow('volume', video.muted ? 'Uključi zvuk' : 'Isključi zvuk', () => {
          muteBtn.click();
          renderMenu();
        }),
        document.pictureInPictureEnabled &&
          menuRow('maximize', 'Slika u slici', () => {
            closeMenu();
            (document.pictureInPictureElement
              ? document.exitPictureInPicture()
              : video.requestPictureInPicture()
            ).catch(() => toast('Slika u slici nije dostupna', 'warn', 2500));
          }),
        menuRow('maximize', 'Cijeli zaslon', () => {
          closeMenu();
          fsBtn.click();
        }),
        menuRow('flip', 'Ponovno spoji', () => {
          closeMenu();
          connect();
        }),
      );
    }
    function openMenu() {
      renderMenu();
      menu.hidden = false;
      gearBtn.setAttribute('aria-expanded', 'true');
    }
    function closeMenu() {
      menu.hidden = true;
      gearBtn.setAttribute('aria-expanded', 'false');
    }
    const toggleMenu = (ev) => {
      ev.stopPropagation();
      if (menu.hidden) openMenu();
      else closeMenu();
    };
    gearBtn.addEventListener('click', toggleMenu);
    resChip.addEventListener('click', toggleMenu);
    menu.addEventListener('click', (ev) => ev.stopPropagation());
    stage.addEventListener('click', () => !menu.hidden && closeMenu());
    stage.addEventListener('keydown', (ev) => ev.key === 'Escape' && closeMenu());

    leave = () => {
      closed = true;
      clearTimeout(retryTimer);
      clearInterval(hdTimer);
      clearInterval(resTimer);
      if (hd) sendHd(false, true);
      player?.stop();
    };

    const links = el('div');
    const renderLinks = () => clear(links).append(linkButtons(info()));
    const header = head(info().name, () => show(showList), statusSlot);
    root.append(header, stage, menu, hdNote, links);
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
    // mikrofon i kodeci (kodek se ne moze mijenjati tijekom emitiranja)
    const micSelect = el('select', { class: 'vp-input', 'aria-label': 'Mikrofon' });
    const names = (kind) =>
      codecNames(globalThis.RTCRtpSender?.getCapabilities?.(kind)).filter(
        (n) => kind === 'video' || n !== 'MULTIOPUS',
      );
    const codecSelect = (kind, labels, autoLabel, prefKey) => {
      const select = el(
        'select',
        { class: 'vp-input', 'aria-label': kind === 'video' ? 'Video kodek' : 'Audio kodek' },
        el('option', { value: 'auto', text: autoLabel }),
        names(kind).map((n) => el('option', { value: n, text: labels[n] || n })),
      );
      const saved = prefs.get(prefKey);
      select.value = [...select.options].some((o) => o.value === saved) ? saved : 'auto';
      return select;
    };
    const videoCodecSelect = codecSelect(
      'video',
      VIDEO_LABELS,
      'Automatski (H.264 prvi)',
      'streamVideoCodec',
    );
    const audioCodecSelect = codecSelect(
      'audio',
      AUDIO_LABELS,
      'Automatski (Opus prvi)',
      'streamAudioCodec',
    );
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

    let sendMode = prefs.get('streamMode') in MODES ? prefs.get('streamMode') : 'auto';
    const modeSelect = el(
      'select',
      { class: 'vp-input', 'aria-label': 'Kvaliteta slanja' },
      Object.entries(MODES).map(([k, label]) => el('option', { value: k, text: label })),
    );
    modeSelect.value = sendMode;
    modeSelect.addEventListener('change', () => {
      sendMode = modeSelect.value;
      prefs.set('streamMode', sendMode);
    });
    // vidljiv i dok se emitira, pa se nacin moze mijenjati uzivo
    const qualityField = el(
      'label',
      { class: 'vp-field' },
      el('span', { text: 'Kvaliteta slanja' }),
      modeSelect,
    );
    const qStatus = el('p', { class: 'vp-note vp-qstatus', role: 'status' });

    const goBtn = el('button', { type: 'button', class: 'btn primary wide vp-go' }, icon('video'));
    const goLabel = el('span', { text: 'Kreni uživo' });
    goBtn.append(goLabel);
    const msg = el('p', { class: 'vp-note', role: 'status' });
    const afterLive = el('div', { hidden: true });
    let controlTimer = null;
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
      el('label', { class: 'vp-field' }, el('span', { text: 'Mikrofon' }), micSelect),
      el('div', { class: 'row wrap vp-rowtools' }, flipBtn, micBtn),
      el(
        'details',
        { class: 'raw vp-adv' },
        el('summary', { text: 'Kodeci' }),
        el('label', { class: 'vp-field' }, el('span', { text: 'Video kodek' }), videoCodecSelect),
        el('label', { class: 'vp-field' }, el('span', { text: 'Audio kodek' }), audioCodecSelect),
        el('p', {
          class: 'vp-note',
          text: 'H.264 je potreban za iTAK, ATAK i HLS adresu. VP8 i VP9 gledaju samo preglednici. Ako stream ne prikazuje sliku, probaj drugi kodek.',
        }),
      ),
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
      const q = CAPTURE;
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
          audio: {
            ...(micSelect.value ? { deviceId: { exact: micSelect.value } } : {}),
            echoCancellation: true,
            noiseSuppression: true,
          },
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
      const mics = (await navigator.mediaDevices.enumerateDevices()).filter(
        (d) => d.kind === 'audioinput',
      );
      const currentMic = media.getAudioTracks()[0]?.getSettings().deviceId;
      clear(micSelect).append(
        ...mics.map((m, i) =>
          el('option', { value: m.deviceId, text: m.label || `Mikrofon ${i + 1}` }),
        ),
      );
      if (currentMic) micSelect.value = currentMic;
      micSelect.disabled = !mics.length;
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
        publisher = await whipPublish(
          endpoint(name, 'whip'),
          media,
          (state) => {
            if (closed || !live) return;
            if (state === 'failed' || state === 'closed') {
              stopLive();
              toast('Veza sa serverom je prekinuta, stream je zaustavljen.', 'bad');
            }
          },
          { video: videoCodecSelect.value, audio: audioCodecSelect.value },
        );
        prefs.set('streamVideoCodec', videoCodecSelect.value);
        prefs.set('streamAudioCodec', audioCodecSelect.value);
        prefs.set('streamName', name);
        prefs.set('streamMic', micOn ? '1' : '0');
        setLive(true, name);
        startControl(name);
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

    // svake 3 s: pita ima li HD zahtjeva, mjeri mrezu i prema tome podize ili spusta kvalitetu
    function startControl(name) {
      const selected = 'high';
      const captureHeight = media?.getVideoTracks()[0]?.getSettings().height || HEIGHT[selected];
      let state = initialCap(selected);
      let applied = null;
      let busy = false;
      const tickControl = async () => {
        if (busy || !publisher || closed) return;
        busy = true;
        try {
          const want = await api(
            'GET',
            `/api/video/quality?path=${encodeURIComponent(name)}`,
          ).catch(() => ({ hd: false, viewers: 0 }));
          const stats = await publisher.readStats();
          qStatus.dataset.stats = JSON.stringify(stats);
          state = adjustCap(state, { selected, ...stats });
          const level = effectiveLevel(
            { selected, hdRequested: want.hd, mode: sendMode },
            state.cap,
          );
          if (level !== applied) {
            await publisher.setLevel(level, captureHeight);
            applied = level;
          }
          const parts = [
            `Šaljem ${HEIGHT[level]}p${stats.sent?.codec ? ` (${stats.sent.codec})` : ''}`,
          ];
          if (want.hd)
            parts.push(`HD traži ${want.viewers} gledatelj${want.viewers === 1 ? '' : 'a'}`);
          else if (sendMode === 'auto') parts.push('štednja podataka (nitko ne traži HD)');
          else if (sendMode === 'low') parts.push('stalno niska kvaliteta');
          else parts.push('stalno HD');
          if (state.cap !== selected) parts.push('signal je slab, kvaliteta je snižena');
          qStatus.textContent = parts.join(' · ');
        } catch {
          /* sljedeci uzorak ce pokusati ponovno */
        }
        busy = false;
      };
      clearInterval(controlTimer);
      controlTimer = setInterval(tickControl, 3000);
      tickControl();
    }

    function stopLive() {
      clearInterval(controlTimer);
      qStatus.textContent = '';
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
    micSelect.addEventListener('change', openCamera);
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
      clearInterval(controlTimer);
      publisher?.stop();
      stopMedia();
    };

    root.append(
      head('Novi stream', () => show(showList), liveBadge),
      stage,
      settings,
      qualityField,
      goBtn,
      msg,
      qStatus,
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
