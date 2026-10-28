// Alarmi: ulaz/izlaz iz zona, niska baterija, "ne javlja polozaj" (racuna ova aplikacija)
// te stvarni alarmi iz OTS-a (GET /api/alerts).
import { randomUUID } from 'node:crypto';
import { num, validLat, validLon } from '../lib/validate.js';
import { zoneContains } from '../public/js/geo.js';
import { otsGet, fixServerTime } from './ots.js';
import { zones } from './data.js';
import {
  DEVICES_PATH,
  LOW_BATTERY_PCT,
  NO_REPORT_MIN,
  OFFLINE_HIDE_MS,
  OTS_ALERTS_PATH,
  OTS_ALERTS_EVERY_MS,
} from './config.js';

const ALERTS_MAX = 500;
export let alerts = [];
function pushAlert(a) {
  alerts.unshift({ id: randomUUID(), time: new Date().toISOString(), ...a });
  if (alerts.length > ALERTS_MAX) alerts.length = ALERTS_MAX;
}

const deviceState = new Map(); // uredjaj id -> { lastTime, noReportAlerted, lowBatteryAlerted, zones }
export function checkZonesAndAlerts(items) {
  for (const it of items) {
    if (!it.from?.includes(DEVICES_PATH)) continue; // alarmi su samo za uredjaje, ne markere
    let ds = deviceState.get(it.id);
    if (!ds) {
      ds = { lastTime: null, noReportAlerted: false, lowBatteryAlerted: false, zones: new Set() };
      deviceState.set(it.id, ds);
    }

    const curZones = new Set();
    for (const z of zones) if (zoneContains(z, it.lat, it.lon)) curZones.add(z.id);
    for (const zid of curZones)
      if (!ds.zones.has(zid)) {
        const z = zones.find((zz) => zz.id === zid);
        if (z)
          pushAlert({
            type: 'enter',
            deviceId: it.id,
            deviceName: it.name,
            zoneId: zid,
            zoneName: z.name,
            message: `${it.name} je ušao u zonu "${z.name}"`,
          });
      }
    for (const zid of ds.zones)
      if (!curZones.has(zid)) {
        const z = zones.find((zz) => zz.id === zid);
        if (z)
          pushAlert({
            type: 'exit',
            deviceId: it.id,
            deviceName: it.name,
            zoneId: zid,
            zoneName: z.name,
            message: `${it.name} je izašao iz zone "${z.name}"`,
          });
      }
    ds.zones = curZones;

    // niska baterija (vrijedi za svaku vrstu objekta koja javlja bateriju); alarm se javlja
    // jednom, a ponovno tek nakon sto se baterija oporavi iznad praga + 5 %
    const battery = it.telemetry?.battery;
    if (Number.isFinite(battery)) {
      if (battery < LOW_BATTERY_PCT && !ds.lowBatteryAlerted) {
        ds.lowBatteryAlerted = true;
        pushAlert({
          type: 'low-battery',
          deviceId: it.id,
          deviceName: it.name,
          message: `${it.name}: baterija ${Math.round(battery)} % (ispod ${LOW_BATTERY_PCT} %)`,
        });
      } else if (battery >= LOW_BATTERY_PCT + 5) {
        ds.lowBatteryAlerted = false;
      }
    }

    const t = Date.parse(it.time || '');
    if (Number.isFinite(t) && t !== ds.lastTime) {
      ds.lastTime = t;
      ds.noReportAlerted = false;
    }
    const silentMs = ds.lastTime ? Date.now() - ds.lastTime : 0;
    if (silentMs > NO_REPORT_MIN * 60000 && silentMs <= OFFLINE_HIDE_MS && !ds.noReportAlerted) {
      ds.noReportAlerted = true;
      pushAlert({
        type: 'no-report',
        deviceId: it.id,
        deviceName: it.name,
        message: `${it.name} ne javlja položaj više od ${NO_REPORT_MIN} min`,
      });
    }
  }
}

// ---------- OTS alarmi (GET /api/alerts) ----------
// OTS cuva alarme koje salju TAK klijenti. Citaju se rjedje od polozaja (OTS_ALERTS_EVERY_MS);
// zadnja stranica sadrzi najnovije. Greska ne smije srusiti ostatak osvjezavanja.
export let otsAlerts = [];
let otsAlertsAt = 0;

const normalizeOtsAlert = (a) => {
  const pt = a.point || {};
  const lat = num(pt.latitude ?? pt.lat);
  const lon = num(pt.longitude ?? pt.lon);
  const located = validLat(lat) && validLon(lon);
  return {
    id: String(a.uid ?? `${a.sender_uid}-${a.start_time}`),
    senderUid: a.sender_uid ?? null,
    callsign: a.callsign ?? null,
    alertType: String(a.alert_type ?? 'alert'),
    startTime: fixServerTime(a.start_time ?? null),
    cancelTime: fixServerTime(a.cancel_time ?? null),
    active: !a.cancel_time,
    lat: located ? lat : null,
    lon: located ? lon : null,
  };
};

export async function loadOtsAlerts() {
  if (!OTS_ALERTS_PATH || Date.now() - otsAlertsAt < OTS_ALERTS_EVERY_MS) return null;
  otsAlertsAt = Date.now();
  const first = await otsGet(`${OTS_ALERTS_PATH}?per_page=50&page=1`);
  if (first.status >= 400) throw new Error(`${OTS_ALERTS_PATH}: HTTP ${first.status}`);
  const total = Number(first.json?.total_pages || 1);
  const last = total > 1 ? await otsGet(`${OTS_ALERTS_PATH}?per_page=50&page=${total}`) : first;
  if (last.status >= 400) throw new Error(`${OTS_ALERTS_PATH}: HTTP ${last.status}`);
  otsAlerts = (last.json?.results || [])
    .map(normalizeOtsAlert)
    .sort((a, b) => (Date.parse(b.startTime) || 0) - (Date.parse(a.startTime) || 0));
  return otsAlerts.length;
}
