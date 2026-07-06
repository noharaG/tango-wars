window.TW = window.TW || {};

// TW.bgm — WebAudio先読みスケジューリングによる生成BGM(キック+ベース+アルペジオ)。
// SPEC_ADDICTION §4 を実装。SFX(TW.sfx)とは独立のAudioContext・独立トグル。
(function () {
  "use strict";

  var ctx = null;
  var enabled = true;      // setEnabled() で切替(settings.bgm とは別に即時ミュート用)
  var timerId = null;      // スケジューラの setInterval id (再生中のみ非null)
  var curMode = "battle";  // "battle" | "blitz" — テンポの基準に反映
  var combo = 0;           // setCombo() で更新
  var feverOn = false;     // setFever() で更新(明るい音色に切替)
  var feverSemitones = 0;  // フィーバー毎の半音転調の積み上げ(上限4、start でリセット)

  var LOOKAHEAD_MS = 25;        // スケジューラのポーリング間隔
  var SCHEDULE_AHEAD_SEC = 0.1; // 先読み100ms
  var nextStepTime = 0;   // 次の16分音符の発音時刻(ctx.currentTime基準の絶対時刻)
  var stepIndex = 0;      // 0..15 (1小節=16ステップ)
  var activeNodes = [];   // 発音済み/予約済みノードの管理(stop() での解放用)

  var ROOT_MIDI = 45; // ベースの基準音(A2 付近)。アルペジオはこの1オクターブ上から

  // 4つ打ちキック: 各拍(0,4,8,12)で発音
  var KICK_STEPS = [0, 4, 8, 12];
  // ベース: ルート音のみの簡易リズムパターン(「ルート音パターン」)
  var BASS_STEPS = [0, 3, 6, 8, 11, 12, 14];
  // アルペジオ: メジャーコードの音を16分でぐるぐる回す(半音オフセット、ルート起点)
  var ARP_PATTERN = [0, 4, 7, 12, 7, 4, 0, 4, 7, 12, 7, 4, 0, 4, 7, 4];

  // AudioContext は初回のユーザー操作(対局開始タップ等)内で生成される前提
  function ensureCtx() {
    if (!ctx) {
      var AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      try {
        ctx = new AC();
      } catch (e) {
        return null;
      }
    }
    if (ctx.state === "suspended") {
      try {
        ctx.resume().catch(function () {});
      } catch (e) {
        // 一部環境で resume が例外を投げても無視
      }
    }
    return ctx;
  }

  // 現在ミュートすべきか: setEnabled(false) または settings.bgm=false
  function isMuted() {
    if (!enabled) return true;
    if (typeof TW.store !== "undefined" && TW.store.state && TW.store.state.settings &&
        TW.store.state.settings.bgm === false) {
      return true;
    }
    return false;
  }

  function midiToFreq(m) {
    return 440 * Math.pow(2, (m - 69) / 12);
  }

  // 基本112BPM(blitzは132) + combo×1.5、上限160
  function currentBpm() {
    var base = curMode === "blitz" ? 132 : 112;
    var bpm = base + Math.max(0, combo) * 1.5;
    return Math.min(160, Math.max(base, bpm));
  }

  // 発音済みノードを記録(stop() での一括解放用)
  function track(nodes, stopAt) {
    activeNodes.push({ nodes: nodes, stopAt: stopAt });
  }

  // 発音が終わって不要になったノード参照を掃除(配列が無限に増えないように)
  function pruneNodes(now) {
    for (var i = activeNodes.length - 1; i >= 0; i--) {
      if (activeNodes[i].stopAt < now - 0.05) {
        activeNodes.splice(i, 1);
      }
    }
  }

  // キック: サイン波の短打、高→低に落ちる典型的なシンセキック
  function scheduleKick(t) {
    var dur = 0.16;
    var osc = ctx.createOscillator();
    var gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.setValueAtTime(150, t);
    osc.frequency.exponentialRampToValueAtTime(45, t + dur);
    gain.gain.setValueAtTime(0.32, t);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(t);
    osc.stop(t + dur + 0.02);
    track([osc, gain], t + dur + 0.02);
  }

  // ベース: ルート音パターン。フィーバー中は波形をsine→sawtoothに切替+フィルタ開放で明るく
  function scheduleBass(t, dur) {
    var freq = midiToFreq(ROOT_MIDI + feverSemitones);
    var osc = ctx.createOscillator();
    var filter = ctx.createBiquadFilter();
    var gain = ctx.createGain();
    osc.type = feverOn ? "sawtooth" : "sine";
    filter.type = "lowpass";
    filter.frequency.value = feverOn ? 2400 : 900;
    osc.frequency.setValueAtTime(freq, t);
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(feverOn ? 0.18 : 0.12, t + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(filter);
    filter.connect(gain);
    gain.connect(ctx.destination);
    osc.start(t);
    osc.stop(t + dur + 0.02);
    track([osc, filter, gain], t + dur + 0.02);
  }

  // アルペジオ: 矩形波・音量小さめ。フィーバー中はフィルタを開いて明るく
  function scheduleArp(t, semitoneOffset, dur) {
    var freq = midiToFreq(ROOT_MIDI + 12 + feverSemitones + semitoneOffset);
    var osc = ctx.createOscillator();
    var filter = ctx.createBiquadFilter();
    var gain = ctx.createGain();
    osc.type = "square";
    filter.type = "lowpass";
    filter.frequency.value = feverOn ? 6000 : 1600;
    osc.frequency.setValueAtTime(freq, t);
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(feverOn ? 0.07 : 0.045, t + 0.005);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(filter);
    filter.connect(gain);
    gain.connect(ctx.destination);
    osc.start(t);
    osc.stop(t + dur + 0.02);
    track([osc, filter, gain], t + dur + 0.02);
  }

  // 1ステップ(16分音符)分の発音をスケジュール
  function scheduleStep(step, t, stepDur) {
    if (KICK_STEPS.indexOf(step) !== -1) {
      scheduleKick(t);
    }
    if (BASS_STEPS.indexOf(step) !== -1) {
      scheduleBass(t, stepDur * 1.6);
    }
    var arpOffset = ARP_PATTERN[step];
    if (arpOffset != null) {
      scheduleArp(t, arpOffset, stepDur * 0.85);
    }
  }

  // 先読みスケジューラ本体(lookahead 100ms)。setTimeoutループではなく
  // AudioContext の時刻を基準に先読みして予約することで再生ズレを防ぐ。
  function schedulerTick() {
    if (!ctx) return;
    var now = ctx.currentTime;
    while (nextStepTime < now + SCHEDULE_AHEAD_SEC) {
      var bpm = currentBpm();
      var stepDur = (60 / bpm) / 4; // 16分音符の長さ(秒)
      if (!isMuted()) {
        scheduleStep(stepIndex, nextStepTime, stepDur);
      }
      stepIndex = (stepIndex + 1) % 16;
      nextStepTime += stepDur;
    }
    pruneNodes(now);
  }

  // TW.bgm.start(mode) — mode: "battle"|"blitz"。多重startに耐える(既存を止めてから開始)
  function start(mode) {
    stop();
    var ac = ensureCtx();
    if (!ac) return;
    curMode = mode === "blitz" ? "blitz" : "battle";
    combo = 0;
    feverOn = false;
    feverSemitones = 0;
    stepIndex = 0;
    nextStepTime = ac.currentTime + 0.05;
    schedulerTick();
    timerId = window.setInterval(schedulerTick, LOOKAHEAD_MS);
  }

  // TW.bgm.stop() — スケジューラ停止+発音中/予約済みの全ノードを即時停止・解放
  function stop() {
    if (timerId != null) {
      window.clearInterval(timerId);
      timerId = null;
    }
    var now = ctx ? ctx.currentTime : 0;
    activeNodes.forEach(function (entry) {
      entry.nodes.forEach(function (n) {
        try {
          if (typeof n.stop === "function") n.stop(now);
        } catch (e) {
          // 既に停止済み等は無視
        }
        try {
          n.disconnect();
        } catch (e) {
          // 無視
        }
      });
    });
    activeNodes = [];
  }

  // TW.bgm.setCombo(n) — コンボ数。テンポに反映(次スケジュール分から)
  function setCombo(n) {
    combo = typeof n === "number" && n > 0 ? n : 0;
  }

  // TW.bgm.setFever(on) — true になるたびキーを半音転調(上限+4)。false は明るい音色を解除するだけ
  function setFever(on) {
    feverOn = !!on;
    if (feverOn) {
      feverSemitones = Math.min(4, feverSemitones + 1);
    }
  }

  // TW.bgm.setEnabled(bool) — false で以後の発音を即ミュート(settings.bgm=false と同義に扱う)
  function setEnabled(v) {
    enabled = !!v;
  }

  window.TW.bgm = {
    start: start,
    stop: stop,
    setCombo: setCombo,
    setFever: setFever,
    setEnabled: setEnabled
  };
})();
