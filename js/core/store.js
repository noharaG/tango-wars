window.TW = window.TW || {};

// TW.store — セーブデータの永続化・読み込み・単語辞書アクセス。
// SPEC_CORE §2(保存形式) §4 TW.store 契約を実装。
// 日跨ぎ処理(クエスト日替わり・シーズン週替わり・ストリーク判定・newPerDayリセット)は load() 内で行う。
(function () {
  "use strict";

  var SAVE_KEY = "tw_save_v1";
  var HISTORY_MAX = 200; // state.history の永続化上限件数(無制限増加によるlocalStorage容量超過対策)

  // ---- 単語辞書の索引キャッシュ(TW.WORD_DATA の参照が変わったら再構築) ----
  var wordIndexCache = null;
  var wordIndexSrc = null;
  function ensureWordIndex() {
    var data = TW.WORD_DATA || [];
    if (wordIndexSrc !== data) {
      wordIndexCache = {};
      for (var i = 0; i < data.length; i++) {
        wordIndexCache[data[i].id] = data[i];
      }
      wordIndexSrc = data;
    }
    return wordIndexCache;
  }

  // ---- 新規セーブデータ生成 ----
  function createNewSave() {
    var now = Date.now();
    var today = TW.util.todayStr();
    return {
      ver: 2,
      createdAt: now,
      lastPlayedAt: now,
      elo: 800,
      rank: { index: 0, progress: 0 },
      coins: 200,
      streak: { days: 0, lastDate: "" },
      srs: {},
      scouted: [],
      quests: {
        date: today,
        items: TW.quest && TW.quest.getDaily ? TW.quest.getDaily() : []
      },
      season: { weekKey: TW.util.weekKey(), score: 0, history: [] },
      achievements: [],
      history: [],
      newPerDay: { date: today, count: 0 },
      settings: { sound: true, typing: false, newWordsPerDay: 20, voice: true, bgm: true },
      // ---- ここから ver2 (中毒強化パック / SPEC_ADDICTION §0) ----
      xp: 0, // 累積XP(下がらない)
      tickets: 1, // スカウトチケット(初回1枚プレゼント)
      login: { cycleDay: 0, lastDate: "" }, // ログボ 7日サイクル
      boost: { stock: 1, lastChargeAt: now, pending: false },
      blitzBest: 0
    };
  }

  // defaults にあるキーで target に無いものを再帰的に補う(壊れた/古いセーブの防御的マイグレーション)。
  // target 側にしか無い余分なキーはそのまま残す。
  function mergeDefaults(target, defaults) {
    if (typeof defaults !== "object" || defaults === null || Array.isArray(defaults)) {
      return target === undefined ? defaults : target;
    }
    if (typeof target !== "object" || target === null || Array.isArray(target)) {
      target = {};
    }
    for (var key in defaults) {
      if (Object.prototype.hasOwnProperty.call(defaults, key)) {
        target[key] = mergeDefaults(target[key], defaults[key]);
      }
    }
    return target;
  }

  function parseDateStr(s) {
    var parts = s.split("-");
    return new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
  }

  function daysBetween(dateStrA, dateStrB) {
    var a = parseDateStr(dateStrA);
    var b = parseDateStr(dateStrB);
    return Math.round((b - a) / 86400000);
  }

  // 日跨ぎ処理: クエスト日替わり・シーズン週替わり・ストリーク判定・newPerDayリセット
  function runDayCrossing(state) {
    var today = TW.util.todayStr();

    // クエスト日替わり(未達成分は繰り越さず、当日分を新規生成)
    if (!state.quests || state.quests.date !== today) {
      state.quests = {
        date: today,
        items: TW.quest && TW.quest.getDaily ? TW.quest.getDaily() : []
      };
    }

    // シーズン週替わり(月曜0時)。旧週のスコアを history へ繰入れてリセット。
    var wk = TW.util.weekKey();
    if (!state.season) {
      state.season = { weekKey: wk, score: 0, history: [] };
    } else if (state.season.weekKey !== wk) {
      if (state.season.weekKey) {
        state.season.history.push({ weekKey: state.season.weekKey, score: state.season.score });
      }
      state.season.weekKey = wk;
      state.season.score = 0;
    }

    // ストリーク判定: 1日以上プレイが飛んでいたら途切れる(継続判定自体は quest.onAction("battle") 側)
    if (state.streak && state.streak.lastDate && state.streak.lastDate !== today) {
      var gap = daysBetween(state.streak.lastDate, today);
      if (gap > 1) state.streak.days = 0;
    }

    // 新規単語/日カウントの日替わりリセット
    if (!state.newPerDay || state.newPerDay.date !== today) {
      state.newPerDay = { date: today, count: 0 };
    }
  }

  TW.store = TW.store || {};

  TW.store.load = function () {
    var raw = null;
    try {
      raw = localStorage.getItem(SAVE_KEY);
    } catch (e) {
      raw = null;
    }

    var state;
    if (raw) {
      try {
        var parsed = JSON.parse(raw);
        state = mergeDefaults(parsed, createNewSave());
        // mergeDefaults は既存のスカラー値(ver等)を上書きしないため、
        // v1セーブの ver を明示的に v2 へ上げる(§0 セーブ移行)。
        state.ver = 2;
      } catch (e) {
        state = createNewSave();
      }
    } else {
      state = createNewSave();
    }

    TW.store.state = state;
    runDayCrossing(state);
    TW.store.save();
  };

  TW.store.save = function () {
    try {
      var state = TW.store.state;
      if (state && Array.isArray(state.history) && state.history.length > HISTORY_MAX) {
        state.history = state.history.slice(-HISTORY_MAX);
      }
      localStorage.setItem(SAVE_KEY, JSON.stringify(TW.store.state));
    } catch (e) {
      // 保存失敗(容量超過など)は握りつぶす。ゲーム進行は継続させる。
    }
  };

  TW.store.wordById = function (id) {
    return ensureWordIndex()[id];
  };

  TW.store.allWords = function () {
    return TW.WORD_DATA || [];
  };

  TW.store.addCoins = function (n) {
    var state = TW.store.state;
    var mult = 1 + Math.min(state.streak.days, 10) * 0.05;
    // 週末コイン2倍イベント (SPEC_ADDICTION §2.3)。TW.daily 未読込でも動くよう疎結合ガード。
    if (typeof TW.daily !== "undefined" && TW.daily.currentEvents) {
      var events = TW.daily.currentEvents();
      for (var i = 0; i < events.length; i++) {
        if (events[i].type === "coin") mult *= events[i].mult;
      }
    }
    var amount = Math.round(n * mult);
    state.coins += amount;
    return amount;
  };

  TW.store.exportSave = function () {
    return JSON.stringify(TW.store.state);
  };

  TW.store.importSave = function (json) {
    try {
      var obj = JSON.parse(json);
      if (!obj || typeof obj !== "object") return false;
      TW.store.state = mergeDefaults(obj, createNewSave());
      TW.store.state.ver = 2; // load() と同様、v1のインポートも v2 へ上げる
      TW.store.save();
      return true;
    } catch (e) {
      return false;
    }
  };

  TW.store.resetAll = function () {
    TW.store.state = createNewSave();
    TW.store.save();
  };
})();
