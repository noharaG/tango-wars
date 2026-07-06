window.TW = window.TW || {};

// TW.sfx — WebAudio(OscillatorNode/GainNode)によるシンセ効果音。外部アセット無し。
// SPEC_CORE §4 TW.sfx 契約 + タスク指示(playの第2引数でpitch可変)を実装。
(function () {
  "use strict";

  var ctx = null;      // AudioContext は初回のユーザー操作内で生成
  var enabled = true;

  // ユーザー操作(タップ等)のハンドラ内から呼ばれることを前提に遅延生成・resume。
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
      // resume は非同期。失敗しても再生自体は試みる(ブラウザによっては即再開される)。
      try {
        ctx.resume().catch(function () {});
      } catch (e) {
        // 一部環境で resume が例外を投げても無視
      }
    }
    return ctx;
  }

  // 単純な1音(サイン/矩形/三角/ノコギリ波)を鳴らす。
  // t0: 現在からの相対開始時刻(秒)、dur: 長さ(秒)
  // opts.freqEnd を渡すと周波数をスイープさせる(下降音・上昇音向け)。
  function tone(t0, freq, dur, opts) {
    opts = opts || {};
    var type = opts.type || "sine";
    var gainPeak = opts.gain != null ? opts.gain : 0.2;
    var freqEnd = opts.freqEnd;
    var t = ctx.currentTime + t0;

    var osc = ctx.createOscillator();
    var gain = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(Math.max(1, freq), t);
    if (freqEnd != null) {
      osc.frequency.exponentialRampToValueAtTime(Math.max(1, freqEnd), t + dur);
    }
    // クリック防止のごく短いアタック + 指数的な減衰
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(gainPeak, t + Math.min(0.02, dur / 4));
    gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);

    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(t);
    osc.stop(t + dur + 0.02);
  }

  // ノイズバースト(ドラムロール・シャリシャリ音向け)。都度バッファ生成なので多重再生でも干渉しない。
  function noiseBurst(t0, dur, opts) {
    opts = opts || {};
    var t = ctx.currentTime + t0;
    var size = Math.max(1, Math.floor(ctx.sampleRate * dur));
    var buffer = ctx.createBuffer(1, size, ctx.sampleRate);
    var data = buffer.getChannelData(0);
    for (var i = 0; i < size; i++) {
      data[i] = Math.random() * 2 - 1;
    }

    var src = ctx.createBufferSource();
    src.buffer = buffer;

    var filter = ctx.createBiquadFilter();
    filter.type = opts.filterType || "bandpass";
    filter.frequency.value = opts.filterFreq || 1200;

    var gain = ctx.createGain();
    var gainPeak = opts.gain != null ? opts.gain : 0.15;
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(gainPeak, t + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);

    src.connect(filter);
    filter.connect(gain);
    gain.connect(ctx.destination);
    src.start(t);
    src.stop(t + dur + 0.02);
  }

  // 各効果音の定義。opts は play() の第2引数がそのまま渡る({pitch: combo} 等)。
  var SOUNDS = {
    // 短いクリック
    tap: function () {
      tone(0, 900, 0.05, { type: "square", gain: 0.12 });
    },

    // 明るい上昇2音。{pitch: combo} でコンボ数に応じて基準音程を上げる。
    correct: function (opts) {
      var combo = opts && typeof opts.pitch === "number" ? opts.pitch : 0;
      var base = 660 + Math.min(Math.max(combo, 0), 20) * 14;
      tone(0, base, 0.09, { type: "triangle", gain: 0.18 });
      tone(0.09, base * 1.5, 0.13, { type: "triangle", gain: 0.16 });
    },

    // 低い下降音
    wrong: function () {
      tone(0, 260, 0.22, { type: "sawtooth", gain: 0.15, freqEnd: 110 });
    },

    // キラン(コンボ)
    combo: function () {
      tone(0, 1200, 0.05, { type: "sine", gain: 0.15 });
      tone(0.05, 1760, 0.09, { type: "sine", gain: 0.15 });
    },

    // 派手なファンファーレ短(フィーバー発動)
    fever: function () {
      [440, 554.37, 659.25, 880].forEach(function (f, i) {
        tone(i * 0.02, f, 0.35, { type: "sawtooth", gain: 0.11 });
      });
      tone(0.28, 1320, 0.18, { type: "square", gain: 0.15 });
    },

    // 勝利ジングル3和音 + 上昇の一撃
    win: function () {
      tone(0, 523.25, 0.5, { type: "triangle", gain: 0.17 }); // C5
      tone(0, 659.25, 0.5, { type: "triangle", gain: 0.14 }); // E5
      tone(0, 783.99, 0.55, { type: "triangle", gain: 0.14 }); // G5
      tone(0.18, 1046.5, 0.4, { type: "triangle", gain: 0.16 }); // C6
    },

    // 短い残念音
    lose: function () {
      tone(0, 300, 0.28, { type: "sine", gain: 0.15, freqEnd: 190 });
      tone(0.14, 220, 0.32, { type: "sine", gain: 0.11, freqEnd: 140 });
    },

    // 豪華ファンファーレ(昇級)
    levelup: function () {
      [523.25, 659.25, 783.99, 1046.5, 1318.5].forEach(function (f, i) {
        tone(i * 0.09, f, 0.24, { type: "triangle", gain: 0.16 });
      });
      tone(0.36, 1318.5, 0.5, { type: "sine", gain: 0.12 });
      tone(0.36, 1046.5, 0.5, { type: "sine", gain: 0.1 });
    },

    // ドラムロール的 → 最後にアクセント(ガチャ)
    gacha: function () {
      for (var i = 0; i < 8; i++) {
        noiseBurst(i * 0.07, 0.05, { gain: 0.1, filterFreq: 2000 + i * 60 });
      }
      tone(0.62, 880, 0.2, { type: "square", gain: 0.17 });
    },

    // ポコン+キラ(捕獲)
    capture: function () {
      tone(0, 440, 0.09, { type: "sine", gain: 0.17 }); // ポコン
      tone(0.09, 1200, 0.07, { type: "triangle", gain: 0.12 }); // キラ
      tone(0.14, 1600, 0.09, { type: "triangle", gain: 0.1 });
    },

    // キラキラアルペジオ
    kira: function () {
      [880, 1108.73, 1318.5, 1760].forEach(function (f, i) {
        tone(i * 0.06, f, 0.13, { type: "sine", gain: 0.13 });
      });
    }
  };

  // TW.sfx.play(name) — name: "tap","correct","wrong","combo","fever","win","lose","levelup","gacha","capture","kira"
  // opts は任意(例: play("correct", { pitch: combo }))。
  function play(name, opts) {
    if (!enabled) return;
    var ac = ensureCtx();
    if (!ac) return;
    var fn = SOUNDS[name];
    if (!fn) return;
    try {
      fn(opts);
    } catch (e) {
      // 再生失敗時も呼び出し側をクラッシュさせない
    }
  }

  // setEnabled(false) で以後の play() を全ミュート
  function setEnabled(v) {
    enabled = !!v;
  }

  // speechSynthesis で en-US 読み上げ。使えない環境・失敗時は黙って何もしない。
  function speak(word) {
    try {
      if (!("speechSynthesis" in window) || typeof SpeechSynthesisUtterance === "undefined") return;
      var u = new SpeechSynthesisUtterance(String(word));
      u.lang = "en-US";
      window.speechSynthesis.speak(u);
    } catch (e) {
      // 黙って何もしない
    }
  }

  window.TW.sfx = {
    play: play,
    setEnabled: setEnabled,
    speak: speak
  };
})();
