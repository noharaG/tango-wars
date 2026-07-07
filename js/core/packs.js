window.TW = window.TW || {};

// TW.packs — 単語パック(章)の解禁状態読み込みと動的スクリプト注入。
// SPEC_PACKS §3 契約を実装。他ファイルの内部実装には依存しない。
(function () {
  "use strict";

  var SAVE_KEY = "tw_save_v1";

  // store.load() より前でも呼べる純関数。localStorage の tw_save_v1 を直接
  // JSON.parse して unlockedPacks を返す。存在しない/壊れている/localStorage
  // 自体が無い(node環境等)場合は ["vol1"] を返す(例外を投げない)。
  function readUnlockedFromStorage() {
    try {
      if (typeof localStorage === "undefined" || !localStorage) return ["vol1"];
      var raw = localStorage.getItem(SAVE_KEY);
      if (!raw) return ["vol1"];
      var parsed = JSON.parse(raw);
      if (parsed && Array.isArray(parsed.unlockedPacks) && parsed.unlockedPacks.length > 0) {
        return parsed.unlockedPacks;
      }
      return ["vol1"];
    } catch (e) {
      return ["vol1"];
    }
  }

  // <script>動的注入で1章分を読み込む。成功時は TW.WORD_PACKS[volId] を
  // TW.WORD_DATA へ concat してから next() を呼ぶ。失敗時もスキップして next() を呼ぶ
  // (そのセッションで当該章が出題されないだけで、起動は止めない)。
  function loadOneScript(volId, next) {
    var el = document.createElement("script");
    el.src = "data/packs/" + volId + ".js";
    el.onload = function () {
      if (TW.WORD_PACKS && Array.isArray(TW.WORD_PACKS[volId])) {
        TW.WORD_DATA = (TW.WORD_DATA || []).concat(TW.WORD_PACKS[volId]);
      }
      next();
    };
    el.onerror = function () {
      next();
    };
    document.head.appendChild(el);
  }

  // unlocked ∩ available(TW.PACK_INDEX) の vol2以降を順次読み込んでから done() を呼ぶ。
  // vol1(builtin)は data/words.js で読込済のため対象外。PACK_INDEX不在でも done() は必ず呼ぶ。
  function loadUnlocked(done) {
    done = typeof done === "function" ? done : function () {};

    var index = TW.PACK_INDEX;
    if (!Array.isArray(index) || index.length === 0) {
      done();
      return;
    }

    var unlockedSet = {};
    readUnlockedFromStorage().forEach(function (id) { unlockedSet[id] = true; });

    var targets = index
      .filter(function (p) { return p.id !== "vol1" && p.available && unlockedSet[p.id]; })
      .map(function (p) { return p.id; });

    var i = 0;
    function step() {
      if (i >= targets.length) { done(); return; }
      var id = targets[i++];
      loadOneScript(id, step);
    }
    step();
  }

  TW.packs = {
    readUnlockedFromStorage: readUnlockedFromStorage,
    loadUnlocked: loadUnlocked
  };
})();
