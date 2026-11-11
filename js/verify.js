// Auswertung der Trefferquote: speichert die Vorhersage jeder Quelle, vergleicht sie
// später mit dem tatsächlich eingetretenen Wetter und leitet daraus Gewichte ab.
// Alles bleibt lokal auf dem Gerät (localStorage).

const H = 3600e3;
const WET_MM = 0.1;
const KEEP_MS = 72 * H; // so lange wartet eine Vorhersage auf Vergleichsdaten
export const MIN_HOURS = 24; // ab so vielen Stunden fliesst die eigene Auswertung ein
export const FULL_HOURS = 168; // ab hier zählt nur noch die eigene Auswertung

export const emptyStore = () => ({ version: 1, pending: {}, stats: {}, truth: null, places: {}, counts: { obs: 0, analysis: 0 } });
export const placeKey = (lat, lon) => `${lat.toFixed(2)},${lon.toFixed(2)}`;

// Schlüssel für einen Ort. Liegt schon ein gemerkter Ort in der Nähe (rund 3 km), wird
// dessen Schlüssel verwendet: der GPS-Standort schwankt leicht und soll trotzdem
// denselben Ort treffen.
export function resolveKey(store, lat, lon) {
  for (const key of Object.keys(store.pending)) {
    const [la, lo] = key.split(',').map(Number);
    if (Math.abs(la - lat) <= 0.03 && Math.abs(lo - lon) <= 0.04) return key;
  }
  return placeKey(lat, lon);
}

// Wie viele gemerkte Stunden noch auf den Vergleich warten
export function pendingCount(store) {
  return Object.values(store.pending).reduce((sum, place) => sum + Object.keys(place).length, 0);
}

// Vorhersagen für die kommenden 24 Stunden merken. Eine bereits gemerkte Vorhersage
// wird nicht überschrieben: bewertet wird die früheste, nicht die kurz vor Eintritt.
export function recordForecasts(store, key, results, nowMs, info = null) {
  const place = (store.pending[key] ??= {});
  // Koordinaten und Höhe merken, damit der Ort auch später noch ausgewertet werden kann
  if (info) (store.places ??= {})[key] = info;
  for (const r of results) {
    if (!r.ok) continue;
    for (const [ms, v] of r.hours) {
      if (ms <= nowMs || ms > nowMs + 24 * H) continue;
      const slot = (place[ms] ??= {});
      if (!(r.id in slot)) slot[r.id] = [v.t, v.p];
    }
  }
}

// Gemerkte Vorhersagen mit dem eingetretenen Wetter vergleichen.
// truth: Map ms -> { t, p }. Gibt die Anzahl ausgewerteter Stunden zurück.
export function evaluate(store, key, truth, nowMs) {
  const place = store.pending[key];
  if (!place) return 0;
  let done = 0;
  for (const msText of Object.keys(place)) {
    const ms = Number(msText);
    const actual = truth.get(ms);
    if (ms > nowMs - H || !actual || actual.t === null || actual.t === undefined) continue;
    for (const [id, [t, p]] of Object.entries(place[msText])) {
      const s = (store.stats[id] ??= { n: 0, absT: 0, sumT: 0, nP: 0, missP: 0 });
      s.n += 1;
      s.absT += Math.abs(t - actual.t);
      s.sumT += t - actual.t;
      if (p !== null && p !== undefined && actual.p !== null && actual.p !== undefined) {
        s.nP += 1;
        if (p >= WET_MM !== actual.p >= WET_MM) s.missP += 1;
      }
    }
    delete place[msText];
    done += 1;
    // mitzählen, ob gegen eine Messung oder gegen die Modellanalyse verglichen wurde
    const counts = (store.counts ??= { obs: 0, analysis: 0 });
    counts[actual.src === 'obs' ? 'obs' : 'analysis'] += 1;
  }
  return done;
}

// Vorhersagen verwerfen, für die keine Vergleichsdaten mehr zu erwarten sind
export function prune(store, nowMs) {
  for (const [key, place] of Object.entries(store.pending)) {
    for (const msText of Object.keys(place)) if (Number(msText) < nowMs - KEEP_MS) delete place[msText];
    if (!Object.keys(place).length) {
      delete store.pending[key];
      if (store.places) delete store.places[key];
    }
  }
}

const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));

// Mischt Ausgangsgewicht und gemessene Güte. Mit wenig Daten zählt das Ausgangsgewicht,
// mit einer Woche Daten nur noch die Messung.
function blend(sources, count, quality) {
  const rated = sources.filter((s) => count(s.id) >= MIN_HOURS);
  const out = Object.fromEntries(sources.map((s) => [s.id, s.weight ?? 1]));
  if (rated.length < 2) return out;
  const raw = rated.map((s) => quality(s.id));
  const scale = rated.reduce((a, s) => a + (s.weight ?? 1), 0) / raw.reduce((a, b) => a + b, 0);
  rated.forEach((s, i) => {
    const learned = clamp(raw[i] * scale, 0.3, 2.5);
    const alpha = Math.min(1, count(s.id) / FULL_HOURS);
    out[s.id] = (s.weight ?? 1) * (1 - alpha) + learned * alpha;
  });
  return out;
}

// Gewichte je Quelle: w für Temperatur/Bewölkung, wp für Niederschlag
export function learnedWeights(store, sources) {
  const st = (id) => store.stats[id] ?? { n: 0, absT: 0, sumT: 0, nP: 0, missP: 0 };
  // Temperatur: Kehrwert des quadrierten mittleren Fehlers (üblich beim Kombinieren von Schätzern)
  const w = blend(sources, (id) => st(id).n, (id) => 1 / Math.max(st(id).absT / st(id).n, 0.3) ** 2);
  // Niederschlag: Kehrwert der Fehlerquote bei nass/trocken
  const wp = blend(sources, (id) => st(id).nP, (id) => 1 / (st(id).missP / st(id).nP + 0.05));
  return Object.fromEntries(sources.map((s) => [s.id, { w: w[s.id], wp: wp[s.id] }]));
}

// Zeilen für die Anzeige
export function report(store, sources) {
  const weights = learnedWeights(store, sources);
  return sources.map((s) => {
    const x = store.stats[s.id];
    return {
      id: s.id,
      label: s.label,
      hours: x?.n ?? 0,
      mae: x?.n ? x.absT / x.n : null,
      bias: x?.n ? x.sumT / x.n : null,
      hit: x?.nP ? 1 - x.missP / x.nP : null,
      w: weights[s.id].w,
      wp: weights[s.id].wp,
      learned: (x?.n ?? 0) >= MIN_HOURS,
    };
  });
}
