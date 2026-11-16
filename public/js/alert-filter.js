// Filtriranje popisa alarma (cista funkcija): skriveni, utisani uredjaji, kategorija i pretraga.
// Utisani uredjaji nestaju iz glavnog popisa i ne stvaraju obavijesti; vide se pod "Utisano".

export function splitAlerts(rows, { hidden, muted }) {
  const visible = [];
  const mutedRows = [];
  let hiddenCount = 0;
  for (const r of rows) {
    if (hidden.has(r.key)) hiddenCount++;
    else if (r.deviceId && muted.has(r.deviceId)) mutedRows.push(r);
    else visible.push(r);
  }
  return { visible, mutedRows, hiddenCount };
}

const norm = (s) => String(s ?? '').toLowerCase();

export function matchAlert(r, query) {
  const q = norm(query).trim();
  if (!q) return true;
  return [r.title, r.deviceName, r.tag, r.deviceId].some((v) => norm(v).includes(q));
}
