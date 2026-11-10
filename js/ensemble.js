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

const mean = (values) => values.reduce((a, b) => a + b, 0) / values.length;
const clamp01 = (x) => Math.max(0, Math.min(1, x));

export function combineHour(entries) {
  const pick = (key) => entries.map((e) => e[key]).filter((v) => v !== null && v !== undefined);
  const t = pick('t');
  if (!t.length) return null;
  const p = pick('p');
  const pp = pick('pp');
  const cc = pick('cc');

  const temp = median(t);
  const tMin = Math.min(...t);
  const tMax = Math.max(...t);
  const precip = p.length ? median(p) : 0;
  const wetShare = p.length ? p.filter((v) => v >= WET_MM).length / p.length : 0;
  // Risiko = Anteil der Quellen mit Niederschlag, gemittelt mit deren eigenen
  // Wahrscheinlichkeitsangaben (falls vorhanden).
  const prob = pp.length ? (wetShare + mean(pp) / 100) / 2 : wetShare;
  const cloud = cc.length ? median(cc) : null;

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
    const entries = ok.map((r) => r.hours.get(ms)).filter(Boolean);
    const combined = combineHour(entries);
    if (combined) hours.push({ ms, ...combined });
  }
  const utcOffset = ok.map((r) => r.utcOffset).find((v) => v !== null && v !== undefined) ?? null;
  return { hours, utcOffset, sourceCount: ok.length };
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
