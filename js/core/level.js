window.TW = window.TW || {};

// TW.level — プレイヤーレベル(累積XP)。DOM非依存。
// SPEC_ADDICTION §1 TW.level を実装。TW.store.state.xp/tickets を読み書きする。
(function () {
  "use strict";

  TW.level = TW.level || {};

  // レベル n → n+1 に必要なXP。序盤は小さく(80)、以降1レベルごとに+40。
  function xpNeedFor(level) {
    return 80 + (level - 1) * 40;
  }

  // 累積XPからレベル・現レベル内の消化XP・次レベルに必要なXPを導出。
  function levelFromXp(totalXp) {
    var level = 1;
    var remaining = totalXp;
    while (remaining >= xpNeedFor(level)) {
      remaining -= xpNeedFor(level);
      level++;
    }
    return { level: level, xpInto: remaining, xpNeed: xpNeedFor(level) };
  }

  TW.level.current = function () {
    var state = TW.store.state;
    var totalXp = state && typeof state.xp === "number" ? state.xp : 0;
    var info = levelFromXp(totalXp);
    return { level: info.level, xpInto: info.xpInto, xpNeed: info.xpNeed, totalXp: totalXp };
  };

  // XPをn加算(XPは絶対に減らない)。レベルアップごとにコイン50・5の倍数到達ごとにチケット+1。
  TW.level.addXp = function (n) {
    var state = TW.store.state;
    if (typeof state.xp !== "number") state.xp = 0;

    var beforeLevel = levelFromXp(state.xp).level;
    state.xp += n;
    var afterLevel = levelFromXp(state.xp).level;
    var levelsGained = afterLevel - beforeLevel;

    var coinsAwarded = 0;
    var ticketsAwarded = 0;
    for (var lv = beforeLevel + 1; lv <= afterLevel; lv++) {
      coinsAwarded += TW.store.addCoins(50);
      if (lv % 5 === 0) ticketsAwarded++;
    }
    if (ticketsAwarded > 0) {
      state.tickets = (state.tickets || 0) + ticketsAwarded;
    }

    return {
      gained: n,
      levelsGained: levelsGained,
      rewards: { coins: coinsAwarded, tickets: ticketsAwarded }
    };
  };
})();
