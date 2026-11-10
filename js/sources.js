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

function openMeteo(model) {
  return async (lat, lon) => {
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
    return { hours, utcOffset: num(data.utc_offset_seconds) };
  };
}

async function metNorway(lat, lon) {
  const url =
    'https://api.met.no/weatherapi/locationforecast/2.0/compact' +
    `?lat=${lat.toFixed(4)}&lon=${lon.toFixed(4)}`;
  const data = await getJson(url);
  const series = data?.properties?.timeseries || [];
  const hours = new Map();
  for (const row of series) {
    const ms = Date.parse(row.time);
    const d = row.data?.instant?.details || {};
    if (num(d.air_temperature) === null) continue;
    const wind = num(d.wind_speed); // m/s
    hours.set(ms, {
      t: d.air_temperature, p: null, pp: null, cc: num(d.cloud_area_fraction),
      ws: wind === null ? null : wind * 3.6, wg: null, th: null, fg: null,
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
];

export async function fetchAll(lat, lon, sources = SOURCES) {
  const settled = await Promise.allSettled(sources.map((s) => s.load(lat, lon)));
  return settled.map((r, i) => {
    const { id, label, weight = 1 } = sources[i];
    if (r.status === 'rejected') return { id, label, weight, ok: false, error: r.reason.message };
    if (r.value.hours.size === 0) return { id, label, weight, ok: false, error: 'keine Daten für diesen Ort' };
    return { id, label, weight, ok: true, ...r.value };
  });
}

// Tatsächlich eingetretenes Wetter der letzten drei Tage, für die Auswertung.
// 1. Wahl: Stationsmessungen des DWD (via Bright Sky), soweit eine Station in der Nähe liegt.
// 2. Wahl: Modellanalyse von Open-Meteo. Das ist KEINE Messung, sondern die beste
//    nachträgliche Schätzung eines Modells, und kann verwandte Quellen bevorzugen.
export async function fetchTruth(lat, lon) {
  const now = Date.now();
  try {
    const url =
      'https://api.brightsky.dev/weather' +
      `?lat=${lat}&lon=${lon}&date=${new Date(now - 72 * H).toISOString()}&last_date=${new Date(now).toISOString()}`;
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
    if (hours.size >= 6) {
      const km = num(station.distance) !== null ? `, ${Math.round(station.distance / 1000)} km entfernt` : '';
      return { kind: 'obs', label: `Stationsmessung ${station.station_name || 'DWD'}${km}`, hours };
    }
  } catch {
    // keine Station in Reichweite oder Dienst nicht erreichbar: weiter mit der Modellanalyse
  }
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
  return { kind: 'analysis', label: 'Modellanalyse von Open-Meteo (keine Stationsmessung)', hours };
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
