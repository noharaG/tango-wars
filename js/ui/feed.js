window.TW = window.TW || {};
window.TW.ui = window.TW.ui || {};

// js/ui/feed.js — ワードフィード画面 (TW.ui.feed)
// SPEC_ADDICTION §5.3 準拠。担当ファイル: js/ui/feed.js, css/feed.css のみ。
// 依存は SPEC_CORE §4 の公開契約のみ(TW.store/TW.srs/TW.sfx/TW.util)。
// TW.level(js/core/level.js)は本タスクと並行実装のため未ロードでも落ちないよう
// typeof ガード付きで疎結合に呼ぶ(SPEC_ADDICTION §2.3 の TW.daily と同じ方針)。
(function () {
  "use strict";

  var BATCH_SIZE = 10;       // 一度の補充枚数
  var PREFETCH_REMAIN = 3;   // 残りこのカード数まで来たら次バッチを補充(終端を作らない)
  var PRUNE_BEHIND = 30;     // 現在位置よりこの枚数以上前のカードはDOM・observerから解放する
  var AUTO_REVEAL_MS = 1500; // カードが画面に入ってから意味を自動表示するまで
  var DOUBLE_TAP_MS = 300;   // ダブルタップ判定のウィンドウ(単タップの意味表示もこの分だけ遅延する)

  // 現在マウント中のインスタンス。1画面につき1つ。render() の度に前のものを解放する。
  var active = null;

  function escapeHtml(str) {
    return String(str == null ? "" : str).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  function rarityClass(r) {
    switch (r) {
      case "N": return "rarity-n";
      case "R": return "rarity-r";
      case "SR": return "rarity-sr";
      case "SSR": return "rarity-ssr";
      case "UR": return "rarity-ur";
      default: return "rarity-n";
    }
  }

  // ---------- 破棄 ----------

  function teardown(inst) {
    if (!inst || inst.destroyed) return;
    inst.destroyed = true;
    if (inst.cardObserver) inst.cardObserver.disconnect();
    if (inst.mountObserver) inst.mountObserver.disconnect();
    if (inst.revealTimer) { window.clearTimeout(inst.revealTimer); inst.revealTimer = null; }
    for (var i = 0; i < inst.pendingCleanups.length; i++) {
      try { inst.pendingCleanups[i](); } catch (e) { /* 個々の後始末失敗は無視 */ }
    }
    inst.pendingCleanups.length = 0;
  }

  // ---------- カード生成 ----------

  function cardHtml(word, seq) {
    var rc = rarityClass(word.rarity);
    var collocHtml = (word.collocations && word.collocations.length)
      ? '<div class="feed-colloc-row">' + word.collocations.map(function (c) {
          return '<span class="chip">' + escapeHtml(c) + '</span>';
        }).join("") + '</div>'
      : "";
    return (
      '<div class="feed-card" data-word-id="' + escapeHtml(word.id) + '" data-seq="' + seq + '">' +
        '<div class="feed-card-inner ' + rc + '" data-role="tapzone">' +
          '<span class="badge ' + rc + ' feed-rarity-badge">' + escapeHtml(word.rarity) + '</span>' +
          '<div class="word-display feed-word">' + escapeHtml(word.word) + '</div>' +
          (word.ipa ? '<div class="feed-ipa">/' + escapeHtml(word.ipa) + '/</div>' : '') +
          '<button type="button" class="feed-speak-btn" data-role="speak" aria-label="発音を聞く">🔊</button>' +
          '<div class="feed-meaning" data-role="meaning">' +
            '<div class="feed-ja">' + escapeHtml(word.ja) + '</div>' +
            (word.ex ? '<div class="feed-ex">' + escapeHtml(word.ex) + '</div>' : '') +
            (word.exJa ? '<div class="feed-exja">' + escapeHtml(word.exJa) + '</div>' : '') +
            collocHtml +
          '</div>' +
          '<div class="feed-tap-hint" data-role="hint">タップで意味 ・ ダブルタップでスカウト</div>' +
          '<div class="feed-heart-layer" data-role="heart-layer"></div>' +
        '</div>' +
        '<div class="feed-actions">' +
          '<button type="button" class="btn feed-answer-btn feed-know-btn" data-action="know">✓ 知ってた</button>' +
          '<button type="button" class="btn feed-answer-btn feed-unknown-btn" data-action="unknown">✗ まだ</button>' +
        '</div>' +
      '</div>'
    );
  }

  function screenHtml() {
    return (
      '<div class="feed-screen">' +
        '<button type="button" class="feed-back-btn" id="feed-back" aria-label="戻る">←</button>' +
        '<div class="feed-scroll" id="feed-scroll"></div>' +
      '</div>'
    );
  }

  // ---------- 単語ごとの演出 ----------

  // 意味ブロックは常にレイアウト上に確保しておき(css/feed.css 側で visibility:hidden)、
  // show クラスで可視化するだけにする。以前は hidden 属性(display:none)を外して
  // 出現させていたため、開示の瞬間にカード内の高さが変わり、中央寄せされた
  // カード内要素(ボタン等)がガタっと動いていた(SPEC_ADDICTION §5.3 対応)。
  function revealMeaning(cardEl) {
    var meaningEl = cardEl.querySelector('[data-role="meaning"]');
    var hintEl = cardEl.querySelector('[data-role="hint"]');
    if (meaningEl && !meaningEl.classList.contains("show")) {
      meaningEl.classList.add("show");
    }
    if (hintEl) hintEl.classList.add("hidden");
  }

  function spawnHeart(cardEl) {
    var layer = cardEl.querySelector('[data-role="heart-layer"]');
    if (!layer) return;
    var heart = document.createElement("div");
    heart.className = "feed-heart";
    heart.textContent = "❤";
    layer.appendChild(heart);
    window.setTimeout(function () {
      if (heart.parentNode) heart.parentNode.removeChild(heart);
    }, 900);
  }

  // ダブルタップ=スカウト(いいね心理・SPEC_ADDICTION §5.3)
  function doScout(word, cardEl) {
    spawnHeart(cardEl);
    if (TW.sfx && typeof TW.sfx.play === "function") TW.sfx.play("capture");
    var state = TW.store.state;
    state.scouted = state.scouted || [];
    if (state.scouted.indexOf(word.id) === -1) {
      state.scouted.push(word.id);
      TW.store.save();
    }
  }

  // scroll-snap-type:y mandatory の下で scrollIntoView({behavior:"smooth"}) を使うと、
  // ブラウザによってはスナップ吸着とスムーススクロールが押し合ってカクつく既知の相性問題がある。
  // プログラムスクロールの間だけ snap を無効化し、着地(scrollend、非対応環境は約600msで代替)
  // したら戻す。手動スワイプ時の snap 挙動には触れない(SPEC_ADDICTION §5.3)。
  function beginNoSnap(inst) {
    inst.noSnapCount = (inst.noSnapCount || 0) + 1;
    inst.scrollEl.classList.add("feed-scroll-nosnap");
  }

  function endNoSnap(inst) {
    inst.noSnapCount = Math.max(0, (inst.noSnapCount || 0) - 1);
    if (inst.noSnapCount === 0 && !inst.destroyed) {
      inst.scrollEl.classList.remove("feed-scroll-nosnap");
    }
  }

  function scrollToNext(inst, cardEl) {
    var next = cardEl.nextElementSibling;
    if (!next || typeof next.scrollIntoView !== "function") return;
    var scrollEl = inst.scrollEl;
    var done = false;
    var fallbackTimer = null;
    function finish() {
      if (done) return;
      done = true;
      scrollEl.removeEventListener("scrollend", finish);
      if (fallbackTimer) window.clearTimeout(fallbackTimer);
      endNoSnap(inst);
    }
    beginNoSnap(inst);
    scrollEl.addEventListener("scrollend", finish);
    fallbackTimer = window.setTimeout(finish, 600);
    inst.pendingCleanups.push(finish); // 画面離脱時に確実に後始末する
    next.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  // ✓/✗ → TW.srs.answer + XP+2(SPEC_ADDICTION §5.3)。TW.level は疎結合ガード付きで呼ぶ。
  function onAnswer(inst, cardEl, word, correct) {
    if (cardEl.classList.contains("answered")) return; // 同じカードへの二重回答を防ぐ
    cardEl.classList.add("answered");

    var result = TW.srs.answer(word.id, correct, 4000);
    if (typeof TW.level !== "undefined" && typeof TW.level.addXp === "function") {
      TW.level.addXp(2);
    }
    TW.store.save();

    if (TW.sfx && typeof TW.sfx.play === "function") {
      TW.sfx.play(correct ? "correct" : "wrong");
      if (result && result.captured) TW.sfx.play("capture");
    }
    cardEl.classList.add(correct ? "feed-answered-know" : "feed-answered-unknown");

    // 回答したら自動で次のカードへ送る(2026-07-06: 手動スワイプ不要のテンポ優先。スワイプも引き続き可)
    window.setTimeout(function () {
      if (inst.destroyed || !cardEl.isConnected) return; // 画面離脱後は何もしない
      scrollToNext(inst, cardEl);
    }, 400);
  }

  function bindCardEvents(inst, cardEl, word) {
    var tapZone = cardEl.querySelector('[data-role="tapzone"]');
    var lastTapAt = 0;
    var tapTimer = null;

    tapZone.addEventListener("click", function (ev) {
      if (ev.target.closest && ev.target.closest('[data-role="speak"]')) return; // 発音ボタンは別処理
      var now = Date.now();
      if (now - lastTapAt < DOUBLE_TAP_MS) {
        lastTapAt = 0;
        if (tapTimer) { window.clearTimeout(tapTimer); tapTimer = null; }
        doScout(word, cardEl);
        return;
      }
      lastTapAt = now;
      if (tapTimer) window.clearTimeout(tapTimer);
      tapTimer = window.setTimeout(function () {
        tapTimer = null;
        revealMeaning(cardEl);
      }, DOUBLE_TAP_MS);
    });
    inst.pendingCleanups.push(function () {
      if (tapTimer) window.clearTimeout(tapTimer);
    });

    var speakBtn = cardEl.querySelector('[data-role="speak"]');
    if (speakBtn) {
      speakBtn.addEventListener("click", function (ev) {
        ev.stopPropagation();
        if (TW.sfx && typeof TW.sfx.speak === "function") TW.sfx.speak(word.word);
      });
    }

    var knowBtn = cardEl.querySelector('[data-action="know"]');
    var unknownBtn = cardEl.querySelector('[data-action="unknown"]');
    if (knowBtn) knowBtn.addEventListener("click", function (ev) {
      ev.stopPropagation();
      onAnswer(inst, cardEl, word, true);
    });
    if (unknownBtn) unknownBtn.addEventListener("click", function (ev) {
      ev.stopPropagation();
      onAnswer(inst, cardEl, word, false);
    });
  }

  // ---------- キュー補充 ----------

  function appendWords(inst, words) {
    if (!inst || inst.destroyed || !words || words.length === 0) return;
    var frag = document.createDocumentFragment();
    var startSeq = inst.total;
    for (var i = 0; i < words.length; i++) {
      var word = words[i];
      var seq = startSeq + i;
      var wrap = document.createElement("div");
      wrap.innerHTML = cardHtml(word, seq);
      var cardEl = wrap.firstElementChild;
      frag.appendChild(cardEl);
      bindCardEvents(inst, cardEl, word);
      inst.cardObserver.observe(cardEl);
    }
    inst.total += words.length;
    inst.scrollEl.appendChild(frag);
  }

  // 画面外に流れ去った古いカードをDOMとIntersectionObserverの観測対象から解放する
  // (無限追加によるDOM・イベントリスナー・observer登録の肥大化を防ぐ)。
  // 現在位置より上のカードを消すとコンテンツ全体が上にシフトし、scrollTop の指す
  // 位置が実質的にずれて画面が跳ぶ(ブラウザのscroll anchoringに頼らず自前で補正する)。
  // そのため削除した高さの合計を同一フレーム内(rAFを挟まず)で scrollTop から差し引く。
  function pruneCards(inst, seq) {
    if (inst.destroyed) return;
    var threshold = seq - PRUNE_BEHIND;
    var removedHeight = 0;
    var child = inst.scrollEl.firstElementChild;
    while (child) {
      var next = child.nextElementSibling;
      if (Number(child.getAttribute("data-seq")) >= threshold) break; // 以降は保持対象
      removedHeight += child.offsetHeight; // removeChild前に測る
      inst.cardObserver.unobserve(child);
      inst.scrollEl.removeChild(child);
      child = next;
    }
    if (removedHeight > 0) {
      inst.scrollEl.scrollTop -= removedHeight;
    }
  }

  // 終端を作らない(SPEC_ADDICTION §5.3): 残りが少なくなったら buildQueue(10) を追加で呼ぶ。
  function maybeRefill(inst, seq) {
    if (inst.destroyed) return;
    pruneCards(inst, seq);
    if (inst.total - 1 - seq > PREFETCH_REMAIN) return;
    var more = TW.srs.buildQueue(BATCH_SIZE);
    appendWords(inst, more);
  }

  // ---------- カードの表示/非表示(自動発音・自動意味表示) ----------

  function onCardActive(inst, cardEl) {
    if (inst.activeCardEl === cardEl) return;
    if (inst.revealTimer) { window.clearTimeout(inst.revealTimer); inst.revealTimer = null; }
    inst.activeCardEl = cardEl;

    var wordId = cardEl.getAttribute("data-word-id");
    var word = TW.store.wordById(wordId);
    var settings = TW.store.state && TW.store.state.settings;
    if (word && settings && settings.voice !== false && TW.sfx && typeof TW.sfx.speak === "function") {
      // 速いスクロールで発音がキューに溜まって遅れて再生されるのを防ぐ(TW.sfx.speakはcancelしないため、
      // ここで直前の発話を止めてから話させる。window.speechSynthesis 標準APIの直接利用のみで
      // js/audio/sfx.js の内部実装には依存しない)。
      try {
        if (window.speechSynthesis && typeof window.speechSynthesis.cancel === "function") {
          window.speechSynthesis.cancel();
        }
      } catch (e) { /* 未対応環境では無視 */ }
      TW.sfx.speak(word.word);
    }

    inst.revealTimer = window.setTimeout(function () {
      inst.revealTimer = null;
      if (!inst.destroyed) revealMeaning(cardEl);
    }, AUTO_REVEAL_MS);
  }

  function onCardInactive(inst, cardEl) {
    if (inst.activeCardEl !== cardEl) return;
    inst.activeCardEl = null;
    if (inst.revealTimer) { window.clearTimeout(inst.revealTimer); inst.revealTimer = null; }
  }

  // ---------- マウント ----------

  function bindBack(container) {
    var backBtn = container.querySelector("#feed-back");
    if (!backBtn) return;
    backBtn.addEventListener("click", function () {
      if (TW.sfx && typeof TW.sfx.play === "function") TW.sfx.play("tap");
      if (TW.router && typeof TW.router.go === "function") TW.router.go("home");
    });
  }

  TW.ui.feed = {
    render: function (container) {
      // 前のインスタンスが残っていれば即座に解放(同一画面への再renderの多重登録防止)。
      if (active) teardown(active);

      var inst = {
        destroyed: false,
        scrollEl: null,
        cardObserver: null,
        mountObserver: null,
        revealTimer: null,
        activeCardEl: null,
        total: 0,
        noSnapCount: 0,
        pendingCleanups: []
      };
      active = inst;

      container.innerHTML = screenHtml();
      inst.scrollEl = container.querySelector("#feed-scroll");

      inst.cardObserver = new IntersectionObserver(function (entries) {
        if (inst.destroyed) return;
        for (var i = 0; i < entries.length; i++) {
          var entry = entries[i];
          var cardEl = entry.target;
          if (entry.isIntersecting && entry.intersectionRatio >= 0.6) {
            onCardActive(inst, cardEl);
            maybeRefill(inst, Number(cardEl.getAttribute("data-seq")));
          } else {
            onCardInactive(inst, cardEl);
          }
        }
      }, { root: inst.scrollEl, threshold: [0, 0.6, 1] });

      bindBack(container);

      // router は画面遷移の度に container(#app) の innerHTML を丸ごと差し替える方式のため、
      // 自分の描画ルートが container の子から外れたことを MutationObserver で検知して
      // IntersectionObserver・タイマー・イベントを確実に解放する。
      var rootEl = container.querySelector(".feed-screen");
      inst.mountObserver = new MutationObserver(function () {
        if (!rootEl.isConnected) teardown(inst);
      });
      inst.mountObserver.observe(container, { childList: true });

      appendWords(inst, TW.srs.buildQueue(BATCH_SIZE));
    }
  };
})();
