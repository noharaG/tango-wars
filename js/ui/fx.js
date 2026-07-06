window.TW = window.TW || {};

// TW.fx — #fx-canvas(パーティクル)と #cutin(カットイン)を使った演出エフェクト。
// SPEC_CORE §4 TW.fx 契約 + SPEC_UI §3 実装メモ を実装。DOM依存(battle-ui/他画面から呼ばれる)。
// 注: #fx-canvas / #cutin の配置・カットインの帯アニメ(.cutin-show)は css/style.css 側で
// 既に定義済み(エフェクト基盤として共通レイヤに置かれている)。ここではパーティクル描画ロジックと
// popScore/shake/flash 用の見た目(css/battle.css)だけを担当する。
(function () {
  "use strict";

  // ---------- パーティクル基盤(canvas) ----------

  var canvas = null;
  var ctx = null;
  var particles = [];
  var rafId = null;

  function getCanvas() {
    if (!canvas) {
      canvas = document.getElementById("fx-canvas");
      if (canvas) {
        ctx = canvas.getContext("2d");
        resizeCanvas();
        window.addEventListener("resize", resizeCanvas);
      }
    }
    return canvas;
  }

  function resizeCanvas() {
    if (!canvas) return;
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
  }

  function ensureLoop() {
    if (rafId === null) {
      rafId = window.requestAnimationFrame(step);
    }
  }

  function step() {
    rafId = null;
    if (!ctx || !canvas) {
      particles.length = 0;
      return;
    }
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    var next = [];
    for (var i = 0; i < particles.length; i++) {
      var p = particles[i];
      p.life -= 1;
      if (p.life <= 0) continue;
      p.x += p.vx;
      p.y += p.vy;
      p.vy += p.gravity;
      p.vx *= p.drag;
      p.vy *= p.drag;
      p.rot += p.vrot;

      var alpha = Math.max(0, Math.min(1, p.life / p.maxLife));
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot);
      ctx.fillStyle = p.color;
      if (p.shape === "rect") {
        ctx.fillRect(-p.size / 2, -p.size / 4, p.size, p.size / 2);
      } else {
        ctx.beginPath();
        ctx.arc(0, 0, p.size / 2, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();

      next.push(p);
    }
    particles = next;
    // rAFループは粒が無いとき止める(SPEC_CORE §4 / SPEC_UI §3)
    if (particles.length > 0) ensureLoop();
  }

  var BURST_COLORS = ["#3B82F6", "#F59E0B", "#EC4899", "#22C55E"];
  var CONFETTI_COLORS = ["#F59E0B", "#EC4899", "#3B82F6", "#22C55E", "#A855F7"];

  // TW.fx.burst(x, y, color) — 座標に弾けるパーティクル
  function burst(x, y, color) {
    var c = getCanvas();
    if (!c) return;
    var count = 18;
    for (var i = 0; i < count; i++) {
      var ang = Math.random() * Math.PI * 2;
      var spd = 2 + Math.random() * 4.5;
      particles.push({
        x: x,
        y: y,
        vx: Math.cos(ang) * spd,
        vy: Math.sin(ang) * spd,
        gravity: 0.15,
        drag: 0.95,
        rot: 0,
        vrot: (Math.random() - 0.5) * 0.3,
        life: 24 + Math.random() * 12,
        maxLife: 36,
        size: 4 + Math.random() * 5,
        shape: "circle",
        color: color || BURST_COLORS[Math.floor(Math.random() * BURST_COLORS.length)]
      });
    }
    ensureLoop();
  }

  // TW.fx.confetti() — 昇級・勝利用の紙吹雪(画面上部から降らせる)
  function confetti() {
    var c = getCanvas();
    if (!c) return;
    var w = c.width || window.innerWidth;
    for (var i = 0; i < 110; i++) {
      var life = 80 + Math.random() * 55;
      particles.push({
        x: Math.random() * w,
        y: -20 - Math.random() * 120,
        vx: (Math.random() - 0.5) * 2.2,
        vy: 2 + Math.random() * 3,
        gravity: 0.05,
        drag: 0.997,
        rot: Math.random() * Math.PI,
        vrot: (Math.random() - 0.5) * 0.25,
        life: life,
        maxLife: life,
        size: 6 + Math.random() * 6,
        shape: "rect",
        color: CONFETTI_COLORS[Math.floor(Math.random() * CONFETTI_COLORS.length)]
      });
    }
    ensureLoop();
  }

  // ---------- スコアポップ(DOM要素・css/battle.css の .fx-popscore アニメで浮上&消える) ----------

  function popScore(x, y, text) {
    var el = document.createElement("div");
    el.className = "fx-popscore";
    el.textContent = text;
    el.style.left = x + "px";
    el.style.top = y + "px";
    document.body.appendChild(el);
    window.setTimeout(function () {
      if (el.parentNode) el.parentNode.removeChild(el);
    }, 750);
  }

  // ---------- shake / flash(対象要素にクラスを一瞬付与するだけの汎用エフェクト) ----------

  function restartAnim(el, cls) {
    el.classList.remove(cls);
    // 強制リフローで同じクラスの再付与でもアニメを最初から再生させる
    void el.offsetWidth;
    el.classList.add(cls);
  }

  function shake(el) {
    if (!el) return;
    restartAnim(el, "fx-shake");
    window.setTimeout(function () {
      el.classList.remove("fx-shake");
    }, 230);
  }

  function flash(el, colorClass) {
    if (!el) return;
    var cls = colorClass || "fx-flash";
    restartAnim(el, cls);
    window.setTimeout(function () {
      el.classList.remove(cls);
    }, 430);
  }

  // ---------- カットイン(#cutin。帯アニメ自体は css/style.css の #cutin.cutin-show 定義) ----------

  var cutinEl = null;
  var cutinTimer = null;

  function cutIn(text) {
    if (!cutinEl) cutinEl = document.getElementById("cutin");
    if (!cutinEl) return;
    window.clearTimeout(cutinTimer);
    cutinEl.classList.remove("cutin-show");
    cutinEl.textContent = text;
    void cutinEl.offsetWidth; // 連続発火時もアニメを最初から再生させるための強制リフロー
    cutinEl.classList.add("cutin-show");
    cutinTimer = window.setTimeout(function () {
      cutinEl.classList.remove("cutin-show");
    }, 650);
  }

  TW.fx = {
    burst: burst,
    popScore: popScore,
    shake: shake,
    flash: flash,
    cutIn: cutIn,
    confetti: confetti
  };
})();
