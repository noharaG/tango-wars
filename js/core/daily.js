window.TW = window.TW || {};

// TW.daily — ログインボーナス・ブーストチケット・期間限定イベント。DOM非依存。
// SPEC_ADDICTION §2 TW.daily を実装。テスト可能性のため全関数は省略可能な now(ms) 引数を受ける。
// TW.store.state.login / boost / tickets を読み書きする。他モジュール(battle/store)からは
// typeof TW.daily !== "undefined" ガード付きの疎結合参照を前提とする。
(function () {
  "use strict";

  TW.daily = TW.daily || {};

  function nowOrDefault(now) {
    return typeof now === "number" ? now : Date.now();
  }

  // ---------------------------------------------------------------------
  // 2.1 ログインボーナス (7日サイクル。日を飛ばしてもサイクルはリセットしない)
  // ---------------------------------------------------------------------
  var LOGIN_REWARDS = {
    1: { coins: 50, tickets: 0 },
    2: { coins: 80, tickets: 0 },
    3: { coins: 100, tickets: 0 },
    4: { coins: 0, tickets: 1 },
    5: { coins: 150, tickets: 0 },
    6: { coins: 200, tickets: 0 },
    7: { coins: 300, tickets: 2 }
  };

  // 今日まだ受け取っていなければ次に受け取れる内容を返す(状態は変えない)。
  TW.daily.pendingLogin = function (now) {
    now = nowOrDefault(now);
    var state = TW.store.state;
    var login = (state && state.login) || { cycleDay: 0, lastDate: "" };
    var today = TW.util.todayStr(new Date(now));

    if (login.lastDate === today) return null;

    var nextDay = (login.cycleDay % 7) + 1; // 1..7 で循環
    var reward = LOGIN_REWARDS[nextDay];
    return { day: nextDay, coins: reward.coins, tickets: reward.tickets };
  };

  // 受け取り確定。lastDate=今日、cycleDayを進める。
  TW.daily.claimLogin = function (now) {
    now = nowOrDefault(now);
    var pending = TW.daily.pendingLogin(now);
    if (!pending) return null;

    var state = TW.store.state;
    if (!state.login) state.login = { cycleDay: 0, lastDate: "" };
    state.login.lastDate = TW.util.todayStr(new Date(now));
    state.login.cycleDay = pending.day;

    var creditedCoins = pending.coins > 0 ? TW.store.addCoins(pending.coins) : 0;
    if (pending.tickets > 0) state.tickets = (state.tickets || 0) + pending.tickets;
    TW.store.save();

    return { day: pending.day, coins: creditedCoins, tickets: pending.tickets };
  };

  // ---------------------------------------------------------------------
  // 2.2 ブーストチケット (4時間ごとに+1、上限2。プレイは制限しない「溢れ心理」だけ移植)
  // ---------------------------------------------------------------------
  var BOOST_CHARGE_MS = 4 * 60 * 60 * 1000;
  var BOOST_MAX = 2;

  // lastChargeAt からの経過を反映して boost をその場で同期する(遅延計算)。
  function syncBoost(now) {
    var state = TW.store.state;
    var boost = state.boost;
    if (!boost) {
      boost = state.boost = { stock: 1, lastChargeAt: now, pending: false };
    }

    if (boost.stock >= BOOST_MAX) {
      // 満タン中は基準時刻を今に固定(枯れた基準からの過大計算・溢れの取り込みを防ぐ)
      boost.stock = BOOST_MAX;
      boost.lastChargeAt = now;
      return boost;
    }

    var elapsed = now - boost.lastChargeAt;
    if (elapsed >= BOOST_CHARGE_MS) {
      var gained = Math.floor(elapsed / BOOST_CHARGE_MS);
      var newStock = Math.min(BOOST_MAX, boost.stock + gained);
      var consumedCharges = newStock - boost.stock;
      boost.lastChargeAt += consumedCharges * BOOST_CHARGE_MS;
      boost.stock = newStock;
      if (boost.stock >= BOOST_MAX) boost.lastChargeAt = now;
    }
    return boost;
  }

  TW.daily.boostState = function (now) {
    now = nowOrDefault(now);
    var boost = syncBoost(now);
    var full = boost.stock >= BOOST_MAX;
    var nextChargeMin = full
      ? null
      : Math.max(0, Math.ceil((BOOST_CHARGE_MS - (now - boost.lastChargeAt)) / 60000));
    return { stock: boost.stock, full: full, nextChargeMin: nextChargeMin, pending: !!boost.pending };
  };

  // stock>0 なら1消費してpending=true(次の対局のコイン&XPを2倍)。battle.end が消費して戻す。
  TW.daily.useBoost = function (now) {
    now = nowOrDefault(now);
    var boost = syncBoost(now);
    if (boost.stock <= 0) return false;
    boost.stock -= 1;
    boost.pending = true;
    TW.store.save();
    return true;
  };

  // ---------------------------------------------------------------------
  // 2.3 期間限定イベント (日付から決定的に生成。サーバ不要)
  // ---------------------------------------------------------------------
  var CAT_POOL = ["general", "academic", "it", "robotics"];
  var CAT_LABEL = {
    general: "🌱 一般語彙",
    academic: "📚 学術語彙",
    it: "💻 IT語彙",
    robotics: "🤖 ロボット語彙"
  };

  // 次の月曜0時(ローカル時刻)のタイムスタンプ。今日が月曜ならちょうど7日後。
  function nextMondayMidnight(now) {
    var d = new Date(now);
    d.setHours(0, 0, 0, 0);
    var dow = d.getDay(); // 0=日..6=土
    var add = (8 - dow) % 7;
    if (add === 0) add = 7;
    d.setDate(d.getDate() + add);
    return d.getTime();
  }

  TW.daily.currentEvents = function (now) {
    now = nowOrDefault(now);
    var events = [];
    var d = new Date(now);
    var wk = TW.util.weekKey(d);
    var endsAt = nextMondayMidnight(now);

    // 週替わり強化週間: weekKeyのハッシュでカテゴリを決定的に1つ選ぶ
    var rng = TW.util.seededRandom(wk);
    var cat = CAT_POOL[Math.floor(rng() * CAT_POOL.length)];
    events.push({
      id: "week_" + wk,
      name: (CAT_LABEL[cat] || cat) + " 強化週間",
      desc: "対象カテゴリの単語スコアが×1.5",
      type: "cat",
      cat: cat,
      mult: 1.5,
      endsAt: endsAt
    });

    // 週末コイン2倍(土日のみ)
    var dow = d.getDay();
    if (dow === 0 || dow === 6) {
      events.push({
        id: "weekend_" + wk,
        name: "🪙 週末コイン2倍",
        desc: "獲得コインが2倍",
        type: "coin",
        mult: 2,
        endsAt: endsAt
      });
    }

    return events;
  };
})();
