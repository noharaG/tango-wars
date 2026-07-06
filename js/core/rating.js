window.TW = window.TW || {};

// TW.rating — Elo・段位(30級〜九段)・ボット強さの算出。DOM非依存。
// SPEC_CORE §4 TW.rating 契約を実装。
(function () {
  "use strict";

  TW.rating = TW.rating || {};

  var KYUU_MAX_INDEX = 29; // index 0..29 = 30級..1級
  var DAN_NAMES = ["初", "二", "三", "四", "五", "六", "七", "八", "九"];
  var MAX_INDEX = KYUU_MAX_INDEX + DAN_NAMES.length; // 38 = 九段

  TW.rating.rankName = function (index) {
    index = TW.util.clamp(index, 0, MAX_INDEX);
    if (index <= KYUU_MAX_INDEX) {
      return (30 - index) + "級";
    }
    var dan = index - KYUU_MAX_INDEX; // 1..9
    return DAN_NAMES[dan - 1] + "段";
  };

  TW.rating.current = function () {
    var state = TW.store.state;
    return {
      name: TW.rating.rankName(state.rank.index),
      index: state.rank.index,
      progress: state.rank.progress,
      elo: state.elo
    };
  };

  // 二つ名(形容+人名風の語)。呼ぶたびにランダム合成する(UI側の旧実装をここに一本化)。
  var BOT_EPITHETS = [
    "電光石火の", "鉄壁の", "百戦錬磨の", "気まぐれな", "冷静沈着な",
    "熱血の", "夜更かしの", "早起きの", "無敗の", "直感型の", "データ派の",
    "一撃必殺の", "粘りの"
  ];
  var BOT_PERSONAS = [
    "ハヤテ", "カケル", "ツバサ", "レン", "ソラ", "アカリ",
    "ミナト", "ユウ", "カイ", "リク", "アオイ", "イブキ"
  ];
  var BOT_STYLES = ["rush", "closer", "streaky"];

  function randomBotName() {
    return TW.util.pick(BOT_EPITHETS) + TW.util.pick(BOT_PERSONAS);
  }

  TW.rating.botFor = function (elo) {
    var delta = (Math.random() * 2 - 1) * 150; // 自Elo±150
    var botElo = Math.round(elo + delta);
    var accuracy = TW.util.clamp(0.55 + (botElo - 800) / 2400, 0.5, 0.95);
    var avgMs = TW.util.clamp(5200 - botElo * 1.2, 2200, 6000);
    var name = randomBotName();
    var style = TW.util.pick(BOT_STYLES);
    return { elo: botElo, accuracy: accuracy, avgMs: avgMs, name: name, style: style };
  };

  TW.rating.applyResult = function (win, botElo) {
    var state = TW.store.state;
    var elo0 = state.elo;

    // Elo標準式 K=32
    var expected = 1 / (1 + Math.pow(10, (botElo - elo0) / 400));
    var actual = win ? 1 : 0;
    var eloDelta = Math.round(32 * (actual - expected));
    var newElo = elo0 + eloDelta;

    var progressDelta;
    if (win) {
      progressDelta = TW.util.clamp(25 + (botElo - elo0) / 20, 10, 45);
    } else {
      progressDelta = -TW.util.clamp(15 + (elo0 - botElo) / 20, 5, 30);
    }
    progressDelta = Math.round(progressDelta);

    var index = state.rank.index;
    var progress = state.rank.progress + progressDelta;
    var promoted = false;
    var demoted = false;

    if (progress >= 100) {
      if (index < MAX_INDEX) {
        index += 1;
        promoted = true;
      }
      progress = 0;
    } else if (progress < 0) {
      if (index > 0) {
        index -= 1;
        progress = 70;
        demoted = true;
      } else {
        progress = 0; // 30級(index0)では0止まり
      }
    }

    state.elo = newElo;
    state.rank.index = index;
    state.rank.progress = progress;

    return {
      promoted: promoted,
      demoted: demoted,
      progressDelta: progressDelta,
      eloDelta: eloDelta,
      rank: { name: TW.rating.rankName(index), index: index, progress: progress, elo: newElo }
    };
  };
})();
