// Kombiniert die Quellen zu einer Konsens-Vorhersage.
// Bewusst einfach und nachvollziehbar gehalten; die Konfidenz ist eine
// Faustregel aus der Streuung der Quellen, keine kalibrierte Wahrscheinlichkeit.

const H = 3600e3;
const WET_MM = 0.1; // ab dieser Menge gilt eine Stunde als «nass»

export function median(values) {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

// Gewichteter Median: der Wert, bei dem die Hälfte des Gesamtgewichts erreicht ist.
// pairs = [[Wert, Gewicht], ...]
export function weightedMedian(pairs) {
  if (!pairs.length) return null;
  const s = [...pairs].sort((a, b) => a[0] - b[0]);
  const half = s.reduce((sum, [, w]) => sum + w, 0) / 2;
  let acc = 0;
  for (let i = 0; i < s.length; i++) {
    acc += s[i][1];
    if (Math.abs(acc - half) < 1e-9 && i + 1 < s.length) return (s[i][0] + s[i + 1][0]) / 2;
    if (acc > half) return s[i][0];
  }
  return s[s.length - 1][0];
}

const wsum = (pairs) => pairs.reduce((sum, [, w]) => sum + w, 0);
const clamp01 = (x) => Math.max(0, Math.min(1, x));

export function combineHour(entries) {
  // [Wert, Gewicht] je Quelle; ohne Angabe zählt jede Quelle gleich (Gewicht 1)
  // Niederschlag hat ein eigenes Gewicht (wp), falls vorhanden
  const pick = (key, weight = (e) => e.w ?? 1) =>
    entries.filter((e) => e[key] !== null && e[key] !== undefined).map((e) => [e[key], weight(e)]);
  const rainWeight = (e) => e.wp ?? e.w ?? 1;
  const tw = pick('t');
  if (!tw.length) return null;
  const t = tw.map(([v]) => v);
  const p = pick('p', rainWeight);
  const pp = pick('pp', rainWeight);
  const cc = pick('cc');

  const temp = weightedMedian(tw);
  const tMin = Math.min(...t);
  const tMax = Math.max(...t);
  const precip = p.length ? weightedMedian(p) : 0;
  const wetShare = p.length ? wsum(p.filter(([v]) => v >= WET_MM)) / wsum(p) : 0;
  // Risiko = gewichteter Anteil der Quellen mit Niederschlag, gemittelt mit deren
  // eigenen Wahrscheinlichkeitsangaben (falls vorhanden).
  const ppMean = pp.length ? pp.reduce((sum, [v, w]) => sum + v * w, 0) / wsum(pp) : null;
  const prob = ppMean !== null ? (wetShare + ppMean / 100) / 2 : wetShare;
  const cloud = cc.length ? weightedMedian(cc) : null;

  let kind;
  if (precip >= WET_MM && wetShare >= 0.5) kind = temp <= 0.5 ? 'snow' : 'rain';
  else if (cloud === null) kind = 'partly';
  else if (cloud >= 70) kind = 'cloudy';
  else if (cloud >= 30) kind = 'partly';
  else kind = 'clear';

  const agreement = Math.abs(wetShare - 0.5) * 2; // 1 = alle einig, 0 = halb/halb
  let conf = 0.5 * clamp01(1 - (tMax - tMin) / 6) + 0.5 * agreement;
  if (t.length < 3) conf = Math.min(conf, 0.35); // zu wenige Quellen für ein Urteil
  const confLabel = conf >= 0.7 ? 'hoch' : conf >= 0.4 ? 'mittel' : 'tief';

  return { n: t.length, temp, tMin, tMax, precip, prob, cloud, kind, conf, confLabel };
}

export function buildForecast(results, startMs, count = 24) {
  const ok = results.filter((r) => r.ok);
  const hours = [];
  for (let i = 0; i < count; i++) {
    const ms = startMs + i * H;
    const entries = ok
      .filter((r) => r.hours.has(ms))
      .map((r) => ({ ...r.hours.get(ms), w: r.weight ?? 1, wp: r.weightP ?? r.weight ?? 1 }));
    const combined = combineHour(entries);
    if (combined) hours.push({ ms, ...combined });
  }
  const utcOffset = ok.map((r) => r.utcOffset).find((v) => v !== null && v !== undefined) ?? null;
  return { hours, utcOffset, sourceCount: ok.length };
}

// Was die Animation für eine Stunde zeigen soll. Das Bild folgt der Wetterlage (kind),
// damit Text und Bild immer zusammenpassen: Regen und Schnee nur unter dichter
// Wolkendecke, «Bewölkt» ohne Sonne, «Klar» ohne nennenswerte Wolken.
//   cover = sichtbare Bewölkung 0..1, rain/snow = sichtbare Stärke in mm pro Stunde
export function visualState(hour) {
  const c = Math.max(0, Math.min(1, (hour.cloud ?? 50) / 100));
  const strength = Math.max(hour.precip ?? 0, 0.3); // auch leichter Niederschlag bleibt sichtbar
  switch (hour.kind) {
    case 'rain':
      return { cover: Math.max(c, 0.96), rain: strength, snow: 0 };
    case 'snow':
      return { cover: Math.max(c, 0.96), rain: 0, snow: strength };
    case 'cloudy':
      return { cover: Math.max(0.84, c), rain: 0, snow: 0 };
    case 'partly':
      return { cover: Math.max(0.3, Math.min(0.6, c)), rain: 0, snow: 0 };
    default:
      return { cover: Math.min(c, 0.1), rain: 0, snow: 0 };
  }
}

// Sonnenhöhe in Grad (Näherung, für Tag/Nacht in der Animation).
export function sunElevation(ms, lat, lon) {
  const rad = Math.PI / 180;
  const d = ms / 86400e3 - 10957.5; // Tage seit 1.1.2000 12:00 UTC
  const g = (357.529 + 0.98560028 * d) * rad;
  const L = (280.459 + 0.98564736 * d + 1.915 * Math.sin(g) + 0.02 * Math.sin(2 * g)) * rad;
  const e = (23.439 - 0.00000036 * d) * rad;
  const ra = Math.atan2(Math.cos(e) * Math.sin(L), Math.cos(L));
  const dec = Math.asin(Math.sin(e) * Math.sin(L));
  const gmst = 18.697374558 + 24.06570982441908 * d;
  const ha = (gmst * 15 + lon) * rad - ra;
  const la = lat * rad;
  return Math.asin(Math.sin(la) * Math.sin(dec) + Math.cos(la) * Math.cos(dec) * Math.cos(ha)) / rad;
}
