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

import { weightedMedian } from '../js/ensemble.js';

test('gewichteter Median', () => {
  assert.equal(weightedMedian([[1, 1], [2, 1], [3, 1]]), 2);
  assert.equal(weightedMedian([[1, 1], [2, 1], [3, 1], [4, 1]]), 2.5);
  assert.equal(weightedMedian([[1, 1], [2, 1], [10, 5]]), 10);
  assert.equal(weightedMedian([[5, 0.7]]), 5);
  assert.equal(weightedMedian([]), null);
});

test('Gewichte verschieben Konsens und Niederschlagsanteil', () => {
  const h = combineHour([
    { t: 5, p: 0, pp: null, cc: 10, w: 0.7 },
    { t: 6, p: 0, pp: null, cc: 20, w: 1 },
    { t: 9, p: 1, pp: null, cc: 90, w: 3 },
  ]);
  assert.equal(h.temp, 9);
  assert.equal(h.kind, 'rain');
  assert.ok(Math.abs(h.prob - 3 / 4.7) < 1e-9);
});

test('buildForecast reicht das Gewicht der Quelle durch', () => {
  const mk = (t, weight) => ({ ok: true, weight, utcOffset: 0, hours: new Map([[0, { t, p: 0, pp: 0, cc: 0 }]]) });
  const f = buildForecast([mk(1, 1), mk(2, 1), mk(8, 5)], 0, 1);
  assert.equal(f.hours[0].temp, 8);
});

import { visualState } from '../js/ensemble.js';

test('Bild passt zur Wetterlage, auch wenn die Bewölkungszahl nicht dazu passt', () => {
  assert.deepEqual(visualState({ kind: 'rain', cloud: 40, precip: 0.1 }), { cover: 0.96, rain: 0.3, snow: 0, fog: 0, thunder: 0 });
  assert.deepEqual(visualState({ kind: 'snow', cloud: 100, precip: 1.5 }), { cover: 1, rain: 0, snow: 1.5, fog: 0, thunder: 0 });
  assert.deepEqual(visualState({ kind: 'thunder', cloud: 30, precip: 0 }), { cover: 1, rain: 1.5, snow: 0, fog: 0, thunder: 1 });
  assert.deepEqual(visualState({ kind: 'fog', cloud: 20, precip: 0 }), { cover: 0.9, rain: 0, snow: 0, fog: 1, thunder: 0 });
  assert.equal(visualState({ kind: 'cloudy', cloud: 70, precip: 0.05 }).cover, 0.84);
  assert.equal(visualState({ kind: 'cloudy', cloud: null }).rain, 0);
  assert.equal(visualState({ kind: 'partly', cloud: 69 }).cover, 0.6);
  assert.equal(visualState({ kind: 'partly', cloud: null }).cover, 0.5);
  assert.equal(visualState({ kind: 'clear', cloud: 29 }).cover, 0.1);
  assert.equal(visualState({ kind: 'clear', cloud: 0 }).cover, 0);
});

test('Wind und Böen: gewichteter Median, Böen nie unter dem Wind, fehlende Werte ignoriert', () => {
  const h = combineHour([
    { t: 10, p: 0, cc: 50, ws: 10, wg: 30 },
    { t: 10, p: 0, cc: 50, ws: 20, wg: 40 },
    { t: 10, p: 0, cc: 50, ws: 30, wg: null },
  ]);
  assert.equal(h.wind, 20);
  assert.equal(h.gust, 35);
  const calm = combineHour([{ t: 10, p: 0, cc: 50, ws: 25, wg: 12 }]);
  assert.equal(calm.gust, 25);
  const none = combineHour([{ t: 10, p: 0, cc: 50 }]);
  assert.equal(none.wind, null);
  assert.equal(none.gust, null);
});

test('Gewitter ab 30 % Gewicht, Nebel erst ab Mehrheit, Quellen ohne Angabe zählen nicht', () => {
  const base = { t: 18, p: 0, cc: 80 };
  const thunder = combineHour([{ ...base, th: true }, { ...base, th: false }, { ...base, th: false }, { ...base, th: null }]);
  assert.equal(thunder.kind, 'thunder');
  assert.ok(Math.abs(thunder.thunder - 1 / 3) < 1e-9);
  const rare = combineHour([{ ...base, th: true }, { ...base, th: false }, { ...base, th: false }, { ...base, th: false }]);
  assert.equal(rare.kind, 'cloudy');
  const fog = combineHour([{ ...base, fg: true }, { ...base, fg: true }, { ...base, fg: false }]);
  assert.equal(fog.kind, 'fog');
  const patchy = combineHour([{ ...base, fg: true }, { ...base, fg: false }, { ...base, fg: false }]);
  assert.equal(patchy.kind, 'cloudy');
  const rainWins = combineHour([{ ...base, p: 1, fg: true }, { ...base, p: 1, fg: true }]);
  assert.equal(rainWins.kind, 'rain');
});
