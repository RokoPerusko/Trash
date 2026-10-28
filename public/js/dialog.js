// Dijalozi umjesto window.prompt/confirm/alert: ista tema, pristupacni (native <dialog>).
import { $ } from './util.js';

function open({ title, message = '', label = null, value = '', okText, danger, cancel = true }) {
  const dialog = $('dialog');
  const input = $('dialogInput');
  $('dialogTitle').textContent = title;
  $('dialogMsg').textContent = message;
  $('dialogMsg').hidden = !message;
  $('dialogLabel').hidden = label === null;
  $('dialogLabelText').textContent = label || '';
  input.value = value;
  const ok = $('dialogOk');
  ok.textContent = okText;
  ok.classList.toggle('danger', !!danger);
  ok.classList.toggle('primary', !danger);
  $('dialogCancel').hidden = !cancel;

  return new Promise((resolve) => {
    let result = null;
    const done = () => {
      dialog.removeEventListener('close', done);
      $('dialogForm').removeEventListener('submit', submit);
      $('dialogCancel').removeEventListener('click', abort);
      resolve(result);
    };
    const submit = () => {
      result = label === null ? true : input.value;
    };
    const abort = () => dialog.close();
    dialog.addEventListener('close', done);
    $('dialogForm').addEventListener('submit', submit);
    $('dialogCancel').addEventListener('click', abort);
    dialog.showModal();
    if (label !== null) {
      input.focus();
      input.select();
    }
  });
}

// vraca uneseni tekst (trimiran) ili null ako je korisnik odustao / ostavio prazno
export async function askText({ title, label, value = '', okText = 'U redu' }) {
  const result = await open({ title, label, value, okText });
  const text = typeof result === 'string' ? result.trim() : '';
  return text || null;
}

export async function confirmDialog({ title, message, okText = 'Potvrdi', danger = false }) {
  return (await open({ title, message, okText, danger })) === true;
}

export async function alertDialog({ title, message }) {
  await open({ title, message, okText: 'U redu', cancel: false });
}
