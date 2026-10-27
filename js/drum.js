/**
 * 공기 혼합식 로또 추첨기 물리 시뮬레이션.
 *
 * 좌표: 추첨기 원통 중심 (0,0), 반지름 1. y 는 아래쪽이 + (중력 방향).
 * 배출구는 원통 맨 위 (0,-1). 추첨 단계가 되면 배출구가 공기를 빨아들여
 * 가장 먼저 배출구에 닿은 공이 관을 타고 올라가 당첨 번호가 됩니다.
 *
 *  DrumSim     — 물리 + 추첨 진행 (DOM 없음, Node 에서도 실행 가능)
 *  LottoMachine — 캔버스 렌더링 + 애니메이션 루프
 */
(function (global) {

  const R_BALL = 0.08;
  const N_BALLS = 45;
  const GRAVITY = 3.0;
  const SUBSTEP = 1 / 480;
  const E_BALL = 0.88;        // 공끼리 반발 계수
  const E_WALL = 0.75;        // 벽 반발 계수
  const AIR_LEVELS = { 1: 22, 2: 28, 3: 35 };
  const EXIT = { x: 0, y: -1 };
  // 배출 후 관 경로: 배출구 → 위로 → 오른쪽 화면 밖
  const TUBE_PATH = [{ x: 0, y: -1 + R_BALL }, { x: 0, y: -1.32 }, { x: 1.4, y: -1.32 }];
  const TUBE_SPEED = 2.4;


  function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }


  function cryptoSeed() {
    try {
      const a = new Uint32Array(1);
      (global.crypto || global.msCrypto).getRandomValues(a);
      return a[0];
    } catch (e) {
      return (Math.random() * 4294967296) >>> 0;
    }
  }


  class DrumSim {

    constructor(opts = {}) {
      this.rng = opts.rng || mulberry32(cryptoSeed());
      this.airLevel = 2;
      this.mixFirst = opts.mixFirst ?? 5;
      this.mixBetween = opts.mixBetween ?? 2.2;
      this.drawCount = opts.drawCount ?? 7;     // 6개 + 보너스
      this.onCapture = null;                    // (n, index) 배출구에 빨려 들어간 순간
      this.onBall = null;                       // (n, index) 관을 지나 결과로 나온 순간
      this.onDone = null;                       // (drawnInOrder)
      this.onPhase = null;                      // (phase)
      this.reset();
    }


    /** 공을 번호 순서대로 원통 바닥에 쌓은 상태 (실제 추첨 전 투입 상태처럼) */
    reset() {
      this.balls = [];
      const r = R_BALL, gap = r * 2.02;
      const slots = [];
      for (let row = 0; row < 20; row++) {
        const y = 1 - r - 0.01 - row * gap * 0.87;
        const off = row % 2 ? gap / 2 : 0;
        for (let x = -1; x <= 1; x += gap) {
          const px = x + off;
          if (Math.hypot(px, y) <= 1 - r - 0.01) slots.push({ x: px, y });
        }
      }
      slots.sort((a, b) => b.y - a.y || a.x - b.x);
      for (let i = 0; i < N_BALLS; i++) {
        const s = slots[i];
        this.balls.push({ n: i + 1, x: s.x, y: s.y, vx: 0, vy: 0, state: 'drum', path: 0 });
      }
      this.air = 0;
      this.time = 0;
      this.phase = 'idle';
      this.timer = 0;
      this.captureT = 0;
      this.drawn = [];
      this.transport = null;
      this.phases = [this.rng() * 6.28, this.rng() * 6.28, this.rng() * 6.28, this.rng() * 6.28];
    }


    get running() {
      return this.phase !== 'idle' && this.phase !== 'done';
    }


    setPhase(p) {
      this.phase = p;
      if (this.onPhase) this.onPhase(p);
    }


    begin() {
      if (this.running) return;
      if (this.phase === 'done' || this.balls.some(b => b.state !== 'drum')) this.reset();
      this.phases = [this.rng() * 6.28, this.rng() * 6.28, this.rng() * 6.28, this.rng() * 6.28];
      this.air = AIR_LEVELS[this.airLevel];
      this.timer = this.mixFirst;
      this.setPhase('mix');
    }


    setAirLevel(level) {
      this.airLevel = level;
      if (this.air > 0) this.air = AIR_LEVELS[level];
    }


    /** 0~1 범위의 매끄러운 난류 */
    noise(x, y, t, k) {
      const p = this.phases;
      return 0.5 + 0.5 * (
        0.45 * Math.sin(3.1 * x + 1.9 * t + p[k & 3]) +
        0.30 * Math.sin(5.7 * y - 2.7 * t + p[(k + 1) & 3]) +
        0.25 * Math.sin(2.3 * (x + y) + 4.3 * t + p[(k + 2) & 3]));
    }


    update(dt) {
      let n = Math.ceil(dt / SUBSTEP);
      const h = dt / n;
      while (n-- > 0) this.substep(h);
    }


    substep(h) {
      this.time += h;
      const r = R_BALL, rng = this.rng, air = this.air, t = this.time;
      const active = this.balls.filter(b => b.state === 'drum');
      const capturing = this.phase === 'capture';
      if (capturing) this.captureT += h;
      const swirl = Math.sin(t * 0.37 + this.phases[3]) * 1.4;

      // 힘 + 적분
      for (const b of active) {
        let ax = 0, ay = GRAVITY;
        if (air > 0) {
          // 바닥 가운데 송풍구에서 솟구치는 바람 기둥 (좌우로 천천히 흔들림)
          // → 공이 가운데로 솟구쳤다가 양옆으로 떨어지며 순환
          const jx = 0.22 * Math.sin(t * 0.9 + this.phases[0]) + 0.12 * Math.sin(t * 2.3 + this.phases[1]);
          const dx = (b.x - jx) / 0.32;
          const col = Math.exp(-dx * dx);
          const low = Math.min(1, Math.max(0, (b.y + 0.2) / 0.8));
          const gust = 0.55 + 0.9 * this.noise(b.x, b.y, t, 0);
          ay -= air * col * (0.35 + low) * gust;
          ax += air * 0.25 * (this.noise(b.y, b.x, t, 1) - 0.5);
          // 원통 안을 도는 소용돌이
          ax += -b.y * swirl;
          ay += b.x * swirl;
          // 미세한 무작위 충격
          ax += (rng() - 0.5) * 8;
          ay += (rng() - 0.5) * 8;
        }
        if (capturing) {
          // 배출구 흡입: 가까울수록, 오래 기다릴수록 강하게
          const dx = EXIT.x - b.x, dy = EXIT.y - b.y, d = Math.hypot(dx, dy);
          const reach = 0.55;
          if (d < reach) {
            const s = (7 + 5 * this.captureT) * (1 - d / reach);
            ax += dx / d * s;
            ay += dy / d * s;
          }
        }
        const drag = air > 0 ? 0.12 : 1.6;
        b.vx += (ax - b.vx * drag) * h;
        b.vy += (ay - b.vy * drag) * h;
        b.x += b.vx * h;
        b.y += b.vy * h;

        // 원통 벽
        const d = Math.hypot(b.x, b.y), max = 1 - r;
        if (d > max) {
          const nx = b.x / d, ny = b.y / d;
          b.x = nx * max;
          b.y = ny * max;
          const vn = b.vx * nx + b.vy * ny;
          if (vn > 0) {
            b.vx -= (1 + E_WALL) * vn * nx;
            b.vy -= (1 + E_WALL) * vn * ny;
            b.vx *= 0.985;
            b.vy *= 0.985;
          }
        }
      }

      // 공끼리 충돌
      const minD = 2 * r, minD2 = minD * minD;
      for (let i = 0; i < active.length; i++) {
        const a = active[i];
        for (let j = i + 1; j < active.length; j++) {
          const b = active[j];
          const dx = b.x - a.x, dy = b.y - a.y;
          const d2 = dx * dx + dy * dy;
          if (d2 >= minD2 || d2 === 0) continue;
          const d = Math.sqrt(d2), nx = dx / d, ny = dy / d;
          const push = (minD - d) / 2;
          a.x -= nx * push; a.y -= ny * push;
          b.x += nx * push; b.y += ny * push;
          const vn = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny;
          if (vn < 0) {
            const jimp = -(1 + E_BALL) * vn / 2;
            a.vx -= jimp * nx; a.vy -= jimp * ny;
            b.vx += jimp * nx; b.vy += jimp * ny;
          }
        }
      }

      // 배출구 포획
      if (capturing) {
        for (const b of active) {
          if (b.y < EXIT.y + r * 1.7 && Math.abs(b.x - EXIT.x) < r * 0.9) {
            this.capture(b);
            break;
          }
        }
      }

      // 관 이동
      if (this.transport) {
        const tb = this.transport;
        tb.path += TUBE_SPEED * h;
        const pos = pathPoint(tb.path);
        tb.x = pos.x; tb.y = pos.y;
        if (pos.end) {
          tb.state = 'out';
          this.transport = null;
          const idx = this.drawn.length - 1;
          if (this.onBall) this.onBall(tb.n, idx);
          if (this.drawn.length >= this.drawCount) {
            this.air = 0;
            this.setPhase('done');
            if (this.onDone) this.onDone(this.drawn.slice());
          } else {
            this.timer = this.mixBetween;
            this.setPhase('mix');
          }
        }
      }

      // 진행 타이머
      if (this.phase === 'mix') {
        this.timer -= h;
        if (this.timer <= 0) {
          this.captureT = 0;
          this.setPhase('capture');
        }
      }
    }


    capture(b) {
      b.state = 'tube';
      b.path = 0;
      b.vx = b.vy = 0;
      this.transport = b;
      this.drawn.push(b.n);
      this.setPhase('transport');
      if (this.onCapture) this.onCapture(b.n, this.drawn.length - 1);
    }
  }


  function pathPoint(dist) {
    let left = dist;
    for (let i = 1; i < TUBE_PATH.length; i++) {
      const a = TUBE_PATH[i - 1], b = TUBE_PATH[i];
      const len = Math.hypot(b.x - a.x, b.y - a.y);
      if (left <= len) {
        const f = left / len;
        return { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f, end: false };
      }
      left -= len;
    }
    const last = TUBE_PATH[TUBE_PATH.length - 1];
    return { x: last.x, y: last.y, end: true };
  }


  // ───────────────────────── 렌더링 ─────────────────────────

  const VIEW = { x0: -1.3, x1: 1.3, y0: -1.5, y1: 1.32 };
  const BALL_COLORS = [
    null,
    { c: '#f6c12a', d: '#c99512', t: '#3d2b00' },
    { c: '#3a8ee6', d: '#1f63ad', t: '#fff' },
    { c: '#ec4f45', d: '#b72b22', t: '#fff' },
    { c: '#9a9a9a', d: '#666', t: '#fff' },
    { c: '#3fb15a', d: '#25803b', t: '#fff' },
  ];
  const decOf = n => (n <= 10 ? 1 : n <= 20 ? 2 : n <= 30 ? 3 : n <= 40 ? 4 : 5);


  class LottoMachine {

    constructor(canvas, callbacks = {}) {
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d');
      this.cb = callbacks;
      this.speed = 1;
      this.visible = false;
      this.raf = 0;
      this.last = 0;
      this.sprites = [];
      this.sim = new DrumSim();
      this.bindSim();
      this.resize();
      if (global.ResizeObserver) new ResizeObserver(() => { this.resize(); this.draw(); }).observe(canvas.parentElement);
    }


    bindSim() {
      const s = this.sim, cb = this.cb;
      s.onPhase = p => cb.onPhase && cb.onPhase(p);
      s.onCapture = (n, i) => cb.onCapture && cb.onCapture(n, i);
      s.onBall = (n, i) => cb.onBall && cb.onBall(n, i);
      s.onDone = d => { cb.onDone && cb.onDone(d); };
    }


    resize() {
      const parent = this.canvas.parentElement;
      const w = Math.max(200, Math.min(parent.clientWidth, 560));
      const h = w * (VIEW.y1 - VIEW.y0) / (VIEW.x1 - VIEW.x0);
      const dpr = Math.min(global.devicePixelRatio || 1, 2);
      this.canvas.style.width = w + 'px';
      this.canvas.style.height = h + 'px';
      this.canvas.width = Math.round(w * dpr);
      this.canvas.height = Math.round(h * dpr);
      this.scale = this.canvas.width / (VIEW.x1 - VIEW.x0);
      this.buildSprites();
    }


    buildSprites() {
      const rp = R_BALL * this.scale;
      const size = Math.ceil(rp * 2 + 4);
      this.sprites = [];
      for (let n = 1; n <= N_BALLS; n++) {
        const cv = document.createElement('canvas');
        cv.width = cv.height = size;
        const g = cv.getContext('2d');
        const c = BALL_COLORS[decOf(n)];
        const cx = size / 2, cy = size / 2;
        const grad = g.createRadialGradient(cx - rp * 0.35, cy - rp * 0.4, rp * 0.1, cx, cy, rp);
        grad.addColorStop(0, '#ffffff');
        grad.addColorStop(0.18, c.c);
        grad.addColorStop(1, c.d);
        g.fillStyle = grad;
        g.beginPath(); g.arc(cx, cy, rp, 0, Math.PI * 2); g.fill();
        g.fillStyle = c.t;
        g.font = `800 ${Math.round(rp * 1.05)}px "Noto Sans KR", system-ui, sans-serif`;
        g.textAlign = 'center';
        g.textBaseline = 'middle';
        g.fillText(String(n), cx, cy + rp * 0.06);
        this.sprites[n] = cv;
      }
    }


    X(x) { return (x - VIEW.x0) * this.scale; }
    Y(y) { return (y - VIEW.y0) * this.scale; }


    setVisible(v) {
      this.visible = v;
      if (v) { this.resize(); this.loop(); }
    }


    setSpeed(s) { this.speed = s; }
    setAirLevel(l) { this.sim.setAirLevel(l); }
    get running() { return this.sim.running; }


    start() {
      this.sim.begin();
      this.loop();
    }


    loop() {
      if (this.raf) return;
      this.last = performance.now();
      const tick = now => {
        this.raf = 0;
        const dt = Math.min((now - this.last) / 1000, 1 / 20);
        this.last = now;
        this.sim.update(dt * this.speed);
        this.draw();
        // 추첨 중이거나 공이 아직 움직이는 동안만 계속 그림 (멈춰 있으면 배터리 절약)
        const settling = this.sim.balls.some(b => b.state === 'drum' && Math.abs(b.vy) + Math.abs(b.vx) > 0.02);
        if (this.sim.running || settling) this.raf = requestAnimationFrame(tick);
      };
      this.raf = requestAnimationFrame(tick);
    }


    draw() {
      const g = this.ctx, s = this.scale, sim = this.sim;
      const W = this.canvas.width, H = this.canvas.height;
      g.clearRect(0, 0, W, H);
      const dark = global.matchMedia && global.matchMedia('(prefers-color-scheme: dark)').matches;
      const ox = this.X(0), oy = this.Y(0), R = s;

      // 받침대
      g.fillStyle = dark ? '#3a3631' : '#3b3833';
      g.beginPath();
      g.moveTo(this.X(-0.5), this.Y(0.86));
      g.lineTo(this.X(0.5), this.Y(0.86));
      g.lineTo(this.X(0.78), this.Y(1.3));
      g.lineTo(this.X(-0.78), this.Y(1.3));
      g.closePath();
      g.fill();
      g.fillStyle = sim.air > 0 ? '#c8341f' : '#777';
      g.beginPath(); g.arc(this.X(0.55), this.Y(1.16), s * 0.035, 0, Math.PI * 2); g.fill();

      // 배출 관 (뒤쪽)
      g.lineCap = 'round';
      g.lineJoin = 'round';
      g.strokeStyle = dark ? 'rgba(180,200,230,.22)' : 'rgba(120,150,190,.25)';
      g.lineWidth = R_BALL * 2.5 * s;
      g.beginPath();
      g.moveTo(this.X(0), this.Y(-0.96));
      g.lineTo(this.X(0), this.Y(-1.32));
      g.lineTo(this.X(1.5), this.Y(-1.32));
      g.stroke();

      // 원통 유리
      const glass = g.createRadialGradient(ox - R * 0.3, oy - R * 0.35, R * 0.1, ox, oy, R);
      glass.addColorStop(0, dark ? 'rgba(200,220,255,.10)' : 'rgba(255,255,255,.75)');
      glass.addColorStop(1, dark ? 'rgba(140,170,220,.10)' : 'rgba(190,210,235,.35)');
      g.fillStyle = glass;
      g.beginPath(); g.arc(ox, oy, R, 0, Math.PI * 2); g.fill();

      // 바람 줄기
      if (sim.air > 0) {
        g.strokeStyle = dark ? 'rgba(255,255,255,.12)' : 'rgba(80,120,170,.16)';
        g.lineWidth = Math.max(1, s * 0.012);
        for (let i = 0; i < 9; i++) {
          const x = -0.6 + i * 0.15;
          const ph = (sim.time * 1.7 + i * 0.37) % 1;
          const y0 = 0.9 - ph * 0.9, y1 = y0 - 0.22;
          if (Math.hypot(x, y0) > 0.97) continue;
          g.beginPath();
          g.moveTo(this.X(x + Math.sin(sim.time * 3 + i) * 0.03), this.Y(y0));
          g.lineTo(this.X(x), this.Y(y1));
          g.stroke();
        }
      }

      // 공
      const rp = R_BALL * s;
      for (const b of sim.balls) {
        if (b.state === 'out') continue;
        const sp = this.sprites[b.n];
        g.drawImage(sp, this.X(b.x) - sp.width / 2, this.Y(b.y) - sp.height / 2);
      }

      // 원통 테두리 + 반사광
      g.strokeStyle = dark ? 'rgba(220,230,245,.55)' : 'rgba(90,110,140,.55)';
      g.lineWidth = Math.max(2, s * 0.025);
      g.beginPath(); g.arc(ox, oy, R + g.lineWidth / 2, 0, Math.PI * 2); g.stroke();
      g.strokeStyle = 'rgba(255,255,255,.55)';
      g.lineWidth = Math.max(2, s * 0.03);
      g.beginPath(); g.arc(ox, oy, R * 0.88, Math.PI * 1.08, Math.PI * 1.38); g.stroke();

      // 배출구 링
      g.strokeStyle = sim.phase === 'capture' ? '#c8341f' : (dark ? 'rgba(220,230,245,.7)' : 'rgba(90,110,140,.7)');
      g.lineWidth = Math.max(2, s * 0.03);
      g.beginPath();
      g.moveTo(this.X(-R_BALL * 1.3), this.Y(-1.0));
      g.lineTo(this.X(R_BALL * 1.3), this.Y(-1.0));
      g.stroke();

      // 관 테두리 (앞쪽)
      g.strokeStyle = dark ? 'rgba(220,230,245,.35)' : 'rgba(90,110,140,.35)';
      g.lineWidth = Math.max(1, s * 0.012);
      const hw = R_BALL * 1.25;
      g.beginPath();
      g.moveTo(this.X(-hw), this.Y(-1.0)); g.lineTo(this.X(-hw), this.Y(-1.32 - hw));
      g.lineTo(this.X(1.5), this.Y(-1.32 - hw));
      g.moveTo(this.X(hw), this.Y(-1.0)); g.lineTo(this.X(hw), this.Y(-1.32 + hw));
      g.lineTo(this.X(1.5), this.Y(-1.32 + hw));
      g.stroke();
      void rp;
    }
  }


  global.LottoDrum = { DrumSim, LottoMachine, mulberry32, AIR_LEVELS };
  if (typeof module !== 'undefined' && module.exports) module.exports = global.LottoDrum;

})(typeof window !== 'undefined' ? window : globalThis);
