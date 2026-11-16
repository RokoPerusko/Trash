import { test } from 'node:test';
import assert from 'node:assert/strict';
import { droneVerdict, mapWeather, describeCode } from '../server/weather.js';

test('procjena za dron: vjetar, kisa i vidljivost', () => {
  const calm = { windMs: 3, gustMs: 5, precipMm: 0, visibilityM: 20000, tempC: 15 };
  assert.equal(droneVerdict(calm).level, 'ok');
  assert.equal(droneVerdict({ ...calm, windMs: 8 }).level, 'warn');
  assert.equal(droneVerdict({ ...calm, gustMs: 15 }).level, 'bad');
  assert.equal(droneVerdict({ ...calm, precipMm: 1 }).level, 'bad');
  assert.equal(droneVerdict({ ...calm, visibilityM: 500 }).level, 'bad');
  assert.ok(droneVerdict({ ...calm, windMs: 12 }).reasons.some((r) => /vjetar/.test(r)));
});

test('mapWeather: odgovor Open-Meteo u nas oblik, prognoza pocinje u buducnosti', () => {
  const w = mapWeather({
    current: {
      time: '2026-11-16T10:00',
      temperature_2m: 12.34,
      wind_speed_10m: 4.2,
      wind_gusts_10m: 7,
      wind_direction_10m: 225,
      weather_code: 3,
      precipitation: 0,
      is_day: 1,
    },
    hourly: {
      time: ['2026-11-16T09:00', '2026-11-16T10:00', '2026-11-16T11:00', '2026-11-16T12:00'],
      temperature_2m: [1, 2, 3, 4],
      wind_speed_10m: [1, 2, 3, 4],
      precipitation_probability: [0, 10, 20, 30],
      visibility: [9000, 10000, 11000, 12000],
    },
  });
  assert.equal(w.tempC, 12.3);
  assert.equal(w.text, 'Oblačno');
  assert.equal(w.hourly[0].time, '2026-11-16T11:00');
  assert.equal(w.hourly[0].precipProb, 20);
  assert.equal(w.drone.level, 'ok');
  assert.equal(mapWeather({}), null);
  assert.equal(describeCode(95), 'Grmljavina');
});
