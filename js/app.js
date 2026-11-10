import { fetchAll, searchPlaces } from './sources.js';
import { buildForecast } from './ensemble.js';
import { Scene } from './scene.js';

const $ = (id) => document.getElementById(id);
const H = 3600e3;
const STORE_KEY = 'wetter.letzterStand';
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
    const weight = s.weight ? ` · Gewicht ${s.weight}` : '';
    const item = el('li', `${s.ok ? '✓' : '✗'} ${s.label}${s.ok ? weight : ` – ${s.error}`}`);
    item.className = s.ok ? 'ok' : 'fail';
    list.append(item);
  }

  scene.setData(forecast, place);
}

async function load(place) {
  setStatus(`Lade Vorhersage für ${place.name} …`);
  $('results').replaceChildren();
  try {
    const sources = await fetchAll(place.lat, place.lon);
    const start = Math.floor(Date.now() / H) * H;
    const forecast = buildForecast(sources, start, 24);
    if (!forecast.hours.length) throw new Error('Keine Quelle hat Daten geliefert.');
    const summary = sources.map(({ id, label, weight, ok, error }) => ({ id, label, weight, ok, error }));
    const loadedAt = Date.now();
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
