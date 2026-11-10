// Animierte Wettersequenz: spielt die Vorhersage als kurzen «Film» auf einem Canvas ab.
import { sunElevation } from './ensemble.js';

const DURATION = 28000; // ms für die ganze Sequenz
const INTRO = 0.06; // Anteil Titelbild am Anfang
const OUTRO = 0.92; // ab hier Zusammenfassung
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
    this.data = { ...forecast, place, summary: summarize(forecast.hours) };
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

    const main = clamp01((this.progress - INTRO) / (OUTRO - INTRO)); // Anteil der 24 Stunden
    const s = this.stateAt(main);
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
      if (cover < 0.6) {
        ctx.strokeStyle = `rgba(255,224,130,${0.5 * (1 - cover / 0.6)})`;
        ctx.lineWidth = u * 0.7;
        ctx.lineCap = 'round';
        ctx.beginPath();
        for (let i = 0; i < 12; i++) {
          const a = (i / 12) * Math.PI * 2 + this.clock / 6000;
          const r1 = u * 8;
          const r2 = u * (10.5 + (i % 2) * 1.8);
          ctx.moveTo(x + Math.cos(a) * r1, y + Math.sin(a) * r1);
          ctx.lineTo(x + Math.cos(a) * r2, y + Math.sin(a) * r2);
        }
        ctx.stroke();
      }
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
    const hillY = (x, base, amp, phase) =>
      base - amp * (Math.sin((x / w) * 5 + phase) * 0.6 + Math.sin((x / w) * 11 + phase * 2) * 0.4);
    const hill = (base, amp, color, phase) => {
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.moveTo(0, h);
      for (let i = 0; i <= 40; i++) ctx.lineTo((w * i) / 40, hillY((w * i) / 40, base, amp, phase));
      ctx.lineTo(w, h);
      ctx.fill();
    };
    const snowy = s.temp <= 0.5 && s.kind === 'snow';
    const backColor = mix([20, 30, 48], snowy ? [200, 212, 224] : [74, 122, 104], day);
    const frontColor = mix([14, 22, 36], snowy ? [226, 234, 242] : [52, 98, 78], day);
    const treeColor = mix([8, 14, 24], snowy ? [150, 170, 180] : [30, 68, 56], day);
    hill(horizon + u * 2, u * 5, rgb(backColor), 1);

    // Tannen auf dem hinteren Hügel
    ctx.fillStyle = rgb(treeColor);
    for (let i = 0; i < 9; i++) {
      const x = w * (0.04 + R[i + 400] * 0.92);
      const y = hillY(x, horizon + u * 2, u * 5, 1) + u * 0.8;
      const th = u * (5 + R[i + 420] * 4);
      ctx.beginPath();
      ctx.moveTo(x, y - th);
      ctx.lineTo(x + th * 0.32, y);
      ctx.lineTo(x - th * 0.32, y);
      ctx.fill();
    }

    hill(horizon + u * 9, u * 4, rgb(frontColor), 4);

    // Haus auf dem vorderen Hügel, nachts mit Licht im Fenster
    {
      const x = w * 0.7;
      const y = hillY(x, horizon + u * 9, u * 4, 4) + u * 0.6;
      const hw = u * 5;
      const hh = u * 4.2;
      ctx.fillStyle = rgb(mix([34, 40, 58], [236, 228, 214], day));
      ctx.fillRect(x - hw, y - hh, hw * 2, hh);
      ctx.fillStyle = rgb(mix([22, 26, 40], snowy ? [240, 244, 248] : [150, 78, 62], day));
      ctx.beginPath();
      ctx.moveTo(x - hw * 1.2, y - hh);
      ctx.lineTo(x, y - hh - u * 3.4);
      ctx.lineTo(x + hw * 1.2, y - hh);
      ctx.fill();
      ctx.fillStyle = day < 0.5 ? 'rgba(255,214,120,0.95)' : rgb(mix([60, 80, 110], [120, 160, 200], day));
      ctx.fillRect(x - hw * 0.6, y - hh * 0.72, u * 1.8, u * 1.8);
      ctx.fillRect(x + hw * 0.6 - u * 1.8, y - hh * 0.72, u * 1.8, u * 1.8);
    }

    // Spritzer am Boden bei Regen
    if (s.kind === 'rain') {
      ctx.strokeStyle = 'rgba(200,222,255,0.5)';
      ctx.lineWidth = Math.max(1, u * 0.25);
      for (let i = 0; i < 14; i++) {
        const phase = (this.clock / 700 + R[i + 440]) % 1;
        const x = R[i + 460] * w;
        const y = horizon + u * (8 + R[i + 480] * 14);
        ctx.globalAlpha = 1 - phase;
        ctx.beginPath();
        ctx.ellipse(x, y, u * (0.5 + phase * 2), u * (0.2 + phase * 0.6), 0, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
    }

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

    this.drawTimeline(w, h, u, pad, main);
    this.drawIntroOutro(w, h, u, pad);
  }

  // Titelbild am Anfang, Zusammenfassung am Schluss
  drawIntroOutro(w, h, u, pad) {
    const { ctx } = this;
    const { place, summary, hours, sourceCount } = this.data;
    const p = this.progress;
    const off = this.data.utcOffset ?? -new Date(hours[0].ms).getTimezoneOffset() * 60;
    const clock = (ms) => `${String(new Date(ms + off * 1000).getUTCHours()).padStart(2, '0')}:00`;

    const intro = clamp01(1 - (p - INTRO * 0.6) / (INTRO * 0.4));
    if (p < INTRO && intro > 0) {
      ctx.fillStyle = `rgba(10,16,30,${0.88 * intro})`;
      ctx.fillRect(0, 0, w, h);
      ctx.globalAlpha = intro;
      ctx.fillStyle = '#fff';
      ctx.textAlign = 'center';
      ctx.font = `800 ${u * 10}px system-ui, sans-serif`;
      ctx.fillText(place.name, w / 2, h * 0.42, w - pad * 2);
      ctx.font = `500 ${u * 4.6}px system-ui, sans-serif`;
      const date = new Date(hours[0].ms + off * 1000).toLocaleDateString('de-CH', {
        weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC',
      });
      ctx.fillText(date, w / 2, h * 0.42 + u * 8, w - pad * 2);
      ctx.fillStyle = '#ffb347';
      ctx.fillText(`Die nächsten ${hours.length} Stunden · ${sourceCount ?? '–'} Quellen`, w / 2, h * 0.42 + u * 15, w - pad * 2);
      ctx.globalAlpha = 1;
    }

    const outro = clamp01((p - OUTRO) / 0.03);
    if (outro > 0) {
      const lines = [
        ['Temperatur', `${Math.round(summary.lo)}° bis ${Math.round(summary.hi)}°`],
        ['Niederschlag', summary.wet ? `${summary.total.toFixed(1)} mm in ${summary.wet} Std.` : 'keiner erwartet'],
        ['Nass', summary.wet ? `${clock(summary.wetFrom)} bis ${clock(summary.wetTo + 3600e3)}` : '–'],
        ['Konfidenz', summary.confText],
      ];
      const bw = Math.min(w - pad * 2, u * 88);
      const bh = u * (16 + lines.length * 8.5);
      const bx = (w - bw) / 2;
      const by = h * 0.4 - bh / 2;
      ctx.globalAlpha = outro;
      ctx.fillStyle = 'rgba(10,16,30,0.95)';
      ctx.beginPath();
      ctx.roundRect(bx, by, bw, bh, u * 4);
      ctx.fill();
      ctx.fillStyle = '#ffb347';
      ctx.textAlign = 'left';
      ctx.font = `700 ${u * 5.4}px system-ui, sans-serif`;
      ctx.fillText('Zusammenfassung', bx + u * 6, by + u * 10);
      lines.forEach(([label, value], i) => {
        const y = by + u * (20 + i * 8.5);
        ctx.fillStyle = 'rgba(255,255,255,0.7)';
        ctx.textAlign = 'left';
        ctx.font = `500 ${u * 4.2}px system-ui, sans-serif`;
        ctx.fillText(label, bx + u * 6, y);
        ctx.fillStyle = '#fff';
        ctx.textAlign = 'right';
        ctx.font = `700 ${u * 4.6}px system-ui, sans-serif`;
        ctx.fillText(value, bx + bw - u * 6, y, bw * 0.62);
      });
      ctx.globalAlpha = 1;
    }
  }

  // Zeitleiste: Tag/Nacht, Streuung der Quellen, Temperaturkurve, Niederschlag, Uhrzeiten
  drawTimeline(w, h, u, pad, main) {
    const { ctx } = this;
    const hrs = this.data.hours;
    const { place } = this.data;
    const x0 = pad;
    const x1 = w - pad;
    const y1 = h - pad * 0.9 - u * 5;
    const y0 = y1 - Math.min(h * 0.16, u * 22);
    const xs = (i) => (hrs.length > 1 ? lerp(x0, x1, i / (hrs.length - 1)) : (x0 + x1) / 2);
    const step = hrs.length > 1 ? (x1 - x0) / (hrs.length - 1) : 0;
    ctx.fillStyle = 'rgba(8,14,28,0.55)';
    ctx.beginPath();
    ctx.roundRect(x0 - u * 3, y0 - u * 7, x1 - x0 + u * 6, y1 - y0 + u * 16, u * 3);
    ctx.fill();

    // Nachtstunden abdunkeln
    ctx.fillStyle = 'rgba(0,0,10,0.35)';
    hrs.forEach((x, i) => {
      if (sunElevation(x.ms, place.lat, place.lon) >= 0) return;
      const a = Math.max(x0, xs(i) - step / 2);
      const b = Math.min(x1, xs(i) + step / 2);
      ctx.fillRect(a, y0 - u, b - a, y1 - y0 + u * 2);
    });

    const lo = Math.min(...hrs.map((x) => x.tMin ?? x.temp));
    const hi = Math.max(...hrs.map((x) => x.tMax ?? x.temp));
    const ys = (t) => (hi - lo < 0.5 ? (y0 + y1) / 2 : lerp(y1 - u * 2, y0 + u * 2, (t - lo) / (hi - lo)));

    // Niederschlag
    const barW = Math.max(2, step * 0.55);
    hrs.forEach((x, i) => {
      if (x.precip < 0.05) return;
      const bh = clamp01(x.precip / 4) * (y1 - y0) * 0.9 + u;
      ctx.fillStyle = `rgba(110,180,255,${0.35 + 0.5 * clamp01(x.prob)})`;
      ctx.fillRect(xs(i) - barW / 2, y1 - bh, barW, bh);
    });

    // Streuung der Quellen (kälteste bis wärmste)
    ctx.fillStyle = 'rgba(255,179,71,0.22)';
    ctx.beginPath();
    hrs.forEach((x, i) => (i ? ctx.lineTo(xs(i), ys(x.tMax ?? x.temp)) : ctx.moveTo(xs(i), ys(x.tMax ?? x.temp))));
    for (let i = hrs.length - 1; i >= 0; i--) ctx.lineTo(xs(i), ys(hrs[i].tMin ?? hrs[i].temp));
    ctx.fill();

    ctx.strokeStyle = '#ffb347';
    ctx.lineWidth = Math.max(2, u * 0.7);
    ctx.lineJoin = 'round';
    ctx.beginPath();
    hrs.forEach((x, i) => (i ? ctx.lineTo(xs(i), ys(x.temp)) : ctx.moveTo(xs(i), ys(x.temp))));
    ctx.stroke();

    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    ctx.font = `500 ${u * 3.2}px system-ui, sans-serif`;
    ctx.textAlign = 'left';
    ctx.fillText(`Temperatur mit Streuung der Quellen`, x0, y0 - u * 2.2, (x1 - x0) * 0.62);
    ctx.textAlign = 'right';
    ctx.fillStyle = 'rgba(140,195,255,0.95)';
    ctx.fillText('Niederschlag', x1, y0 - u * 2.2);

    // Uhrzeiten
    const off = this.data.utcOffset ?? -new Date(hrs[0].ms).getTimezoneOffset() * 60;
    const every = w / u > 110 ? 2 : 3;
    ctx.fillStyle = 'rgba(255,255,255,0.75)';
    ctx.textAlign = 'center';
    ctx.font = `500 ${u * 2.9}px system-ui, sans-serif`;
    hrs.forEach((x, i) => {
      const hour = new Date(x.ms + off * 1000).getUTCHours();
      if (hour % every) return;
      ctx.fillText(String(hour).padStart(2, '0'), xs(i), y1 + u * 5);
      ctx.fillRect(xs(i) - u * 0.1, y1 + u * 0.6, u * 0.2, u * 1.2);
    });

    // Abspielmarke mit Punkt auf der Kurve
    const px = lerp(x0, x1, main);
    const st = this.stateAt(main);
    ctx.strokeStyle = 'rgba(255,255,255,0.8)';
    ctx.lineWidth = Math.max(1.5, u * 0.4);
    ctx.beginPath();
    ctx.moveTo(px, y0 - u);
    ctx.lineTo(px, y1 + u);
    ctx.stroke();
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.arc(px, ys(st.temp), u * 1.3, 0, Math.PI * 2);
    ctx.fill();
  }
}

// Kennzahlen für die Zusammenfassung am Schluss
function summarize(hours) {
  const wetHours = hours.filter((x) => x.kind === 'rain' || x.kind === 'snow');
  const count = (label) => hours.filter((x) => x.confLabel === label).length;
  const [hoch, mittel, tief] = [count('hoch'), count('mittel'), count('tief')];
  const top = Math.max(hoch, mittel, tief);
  const main = top === hoch ? 'hoch' : top === mittel ? 'mittel' : 'tief';
  return {
    lo: Math.min(...hours.map((x) => x.temp)),
    hi: Math.max(...hours.map((x) => x.temp)),
    total: wetHours.reduce((sum, x) => sum + x.precip, 0),
    wet: wetHours.length,
    wetFrom: wetHours[0]?.ms,
    wetTo: wetHours[wetHours.length - 1]?.ms,
    confText: `meist ${main} (${top}/${hours.length} Std.)`,
  };
}
