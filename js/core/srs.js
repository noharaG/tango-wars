window.TW = window.TW || {};

// TW.srs — SM-2簡略版の忘却曲線ロジック。DOM非依存。
// SPEC_CORE §4 TW.srs 契約を実装。
(function () {
  "use strict";

  TW.srs = TW.srs || {};

  // 期限到来語(due<=now)。due昇順。
  TW.srs.dueWords = function (now) {
    now = typeof now === "number" ? now : Date.now();
    var state = TW.store.state;
    var srsMap = state.srs || {};
    var all = TW.store.allWords();
    var result = [];
    for (var i = 0; i < all.length; i++) {
      var w = all[i];
      var e = srsMap[w.id];
      if (e && e.due <= now) result.push(w);
    }
    result.sort(function (a, b) {
      return srsMap[a.id].due - srsMap[b.id].due;
    });
    return result;
  };

  // 未学習語から count 件。優先順: scouted → 低level → id順。当日 newPerDay 残数を超えない。
  TW.srs.newWords = function (count) {
    count = Math.max(0, count | 0);
    if (count === 0) return [];

    var state = TW.store.state;
    var today = TW.util.todayStr();
    var perDayLimit = (state.settings && state.settings.newWordsPerDay) || 20;
    var usedCount = state.newPerDay && state.newPerDay.date === today ? state.newPerDay.count : 0;
    var remaining = Math.max(0, perDayLimit - usedCount);
    remaining = Math.min(count, remaining);
    if (remaining <= 0) return [];

    var all = TW.store.allWords();
    var srsMap = state.srs || {};
    var candidates = [];
    for (var i = 0; i < all.length; i++) {
      if (!srsMap[all[i].id]) candidates.push(all[i]);
    }

    var scoutedSet = {};
    (state.scouted || []).forEach(function (id) {
      scoutedSet[id] = true;
    });

    candidates.sort(function (a, b) {
      var as = scoutedSet[a.id] ? 0 : 1;
      var bs = scoutedSet[b.id] ? 0 : 1;
      if (as !== bs) return as - bs;
      if (a.level !== b.level) return a.level - b.level;
      return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
    });

    return candidates.slice(0, remaining);
  };

  // due 60% / 新規 30%(固定) / 学習済ランダム 10% を混ぜてシャッフル(2026-07-05再調整)。
  // 新規単語だらけの対局を防ぐため、新規枠は size×30%を超えて増やさない。
  // 補填順: ①due→不足は学習済へ ②新規(newPerDay日次上限内、不足は未学習ランダムで
  // 上限バイパス補填。ただし新規枠自体は超えない) ③学習済ランダム(due/新規の不足分を吸収)
  // ④学習済プールが尽きた場合のみ未学習語で埋める(このときだけ30%を超えてよい=序盤の救済)
  // ⑤それでも足りなければ重複を許して全単語からランダム補填し、必ず size 個返す。
  TW.srs.buildQueue = function (size) {
    size = Math.max(0, size | 0);
    if (size === 0) return [];

    var chosenIds = {};
    var queue = [];

    function addFrom(list, n) {
      var added = 0;
      for (var i = 0; i < list.length && added < n; i++) {
        var w = list[i];
        if (!chosenIds[w.id]) {
          chosenIds[w.id] = true;
          queue.push(w);
          added++;
        }
      }
      return added;
    }

    function unlearnedPoolExcludingChosen() {
      var pool = [];
      for (var i = 0; i < all.length; i++) {
        if (!srsMap[all[i].id] && !chosenIds[all[i].id]) pool.push(all[i]);
      }
      return TW.util.shuffle(pool);
    }

    var state = TW.store.state;
    var srsMap = state.srs || {};
    var all = TW.store.allWords();

    var dueCount = Math.floor(size * 0.6);
    var newCount = Math.floor(size * 0.3);
    var learnedCount = size - dueCount - newCount;

    // ① due枠: 不足は学習済ランダムに回す(新規には回さない)。
    var dueList = TW.srs.dueWords(Date.now());
    var addedDue = addFrom(dueList, dueCount);
    var dueDeficit = dueCount - addedDue;

    // ② 新規枠(30%固定): newWords(日次上限内)で埋め、不足分だけ未学習語からランダム
    // 補填する(上限バイパス)。新規(未学習語)の合計はこの枠を超えない。
    var newList = TW.srs.newWords(newCount);
    var addedNew = addFrom(newList, newCount);
    var newDeficit = newCount - addedNew;
    if (newDeficit > 0) {
      var addedNewBonus = addFrom(unlearnedPoolExcludingChosen(), newDeficit);
      // ここで埋まらなかった分(未学習語の総数自体が足りない極端なケース)は
      // 学習済ランダム枠側に回す。新規枠を超えて未学習語を追加することはしない。
      newDeficit -= addedNewBonus;
    }

    // ③ 学習済ランダム枠 = 残り(due不足・新規枠を満たせなかった分を含めて吸収)。
    var learnedPool = [];
    for (var i = 0; i < all.length; i++) {
      if (srsMap[all[i].id] && !chosenIds[all[i].id]) learnedPool.push(all[i]);
    }
    learnedPool = TW.util.shuffle(learnedPool);
    var wantLearned = learnedCount + dueDeficit + newDeficit;
    var addedLearned = addFrom(learnedPool, wantLearned);
    var deficit = wantLearned - addedLearned;

    // ④ 学習済プールが尽きた場合のみ未学習語で埋める(このときだけ新規が30%を超えてよい)。
    if (deficit > 0) {
      var addedUnlearnedBonus = addFrom(unlearnedPoolExcludingChosen(), deficit);
      deficit -= addedUnlearnedBonus;
    }

    // ⑤ 全単語(重複無し)を使い切ってもまだ size に満たない場合(単語総数 < size)は、
    // 重複を許して全単語からランダム補填し、必ず size 個返す(SPEC_CORE §4 「必ず size 個」)。
    if (all.length > 0) {
      while (queue.length < size) {
        queue.push(TW.util.pick(all));
      }
    }

    return TW.util.shuffle(queue);
  };

  // 正誤と回答速度を反映。初回登場語は ef 2.5 で登録してから適用。
  TW.srs.answer = function (wordId, correct, ms) {
    var state = TW.store.state;
    var now = Date.now();

    if (!state.srs[wordId]) {
      state.srs[wordId] = { ef: 2.5, interval: 0, due: now, reps: 0, lapses: 0, mastery: 0 };
      // 新規語の初登場 → 当日の新規学習カウントに加算
      state.newPerDay.count = (state.newPerDay.count || 0) + 1;
    }

    var e = state.srs[wordId];

    // 早期復習ルール(SPEC_CORE §4, 2026-07-06追加): 正答でも期限前(now<due、学習済ランダム枠
    // での同日再演など)は練習扱いとしてSRS状態を一切前進させない(reps/interval/due/ef/mastery不変)。
    // 誤答は期限前でも従来どおりlapse処理する(忘却はいつでも事実)。初登場語は直前にdue=nowで
    // 登録したばかりなので(上のif内)、この分岐には掛からず従来どおり前進する。
    if (correct && now < e.due) {
      return { mastery: e.mastery, captured: false, kira: false };
    }

    var prevMastery = e.mastery;
    var prevInterval = e.interval;

    var q;
    if (!correct) {
      q = 1;
    } else if (ms > 6000) {
      q = 3;
    } else if (ms > 2000) {
      q = 4;
    } else {
      q = 5;
    }

    if (q < 3) {
      e.reps = 0;
      e.lapses += 1;
      e.interval = 0;
      e.due = now + 10 * 60 * 1000;
      e.mastery = Math.max(0, e.mastery - 1);
    } else {
      e.reps += 1;
      var newInterval;
      if (e.reps === 1) newInterval = 1;
      else if (e.reps === 2) newInterval = 3;
      else newInterval = Math.round(e.interval * e.ef);
      e.ef = Math.max(1.3, e.ef + (0.1 - (5 - q) * (0.08 + (5 - q) * 0.02)));
      e.interval = newInterval;
      e.due = now + newInterval * 24 * 60 * 60 * 1000;
      e.mastery = Math.min(5, e.mastery + 1);
    }

    // captured/kira は「この回答で初めてその状態に達した」という遷移イベントとして返す
    // (状態そのものは mastery/interval から常時導出可能。捕獲/キラの単発報酬付与のため遷移検出が必要と判断)
    var captured = prevMastery < 3 && e.mastery >= 3;
    var wasKira = prevMastery >= 5 && prevInterval >= 21;
    var isKira = e.mastery >= 5 && e.interval >= 21;
    var kira = !wasKira && isKira;

    // 捕獲で state.scouted から外れる (SPEC_CORE §2)
    if (captured && state.scouted) {
      var idx = state.scouted.indexOf(wordId);
      if (idx !== -1) state.scouted.splice(idx, 1);
    }

    return { mastery: e.mastery, captured: captured, kira: kira };
  };
})();
