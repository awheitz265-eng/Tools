// Animierte Wettersequenz: spielt die Vorhersage als kurzen «Film» auf einem Canvas ab.
import { sunElevation } from './ensemble.js';

const DURATION = 20000; // ms für die ganze Sequenz
const KIND_TEXT = { clear: 'Klar', partly: 'Teils bewölkt', cloudy: 'Bewölkt', rain: 'Regen', snow: 'Schnee' };

const lerp = (a, b, f) => a + (b - a) * f;
const clamp01 = (x) => Math.max(0, Math.min(1, x));
const mix = (c1, c2, f) => c1.map((v, i) => Math.round(lerp(v, c2[i], f)));
const rgb = (c, a = 1) => `rgba(${c[0]},${c[1]},${c[2]},${a})`;

// feste Pseudozufallszahlen, damit die Szene nicht flackert
function seeded(n, seed = 7) {
  const out = [];
  let s = seed;
  for (let i = 0; i < n; i++) {
    s = (s * 16807) % 2147483647;
    out.push(s / 2147483647);
  }
  return out;
}
const R = seeded(600);

export class Scene {
  constructor(canvas, onProgress) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.onProgress = onProgress || (() => {});
    this.progress = 0;
    this.playing = false;
    this.data = null;
    this.last = 0;
    this.clock = 0;
    this.tick = this.tick.bind(this);
    new ResizeObserver(() => this.resize()).observe(canvas);
    this.resize();
  }

  resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const { width, height } = this.canvas.getBoundingClientRect();
    if (!width || !height) return;
    this.canvas.width = Math.round(width * dpr);
    this.canvas.height = Math.round(height * dpr);
    this.draw();
  }

  setData(forecast, place) {
    this.data = { ...forecast, place };
    this.progress = 0;
    this.play();
  }

  play() {
    if (!this.data) return;
    if (this.progress >= 1) this.progress = 0;
    if (this.playing) return;
    this.playing = true;
    this.last = performance.now();
    cancelAnimationFrame(this.frame); // nie zwei Schleifen gleichzeitig
    this.frame = requestAnimationFrame(this.tick);
  }

  pause() {
    this.playing = false;
    this.onProgress(this.progress, false);
  }

  toggle() {
    this.playing ? this.pause() : this.play();
  }

  seek(f) {
    this.progress = clamp01(f);
    this.draw();
    this.onProgress(this.progress, this.playing);
  }

  tick(now) {
    if (!this.playing) return;
    const dt = Math.max(0, Math.min(now - this.last, 100)); // rAF-Zeit kann vor dem Startzeitpunkt liegen
    this.last = now;
    this.clock += dt;
    this.progress += dt / DURATION;
    if (this.progress >= 1) {
      this.progress = 1;
      this.playing = false;
    }
    this.draw();
    this.onProgress(this.progress, this.playing);
    if (this.playing) this.frame = requestAnimationFrame(this.tick);
  }

  // Zustand zum Zeitpunkt f (0..1), zwischen den Stunden interpoliert
  stateAt(f) {
    const hrs = this.data.hours;
    const pos = f * (hrs.length - 1);
    const i = Math.max(0, Math.min(Math.floor(pos), hrs.length - 2));
    const a = hrs[i];
    const b = hrs[Math.min(i + 1, hrs.length - 1)];
    const k = pos - i;
    const near = k < 0.5 ? a : b;
    return {
      ms: lerp(a.ms, b.ms, k),
      temp: lerp(a.temp, b.temp, k),
      precip: lerp(a.precip, b.precip, k),
      prob: lerp(a.prob, b.prob, k),
      cloud: lerp(a.cloud ?? 50, b.cloud ?? 50, k),
      kind: near.kind,
      confLabel: near.confLabel,
      n: near.n,
    };
  }

  draw() {
    const { ctx, canvas } = this;
    const w = canvas.width;
    const h = canvas.height;
    if (!w || !h) return;
    const u = Math.min(w, h * 0.8) / 100; // Grundeinheit für Grössen
    ctx.clearRect(0, 0, w, h);

    if (!this.data || !this.data.hours.length) {
      ctx.fillStyle = '#16233b';
      ctx.fillRect(0, 0, w, h);
      return;
    }

    const s = this.stateAt(this.progress);
    const { place } = this.data;
    const elev = sunElevation(s.ms, place.lat, place.lon);
    const day = clamp01((elev + 6) / 12); // 0 = Nacht, 1 = Tag, dazwischen Dämmerung
    const cover = clamp01(s.cloud / 100);
    const wet = s.kind === 'rain' || s.kind === 'snow';
    const horizon = h * 0.62;

    // Himmel
    const dusk = 1 - Math.abs(day - 0.5) * 2;
    let top = mix([8, 14, 38], [52, 128, 214], day);
    let bottom = mix([26, 36, 72], [164, 212, 246], day);
    bottom = mix(bottom, [244, 150, 90], dusk * 0.6 * (1 - cover));
    const grey = mix([44, 50, 62], [150, 160, 172], day);
    top = mix(top, grey, cover * 0.75);
    bottom = mix(bottom, mix(grey, [200, 205, 212], day * 0.5), cover * 0.75);
    const sky = ctx.createLinearGradient(0, 0, 0, horizon);
    sky.addColorStop(0, rgb(top));
    sky.addColorStop(1, rgb(bottom));
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, w, h);

    // Sterne
    const starAlpha = (1 - day) * (1 - cover);
    if (starAlpha > 0.05) {
      for (let i = 0; i < 70; i++) {
        const tw = 0.6 + 0.4 * Math.sin(this.clock / 500 + i);
        ctx.fillStyle = `rgba(255,255,255,${starAlpha * tw})`;
        ctx.fillRect(R[i] * w, R[i + 100] * horizon * 0.9, u * 0.45, u * 0.45);
      }
    }

    // Sonne oder Mond
    const local = ((s.ms / 3600e3 + place.lon / 15) % 24 + 24) % 24; // wahre Ortszeit
    if (elev > -4) {
      const x = w * (0.1 + 0.8 * clamp01((local - 5) / 14));
      const y = horizon - (clamp01(elev / 60) * horizon * 0.72 + u * 2);
      const glow = ctx.createRadialGradient(x, y, u * 2, x, y, u * 22);
      glow.addColorStop(0, `rgba(255,236,170,${0.55 * (1 - cover * 0.7)})`);
      glow.addColorStop(1, 'rgba(255,236,170,0)');
      ctx.fillStyle = glow;
      ctx.fillRect(x - u * 22, y - u * 22, u * 44, u * 44);
      ctx.fillStyle = `rgba(255,214,90,${1 - cover * 0.6})`;
      ctx.beginPath();
      ctx.arc(x, y, u * 6, 0, Math.PI * 2);
      ctx.fill();
    } else {
      const x = w * 0.78;
      const y = horizon * 0.24;
      ctx.fillStyle = `rgba(235,238,250,${0.95 - cover * 0.7})`;
      ctx.beginPath();
      ctx.arc(x, y, u * 5, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = rgb(top);
      ctx.beginPath();
      ctx.arc(x + u * 2.2, y - u * 1.2, u * 4.4, 0, Math.PI * 2);
      ctx.fill();
    }

    // Wolken
    const cloudCount = Math.round(cover * 9);
    const tone = wet ? mix([70, 76, 90], [128, 136, 150], day) : mix([86, 94, 112], [250, 251, 254], day);
    for (let i = 0; i < cloudCount; i++) {
      const size = u * (9 + R[i + 200] * 9);
      const speed = 0.004 + R[i + 220] * 0.006;
      const span = w + size * 8;
      const x = ((R[i + 240] * span + this.clock * speed * u) % span) - size * 4;
      const y = horizon * (0.12 + R[i + 260] * 0.5);
      ctx.fillStyle = rgb(tone, 0.82);
      ctx.beginPath();
      ctx.arc(x, y, size, 0, Math.PI * 2);
      ctx.arc(x + size * 1.1, y - size * 0.45, size * 1.15, 0, Math.PI * 2);
      ctx.arc(x + size * 2.3, y, size * 0.95, 0, Math.PI * 2);
      ctx.arc(x + size * 1.1, y + size * 0.35, size * 1.1, 0, Math.PI * 2);
      ctx.fill();
    }

    // Landschaft
    const hill = (base, amp, color, phase) => {
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.moveTo(0, h);
      for (let i = 0; i <= 40; i++) {
        const x = (w * i) / 40;
        const y = base - amp * (Math.sin((x / w) * 5 + phase) * 0.6 + Math.sin((x / w) * 11 + phase * 2) * 0.4);
        ctx.lineTo(x, y);
      }
      ctx.lineTo(w, h);
      ctx.fill();
    };
    const snowy = s.temp <= 0.5 && s.kind === 'snow';
    hill(horizon + u * 2, u * 5, rgb(mix([20, 30, 48], snowy ? [200, 212, 224] : [74, 122, 104], day)), 1);
    hill(horizon + u * 9, u * 4, rgb(mix([14, 22, 36], snowy ? [226, 234, 242] : [52, 98, 78], day)), 4);

    // Niederschlag
    if (wet) {
      const amount = Math.round(40 + clamp01(s.precip / 3) * 160);
      const t = this.clock / 1000;
      if (s.kind === 'rain') {
        ctx.strokeStyle = 'rgba(200,222,255,0.6)';
        ctx.lineWidth = Math.max(1, u * 0.3);
        ctx.beginPath();
        for (let i = 0; i < amount; i++) {
          const x = R[i + 300] * w * 1.1;
          const y = ((R[i] + t * (1.1 + R[i + 50] * 0.5)) % 1) * h;
          ctx.moveTo(x, y);
          ctx.lineTo(x - u * 0.8, y + u * 3.2);
        }
        ctx.stroke();
      } else {
        ctx.fillStyle = 'rgba(255,255,255,0.85)';
        for (let i = 0; i < amount; i++) {
          const y = ((R[i] + t * (0.12 + R[i + 50] * 0.1)) % 1) * h;
          const x = R[i + 300] * w + Math.sin(t + i) * u * 2;
          ctx.beginPath();
          ctx.arc(x, y, u * (0.4 + R[i + 100] * 0.5), 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }

    // Texte
    const off = this.data.utcOffset ?? -new Date(s.ms).getTimezoneOffset() * 60;
    const d = new Date(s.ms + off * 1000);
    const hhmm = `${String(d.getUTCHours()).padStart(2, '0')}:${String(Math.floor(d.getUTCMinutes() / 10) * 10).padStart(2, '0')}`;
    const pad = u * 6;
    ctx.textBaseline = 'alphabetic';
    ctx.shadowColor = 'rgba(0,0,0,0.45)';
    ctx.shadowBlur = u * 2;
    ctx.fillStyle = '#fff';
    ctx.textAlign = 'left';
    ctx.font = `600 ${u * 5.2}px system-ui, sans-serif`;
    ctx.fillText(place.name, pad, pad + u * 4, w - pad * 2 - u * 26);
    ctx.textAlign = 'right';
    ctx.font = `700 ${u * 7}px system-ui, sans-serif`;
    ctx.fillText(hhmm, w - pad, pad + u * 5);

    ctx.textAlign = 'left';
    ctx.font = `800 ${u * 25}px system-ui, sans-serif`;
    ctx.fillText(`${Math.round(s.temp)}°`, pad, pad + u * 33);
    ctx.font = `600 ${u * 6}px system-ui, sans-serif`;
    ctx.fillText(KIND_TEXT[s.kind], pad, pad + u * 42);
    ctx.font = `500 ${u * 4.2}px system-ui, sans-serif`;
    ctx.fillText(`Niederschlag ${s.precip.toFixed(1)} mm · Risiko ${Math.round(s.prob * 100)} %`, pad, pad + u * 49, w - pad * 2);
    ctx.fillText(`Konfidenz ${s.confLabel} · ${s.n} Quellen`, pad, pad + u * 55, w - pad * 2);
    ctx.shadowBlur = 0;

    this.drawTimeline(w, h, u, pad);
  }

  // Temperaturkurve und Niederschlagsbalken mit Abspielmarke
  drawTimeline(w, h, u, pad) {
    const { ctx } = this;
    const hrs = this.data.hours;
    const x0 = pad;
    const x1 = w - pad;
    const y1 = h - pad * 0.9;
    const y0 = y1 - Math.min(h * 0.16, u * 22);
    const xs = (i) => (hrs.length > 1 ? lerp(x0, x1, i / (hrs.length - 1)) : (x0 + x1) / 2);
    ctx.fillStyle = 'rgba(8,14,28,0.5)';
    ctx.beginPath();
    ctx.roundRect(x0 - u * 3, y0 - u * 7, x1 - x0 + u * 6, y1 - y0 + u * 11, u * 3);
    ctx.fill();

    const temps = hrs.map((x) => x.temp);
    const lo = Math.min(...temps);
    const hi = Math.max(...temps);
    const ys = (t) => (hi - lo < 0.5 ? (y0 + y1) / 2 : lerp(y1 - u * 2, y0 + u * 2, (t - lo) / (hi - lo)));

    const barW = Math.max(2, ((x1 - x0) / hrs.length) * 0.55);
    ctx.fillStyle = 'rgba(110,180,255,0.75)';
    hrs.forEach((x, i) => {
      if (x.precip < 0.05) return;
      const bh = clamp01(x.precip / 4) * (y1 - y0) * 0.9 + u;
      ctx.fillRect(xs(i) - barW / 2, y1 - bh, barW, bh);
    });

    ctx.strokeStyle = '#ffb347';
    ctx.lineWidth = Math.max(2, u * 0.7);
    ctx.lineJoin = 'round';
    ctx.beginPath();
    hrs.forEach((x, i) => (i ? ctx.lineTo(xs(i), ys(x.temp)) : ctx.moveTo(xs(i), ys(x.temp))));
    ctx.stroke();

    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    ctx.font = `500 ${u * 3.2}px system-ui, sans-serif`;
    ctx.textAlign = 'left';
    ctx.fillText(`${Math.round(hi)}° max`, x0, y0 - u * 2.2);
    ctx.textAlign = 'right';
    ctx.fillText(`${Math.round(lo)}° min`, x1, y0 - u * 2.2);

    const px = lerp(x0, x1, this.progress);
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = Math.max(1.5, u * 0.5);
    ctx.beginPath();
    ctx.moveTo(px, y0 - u);
    ctx.lineTo(px, y1 + u);
    ctx.stroke();
  }
}
