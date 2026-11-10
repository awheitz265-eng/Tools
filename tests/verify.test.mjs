import test from 'node:test';
import assert from 'node:assert/strict';
import { emptyStore, placeKey, recordForecasts, evaluate, prune, learnedWeights, report } from '../js/verify.js';

const H = 3600e3;
const NOW = 1000 * H;
const src = (id, t, p, from = 1, to = 30) => ({
  id, ok: true,
  hours: new Map(Array.from({ length: to - from + 1 }, (_, i) => [NOW + (from + i) * H, { t, p }])),
});
const SOURCES = [{ id: 'a', label: 'A', weight: 1 }, { id: 'b', label: 'B', weight: 1 }, { id: 'c', label: 'C', weight: 1.5 }];

test('merkt nur die kommenden 24 Stunden und überschreibt nicht', () => {
  const store = emptyStore();
  recordForecasts(store, 'k', [src('a', 10, 0, -2, 30), { id: 'x', ok: false }], NOW);
  assert.equal(Object.keys(store.pending.k).length, 24);
  recordForecasts(store, 'k', [src('a', 99, 5)], NOW);
  assert.deepEqual(store.pending.k[NOW + H].a, [10, 0]);
  recordForecasts(store, 'k', [src('b', 7, 1)], NOW + 2 * H);
  assert.equal(store.pending.k[NOW + H].b, undefined, 'vergangene Stunde wird nicht nachgetragen');
  assert.deepEqual(store.pending.k[NOW + 3 * H].b, [7, 1]);
});

test('wertet vergangene Stunden aus und lässt künftige stehen', () => {
  const store = emptyStore();
  recordForecasts(store, 'k', [src('a', 12, 0), src('b', 9, 1)], NOW);
  const truth = new Map(Array.from({ length: 30 }, (_, i) => [NOW + (i + 1) * H, { t: 10, p: 0.5 }]));
  const done = evaluate(store, 'k', truth, NOW + 11 * H);
  assert.equal(done, 10);
  assert.deepEqual(store.stats.a, { n: 10, absT: 20, sumT: 20, nP: 10, missP: 10 });
  assert.deepEqual(store.stats.b, { n: 10, absT: 10, sumT: -10, nP: 10, missP: 0 });
  assert.equal(Object.keys(store.pending.k).length, 14);
  assert.equal(evaluate(store, 'k', truth, NOW + 11 * H), 0, 'keine Doppelzählung');
});

test('fehlende Vergleichswerte werden übersprungen, alte Einträge verworfen', () => {
  const store = emptyStore();
  recordForecasts(store, 'k', [src('a', 12, null)], NOW);
  const truth = new Map([[NOW + H, { t: 11, p: null }], [NOW + 2 * H, { t: null, p: 0 }]]);
  assert.equal(evaluate(store, 'k', truth, NOW + 10 * H), 1);
  assert.equal(store.stats.a.nP, 0);
  prune(store, NOW + 24 * H + 73 * H);
  assert.deepEqual(store.pending, {});
});

test('Gewichte: zu wenig Daten = Ausgangswerte, danach besser = höher', () => {
  const store = emptyStore();
  assert.deepEqual(learnedWeights(store, SOURCES).c, { w: 1.5, wp: 1.5 });
  store.stats = {
    a: { n: 200, absT: 200 * 0.8, sumT: 0, nP: 200, missP: 10 },
    b: { n: 200, absT: 200 * 2.4, sumT: 0, nP: 200, missP: 80 },
    c: { n: 10, absT: 50, sumT: 0, nP: 10, missP: 9 },
  };
  const w = learnedWeights(store, SOURCES);
  assert.ok(w.a.w > 1.5 && w.b.w < 0.5, JSON.stringify(w));
  assert.ok(Math.abs(w.a.w + w.b.w - 2) < 0.31, 'Summe bleibt etwa erhalten (bis auf Begrenzung)');
  assert.ok(w.a.wp > w.b.wp);
  assert.deepEqual(w.c, { w: 1.5, wp: 1.5 }, 'Quelle mit wenig Daten behält Ausgangsgewicht');
});

test('Gewichte gleiten mit der Datenmenge vom Ausgangswert zur Messung', () => {
  const mk = (n) => ({ ...emptyStore(), stats: {
    a: { n, absT: n * 1, sumT: 0, nP: 0, missP: 0 },
    b: { n, absT: n * 2, sumT: 0, nP: 0, missP: 0 } } });
  const few = learnedWeights(mk(24), SOURCES).a.w;
  const many = learnedWeights(mk(168), SOURCES).a.w;
  assert.ok(few > 1 && few < many, `${few} ${many}`);
  assert.ok(Math.abs(many - 1.6) < 1e-9);
});

test('report und placeKey', () => {
  const store = emptyStore();
  store.stats.a = { n: 4, absT: 6, sumT: -2, nP: 4, missP: 1 };
  const row = report(store, SOURCES)[0];
  assert.deepEqual([row.hours, row.mae, row.bias, row.hit, row.learned], [4, 1.5, -0.5, 0.75, false]);
  assert.equal(report(store, SOURCES)[1].mae, null);
  assert.equal(placeKey(47.0512, 8.3049), '47.05,8.30');
});
