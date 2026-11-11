// Animierte Wettersequenz: spielt die Vorhersage als kurzen «Film» auf einem Canvas ab.
import { sunElevation, visualState, isWet } from './ensemble.js';

const MS_PER_HOUR = 800; // Abspieltempo: so lange dauert eine Vorhersagestunde
const INTRO = 0.06; // Anteil Titelbild am Anfang
const OUTRO = 0.92; // ab hier Zusammenfassung
const KIND_TEXT = {
  clear: 'Klar', partly: 'Teils bewölkt', cloudy: 'Bewölkt', fog: 'Nebel',
  rain: 'Regen', snow: 'Schnee', thunder: 'Gewitter',
};
const WEEKDAYS = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'];

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


// Mondphase: 0 = Neumond, 0.5 = Vollmond (Näherung über die mittlere Lunation)
function moonPhase(ms) {
  const lunation = 29.530588853 * 86400e3;
  return (((ms - 947182440000) % lunation) + lunation) % lunation / lunation;
}

// Höhenprofil einer Bergkette (Werte 0..1), aus überlagerten Wellen plus Zacken
function makeRidge(seed, waves, jag) {
  const n = 160;
  const out = [];
  let lo = Infinity;
  let hi = -Infinity;
  for (let i = 0; i <= n; i++) {
    let v = 0;
    waves.forEach(([freq, amp], k) => {
      v += amp * Math.sin((i / n) * freq * Math.PI * 2 + R[seed + k] * 20);
    });
    v += jag * (R[(seed + i * 3) % 600] - 0.5);
    out.push(v);
    lo = Math.min(lo, v);
    hi = Math.max(hi, v);
  }
  return out.map((v) => (v - lo) / (hi - lo));
}

// Weiche Wolke aus vielen überlagerten, nach aussen auslaufenden Ballen
function makeCloudSprite(seed) {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 256;
  const g = c.getContext('2d');
  for (let i = 0; i < 34; i++) {
    const dx = R[seed + i] - 0.5; // -0.5..0.5 entlang der Wolke
    const edge = 1 - Math.abs(dx) * 2; // 1 in der Mitte, 0 am Rand
    const x = 256 + dx * 360;
    const y = 168 - R[seed + i + 40] * 90 * edge;
    const r = 26 + 46 * edge * (0.5 + R[seed + i + 80] * 0.5);
    const grad = g.createRadialGradient(x, y, r * 0.15, x, y, r);
    grad.addColorStop(0, 'rgba(255,255,255,0.8)');
    grad.addColorStop(0.55, 'rgba(255,255,255,0.38)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grad;
    g.fillRect(x - r, y - r, r * 2, r * 2);
  }
  return c;
}


// ---------------------------------------------------------------------------------
// Statische Landschaft: bewaldeter Höhenzug, Wiese, Dorf. Gibt die Lage der Kamine
// zurück (für den Rauch). L = Lichtverhältnisse, siehe Aufruf.
// ---------------------------------------------------------------------------------
const HOUSES = [
  // x-Anteil, Tiefe (0 hinten .. 1 vorn), Breite, Höhe, Dach, Wand, Fenster
  [0.47, 0.12, 3.4, 2.5, 0, 0, 2], [0.515, 0.42, 4.2, 3.0, 1, 1, 3], [0.555, 0.06, 3.0, 2.3, 2, 2, 2],
  [0.59, 0.66, 4.8, 3.3, 0, 3, 3], [0.615, 0.26, 3.6, 2.7, 1, 0, 2], [0.725, 0.1, 3.2, 2.4, 0, 1, 2],
  [0.745, 0.5, 4.2, 3.0, 2, 0, 3], [0.79, 0.24, 3.6, 2.7, 1, 3, 2], [0.815, 0.78, 5.0, 3.4, 0, 1, 4],
  [0.86, 0.38, 3.9, 2.9, 2, 2, 3], [0.905, 0.62, 4.4, 3.1, 1, 0, 3], [0.69, 0.92, 5.2, 3.5, 2, 1, 4],
  [0.54, 0.95, 4.6, 3.2, 0, 2, 3],
];
const CHURCH = [0.665, 0.34];
const TREES = [[0.49, 0.3], [0.57, 0.5], [0.635, 0.55], [0.705, 0.3], [0.765, 0.7], [0.835, 0.2], [0.88, 0.85], [0.93, 0.3], [0.61, 0.98], [0.76, 0.98]];
const ROOFS = [[152, 76, 58], [96, 88, 90], [124, 90, 66]];
const WALLS = [[238, 230, 214], [246, 242, 234], [216, 198, 172], [156, 116, 86]];

function paintGround(g, w, h, u, horizon, ridges, L) {
  const ridgeY = (ridge, base, amp, x) => {
    const pos = clamp01(x / w) * (ridge.length - 1);
    const i = Math.min(Math.floor(pos), ridge.length - 2);
    return base - amp * lerp(ridge[i], ridge[i + 1], pos - i);
  };
  const ridgePath = (ridge, base, amp) => {
    g.beginPath();
    g.moveTo(0, h);
    ridge.forEach((v, i) => g.lineTo((w * i) / (ridge.length - 1), base - amp * v));
    g.lineTo(w, h);
    g.closePath();
  };
  const tri = (x1, y1, x2, y2, x3, y3) => {
    g.beginPath();
    g.moveTo(x1, y1);
    g.lineTo(x2, y2);
    g.lineTo(x3, y3);
    g.fill();
  };
  const SNOW = [232, 238, 246];
  // Farbe bei diesem Licht: nachts dunkler und bläulich (Mondlicht), bei trübem Wetter grauer
  const lit = (c) => {
    const night = mix(mix(c, [40, 56, 96], 0.55), [0, 0, 0], 0.3);
    const grey = (c[0] + c[1] + c[2]) / 3;
    return mix(mix(night, c, L.day), [grey, grey, grey], L.gloom * 0.25);
  };
  const snowy = (c, amount = 1) => mix(c, lit(SNOW), L.snow * amount);

  const conifer = (x, base, ht, tiers, body, shade, trunk) => {
    const half = ht * 0.3;
    if (trunk) {
      g.fillStyle = trunk;
      g.fillRect(x - ht * 0.03, base - ht * 0.14, ht * 0.06, ht * 0.14);
    }
    for (let t = tiers - 1; t >= 0; t--) {
      const top = base - ht + (ht * 0.78 * t) / tiers;
      const bot = Math.min(base - ht * 0.06, top + ((ht * 0.78) / tiers) * 1.75);
      const hw = half * (0.35 + (0.65 * (t + 1)) / tiers);
      g.fillStyle = body;
      tri(x, top, x + hw, bot, x - hw, bot);
      g.fillStyle = shade; // Schattenseite
      tri(x, top, x, bot, x - hw, bot);
      if (L.snow > 0.1) {
        g.fillStyle = rgb(lit(SNOW), L.snow * 0.9);
        tri(x, top, x + hw * 0.55, top + (bot - top) * 0.5, x - hw * 0.55, top + (bot - top) * 0.5);
      }
    }
  };

  // ---- bewaldeter Höhenzug ----
  const midBase = horizon + u * 4;
  const midAmp = u * 8;
  const nearBase = horizon + u * 9;
  const nearAmp = u * 3;
  let forest = lit([44, 82, 66]);
  forest = mix(forest, L.low, 0.14 + L.wet * 0.2);
  const forestBody = rgb(snowy(forest, 0.35));
  const forestShade = rgb(mix(snowy(forest, 0.2), [0, 0, 0], 0.3));
  const trunk = rgb(lit([70, 52, 40]));
  for (let i = 0; i < 130; i++) {
    // Baumreihe auf der Kante
    const x = (w * (i + R[i + 420])) / 130;
    const y = ridgeY(ridges[1], midBase, midAmp, x) + u * 0.5;
    conifer(x, y, u * (1.8 + R[i + 440] * 2.4), 2, forestBody, forestShade);
  }
  ridgePath(ridges[1], midBase, midAmp);
  const slope = g.createLinearGradient(0, midBase - midAmp, 0, nearBase);
  slope.addColorStop(0, forestBody);
  slope.addColorStop(1, forestShade);
  g.fillStyle = slope;
  g.fill();
  // Bäume am Hang, nach unten hin grösser (näher); rechts lichter, dort liegt das Dorf
  const stand = [];
  for (let i = 0; i < 230; i++) {
    const x = R[(i * 3) % 600] * w;
    const top = ridgeY(ridges[1], midBase, midAmp, x);
    const bottom = ridgeY(ridges[2], nearBase, nearAmp, x) + u * 0.6;
    if (bottom - top < u * 1.5) continue;
    const depth = R[(i * 3 + 1) % 600];
    if (x > w * 0.44 && depth > 0.55 && R[(i * 3 + 2) % 600] < 0.8) continue;
    stand.push([x, top + (0.12 + 0.88 * depth) * (bottom - top), u * (2.2 + depth * 3 + R[(i * 3 + 2) % 600] * 1.4)]);
  }
  stand.sort((a, b) => a[1] - b[1]);
  for (const [x, y, ht] of stand) conifer(x, y, ht, 3, forestBody, forestShade, trunk);

  // ---- Wiese ----
  let grassTop = snowy(lit([100, 146, 88]));
  let grassLow = snowy(lit([56, 98, 62]), 0.9);
  ridgePath(ridges[2], nearBase, nearAmp);
  const meadow = g.createLinearGradient(0, nearBase - nearAmp, 0, h);
  meadow.addColorStop(0, rgb(grassTop));
  meadow.addColorStop(1, rgb(grassLow));
  g.fillStyle = meadow;
  g.fill();
  g.save();
  g.clip();
  // Felder und Wiesenstücke
  for (let i = 0; i < 9; i++) {
    const x = R[i + 500] * w;
    const y = ridgeY(ridges[2], nearBase, nearAmp, x) + u * (2 + R[i + 510] * 16);
    g.fillStyle = rgb(i % 2 ? [255, 255, 220] : [0, 20, 0], 0.07);
    g.beginPath();
    g.ellipse(x, y, u * (9 + R[i + 520] * 12), u * (1.2 + R[i + 530] * 1.6), -0.08, 0, Math.PI * 2);
    g.fill();
  }
  if (L.sheen > 0) {
    g.fillStyle = rgb(L.low, 0.08 + L.sheen * 0.12); // nasser Boden spiegelt den Himmel
    g.fillRect(0, 0, w, h);
  }
  // Strasse vom Dorf nach vorn
  const road = rgb(snowy(lit([190, 180, 158]), 0.8));
  for (let k = 0; k < 70; k++) {
    const f = k / 70;
    const x = w * (0.66 - f * f * 0.5 + Math.sin(f * 5) * 0.03);
    const y = ridgeY(ridges[2], nearBase, nearAmp, w * 0.66) + u * (3 + f * 24);
    g.fillStyle = road;
    g.beginPath();
    g.ellipse(x, y, u * (1.2 + f * 3.4), u * (0.5 + f * 0.9), -0.5, 0, Math.PI * 2);
    g.fill();
  }
  g.restore();

  // ---- Dorf ----
  const vu = u * Math.min(1.4, Math.max(1, w / (u * 100))); // auf breiten Bildschirmen grösser
  const lights = clamp01(1 - L.day / 0.45); // wie stark die Fenster leuchten
  const ground = (fx, depth) => ridgeY(ridges[2], nearBase, nearAmp, w * fx) + u * (1.2 + depth * 9.5);
  const chimneys = [];
  const items = [];

  HOUSES.forEach(([fx, depth, bw, bh, roof, wall, wins], n) => {
    items.push([depth, () => {
      const k = vu * (0.78 + depth * 0.42);
      const x = w * fx;
      const y = ground(fx, depth);
      const ww = bw * k;
      const wh = bh * k;
      const rh = ww * 0.42;
      const wallC = lit(WALLS[wall]);
      const roofC = snowy(lit(ROOFS[roof]), 0.95);
      // Kamin (hinter dem Dach)
      const cx = x + ww * 0.24;
      g.fillStyle = rgb(mix(wallC, [0, 0, 0], 0.35));
      g.fillRect(cx - k * 0.28, y - wh - rh * 0.95, k * 0.56, rh * 0.8);
      if (n % 3 !== 2) chimneys.push([cx, y - wh - rh * 0.95]);
      // Wand mit Schattenseite
      g.fillStyle = rgb(wallC);
      g.fillRect(x - ww / 2, y - wh, ww, wh);
      g.fillStyle = rgb([0, 0, 0], 0.16);
      g.fillRect(x - ww / 2, y - wh, ww * 0.22, wh);
      // Giebeldach mit Überstand
      g.fillStyle = rgb(roofC);
      tri(x - ww * 0.6, y - wh + k * 0.1, x, y - wh - rh, x + ww * 0.6, y - wh + k * 0.1);
      g.fillStyle = rgb([0, 0, 0], 0.18);
      tri(x - ww * 0.6, y - wh + k * 0.1, x, y - wh - rh, x, y - wh + k * 0.1);
      // Tür
      g.fillStyle = rgb(lit([92, 62, 44]));
      g.fillRect(x - ww * 0.42, y - wh * 0.5, ww * 0.14, wh * 0.5);
      // Fenster, nachts teils erleuchtet
      const fw = ww * 0.11;
      const fh = wh * 0.3;
      for (let i = 0; i < wins; i++) {
        const fxw = x - ww * 0.2 + (i * ww * 0.62) / Math.max(1, wins - 1) - fw / 2;
        const fy = y - wh * 0.72;
        const on = lights > 0 && R[(n * 17 + i * 5) % 600] < 0.72;
        if (on) {
          const glow = g.createRadialGradient(fxw + fw / 2, fy + fh / 2, 0, fxw + fw / 2, fy + fh / 2, k * 2.2);
          glow.addColorStop(0, `rgba(255,200,120,${0.4 * lights})`);
          glow.addColorStop(1, 'rgba(255,200,120,0)');
          g.fillStyle = glow;
          g.fillRect(fxw - k * 2.2, fy - k * 2.2, fw + k * 4.4, fh + k * 4.4);
        }
        g.fillStyle = on ? `rgba(255,218,140,${0.55 + lights * 0.45})` : rgb(lit([86, 108, 132]));
        g.fillRect(fxw, fy, fw, fh);
      }
    }]);
  });

  // Kirche mit Turm
  items.push([CHURCH[1], () => {
    const k = vu * 0.95;
    const x = w * CHURCH[0];
    const y = ground(CHURCH[0], CHURCH[1]);
    const wallC = lit([244, 240, 232]);
    const roofC = snowy(lit([88, 82, 86]), 0.95);
    // Schiff
    g.fillStyle = rgb(wallC);
    g.fillRect(x, y - k * 3.6, k * 7, k * 3.6);
    g.fillStyle = rgb(roofC);
    tri(x - k * 0.3, y - k * 3.5, x + k * 3.5, y - k * 6, x + k * 7.3, y - k * 3.5);
    // Turm
    g.fillStyle = rgb(wallC);
    g.fillRect(x - k * 1.3, y - k * 9, k * 2.6, k * 9);
    g.fillStyle = rgb([0, 0, 0], 0.15);
    g.fillRect(x - k * 1.3, y - k * 9, k * 0.6, k * 9);
    g.fillStyle = rgb(roofC);
    tri(x - k * 1.6, y - k * 9, x, y - k * 14, x + k * 1.6, y - k * 9);
    g.fillRect(x - k * 0.08, y - k * 15, k * 0.16, k * 1.2);
    g.fillRect(x - k * 0.4, y - k * 14.6, k * 0.8, k * 0.16);
    // Turmuhr, Schallfenster, Kirchenfenster
    g.fillStyle = rgb(lit([228, 206, 150]));
    g.beginPath();
    g.arc(x, y - k * 7.6, k * 0.6, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = rgb(lit([60, 66, 80]));
    g.fillRect(x - k * 0.4, y - k * 6.4, k * 0.8, k * 1.1);
    for (let i = 0; i < 3; i++) {
      g.fillStyle = lights > 0 ? `rgba(255,214,140,${0.45 + lights * 0.4})` : rgb(lit([86, 108, 132]));
      g.fillRect(x + k * (1.9 + i * 1.6), y - k * 2.7, k * 0.6, k * 1.5);
    }
  }]);

  // Laubbäume zwischen den Häusern, je nach Jahreszeit
  const leaf = { spring: [126, 172, 84], summer: [78, 128, 66], autumn: [186, 128, 56], winter: null }[L.season];
  TREES.forEach(([fx, depth], n) => {
    items.push([depth + 0.01, () => {
      const k = vu * (0.75 + depth * 0.45);
      const x = w * fx;
      const y = ground(fx, depth);
      g.strokeStyle = rgb(lit([74, 54, 40]));
      g.lineWidth = Math.max(1, k * 0.32);
      g.lineCap = 'round';
      g.beginPath();
      g.moveTo(x, y);
      g.lineTo(x, y - k * 2.2);
      if (!leaf) {
        // kahle Krone im Winter
        for (let b = 0; b < 5; b++) {
          const a = -Math.PI / 2 + (b - 2) * 0.42;
          g.moveTo(x, y - k * (1.4 + (b % 2) * 0.5));
          g.lineTo(x + Math.cos(a) * k * 1.7, y - k * 1.8 + Math.sin(a) * k * 1.7);
        }
      }
      g.stroke();
      if (leaf) {
        const crown = snowy(lit(leaf), 0.6);
        [[0, -3.1, 1.5], [-1, -2.5, 1.2], [1, -2.5, 1.2], [0, -2.1, 1.3]].forEach(([dx, dy, r], i) => {
          g.fillStyle = rgb(i === 1 ? mix(crown, [0, 0, 0], 0.22) : crown);
          g.beginPath();
          g.arc(x + dx * k + (R[n + 590] - 0.5) * k * 0.3, y + dy * k, r * k, 0, Math.PI * 2);
          g.fill();
        });
      } else if (L.snow > 0.1) {
        g.fillStyle = rgb(lit(SNOW), L.snow * 0.8);
        g.beginPath();
        g.ellipse(x, y - k * 2.6, k * 1.2, k * 0.35, 0, 0, Math.PI * 2);
        g.fill();
      }
    }]);
  });

  items.sort((a, b) => a[0] - b[0]);
  for (const [, paint] of items) paint();

  // ---- grosse Tannen am Bildrand als Rahmen ----
  [[0.035, 13, 17], [0.1, 15.5, 13], [-0.01, 18, 21], [0.975, 14, 16], [1.02, 18.5, 20]].forEach(([fx, dy, ht]) => {
    conifer(w * fx, horizon + u * dy, u * ht, 6, forestBody, forestShade, trunk);
  });

  return { chimneys };
}

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
    this.drift = 0;
    this.speed = 1; // Abspieltempo (0.5 bis 4)
    this.groundKey = '';
    this.tick = this.tick.bind(this);
    this.ridges = [
      makeRidge(500, [[1.3, 1], [3.1, 0.55], [7.3, 0.28], [15, 0.12]], 0.16), // ferne Alpenkette
      makeRidge(520, [[1.1, 1], [2.7, 0.4], [6.1, 0.15]], 0.04), // bewaldeter Höhenzug
      makeRidge(540, [[0.8, 1], [2.2, 0.3]], 0), // Wiese im Vordergrund
    ];
    this.cloudShapes = [0, 97, 211, 313, 401, 150].map(makeCloudSprite);
    this.cloudTint = { key: '', sprites: [] };
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
    // Wolken und Nebel ziehen mit dem Wind: eigener Zähler, damit nichts springt
    const windNow = this.stateAt(clamp01((this.progress - INTRO) / (OUTRO - INTRO))).wind;
    this.drift += dt * this.speed * (0.5 + windNow / 18);
    this.progress += (dt * this.speed) / (this.data.hours.length * MS_PER_HOUR + 6000);
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
    // Das Bild wechselt zügig um die Stundenmitte, gleichzeitig mit der Beschriftung
    const e = clamp01((k - 0.3) / 0.4);
    const ease = e * e * (3 - 2 * e);
    const va = visualState(a);
    const vb = visualState(b);
    return {
      ms: lerp(a.ms, b.ms, k),
      temp: lerp(a.temp, b.temp, k),
      precip: lerp(a.precip, b.precip, k),
      prob: lerp(a.prob, b.prob, k),
      cover: lerp(va.cover, vb.cover, ease),
      rain: lerp(va.rain, vb.rain, ease),
      snow: lerp(va.snow, vb.snow, ease),
      fog: lerp(va.fog, vb.fog, ease),
      thunder: lerp(va.thunder, vb.thunder, ease),
      wind: lerp(a.wind ?? 0, b.wind ?? 0, k),
      gust: lerp(a.gust ?? a.wind ?? 0, b.gust ?? b.wind ?? 0, k),
      hasWind: near.wind !== null && near.wind !== undefined,
      hasGust: near.gust !== null && near.gust !== undefined,
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
    const cover = s.cover;
    // Horizont so, dass zwischen ihm und der Zeitleiste Platz für Wald und Dorf bleibt
    const horizon = Math.max(h * 0.45, h - u * 62);

    // ---------- Licht und Stimmung ----------
    const dusk = clamp01(1 - Math.abs(elev) / 10); // Sonne nahe am Horizont
    const wetAmt = clamp01((s.rain + s.snow) / 2);
    const falling = clamp01((s.rain + s.snow) / 0.3); // 1 = es regnet oder schneit
    const gloom = clamp01(cover ** 1.5 * 1.2 + falling * 0.2 + s.thunder * 0.3); // wie trüb der Himmel ist
    const blow = clamp01(Math.max(s.wind, s.gust * 0.6) / 60); // 0 = windstill, 1 = Sturm
    // Wie stark Sonne, Mond und Sterne durchkommen: ab dichter Decke gar nicht mehr
    const c = clamp01((cover - 0.5) / 0.38);
    const clearSky = (1 - c * c * (3 - 2 * c)) * (1 - falling) * (1 - s.fog);
    const clock = this.clock;

    // ---------- Himmel ----------
    let zenith = mix([14, 22, 52], [38, 104, 190], day);
    let middle = mix([24, 36, 76], [112, 170, 226], day);
    let low = mix([44, 60, 106], [190, 218, 240], day);
    low = mix(low, [250, 166, 98], dusk * 0.75);
    middle = mix(middle, [212, 142, 132], dusk * 0.35);
    const greyHi = mix([44, 50, 66], [108, 118, 132], day);
    const greyLo = mix([66, 74, 94], [178, 186, 196], day);
    zenith = mix(zenith, greyHi, gloom);
    middle = mix(middle, mix(greyHi, greyLo, 0.5), gloom);
    low = mix(low, greyLo, gloom * 0.9);
    const sky = ctx.createLinearGradient(0, 0, 0, horizon + u * 4);
    sky.addColorStop(0, rgb(zenith));
    sky.addColorStop(0.55, rgb(middle));
    sky.addColorStop(1, rgb(low));
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, w, h);

    // Sterne
    const starAlpha = (1 - day) * clearSky * (1 - cover * 0.5);
    if (starAlpha > 0.05) {
      for (let i = 0; i < 110; i++) {
        const tw = 0.55 + 0.45 * Math.sin(clock / (400 + R[i + 30] * 600) + i);
        const size = u * (0.18 + R[i + 150] * 0.42);
        ctx.fillStyle = `rgba(255,${240 + R[i] * 15},${220 + R[i + 60] * 35},${starAlpha * tw * (0.4 + R[i + 90] * 0.6)})`;
        ctx.beginPath();
        ctx.arc(R[i] * w, R[i + 100] * horizon * 0.92, size, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // Mond mit echter Phase
    const moonAlpha = clamp01(1 - day / 0.6) * clearSky;
    if (moonAlpha > 0.03) {
      const x = w * 0.78;
      const y = horizon * 0.22;
      const r = u * 4;
      const glow = ctx.createRadialGradient(x, y, r, x, y, r * 6);
      glow.addColorStop(0, `rgba(200,214,255,${0.28 * moonAlpha})`);
      glow.addColorStop(1, 'rgba(200,214,255,0)');
      ctx.fillStyle = glow;
      ctx.fillRect(x - r * 6, y - r * 6, r * 12, r * 12);
      ctx.fillStyle = `rgba(236,238,246,${moonAlpha})`;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
      const ph = moonPhase(s.ms);
      const k = Math.cos(ph * 2 * Math.PI); // 1 = Neumond, -1 = Vollmond
      const waxing = ph < 0.5;
      ctx.fillStyle = rgb(zenith, 0.93 * moonAlpha);
      ctx.beginPath();
      ctx.arc(x, y, r * 1.02, -Math.PI / 2, Math.PI / 2, waxing); // dunkle Seite
      ctx.ellipse(x, y, Math.abs(k) * r * 1.02, r * 1.02, 0, Math.PI / 2, -Math.PI / 2, waxing ? k > 0 : k < 0);
      ctx.fill();
    }

    // Sonne: weicher Lichthof, nahe am Horizont rötlich
    if (elev > -8) {
      const local = ((s.ms / 3600e3 + place.lon / 15) % 24 + 24) % 24; // wahre Ortszeit
      const x = w * (0.08 + 0.84 * clamp01((local - 5) / 14));
      const y = horizon - Math.min(elev / 60, 1) * horizon * 0.75;
      const power = clearSky * (1 - cover * 0.35);
      const tint = mix([255, 150, 70], [255, 244, 214], clamp01(elev / 14));
      const halo = ctx.createRadialGradient(x, y, 0, x, y, u * 46);
      // hinter dichten Wolken bleibt nur ein schwacher heller Fleck, bei Niederschlag nichts
      const diffuse = 0.1 * (1 - falling);
      halo.addColorStop(0, rgb(tint, 0.85 * power + diffuse));
      halo.addColorStop(0.12, rgb(tint, 0.42 * power + diffuse * 0.5));
      halo.addColorStop(0.45, rgb(tint, 0.12 * power));
      halo.addColorStop(1, rgb(tint, 0));
      ctx.fillStyle = halo;
      ctx.fillRect(x - u * 46, y - u * 46, u * 92, u * 92);
      if (power > 0.25) {
        const disc = ctx.createRadialGradient(x, y, 0, x, y, u * 4.2);
        disc.addColorStop(0, `rgba(255,255,250,${power})`);
        disc.addColorStop(0.8, rgb(tint, power));
        disc.addColorStop(1, rgb(tint, 0));
        ctx.fillStyle = disc;
        ctx.beginPath();
        ctx.arc(x, y, u * 4.2, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // ---------- Wolken ----------
    // Eingefärbte Wolkenbilder nur neu berechnen, wenn sich das Licht merklich ändert
    const tintKey = `${Math.round(day * 12)}|${Math.round(gloom * 8)}|${Math.round(dusk * 4)}`;
    if (this.cloudTint.key !== tintKey) {
      let lit = mix([112, 122, 152], [255, 255, 255], day);
      lit = mix(lit, [255, 208, 170], dusk * 0.6);
      lit = mix(lit, mix([84, 92, 112], [150, 156, 166], day), gloom * 0.85);
      let shade = mix([52, 60, 84], [150, 166, 190], day);
      shade = mix(shade, mix([40, 46, 62], [72, 78, 90], day), gloom);
      this.cloudTint = {
        key: tintKey,
        sprites: this.cloudShapes.map((shape) => {
          const c = document.createElement('canvas');
          c.width = shape.width;
          c.height = shape.height;
          const g = c.getContext('2d');
          g.drawImage(shape, 0, 0);
          g.globalCompositeOperation = 'source-atop';
          const grad = g.createLinearGradient(0, 60, 0, 200);
          grad.addColorStop(0, rgb(lit));
          grad.addColorStop(1, rgb(shade));
          g.fillStyle = grad;
          g.fillRect(0, 0, c.width, c.height);
          return c;
        }),
      };
    }
    const sprites = this.cloudTint.sprites;
    const cloudLayer = (count, seed, scaleLo, scaleHi, yLo, yHi, speed, alpha) => {
      ctx.globalAlpha = alpha;
      for (let i = 0; i < count; i++) {
        const cw = u * 62 * lerp(scaleLo, scaleHi, R[seed + i]);
        const span = w + cw * 1.5;
        const x = ((R[seed + i + 20] * span + this.drift * speed * u * (0.7 + R[seed + i + 40] * 0.6)) % span) - cw;
        const y = horizon * lerp(yLo, yHi, R[seed + i + 60]) - cw * 0.3;
        ctx.drawImage(sprites[(seed + i) % sprites.length], x, y, cw, cw / 2);
      }
      ctx.globalAlpha = 1;
    };
    cloudLayer(Math.round(cover * 10), 300, 0.5, 0.9, 0.36, 0.7, 0.0018, 0.9); // fern, klein, langsam
    if (cover > 0.55) {
      // geschlossene Wolkendecke
      const veil = ctx.createLinearGradient(0, 0, 0, horizon);
      const a = ((cover - 0.55) / 0.45) * (0.62 + falling * 0.25);
      veil.addColorStop(0, rgb(greyHi, a));
      veil.addColorStop(1, rgb(greyLo, a * 0.7));
      ctx.fillStyle = veil;
      ctx.fillRect(0, 0, w, horizon + u * 4);
    }
    cloudLayer(Math.round(cover * 10 + falling * 3), 350, 1.1, 1.9, 0.08, 0.46, 0.0045, 1); // nah, gross, schneller

    // Gewitter: Blitz im Himmel (die Berge verdecken sein unteres Ende)
    let flash = 0;
    if (s.thunder > 0.5) {
      const period = 2400;
      const idx = Math.floor(clock / period);
      const since = clock - idx * period - R[(idx * 13) % 600] * 1300;
      if (since >= 0 && since < 460) {
        flash = since < 80 || (since > 150 && since < 240) ? 1 : 0.35 * (1 - since / 460);
        if (since < 240) {
          let x = w * (0.15 + R[(idx * 29) % 600] * 0.7);
          ctx.strokeStyle = 'rgba(245,248,255,0.95)';
          ctx.shadowColor = 'rgba(170,200,255,0.9)';
          ctx.shadowBlur = u * 3;
          ctx.lineWidth = Math.max(1.5, u * 0.55);
          ctx.lineJoin = 'round';
          ctx.beginPath();
          ctx.moveTo(x, horizon * 0.2);
          for (let j = 1; j <= 9; j++) {
            x += (R[(idx * 7 + j * 11) % 600] - 0.5) * u * 9;
            ctx.lineTo(x, horizon * (0.2 + j * 0.085));
            if (j === 4) {
              // Seitenast
              ctx.lineTo(x + u * 7, horizon * (0.2 + (j + 1.6) * 0.085));
              ctx.moveTo(x, horizon * (0.2 + j * 0.085));
            }
          }
          ctx.stroke();
          ctx.shadowBlur = 0;
        }
      }
    }

    // ---------- Landschaft ----------
    const snowGround = clamp01(s.snow / 0.3) * 0.85;
    const ridgePath = (ridge, base, amp) => {
      ctx.beginPath();
      ctx.moveTo(0, h);
      ridge.forEach((v, i) => ctx.lineTo((w * i) / (ridge.length - 1), base - amp * v));
      ctx.lineTo(w, h);
      ctx.closePath();
    };
    const ridgeY = (ridge, base, amp, x) => {
      const pos = clamp01(x / w) * (ridge.length - 1);
      const i = Math.min(Math.floor(pos), ridge.length - 2);
      return base - amp * lerp(ridge[i], ridge[i + 1], pos - i);
    };

    // ferne Alpenkette, vom Dunst aufgehellt, mit Schnee auf den Gipfeln
    const farBase = horizon + u * 2;
    const farAmp = u * 21;
    const rock = mix(mix([44, 56, 88], [78, 100, 132], day), low, 0.45 + gloom * 0.3);
    ridgePath(this.ridges[0], farBase, farAmp);
    ctx.fillStyle = rgb(rock);
    ctx.fill();
    ctx.save();
    ctx.clip();
    const caps = ctx.createLinearGradient(0, farBase - farAmp, 0, farBase - farAmp * 0.45);
    const capColor = mix(mix([152, 164, 198], [250, 252, 255], day), [255, 214, 190], dusk * 0.5);
    caps.addColorStop(0, rgb(capColor, 0.85 * (1 - gloom * 0.5)));
    caps.addColorStop(1, rgb(capColor, 0));
    ctx.fillStyle = caps;
    ctx.fillRect(0, farBase - farAmp, w, farAmp);
    ctx.restore();

    // Dunst und Niederschlagsschleier vor den Bergen
    const haze = ctx.createLinearGradient(0, horizon - u * 22, 0, horizon + u * 6);
    haze.addColorStop(0, rgb(low, 0));
    haze.addColorStop(1, rgb(low, 0.18 + wetAmt * 0.6 + cover * 0.2));
    ctx.fillStyle = haze;
    ctx.fillRect(0, horizon - u * 22, w, u * 28);

    // Wald, Wiese und Dorf: aufwendig zu zeichnen, darum nur neu, wenn sich Licht,
    // Schnee, Nässe, Jahreszeit oder die Grösse merklich ändern
    const nearBase = horizon + u * 9;
    const month = new Date(s.ms).getUTCMonth();
    const season = month <= 1 || month === 11 ? 'winter' : month <= 4 ? 'spring' : month <= 7 ? 'summer' : 'autumn';
    const light = {
      day: Math.round(day * 20) / 20,
      gloom: Math.round(gloom * 6) / 6,
      dusk: Math.round(dusk * 5) / 5,
      snow: Math.round(snowGround * 5) / 5,
      wet: Math.round(wetAmt * 3) / 3,
      sheen: Math.round(clamp01(s.rain / 3) * 3) / 3,
      season,
    };
    const groundKey = `${w}x${h}|${Object.values(light).join('|')}`;
    if (this.groundKey !== groundKey) {
      this.groundKey = groundKey;
      this.ground ??= document.createElement('canvas');
      this.ground.width = w;
      this.ground.height = h;
      this.village = paintGround(this.ground.getContext('2d'), w, h, u, horizon, this.ridges, { ...light, low });
    }
    ctx.drawImage(this.ground, 0, 0);

    // Rauch aus den Kaminen, wenn geheizt wird; der Wind biegt ihn um
    if (s.temp < 12) {
      const smoke = mix([120, 126, 140], [226, 228, 232], day);
      for (const [cx, cy] of this.village.chimneys) {
        for (let j = 0; j < 6; j++) {
          const phase = (clock / 3200 + j / 6 + cx * 0.37) % 1;
          ctx.fillStyle = rgb(smoke, (1 - phase) * 0.34);
          ctx.beginPath();
          ctx.arc(
            cx - phase * u * (1 + blow * 12) + Math.sin(clock / 900 + j) * u * 0.25,
            cy - phase * u * (6 - blow * 3.5),
            u * (0.35 + phase * 1.2), 0, Math.PI * 2,
          );
          ctx.fill();
        }
      }
    }

    // ---------- Niederschlag in drei Tiefenebenen ----------
    const t = clock / 1000;
    if (s.rain > 0.03) {
      const power = 0.25 + clamp01(s.rain / 3) * 0.75;
      const tone = mix([150, 170, 205], [214, 228, 246], day);
      [[150, 2.2, 0.22, 0.25, 0.9], [90, 3.8, 0.32, 0.36, 1.25], [40, 6.5, 0.5, 0.5, 1.7]].forEach(
        ([count, len, width, alpha, speed], layer) => {
          ctx.strokeStyle = rgb(tone, alpha);
          ctx.lineWidth = Math.max(1, u * width);
          ctx.beginPath();
          const n = Math.round(count * power);
          for (let i = 0; i < n; i++) {
            const k = (i * 7 + layer * 131) % 600;
            const x = R[k] * w * 1.15;
            const y = ((R[(k + 211) % 600] + t * speed * (0.9 + R[(k + 97) % 600] * 0.2)) % 1) * (h + u * 8) - u * 4;
            ctx.moveTo(x, y);
            ctx.lineTo(x - u * len * (0.12 + blow * 0.75), y + u * len);
          }
          ctx.stroke();
        },
      );
      // Spritzer am Boden
      ctx.strokeStyle = rgb(tone, 0.45);
      ctx.lineWidth = Math.max(1, u * 0.22);
      for (let i = 0; i < Math.round(18 * power); i++) {
        const phase = (clock / 600 + R[i + 440]) % 1;
        const x = R[i + 460] * w;
        const y = nearBase + u * (1 + R[i + 480] * 12);
        ctx.globalAlpha = 1 - phase;
        ctx.beginPath();
        ctx.ellipse(x, y, u * (0.4 + phase * 1.8), u * (0.15 + phase * 0.5), 0, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
    }
    if (s.snow > 0.03) {
      const power = 0.3 + clamp01(s.snow / 2) * 0.7;
      [[140, 0.35, 0.5, 0.06], [80, 0.6, 0.7, 0.09], [36, 1.05, 0.9, 0.13]].forEach(([count, size, alpha, speed], layer) => {
        ctx.fillStyle = `rgba(255,255,255,${alpha})`;
        const n = Math.round(count * power);
        for (let i = 0; i < n; i++) {
          const k = (i * 7 + layer * 131) % 600;
          const y = ((R[(k + 211) % 600] + t * speed * (0.8 + R[(k + 97) % 600] * 0.4)) % 1) * h;
          const side = (((R[k] - t * blow * 0.12 * (1 + layer * 0.4)) % 1) + 1) % 1; // Wind treibt den Schnee seitwärts
          const x = side * w * 1.1 - w * 0.05 + Math.sin(t * 0.8 + k) * u * (1.5 + layer);
          ctx.beginPath();
          ctx.arc(x, y, u * size * (0.7 + R[(k + 50) % 600] * 0.6), 0, Math.PI * 2);
          ctx.fill();
        }
      });
    }

    // ---------- Nebel: verschluckt Berge und Wald, zieht in Schwaden über die Wiese ----------
    if (s.fog > 0.02) {
      const fogColor = mix([78, 84, 100], [208, 212, 218], day);
      const veil = ctx.createLinearGradient(0, 0, 0, h);
      veil.addColorStop(0, rgb(fogColor, 0.45 * s.fog));
      veil.addColorStop(horizon / h, rgb(fogColor, 0.9 * s.fog));
      veil.addColorStop(1, rgb(fogColor, 0.55 * s.fog));
      ctx.fillStyle = veil;
      ctx.fillRect(0, 0, w, h);
      ctx.globalAlpha = 0.5 * s.fog;
      for (let i = 0; i < 6; i++) {
        const bw = u * (120 + R[i + 560] * 80);
        const span = w + bw;
        const x = ((R[i + 570] * span + this.drift * 0.004 * u * (0.6 + R[i + 580])) % span) - bw;
        ctx.drawImage(sprites[i % sprites.length], x, horizon + u * (-12 + i * 5.5), bw, bw * 0.22);
      }
      ctx.globalAlpha = 1;
    }

    // Wetterleuchten: der Blitz erhellt kurz die ganze Szene
    if (flash > 0) {
      ctx.fillStyle = `rgba(214,226,255,${0.3 * flash})`;
      ctx.fillRect(0, 0, w, h);
    }

    // ---------- Bildwirkung: Randabdunklung und Lesehilfe für den Text ----------
    const vignette = ctx.createRadialGradient(w / 2, h * 0.45, Math.min(w, h) * 0.35, w / 2, h * 0.45, Math.max(w, h) * 0.8);
    vignette.addColorStop(0, 'rgba(0,0,0,0)');
    vignette.addColorStop(1, 'rgba(0,0,0,0.28)');
    ctx.fillStyle = vignette;
    ctx.fillRect(0, 0, w, h);
    // Abdunklung hinter dem Text: läuft nach allen Seiten weich aus, ohne Kante
    const scrim = ctx.createRadialGradient(w * 0.1, horizon * 0.3, 0, w * 0.1, horizon * 0.3, Math.max(w * 0.8, horizon * 0.62));
    scrim.addColorStop(0, 'rgba(0,0,0,0.34)');
    scrim.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = scrim;
    ctx.fillRect(0, 0, w, h);

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
    ctx.font = `800 ${u * 22}px system-ui, sans-serif`;
    ctx.fillText(`${Math.round(s.temp)}°`, pad, pad + u * 29);
    ctx.font = `600 ${u * 6}px system-ui, sans-serif`;
    ctx.fillText(KIND_TEXT[s.kind], pad, pad + u * 37.5);
    ctx.font = `500 ${u * 4.2}px system-ui, sans-serif`;
    ctx.fillText(`Niederschlag ${s.precip.toFixed(1)} mm · Risiko ${Math.round(s.prob * 100)} %`, pad, pad + u * 44, w - pad * 2);
    const windText = !s.hasWind
      ? 'Wind: keine Angabe'
      : `Wind ${Math.round(s.wind)} km/h` + (s.hasGust ? ` · Böen ${Math.round(s.gust)} km/h` : '');
    ctx.fillText(windText, pad, pad + u * 49.5, w - pad * 2);
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
    // Wochentag und Uhrzeit, z.B. «Mi 15:00» (der Zeitraum reicht über mehrere Tage)
    const clock = (ms) => {
      const d = new Date(ms + off * 1000);
      return `${WEEKDAYS[d.getUTCDay()]} ${String(d.getUTCHours()).padStart(2, '0')}:00`;
    };
    const span = (list) => `${clock(list[0])} bis ${clock(list[list.length - 1] + 3600e3)}`;

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
        ['Nass', summary.wet ? span([summary.wetFrom, summary.wetTo]) : '–'],
        ['Wind', summary.maxGust === null ? 'keine Angabe' : `Böen bis ${Math.round(summary.maxGust)} km/h`],
      ];
      if (summary.thunder.length) lines.push(['Gewitter', `möglich ${span(summary.thunder)}`]);
      if (summary.fog.length) lines.push(['Nebel', span(summary.fog)]);
      lines.push(['Konfidenz', summary.confText]);
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
      if (!isWet(x.kind)) return;
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
    const wide = w / u > 110;
    const every = hrs.length > 30 ? (wide ? 3 : 6) : wide ? 2 : 3;
    ctx.fillStyle = 'rgba(255,255,255,0.75)';
    ctx.textAlign = 'center';
    ctx.font = `500 ${u * 2.9}px system-ui, sans-serif`;
    hrs.forEach((x, i) => {
      const local = new Date(x.ms + off * 1000);
      const hour = local.getUTCHours();
      if (hour === 0 && i > 0) {
        // Tageswechsel: Trennlinie mit Wochentag
        ctx.fillStyle = 'rgba(255,255,255,0.45)';
        ctx.fillRect(xs(i) - u * 0.12, y0 - u, u * 0.24, y1 - y0 + u * 2);
        ctx.textAlign = 'left';
        ctx.fillText(WEEKDAYS[local.getUTCDay()], xs(i) + u * 1, y0 + u * 2.2);
        ctx.textAlign = 'center';
        ctx.fillStyle = 'rgba(255,255,255,0.75)';
      }
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
  const wetHours = hours.filter((x) => isWet(x.kind));
  const gusts = hours.map((x) => x.gust ?? x.wind).filter((v) => v !== null && v !== undefined);
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
    maxGust: gusts.length ? Math.max(...gusts) : null,
    thunder: hours.filter((x) => x.kind === 'thunder').map((x) => x.ms),
    fog: hours.filter((x) => x.kind === 'fog').map((x) => x.ms),
    confText: `meist ${main} (${top}/${hours.length} Std.)`,
  };
}
