window.TW = window.TW || {};

// TW.quest — デイリークエスト・シーズン・ストリーク継続判定・実績。DOM非依存。
// SPEC_CORE §4 TW.quest 契約を実装。
//
// 補足(契約に明記されていないため本実装で決めた点):
// - ストリーク(streak.days)の「継続」判定は onAction("battle") 側で行う。
//   store.load() は日跨ぎによる「途切れ」判定のみ担当し、継続の加算はここで行う設計。
// - checkAchievements(ctx) の ctx は仕様に形が明記されていないため、
//   { win, promoted, maxCombo, capturedWords } という最小限の形を独自に定義した(battle.js側の実装依存)。
(function () {
  "use strict";

  TW.quest = TW.quest || {};

  // クエスト候補プール(id, 判定に使うアクション種別, 表示名, 目標値, 報酬コイン)
  TW.quest.QUEST_POOL = [
    { id: "battle1", type: "battle", name: "対局1回", goal: 1, reward: 30 },
    { id: "win1", type: "win", name: "勝利1回", goal: 1, reward: 50 },
    { id: "review20", type: "review", name: "復習20語", goal: 20, reward: 30 },
    { id: "newword5", type: "newWord", name: "新出5語", goal: 5, reward: 40 },
    { id: "combo15", type: "combo", name: "コンボ15", goal: 15, reward: 50 }
  ];

  var poolById = {};
  TW.quest.QUEST_POOL.forEach(function (q) {
    poolById[q.id] = q;
  });

  // 実績プール(称号一覧。名前は設定/統計画面での表示用)
  TW.quest.ACHIEVEMENTS = [
    { id: "first_win", name: "初勝利" },
    { id: "first_promotion", name: "初昇級" },
    { id: "first_dan", name: "初段到達" },
    { id: "combo20", name: "コンボ20" },
    { id: "combo50", name: "コンボ50" },
    { id: "first_ur", name: "UR初捕獲" },
    { id: "kira10", name: "キラ10個" },
    { id: "streak7", name: "ストリーク7日" },
    { id: "streak30", name: "ストリーク30日" },
    { id: "capture100", name: "捕獲100語" },
    { id: "capture500", name: "捕獲500語" }
  ];

  // 日付シードでプールから固定3件を決定的に選出。
  TW.quest.getDaily = function () {
    var seed = TW.util.todayStr();
    var rng = TW.util.seededRandom(seed);
    var pool = TW.quest.QUEST_POOL.slice();
    for (var i = pool.length - 1; i > 0; i--) {
      var j = Math.floor(rng() * (i + 1));
      var tmp = pool[i];
      pool[i] = pool[j];
      pool[j] = tmp;
    }
    return pool.slice(0, 3).map(function (q) {
      return { id: q.id, done: 0, goal: q.goal, claimed: false };
    });
  };

  // 「1日1対局」でストリーク継続。同日2回目以降の battle アクションでは加算しない。
  function updateStreakOnBattle() {
    var state = TW.store.state;
    var today = TW.util.todayStr();
    if (state.streak.lastDate !== today) {
      state.streak.days = (state.streak.days || 0) + 1;
      state.streak.lastDate = today;
    }
  }

  TW.quest.onAction = function (type, n) {
    n = typeof n === "number" ? n : 1;

    if (type === "battle") updateStreakOnBattle();

    var state = TW.store.state;
    var items = (state.quests && state.quests.items) || [];
    for (var i = 0; i < items.length; i++) {
      var item = items[i];
      var meta = poolById[item.id];
      if (meta && meta.type === type) {
        item.done = Math.min(item.goal, item.done + n);
      }
    }
  };

  TW.quest.claim = function (id) {
    var state = TW.store.state;
    var items = (state.quests && state.quests.items) || [];
    var item = null;
    for (var i = 0; i < items.length; i++) {
      if (items[i].id === id) {
        item = items[i];
        break;
      }
    }
    if (!item || item.claimed || item.done < item.goal) return 0;

    var meta = poolById[id];
    var reward = meta ? meta.reward : 0;
    item.claimed = true;
    var coins = TW.store.addCoins(reward);
    TW.store.save();
    return coins;
  };

  TW.quest.seasonInfo = function () {
    var season = TW.store.state.season;
    var best = 0;
    (season.history || []).forEach(function (h) {
      if (h.score > best) best = h.score;
    });

    var today = new Date();
    var isoWeekday = ((today.getDay() + 6) % 7) + 1; // 月=1..日=7
    var daysLeft = (8 - isoWeekday) % 7;
    if (daysLeft === 0) daysLeft = 7;

    return { weekKey: season.weekKey, score: season.score, bestPastScore: best, daysLeft: daysLeft };
  };

  TW.quest.addSeasonScore = function (n) {
    TW.store.state.season.score += n;
  };

  // ctx = { win, promoted, maxCombo, capturedWords } (いずれも省略可)
  TW.quest.checkAchievements = function (ctx) {
    ctx = ctx || {};
    var state = TW.store.state;
    var unlocked = state.achievements;
    var newly = [];

    function unlock(id) {
      if (unlocked.indexOf(id) === -1) {
        unlocked.push(id);
        newly.push(id);
      }
    }

    if (ctx.win) unlock("first_win");
    if (ctx.promoted) unlock("first_promotion");
    if (state.rank.index >= 30) unlock("first_dan");
    if (typeof ctx.maxCombo === "number" && ctx.maxCombo >= 20) unlock("combo20");
    if (typeof ctx.maxCombo === "number" && ctx.maxCombo >= 50) unlock("combo50");

    if (Array.isArray(ctx.capturedWords)) {
      for (var i = 0; i < ctx.capturedWords.length; i++) {
        if (ctx.capturedWords[i] && ctx.capturedWords[i].rarity === "UR") {
          unlock("first_ur");
          break;
        }
      }
    }

    // 累計系はグローバル状態から毎回再評価(srsに記録された全語を走査)
    var capturedCount = 0;
    var kiraCount = 0;
    var srsMap = state.srs || {};
    for (var wid in srsMap) {
      if (Object.prototype.hasOwnProperty.call(srsMap, wid)) {
        var e = srsMap[wid];
        if (e.mastery >= 3) capturedCount++;
        if (e.mastery >= 5 && e.interval >= 21) kiraCount++;
      }
    }
    if (kiraCount >= 10) unlock("kira10");
    if (state.streak.days >= 7) unlock("streak7");
    if (state.streak.days >= 30) unlock("streak30");
    if (capturedCount >= 100) unlock("capture100");
    if (capturedCount >= 500) unlock("capture500");

    return newly;
  };
})();
