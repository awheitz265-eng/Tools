// Datenquellen. Jede Quelle liefert stündliche Werte als Map: UTC-Millisekunden -> { t, p, pp, cc }
//   t  = Temperatur (°C), p = Niederschlag der Stunde (mm),
//   pp = Niederschlagswahrscheinlichkeit (%), cc = Bewölkung (%)
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
      '&hourly=temperature_2m,precipitation,precipitation_probability,cloud_cover' +
      `&models=${model}&timeformat=unixtime&timezone=auto&forecast_days=3`;
    const data = await getJson(url);
    const hourly = data.hourly || {};
    const col = (name) => hourly[name] ?? hourly[`${name}_${model}`] ?? [];
    const time = hourly.time || [];
    const t = col('temperature_2m');
    const p = col('precipitation');
    const pp = col('precipitation_probability');
    const cc = col('cloud_cover');
    const hours = new Map();
    time.forEach((sec, i) => {
      if (num(t[i]) === null) return;
      hours.set(sec * 1000, { t: t[i], p: num(p[i]), pp: num(pp[i]), cc: num(cc[i]) });
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
    hours.set(ms, { t: d.air_temperature, p: null, pp: null, cc: num(d.cloud_area_fraction) });
  }
  // MET Norway gibt den Niederschlag für die FOLGENDE Stunde an, die anderen
  // Quellen für die VERGANGENE. Darum um eine Stunde verschieben.
  for (const row of series) {
    const amount = num(row.data?.next_1_hours?.details?.precipitation_amount);
    const target = hours.get(Date.parse(row.time) + H);
    if (amount !== null && target) target.p = amount;
  }
  return { hours, utcOffset: null };
}

async function brightSky(lat, lon) {
  const start = new Date(Math.floor(Date.now() / H) * H);
  const end = new Date(start.getTime() + 26 * H);
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
