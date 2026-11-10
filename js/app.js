import { SOURCES, fetchAll, fetchTruth, searchPlaces } from './sources.js';
import { emptyStore, resolveKey, pendingCount, recordForecasts, evaluate, prune, learnedWeights, report, MIN_HOURS, FULL_HOURS } from './verify.js';
import { buildForecast } from './ensemble.js';
import { Scene } from './scene.js';

const $ = (id) => document.getElementById(id);
const H = 3600e3;
const STORE_KEY = 'wetter.letzterStand';
const VERIFY_KEY = 'wetter.auswertung';
const KIND = {
  clear: ['☀️', 'Klar'],
  partly: ['⛅', 'Teils bewölkt'],
  cloudy: ['☁️', 'Bewölkt'],
  rain: ['🌧️', 'Regen'],
  snow: ['🌨️', 'Schnee'],
};

const scene = new Scene($('scene'), (progress, playing) => {
  $('scrub').value = Math.round(progress * 1000);
  $('play').textContent = playing ? 'Pause' : progress >= 1 ? 'Nochmals' : 'Abspielen';
});

function setStatus(text, isError = false) {
  const el = $('status');
  el.textContent = text;
  el.classList.toggle('error', isError);
  el.hidden = !text;
}

function el(tag, text, className) {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (className) node.className = className;
  return node;
}

function hourLabel(ms, utcOffset) {
  const off = utcOffset ?? -new Date(ms).getTimezoneOffset() * 60;
  return `${String(new Date(ms + off * 1000).getUTCHours()).padStart(2, '0')}:00`;
}

function render(place, forecast, sources, loadedAt, stale) {
  $('result').hidden = false;
  $('place').textContent = place.detail ? `${place.name} · ${place.detail}` : place.name;
  const when = new Date(loadedAt).toLocaleString('de-CH', { dateStyle: 'short', timeStyle: 'short' });
  $('meta').textContent =
    `${forecast.sourceCount} von ${sources.length} Quellen · Stand ${when}` + (stale ? ' · offline, gespeicherte Daten' : '');

  const body = $('hours');
  body.replaceChildren();
  for (const h of forecast.hours) {
    const [icon, text] = KIND[h.kind];
    const row = el('tr');
    row.append(
      el('td', hourLabel(h.ms, forecast.utcOffset)),
      el('td', `${icon} ${text}`),
      el('td', `${Math.round(h.temp)}°`, 'num strong'),
      el('td', `${Math.round(h.tMin)}…${Math.round(h.tMax)}°`, 'num dim'),
      el('td', `${h.precip.toFixed(1)} mm`, 'num'),
      el('td', `${Math.round(h.prob * 100)} %`, 'num'),
      el('td', h.confLabel, `conf conf-${h.confLabel}`),
    );
    body.append(row);
  }

  const list = $('sources');
  list.replaceChildren();
  for (const s of sources) {
    const item = el('li', `${s.ok ? '✓' : '✗'} ${s.label}${s.ok ? '' : ` – ${s.error}`}`);
    item.className = s.ok ? 'ok' : 'fail';
    list.append(item);
  }

  renderVerify();
  scene.setData(forecast, place);
}

function readVerify() {
  try {
    const store = JSON.parse(localStorage.getItem(VERIFY_KEY));
    return store?.version === 1 ? store : emptyStore();
  } catch {
    return emptyStore();
  }
}

function renderVerify() {
  const store = readVerify();
  const rows = report(store, SOURCES);
  const total = Math.max(...rows.map((r) => r.hours));
  const body = $('verify');
  body.replaceChildren();
  const fmt = (v, digits, unit = '') => (v === null ? '–' : `${v.toFixed(digits)}${unit}`);
  for (const r of rows) {
    const row = el('tr');
    row.append(
      el('td', r.label.replace(/ \(via .*\)$/, '')),
      el('td', String(r.hours), 'num'),
      el('td', fmt(r.mae, 1, '°'), 'num strong'),
      el('td', r.bias === null ? '–' : `${r.bias > 0 ? '+' : ''}${r.bias.toFixed(1)}°`, 'num dim'),
      el('td', r.hit === null ? '–' : `${Math.round(r.hit * 100)} %`, 'num'),
      el('td', r.w.toFixed(2), 'num'),
      el('td', r.wp.toFixed(2), 'num'),
    );
    body.append(row);
  }
  const basis = store.truth ? ` Vergleichsdaten zuletzt: ${store.truth.label}.` : '';
  const waiting = pendingCount(store);
  const last = store.last;
  $('verify-status').textContent =
    `Gemerkt und noch nicht verglichen: ${waiting} Stunden. ` +
    (!last
      ? 'Vergleichsdaten wurden noch nie abgerufen.'
      : last.error
        ? `Letzter Abruf der Vergleichsdaten fehlgeschlagen: ${last.error}.`
        : `Letzter Abruf der Vergleichsdaten: ${last.label}, ${last.hours} Stunden erhalten, ${last.evaluated} davon ausgewertet.`);
  $('verify-info').textContent =
    total === 0
      ? 'Noch keine Auswertung. Die App merkt sich jede Vorhersage und vergleicht sie beim nächsten Öffnen mit dem eingetretenen Wetter. Dafür die App mindestens alle zwei bis drei Tage öffnen.'
      : total < MIN_HOURS
        ? `${total} Stunden ausgewertet. Ab ${MIN_HOURS} Stunden fliesst die Auswertung in die Gewichte ein.${basis}`
        : `${total} Stunden ausgewertet. Die Gewichte stammen zu ${Math.round(Math.min(1, total / FULL_HOURS) * 100)} % aus der eigenen Auswertung.${basis}`;
}

async function load(place) {
  setStatus(`Lade Vorhersage für ${place.name} …`);
  $('results').replaceChildren();
  try {
    const [sources, truth] = await Promise.all([
      fetchAll(place.lat, place.lon),
      fetchTruth(place.lat, place.lon).catch((e) => ({ error: e.message })),
    ]);
    const loadedAt = Date.now();

    // Auswertung: alte Vorhersagen prüfen, neue merken, Gewichte daraus ableiten
    const store = readVerify();
    const key = resolveKey(store, place.lat, place.lon);
    const evaluated = truth.error ? 0 : evaluate(store, key, truth.hours, loadedAt);
    if (evaluated > 0) store.truth = { kind: truth.kind, label: truth.label };
    // Stand des letzten Abrufs, damit sichtbar ist, ob die Auswertung funktioniert
    store.last = truth.error
      ? { at: loadedAt, error: truth.error }
      : { at: loadedAt, label: truth.label, hours: truth.hours.size, evaluated };
    recordForecasts(store, key, sources, loadedAt);
    prune(store, loadedAt);
    try {
      localStorage.setItem(VERIFY_KEY, JSON.stringify(store));
    } catch {
      // Speicher voll oder gesperrt: Vorhersage trotzdem anzeigen
    }
    const weights = learnedWeights(store, SOURCES);
    for (const s of sources) {
      s.weight = weights[s.id].w;
      s.weightP = weights[s.id].wp;
    }

    const start = Math.floor(loadedAt / H) * H;
    const forecast = buildForecast(sources, start, 24);
    if (!forecast.hours.length) throw new Error('Keine Quelle hat Daten geliefert.');
    const summary = sources.map(({ id, label, ok, error }) => ({ id, label, ok, error }));
    localStorage.setItem(STORE_KEY, JSON.stringify({ place, forecast, sources: summary, loadedAt }));
    setStatus('');
    render(place, forecast, summary, loadedAt, false);
  } catch (e) {
    const saved = readSaved();
    if (saved && saved.place.name === place.name) {
      setStatus(`Aktualisieren nicht möglich (${e.message}).`, true);
      render(saved.place, saved.forecast, saved.sources, saved.loadedAt, true);
    } else {
      setStatus(`Vorhersage konnte nicht geladen werden: ${e.message}`, true);
    }
  }
}

function readSaved() {
  try {
    return JSON.parse(localStorage.getItem(STORE_KEY));
  } catch {
    return null;
  }
}

$('search').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const query = $('query').value.trim();
  if (query.length < 2) return;
  setStatus('Suche Ort …');
  try {
    const places = await searchPlaces(query);
    const box = $('results');
    box.replaceChildren();
    if (!places.length) return setStatus(`Kein Ort gefunden für «${query}».`, true);
    setStatus('');
    if (places.length === 1) return load(places[0]);
    for (const p of places) {
      const btn = el('button', `${p.name}${p.detail ? ` · ${p.detail}` : ''}`);
      btn.type = 'button';
      btn.addEventListener('click', () => load(p));
      box.append(btn);
    }
  } catch (e) {
    setStatus(`Ortssuche fehlgeschlagen: ${e.message}`, true);
  }
});

$('locate').addEventListener('click', () => {
  if (!navigator.geolocation) return setStatus('Dieses Gerät gibt keinen Standort frei.', true);
  setStatus('Bestimme Standort …');
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      const { latitude: lat, longitude: lon } = pos.coords;
      load({ name: 'Mein Standort', detail: `${lat.toFixed(2)}°, ${lon.toFixed(2)}°`, lat, lon });
    },
    (err) =>
      setStatus(
        err.code === 1
          ? 'Standortzugriff wurde abgelehnt. Bitte in den Einstellungen erlauben oder einen Ort eingeben.'
          : 'Standort konnte nicht bestimmt werden. Bitte einen Ort eingeben.',
        true,
      ),
    { timeout: 15000, maximumAge: 600000 },
  );
});

$('verify-reset').addEventListener('click', () => {
  if (!confirm('Auswertung wirklich löschen? Die Gewichte fallen auf die Ausgangswerte zurück.')) return;
  localStorage.removeItem(VERIFY_KEY);
  renderVerify();
});

$('play').addEventListener('click', () => scene.toggle());
$('scene').addEventListener('click', () => scene.toggle());
$('scrub').addEventListener('input', (ev) => {
  const target = ev.target.value / 1000; // vor pause() lesen: pause() setzt den Regler zurück
  scene.pause();
  scene.seek(target);
});

// Beim Start: zuletzt gewählten Ort neu laden
const saved = readSaved();
if (saved?.place) load(saved.place);

if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').catch(() => {});
