import test from 'node:test';
import assert from 'node:assert/strict';
import { dailySummary, warnings } from '../js/ensemble.js';
import { parseSmnStations, parseSmnTenMin, nearestStation, distanceKm } from '../js/sources.js';
import { emptyStore, recordForecasts, evaluate, prune } from '../js/verify.js';

const H = 3600e3;
const hour = (i, o = {}) => ({ ms: Date.UTC(2026, 10, 11, 12) + i * H, temp: 8, tMin: 7, tMax: 9, precip: 0, kind: 'cloudy', wind: 10, gust: 20, ...o });

test('Tagesübersicht: Tage nach Ortszeit, Kennzahlen und prägende Wetterlage', () => {
  const hours = Array.from({ length: 48 }, (_, i) =>
    hour(i, i >= 14 && i < 18 ? { kind: 'rain', precip: 1.5, temp: 5, gust: 60 } : i >= 40 ? { kind: 'clear', temp: 12 } : {}));
  const days = dailySummary(hours, 3600); // UTC+1: der erste Tag beginnt um 13 Uhr Ortszeit
  assert.deepEqual(days.map((d) => d.hours), [11, 24, 13]);
  assert.equal(days[0].kind, 'cloudy');
  assert.equal(days[0].wetHours, 0);
  assert.equal(days[1].kind, 'rain');
  assert.equal(days[1].precip, 6);
  assert.equal(days[1].lo, 5);
  assert.equal(days[1].maxGust, 60);
  assert.equal(days[2].hi, 12);
  assert.equal(dailySummary([hour(0, { gust: null, wind: null })])[0].maxGust, null);
});

test('Tagesübersicht: Gewitter prägt den Tag, eine einzelne Regenstunde nicht', () => {
  const one = dailySummary(Array.from({ length: 10 }, (_, i) => hour(i, i === 3 ? { kind: 'rain', precip: 0.3 } : { kind: 'partly' })))[0];
  assert.equal(one.kind, 'partly');
  assert.equal(one.wetHours, 1);
  const storm = dailySummary(Array.from({ length: 10 }, (_, i) => hour(i, i === 3 ? { kind: 'thunder', precip: 4 } : { kind: 'clear' })))[0];
  assert.equal(storm.kind, 'thunder');
});

test('Hinweise: ruhiges Wetter ergibt keine', () => {
  assert.deepEqual(warnings(Array.from({ length: 48 }, (_, i) => hour(i))), []);
});

test('Hinweise: Schwellen, Zeitspannen und Reihenfolge', () => {
  const hours = Array.from({ length: 24 }, (_, i) => hour(i));
  Object.assign(hours[2], { kind: 'thunder', precip: 16 });
  Object.assign(hours[3], { kind: 'rain', precip: 6 });
  Object.assign(hours[5], { gust: 55 });
  Object.assign(hours[6], { gust: 80 });
  Object.assign(hours[10], { temp: -2, tMin: -3 });
  Object.assign(hours[11], { temp: -1, tMin: -2, kind: 'snow', precip: 0.8 });
  Object.assign(hours[20], { kind: 'fog' });
  const list = warnings(hours);
  const titles = list.map((n) => n.title);
  assert.deepEqual(titles, [
    'Gewitter möglich', 'Starkregen bis 16.0 mm pro Stunde', 'Sturmböen bis 80 km/h',
    'Frost bis -2°', 'Schneefall, 0.8 mm Niederschlag', 'Nebel',
  ]);
  assert.deepEqual(list.map((n) => n.level), ['warn', 'warn', 'warn', 'info', 'info', 'info']);
  const rain = list[1];
  assert.equal(rain.from, hours[2].ms);
  assert.equal(rain.to, hours[3].ms);
  assert.equal(rain.hours, 2);
});

test('Hinweise: Stufen bei Böen, Regen, Frost und Hitze', () => {
  const one = (o) => warnings([hour(0, o)])[0];
  assert.equal(one({ gust: 49 }), undefined);
  assert.deepEqual([one({ gust: 50 }).title, one({ gust: 50 }).level], ['Starke Böen bis 50 km/h', 'info']);
  assert.equal(one({ gust: 62 }).title, 'Stürmische Böen bis 62 km/h');
  assert.equal(one({ gust: 95 }).title, 'Schwere Sturmböen bis 95 km/h');
  assert.equal(one({ gust: null, wind: 70 }).title, 'Stürmische Böen bis 70 km/h');
  assert.deepEqual([one({ kind: 'rain', precip: 5 }).title, one({ kind: 'rain', precip: 5 }).level], ['Kräftiger Regen bis 5.0 mm pro Stunde', 'info']);
  assert.equal(one({ temp: 1, tMin: -1 }).title, 'Frost nicht ausgeschlossen (kälteste Quelle -1°)');
  assert.deepEqual([one({ temp: 31, tMin: 30 }).title, one({ temp: 31, tMin: 30 }).level], ['Hitze bis 31°', 'warn']);
});

const STATIONS = 'station_abbr;station_name;station_canton;station_height_masl;station_coordinates_wgs84_lat;station_coordinates_wgs84_lon\r\n' +
  'LUZ;Luzern;LU;454.0;47.036439;8.301022\r\nPIL;Pilatus;OW;2105.0;46.978803;8.252289\r\nBER;Bern / Zollikofen;BE;553.0;46.990744;7.464061\r\n';

test('MeteoSchweiz: Stationsliste lesen, nächste passende Station wählen', () => {
  const list = parseSmnStations(STATIONS);
  assert.equal(list.length, 3);
  assert.deepEqual(list[0], { id: 'LUZ', name: 'Luzern', alt: 454, lat: 47.036439, lon: 8.301022 });
  assert.ok(Math.abs(distanceKm(47.05, 8.31, 47.036439, 8.301022) - 1.65) < 0.1);
  assert.equal(nearestStation(list, 47.05, 8.31, 440).id, 'LUZ');
  // Kriens liegt näher am Pilatus-Gipfel als gedacht, aber 1600 m tiefer: Gipfelstation zählt nicht
  assert.equal(nearestStation(list, 46.985, 8.26, 500).id, 'LUZ');
  assert.equal(nearestStation(list, 46.985, 8.26, 2000).id, 'PIL');
  assert.equal(nearestStation(list, 46.985, 8.26).id, 'PIL', 'ohne bekannte Höhe zählt nur die Entfernung');
  assert.equal(nearestStation(list, 47.5, 9.4, 400), null, 'keine Station in 12 km');
  assert.throws(() => parseSmnStations('a;b\r\n1;2'), /Format/);
});

test('MeteoSchweiz: Zehnminutenwerte zu Stundenwerten', () => {
  const rows = ['station_abbr;reference_timestamp;tre200s0;rre150z0;fu3010z0'];
  const add = (hh, mm, t, p) => rows.push(`LUZ;11.11.2026 ${hh}:${mm};${t};${p};5.0`);
  add('12', '00', '8.0', '0.0'); // Stunde 12: Vorwerte fehlen -> Niederschlag unbekannt
  for (const [mm, p] of [['10', '0.1'], ['20', '0.0'], ['30', '0.4'], ['40', '0.0'], ['50', '0.2']]) add('12', mm, '8.5', p);
  add('13', '00', '9.1', '0.3');
  for (const mm of ['10', '20', '30', '40', '50']) add('13', mm, '9.5', mm === '30' ? '' : '0.0'); // ein Wert fehlt
  add('14', '00', '', '0.0'); // Temperatur fehlt -> Stunde entfällt
  rows.push('LUZ;kaputt;1;1;1');
  const hours = parseSmnTenMin(rows.join('\r\n') + '\r\n');
  assert.deepEqual([...hours.keys()], [Date.UTC(2026, 10, 11, 12), Date.UTC(2026, 10, 11, 13)]);
  assert.deepEqual(hours.get(Date.UTC(2026, 10, 11, 12)), { t: 8, p: null });
  assert.deepEqual(hours.get(Date.UTC(2026, 10, 11, 13)), { t: 9.1, p: 1 });
  assert.throws(() => parseSmnTenMin('a;b\r\n1;2'), /Format/);
});

test('Auswertung zählt Messung und Modellanalyse getrennt und merkt sich den Ort', () => {
  const NOW = 1000 * H;
  const store = emptyStore();
  const src = { id: 'a', ok: true, hours: new Map([[NOW + H, { t: 5, p: 0 }], [NOW + 2 * H, { t: 6, p: 0 }], [NOW + 3 * H, { t: 7, p: 0 }]]) };
  recordForecasts(store, 'k', [src], NOW, { lat: 47, lon: 8, elevation: 440 });
  assert.deepEqual(store.places.k, { lat: 47, lon: 8, elevation: 440 });
  const truth = new Map([[NOW + H, { t: 5, p: 0, src: 'obs' }], [NOW + 2 * H, { t: 5, p: 0, src: 'analysis' }], [NOW + 3 * H, { t: 5, p: 0, src: 'obs' }]]);
  assert.equal(evaluate(store, 'k', truth, NOW + 10 * H), 3);
  assert.deepEqual(store.counts, { obs: 2, analysis: 1 });
  prune(store, NOW + 10 * H);
  assert.deepEqual(store.places, {}, 'ausgewerteter Ort wird vergessen');
  // ältere Speicherstände ohne die neuen Felder funktionieren weiter
  const old = { version: 1, pending: { k: { [NOW + H]: { a: [5, 0] } } }, stats: {}, truth: null };
  assert.equal(evaluate(old, 'k', truth, NOW + 10 * H), 1);
  assert.deepEqual(old.counts, { obs: 1, analysis: 0 });
});
