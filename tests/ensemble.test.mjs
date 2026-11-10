import test from 'node:test';
import assert from 'node:assert/strict';
import { median, combineHour, buildForecast, sunElevation } from '../js/ensemble.js';

test('median', () => {
  assert.equal(median([3, 1, 2]), 2);
  assert.equal(median([4, 1, 2, 3]), 2.5);
  assert.equal(median([]), null);
});

test('einige Quellen: Regen, hohe Konfidenz', () => {
  const h = combineHour([
    { t: 10, p: 1.0, pp: 80, cc: 90 },
    { t: 10.5, p: 0.8, pp: 90, cc: 100 },
    { t: 11, p: 1.4, pp: null, cc: 95 },
  ]);
  assert.equal(h.kind, 'rain');
  assert.equal(h.temp, 10.5);
  assert.equal(h.precip, 1.0);
  assert.equal(h.confLabel, 'hoch');
  assert.ok(Math.abs(h.prob - 0.925) < 1e-9);
});

test('uneinige Quellen: tiefe Konfidenz', () => {
  const h = combineHour([
    { t: 4, p: 0, pp: 10, cc: 20 },
    { t: 9, p: 2, pp: 90, cc: 100 },
    { t: 12, p: 0, pp: 20, cc: 40 },
    { t: 7, p: 1, pp: 70, cc: 80 },
  ]);
  assert.equal(h.confLabel, 'tief');
});

test('Schnee bei Frost, fehlende Werte werden ignoriert', () => {
  const h = combineHour([
    { t: -2, p: 0.5, pp: null, cc: null },
    { t: -1, p: 0.7, pp: null, cc: 100 },
    { t: -1.5, p: null, pp: null, cc: 100 },
  ]);
  assert.equal(h.kind, 'snow');
  assert.equal(h.n, 3);
});

test('weniger als drei Quellen deckelt die Konfidenz', () => {
  const h = combineHour([{ t: 10, p: 0, pp: 0, cc: 0 }, { t: 10, p: 0, pp: 0, cc: 0 }]);
  assert.equal(h.kind, 'clear');
  assert.equal(h.confLabel, 'tief');
});

test('buildForecast richtet Stunden aus und überspringt Lücken', () => {
  const H = 3600e3;
  const a = { ok: true, utcOffset: 3600, hours: new Map([[0, { t: 1, p: 0, pp: 0, cc: 0 }], [H, { t: 2, p: 0, pp: 0, cc: 0 }]]) };
  const b = { ok: true, utcOffset: null, hours: new Map([[H, { t: 4, p: 0, pp: 0, cc: 0 }]]) };
  const c = { ok: false, error: 'x' };
  const f = buildForecast([c, a, b], 0, 3);
  assert.equal(f.hours.length, 2);
  assert.equal(f.hours[1].temp, 3);
  assert.equal(f.utcOffset, 3600);
  assert.equal(f.sourceCount, 2);
});

test('Sonnenhöhe Zürich: Mittag im Juni hoch, Mitternacht negativ', () => {
  const noon = sunElevation(Date.UTC(2026, 5, 21, 11, 30), 47.37, 8.54);
  const night = sunElevation(Date.UTC(2026, 5, 21, 23, 30), 47.37, 8.54);
  assert.ok(noon > 63 && noon < 67, `noon=${noon}`);
  assert.ok(night < -15, `night=${night}`);
});
