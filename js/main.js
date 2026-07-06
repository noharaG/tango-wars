window.TW = window.TW || {};

// js/main.js — TW.router(画面遷移) + 起動処理。SPEC_CORE §3/§4(TW.router)を実装。
// 担当: 統合(main.js のみ)。
(function () {
  "use strict";

  var appEl = null;
  var navEl = null;
  var lastResult = null; // showResult() で保持し、go("result") 時に TW.ui.result.render へ渡す

  // "battle"/"result" 中は下部ナビを隠す(バトルは SPEC_UI §1、リザルトも同様に全画面演出優先)。
  // "feed" も同様に全画面(SPEC_ADDICTION §5.3: 出口は左上の「←」のみ)。
  var NAV_HIDDEN_SCREENS = { battle: true, result: true, feed: true };

  // screen名 → 描画を担当するモジュール({render(container, opts)} を持つ)。
  function screenModule(screen) {
    switch (screen) {
      case "home": return TW.ui.home;
      case "battle": return TW.ui.battle;
      case "result": return TW.ui.result;
      case "collection": return TW.ui.collection;
      case "stats": return TW.ui.stats;
      case "settings": return TW.ui.settings;
      case "feed": return TW.ui.feed;
      default: return null;
    }
  }

  function updateNavVisibility(screen) {
    if (!navEl) return;
    navEl.classList.toggle("hidden", !!NAV_HIDDEN_SCREENS[screen]);
  }

  function updateNavActive(screen) {
    if (!navEl) return;
    var btns = navEl.querySelectorAll(".nav-btn");
    for (var i = 0; i < btns.length; i++) {
      btns[i].classList.toggle("active", btns[i].getAttribute("data-screen") === screen);
    }
  }

  // TW.router.go(screen, opts) — #app を screen の描画で差し替え、下部ナビの表示/activeを更新する。
  // opts は各 TW.ui.<name>.render(container, opts) へそのまま第2引数として渡す
  // (例: TW.router.go("battle", { mode: "free" }))。"result" は例外的に
  // lastResult(showResult 経由で保持した Result)を第2引数として渡す。
  function go(screen, opts) {
    var mod = screenModule(screen);
    if (!mod || typeof mod.render !== "function") return; // 未知の画面idは無視(防御的)

    updateNavVisibility(screen);
    updateNavActive(screen);

    if (screen === "result") {
      mod.render(appEl, lastResult);
    } else {
      mod.render(appEl, opts);
    }
    window.scrollTo(0, 0);
  }

  // TW.router.showResult(result) — 結果を保持して "result" 画面へ遷移する。
  // (js/game/battle.js の Session.end() の戻り値を js/ui/battle-ui.js がそのまま渡す想定)
  function showResult(result) {
    lastResult = result;
    go("result");
  }

  // 下部ナビ(#bottom-nav)のクリックをイベント委任で受け、data-screen へ遷移する。
  function bindNav() {
    navEl.addEventListener("click", function (ev) {
      var btn = ev.target.closest ? ev.target.closest(".nav-btn") : null;
      if (!btn) return;
      var screen = btn.getAttribute("data-screen");
      if (!screen) return;
      TW.sfx.play("tap");
      go(screen);
    });
  }

  // 初回のユーザー操作内で AudioContext を resume する。
  // TW.sfx は resume専用のAPIを公開していないため、存在しない音名で play() を呼び、
  // 内部の ensureCtx()(生成/resume)だけを一度走らせる(該当音が無いので実際の再生は起きない)。
  function bindAudioUnlock() {
    var events = ["pointerdown", "touchstart", "keydown"];
    function unlock() {
      for (var i = 0; i < events.length; i++) {
        window.removeEventListener(events[i], unlock, true);
      }
      if (TW.sfx && typeof TW.sfx.play === "function") {
        TW.sfx.play("__audio_unlock__");
      }
    }
    for (var i = 0; i < events.length; i++) {
      window.addEventListener(events[i], unlock, true);
    }
  }

  document.addEventListener("DOMContentLoaded", function () {
    appEl = document.getElementById("app");
    navEl = document.getElementById("bottom-nav");

    TW.store.load(); // 日跨ぎ処理(quest/season/streak/newPerDay)は store.load() 内で行われる

    // 保存済みの音設定を TW.sfx へ反映する。
    // (js/audio/sfx.js の enabled は既定 true で起動するため、ここで明示的に同期しないと
    //  「設定で音をOFFにして再読み込みした」場合に反映されない)
    if (TW.sfx && typeof TW.sfx.setEnabled === "function") {
      var settings = TW.store.state && TW.store.state.settings;
      TW.sfx.setEnabled(!settings || settings.sound !== false);
    }

    bindNav();
    bindAudioUnlock();

    go("home");
  });

  TW.router = {
    go: go,
    showResult: showResult
  };
})();
