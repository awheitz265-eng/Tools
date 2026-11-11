// Datenquellen. Jede Quelle liefert stündliche Werte als Map: UTC-Millisekunden -> { t, p, pp, cc }
//   t  = Temperatur (°C), p = Niederschlag der Stunde (mm),
//   pp = Niederschlagswahrscheinlichkeit (%), cc = Bewölkung (%),
//   ws = Wind (km/h), wg = Böen (km/h), th = Gewitter (ja/nein), fg = Nebel (ja/nein)
// Was eine Quelle nicht liefert, ist null.
// Fällt eine Quelle aus, läuft die App mit den übrigen weiter.

const H = 3600e3;

async function getJson(url, timeoutMs = 12000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } catch (e) {
    if (e.name === 'AbortError') throw new Error('Zeitüberschreitung');
    // TypeError = Verbindung gescheitert oder vom Browser blockiert (z.B. CORS)
    throw new Error(e instanceof TypeError ? 'nicht erreichbar' : e.message);
  } finally {
    clearTimeout(timer);
  }
}

const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

// regional = Modell deckt nur einen Teil Europas ab. Ausserhalb liefert Open-Meteo
// einen Fehler 400 oder leere Werte; das ist dann kein Ausfall, sondern «nicht abgedeckt».
function openMeteo(model, regional = false) {
  return async (lat, lon) => {
    try {
      return await openMeteoLoad(model, lat, lon);
    } catch (e) {
      if (regional && e.message === 'HTTP 400') return { hours: new Map(), outside: true };
      throw e;
    }
  };
}

async function openMeteoLoad(model, lat, lon) {
  const url =
    'https://api.open-meteo.com/v1/forecast' +
    `?latitude=${lat}&longitude=${lon}` +
    '&hourly=temperature_2m,precipitation,precipitation_probability,cloud_cover,wind_speed_10m,wind_gusts_10m,weather_code' +
    `&models=${model}&timeformat=unixtime&timezone=auto&forecast_days=4`;
  const data = await getJson(url);
  const hourly = data.hourly || {};
  const col = (name) => hourly[name] ?? hourly[`${name}_${model}`] ?? [];
  const time = hourly.time || [];
  const t = col('temperature_2m');
  const p = col('precipitation');
  const pp = col('precipitation_probability');
  const cc = col('cloud_cover');
  const ws = col('wind_speed_10m');
  const wg = col('wind_gusts_10m');
  const code = col('weather_code'); // WMO-Code: 45/48 Nebel, 95–99 Gewitter
  const hours = new Map();
  time.forEach((sec, i) => {
    if (num(t[i]) === null) return;
    const c = num(code[i]);
    hours.set(sec * 1000, {
      t: t[i], p: num(p[i]), pp: num(pp[i]), cc: num(cc[i]), ws: num(ws[i]), wg: num(wg[i]),
      th: c === null ? null : c >= 95 && c <= 99,
      fg: c === null ? null : c === 45 || c === 48,
    });
  });
  return { hours, utcOffset: num(data.utc_offset_seconds), elevation: num(data.elevation) };
}

async function metNorway(lat, lon) {
  const url =
    'https://api.met.no/weatherapi/locationforecast/2.0/complete' +
    `?lat=${lat.toFixed(4)}&lon=${lon.toFixed(4)}`;
  const data = await getJson(url);
  const series = data?.properties?.timeseries || [];
  const hours = new Map();
  for (const row of series) {
    const ms = Date.parse(row.time);
    const d = row.data?.instant?.details || {};
    if (num(d.air_temperature) === null) continue;
    const wind = num(d.wind_speed); // m/s
    const gust = num(d.wind_speed_of_gust); // m/s, nicht überall vorhanden
    hours.set(ms, {
      t: d.air_temperature, p: null, pp: null, cc: num(d.cloud_area_fraction),
      ws: wind === null ? null : wind * 3.6, wg: gust === null ? null : gust * 3.6, th: null, fg: null,
    });
  }
  // MET Norway gibt Niederschlag und Wettersymbol für die FOLGENDE Stunde an, die
  // anderen Quellen für die VERGANGENE. Darum um eine Stunde verschieben.
  for (const row of series) {
    const next = row.data?.next_1_hours;
    const target = hours.get(Date.parse(row.time) + H);
    if (!next || !target) continue;
    const amount = num(next.details?.precipitation_amount);
    if (amount !== null) target.p = amount;
    target.pp = num(next.details?.probability_of_precipitation);
    const symbol = next.summary?.symbol_code;
    if (typeof symbol === 'string') {
      target.th = symbol.includes('thunder');
      target.fg = symbol.startsWith('fog');
    }
  }
  return { hours, utcOffset: null };
}

async function brightSky(lat, lon) {
  const start = new Date(Math.floor(Date.now() / H) * H);
  const end = new Date(start.getTime() + 50 * H);
  const url =
    'https://api.brightsky.dev/weather' +
    `?lat=${lat}&lon=${lon}&date=${start.toISOString()}&last_date=${end.toISOString()}`;
  const data = await getJson(url);
  const hours = new Map();
  for (const row of data.weather || []) {
    if (num(row.temperature) === null) continue;
    hours.set(Date.parse(row.timestamp), {
      t: row.temperature,
      p: num(row.precipitation),
      pp: num(row.precipitation_probability),
      cc: num(row.cloud_cover),
      ws: num(row.wind_speed),
      wg: num(row.wind_gust_speed),
      th: typeof row.condition === 'string' ? row.condition === 'thunderstorm' : null,
      fg: typeof row.condition === 'string' ? row.condition === 'fog' : null,
    });
  }
  return { hours, utcOffset: null };
}

// Gewichte: Begründung und Belegstand siehe PLAN.md, Abschnitt «Gewichtung».
// 1.0 = neutral (keine Belege für eine Abweichung gefunden).
// 0.8 für die zusätzlichen Regionalmodelle: Sie gehören zu Modellfamilien, die schon
// vertreten sind (ICON bzw. AROME/ALADIN/HARMONIE), sind also keine ganz unabhängigen Stimmen.
export const SOURCES = [
  { id: 'icon', label: 'DWD ICON (via Open-Meteo)', weight: 1.0, load: openMeteo('icon_seamless') },
  // ECMWF und MET Norway zusammen 2.0: MET Norway liefert ausserhalb Nordeuropas
  // ECMWF-Daten, die beiden sind also keine unabhängigen Stimmen.
  { id: 'ecmwf', label: 'ECMWF IFS (via Open-Meteo)', weight: 1.25, load: openMeteo('ecmwf_ifs025') },
  { id: 'meteofrance', label: 'Météo-France (via Open-Meteo)', weight: 1.0, load: openMeteo('meteofrance_seamless') },
  { id: 'ukmo', label: 'UK Met Office (via Open-Meteo)', weight: 1.0, load: openMeteo('ukmo_seamless') },
  { id: 'gfs', label: 'NOAA GFS (via Open-Meteo)', weight: 0.7, load: openMeteo('gfs_seamless') },
  { id: 'metno', label: 'MET Norway', weight: 0.75, load: metNorway },
  // statistisch nachbearbeitete Punktvorhersage (aus ICON und ECMWF)
  { id: 'brightsky', label: 'DWD MOSMIX (via Bright Sky)', weight: 1.5, load: brightSky },
  // Hochaufgelöste Regionalmodelle, je nur für einen Teil Europas
  { id: 'meteoswiss', label: 'MeteoSchweiz ICON-CH (via Open-Meteo)', weight: 0.8, regional: true, load: openMeteo('meteoswiss_icon_seamless', true) },
  // C-LAEF (1 km) ist der Nachfolger von AROME Austria, das am 4.11.2026 eingestellt wurde
  { id: 'geosphere', label: 'GeoSphere Austria C-LAEF (via Open-Meteo)', weight: 0.8, regional: true, load: openMeteo('geosphere_claef_austria', true) },
  { id: 'italiameteo', label: 'ItaliaMeteo ICON-2I (via Open-Meteo)', weight: 0.8, regional: true, load: openMeteo('italia_meteo_arpae_icon_2i', true) },
  { id: 'chmi', label: 'CHMI ALADIN Mitteleuropa (via Open-Meteo)', weight: 0.8, regional: true, load: openMeteo('chmi_aladin_central_europe_2km', true) },
  { id: 'knmi', label: 'KNMI HARMONIE (via Open-Meteo)', weight: 0.8, regional: true, load: openMeteo('knmi_harmonie_arome_europe', true) },
  { id: 'dmi', label: 'DMI HARMONIE (via Open-Meteo)', weight: 0.8, regional: true, load: openMeteo('dmi_harmonie_arome_europe', true) },
];

export async function fetchAll(lat, lon, sources = SOURCES) {
  const settled = await Promise.allSettled(sources.map((s) => s.load(lat, lon)));
  return settled.map((r, i) => {
    const { id, label, weight = 1, regional = false } = sources[i];
    const base = { id, label, weight, ok: false };
    if (r.status === 'rejected') return { ...base, error: r.reason.message };
    if (r.value.hours.size === 0) {
      return regional
        ? { ...base, outside: true, error: 'deckt diesen Ort nicht ab' }
        : { ...base, error: 'keine Daten für diesen Ort' };
    }
    return { ...base, ok: true, ...r.value };
  });
}

// ---------------------------------------------------------------------------------
// Tatsächlich eingetretenes Wetter, für die Auswertung der Trefferquote.
//   1. Stationsmessung MeteoSchweiz (SwissMetNet), wenn eine Station nah genug liegt
//   2. Stationsmessung DWD (via Bright Sky), wenn eine Station nah genug liegt
//   3. Modellanalyse von Open-Meteo für alle Stunden ohne Messung. Das ist KEINE
//      Messung, sondern die nachträgliche Schätzung eines Modells, und kann
//      verwandte Quellen bevorzugen.
// Jede Stunde trägt ihre Herkunft: src = 'obs' (Messung) oder 'analysis'.
// ---------------------------------------------------------------------------------

const SMN = 'https://data.geo.admin.ch/ch.meteoschweiz.ogd-smn';
const MAX_STATION_KM = 12; // weiter entfernte Stationen sagen wenig über den Ort aus
const MAX_STATION_DH = 150; // ebenso Stationen auf deutlich anderer Höhe (Meter)

async function getText(url, timeoutMs = 15000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    // Die Dateien von MeteoSchweiz sind nicht UTF-8 (Umlaute in Stationsnamen)
    return new TextDecoder('windows-1252').decode(await res.arrayBuffer());
  } catch (e) {
    if (e.name === 'AbortError') throw new Error('Zeitüberschreitung');
    throw new Error(e instanceof TypeError ? 'nicht erreichbar' : e.message);
  } finally {
    clearTimeout(timer);
  }
}

const csvRows = (text) =>
  text.split(/\r?\n/).filter((line) => line.trim()).map((line) => line.split(';'));

// Stationsliste von MeteoSchweiz (ogd-smn_meta_stations.csv)
export function parseSmnStations(text) {
  const [head, ...rows] = csvRows(text);
  const at = (name) => head.indexOf(name);
  const [iId, iName, iAlt, iLat, iLon] = [
    at('station_abbr'), at('station_name'), at('station_height_masl'),
    at('station_coordinates_wgs84_lat'), at('station_coordinates_wgs84_lon'),
  ];
  if (iId < 0 || iLat < 0 || iLon < 0) throw new Error('unerwartetes Format der Stationsliste');
  return rows
    .map((r) => ({ id: r[iId], name: r[iName] || r[iId], alt: parseFloat(r[iAlt]), lat: parseFloat(r[iLat]), lon: parseFloat(r[iLon]) }))
    .filter((s) => s.id && Number.isFinite(s.lat) && Number.isFinite(s.lon));
}

export function distanceKm(lat1, lon1, lat2, lon2) {
  const rad = Math.PI / 180;
  const a =
    Math.sin(((lat2 - lat1) * rad) / 2) ** 2 +
    Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(((lon2 - lon1) * rad) / 2) ** 2;
  return 12742 * Math.asin(Math.sqrt(a));
}

// Nächste Station, die nah genug und auf ähnlicher Höhe liegt (sonst null)
export function nearestStation(stations, lat, lon, elevation = null) {
  let best = null;
  for (const s of stations) {
    const km = distanceKm(lat, lon, s.lat, s.lon);
    if (km > MAX_STATION_KM) continue;
    if (elevation !== null && Number.isFinite(s.alt) && Math.abs(s.alt - elevation) > MAX_STATION_DH) continue;
    if (!best || km < best.km) best = { ...s, km };
  }
  return best;
}

// Zehnminutenwerte einer Station (ogd-smn_<station>_t_now.csv) zu Stundenwerten.
// Der Zeitstempel bezeichnet bei MeteoSchweiz das ENDE des Messintervalls, in UTC.
//   Temperatur: Momentanwert zur vollen Stunde (tre200s0)
//   Niederschlag: Summe der sechs Zehnminutenwerte bis zur vollen Stunde (rre150z0)
export function parseSmnTenMin(text) {
  const [head, ...rows] = csvRows(text);
  const iTime = head.indexOf('reference_timestamp');
  const iT = head.indexOf('tre200s0');
  const iP = head.indexOf('rre150z0');
  if (iTime < 0 || iT < 0) throw new Error('unerwartetes Format der Messwerte');
  const temp = new Map();
  const rain = new Map();
  for (const r of rows) {
    const m = /^(\d{2})\.(\d{2})\.(\d{4}) (\d{2}):(\d{2})/.exec(r[iTime] || '');
    if (!m) continue;
    const ms = Date.UTC(+m[3], +m[2] - 1, +m[1], +m[4], +m[5]);
    const t = parseFloat(r[iT]);
    if (Number.isFinite(t)) temp.set(ms, t);
    const p = iP < 0 ? NaN : parseFloat(r[iP]);
    if (Number.isFinite(p)) rain.set(ms, p);
  }
  const hours = new Map();
  for (const [ms, t] of temp) {
    if (ms % H) continue;
    let sum = 0;
    for (let k = 0; k < 6 && sum !== null; k++) {
      const v = rain.get(ms - k * 600e3);
      sum = v === undefined ? null : sum + v;
    }
    hours.set(ms, { t, p: sum === null ? null : Math.round(sum * 10) / 10 });
  }
  return hours;
}

const STATIONS_KEY = 'wetter.smnStationen';

async function smnStations() {
  try {
    const cached = JSON.parse(localStorage.getItem(STATIONS_KEY));
    if (cached && Date.now() - cached.at < 30 * 24 * H) return cached.list;
  } catch {
    // kein oder defekter Zwischenspeicher: neu laden
  }
  const list = parseSmnStations(await getText(`${SMN}/ogd-smn_meta_stations.csv`));
  try {
    localStorage.setItem(STATIONS_KEY, JSON.stringify({ at: Date.now(), list }));
  } catch {
    // Speicher voll oder gesperrt: dann eben ohne Zwischenspeicher
  }
  return list;
}

async function truthMeteoSwiss(lat, lon, elevation) {
  // grobe Vorprüfung: nur in und um die Schweiz
  if (lat < 45.6 || lat > 48.0 || lon < 5.7 || lon > 10.7) return null;
  const station = nearestStation(await smnStations(), lat, lon, elevation);
  if (!station) return null;
  const id = station.id.toLowerCase();
  const hours = parseSmnTenMin(await getText(`${SMN}/${id}/ogd-smn_${id}_t_now.csv`));
  if (hours.size < 3) return null;
  return { hours, label: `Stationsmessung MeteoSchweiz ${station.name}, ${station.km.toFixed(1)} km entfernt` };
}

async function truthBrightSky(lat, lon) {
  const now = Date.now();
  const url =
    'https://api.brightsky.dev/weather' +
    `?lat=${lat}&lon=${lon}&max_dist=${MAX_STATION_KM * 1000}` +
    `&date=${new Date(now - 72 * H).toISOString()}&last_date=${new Date(now).toISOString()}`;
  const data = await getJson(url);
  const stations = new Map((data.sources || []).map((s) => [s.id, s]));
  const hours = new Map();
  let station = null;
  for (const row of data.weather || []) {
    const src = stations.get(row.source_id);
    if (!src || src.observation_type === 'forecast' || num(row.temperature) === null) continue;
    hours.set(Date.parse(row.timestamp), { t: row.temperature, p: num(row.precipitation) });
    station = src;
  }
  if (hours.size < 3) return null;
  const km = num(station.distance) !== null ? `, ${(station.distance / 1000).toFixed(1)} km entfernt` : '';
  return { hours, label: `Stationsmessung DWD ${station.station_name || ''}${km}`.replace('  ', ' ') };
}

async function truthAnalysis(lat, lon) {
  const now = Date.now();
  const url =
    'https://api.open-meteo.com/v1/forecast' +
    `?latitude=${lat}&longitude=${lon}&hourly=temperature_2m,precipitation` +
    '&past_days=3&forecast_days=1&timeformat=unixtime&timezone=GMT';
  const data = await getJson(url);
  const hourly = data.hourly || {};
  const hours = new Map();
  (hourly.time || []).forEach((sec, i) => {
    if (sec * 1000 > now || num(hourly.temperature_2m?.[i]) === null) return;
    hours.set(sec * 1000, { t: hourly.temperature_2m[i], p: num(hourly.precipitation?.[i]) });
  });
  return hours;
}

export async function fetchTruth(lat, lon, elevation = null) {
  const notes = [];
  const attempt = async (name, fn) => {
    try {
      return await fn();
    } catch (e) {
      notes.push(`${name}: ${e.message}`);
      return null;
    }
  };
  const [station, analysis] = await Promise.all([
    (async () =>
      (await attempt('MeteoSchweiz', () => truthMeteoSwiss(lat, lon, elevation))) ??
      (await attempt('DWD', () => truthBrightSky(lat, lon))))(),
    attempt('Modellanalyse', () => truthAnalysis(lat, lon)),
  ]);
  if (!station && !analysis) throw new Error(notes.join('; ') || 'keine Vergleichsdaten');

  const hours = new Map();
  for (const [ms, v] of analysis ?? []) hours.set(ms, { ...v, src: 'analysis' });
  for (const [ms, v] of station?.hours ?? []) hours.set(ms, { ...v, src: 'obs' }); // Messung hat Vorrang
  return {
    kind: station ? 'obs' : 'analysis',
    label: station ? station.label : 'Modellanalyse von Open-Meteo (keine Stationsmessung in der Nähe)',
    obsHours: station ? station.hours.size : 0,
    hours,
    notes,
  };
}

export async function searchPlaces(name) {
  const url =
    'https://geocoding-api.open-meteo.com/v1/search' +
    `?name=${encodeURIComponent(name)}&count=6&language=de&format=json`;
  const data = await getJson(url);
  return (data.results || []).map((r) => ({
    name: r.name,
    detail: [r.admin1, r.country].filter(Boolean).join(', '),
    lat: r.latitude,
    lon: r.longitude,
  }));
}
