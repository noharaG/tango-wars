// js/ui/home.js — ホーム画面 (TW.ui.home) + スカウトガチャ (TW.ui.gacha)
// SPEC_UI §2.1 / SPEC_CORE §4 準拠。担当ファイル: js/ui/home.js, css/home.css のみ。
window.TW = window.TW || {};

(function () {
  "use strict";

  TW.ui = TW.ui || {};

  // render() で描画した #app コンテナへの参照。クエスト受取/ガチャ後の再描画に使う。
  var homeContainer = null;

  // ---------- 小物ユーティリティ ----------

  function fmt(n) {
    return (TW.util && typeof TW.util.fmt === "function") ? TW.util.fmt(n) : String(n);
  }

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

  // カウントアップアニメ(300ms, easeOutCubic) — SPEC_UI §3
  function countUp(el, from, to, ms) {
    if (!el) return;
    ms = ms || 300;
    var t0 = (window.performance && performance.now) ? performance.now() : Date.now();
    function step(now) {
      var p = Math.min(1, (now - t0) / ms);
      var eased = 1 - Math.pow(1 - p, 3);
      var v = Math.round(from + (to - from) * eased);
      el.textContent = fmt(v);
      if (p < 1) requestAnimationFrame(step);
    }
    requestAnimationFrame(step);
  }

  // デイリークエストの id → 表示文言。
  // 注: SPEC_CORE の QuestItem は {id, done, goal, claimed} のみで表示ラベル用の
  // フィールドが契約に無いため、プール(SPEC_CORE §4 TW.quest.getDaily)の説明文から
  // id の命名を推測してここだけで解決している。quest.js 側の実際の id 命名が
  // 異なる場合は末尾の汎用フォールバックに落ちる(表示は崩れない)。
  function questLabel(item) {
    var id = String(item.id || "");
    var goal = item.goal;
    if (id.indexOf("battle") === 0) return "対局 " + goal + "回";
    if (id.indexOf("win") === 0) return "勝利 " + goal + "回";
    if (id.indexOf("review") === 0) return "復習 " + goal + "語";
    if (id.indexOf("new") === 0) return "新出語 " + goal + "語";
    if (id.indexOf("combo") === 0) return "コンボ " + goal;
    return "クエスト (" + goal + ")";
  }

  // ---------- 描画パーツ ----------

  function renderRankCard(rank, s) {
    var streakDays = (s.streak && s.streak.days) || 0;
    var progress = TW.util.clamp(rank.progress, 0, 100);
    // 昇級煽りバッジ (SPEC_ADDICTION §5.1): 達成率75%以上で表示
    var promoBadge = progress >= 75
      ? '<div class="home-promo-badge">⚡あと1勝で昇級!</div>'
      : '';
    return (
      '<section class="card home-rank-card">' +
        '<div class="home-rank-top">' +
          '<div class="home-rank-name">' + escapeHtml(rank.name) + '</div>' +
          '<div class="home-rank-side">' +
            '<div class="home-elo">Elo <span data-elo>' + fmt(Math.round(rank.elo)) + '</span></div>' +
            '<div class="home-streak">🔥 <span data-streak>' + fmt(streakDays) + '</span>日</div>' +
          '</div>' +
        '</div>' +
        '<div class="bar home-rank-bar"><div class="bar-fill" style="width:' + progress + '%"></div></div>' +
        '<div class="home-rank-progress-label' + (progress >= 90 ? ' hot' : '') + '">達成率 <b>' + Math.round(progress) + '%</b></div>' +
        promoBadge +
      '</section>'
    );
  }

  // XPバー (SPEC_ADDICTION §5.1): 段位カードの下に常時見える成長メーター。
  // TW.level が未読込(script順序未整備・別担当実装中)でも home 全体が壊れないよう疎結合ガードする。
  function renderXpBar() {
    if (!TW.level || typeof TW.level.current !== "function") return "";
    var lv = TW.level.current();
    var pct = lv.xpNeed > 0 ? TW.util.clamp(Math.round((lv.xpInto / lv.xpNeed) * 100), 0, 100) : 0;
    return (
      '<section class="card home-xp-card">' +
        '<div class="home-xp-top">' +
          '<div class="home-xp-level">Lv.' + fmt(lv.level) + '</div>' +
          '<div class="home-xp-nums tabular-nums">' + fmt(lv.xpInto) + ' / ' + fmt(lv.xpNeed) + ' XP</div>' +
        '</div>' +
        '<div class="bar home-xp-bar"><div class="bar-fill" style="width:' + pct + '%"></div></div>' +
      '</section>'
    );
  }

  function renderBattleButtons(dueCount) {
    return (
      '<section class="home-battle-block">' +
        '<div class="home-battle-row">' +
          '<button type="button" class="btn btn-primary btn-big home-battle-btn" data-action="battle">⚔ ランク対局</button>' +
          // ブリッツ60ボタン (SPEC_ADDICTION §5.1): 対局ボタンの隣に小さめで配置
          '<button type="button" class="btn home-blitz-btn" data-action="blitz">⏱<br>ブリッツ60</button>' +
        '</div>' +
        '<button type="button" class="btn home-train-btn" data-action="train">' +
          '<span>特訓(復習 ' + fmt(dueCount) + '語)</span>' +
          (dueCount > 0 ? '<span class="badge home-due-badge">' + fmt(dueCount) + '</span>' : '') +
        '</button>' +
        // ワードフィードボタン (SPEC_ADDICTION §5.1)
        '<button type="button" class="btn home-feed-btn" data-action="feed">▶ フィード</button>' +
      '</section>'
    );
  }

  // 復習溢れゲージ (SPEC_ADDICTION §5.1): due数を0〜50で可視化。30超で赤パルス+警告文。
  function renderDueGauge(dueCount) {
    var pct = TW.util.clamp(Math.round((dueCount / 50) * 100), 0, 100);
    var overflow = dueCount > 30;
    return (
      '<section class="card home-due-card' + (overflow ? ' home-due-overflow' : '') + '" data-action="train-gauge">' +
        '<div class="home-section-title">復習ストック</div>' +
        '<div class="bar home-due-bar"><div class="bar-fill" style="width:' + pct + '%"></div></div>' +
        '<div class="home-due-label">' +
          (overflow
            ? '復習が' + fmt(dueCount) + '語たまっています — 溢れる前に回収!'
            : fmt(dueCount) + '語 / 50') +
        '</div>' +
      '</section>'
    );
  }

  // ---------- ブースト・イベント (SPEC_ADDICTION §2.2/2.3, §5.1) ----------
  // TW.daily は他担当の新規実装なので、未読込でも home が壊れないよう全て疎結合ガードする。

  function renderBoostGauge() {
    if (!TW.daily || typeof TW.daily.boostState !== "function") return "";
    var b = TW.daily.boostState();
    var slots = "";
    for (var i = 0; i < 2; i++) {
      slots += '<div class="home-boost-slot' + (i < b.stock ? ' filled' : '') + '">⚡</div>';
    }
    var chargeLabel = b.full
      ? "満タン!"
      : (typeof b.nextChargeMin === "number" ? "次まで" + fmt(b.nextChargeMin) + "分" : "");
    var btnLabel = b.pending ? "次の対局 コイン&XP 2倍!" : "使う(次の対局2倍)";
    var btnDisabled = (b.stock > 0 && !b.pending) ? "" : "disabled";
    return (
      '<section class="card home-boost-card' + (b.full ? ' home-boost-full' : '') + '">' +
        '<div class="home-boost-top">' +
          '<div class="home-section-title">ブースト</div>' +
          '<div class="home-boost-charge">' + escapeHtml(chargeLabel) + '</div>' +
        '</div>' +
        '<div class="home-boost-slots">' + slots + '</div>' +
        (b.full ? '<div class="home-boost-overflow">溢れてる! チャージ満タン</div>' : '') +
        '<button type="button" class="btn home-boost-btn' + (b.pending ? ' ready' : '') + '" data-action="use-boost" ' + btnDisabled + '>' +
          escapeHtml(btnLabel) +
        '</button>' +
      '</section>'
    );
  }

  function pad2(n) {
    return (n < 10 ? "0" : "") + n;
  }

  function fmtCountdown(endsAt) {
    var ms = Math.max(0, endsAt - Date.now());
    var totalSec = Math.floor(ms / 1000);
    var hh = Math.floor(totalSec / 3600);
    var mm = Math.floor((totalSec % 3600) / 60);
    var ss = totalSec % 60;
    // 秒まで刻む(2026-07-06: 動くカウントダウンの方が締切の圧が出る)
    return "残り" + pad2(hh) + ":" + pad2(mm) + ":" + pad2(ss);
  }

  function renderEventCard(events) {
    if (!events || events.length === 0) return "";
    var items = events.map(function (ev) {
      return (
        '<div class="home-event-item" data-ends-at="' + Number(ev.endsAt) + '">' +
          '<div class="home-event-name">' + escapeHtml(ev.name) + '</div>' +
          '<div class="home-event-desc">' + escapeHtml(ev.desc) + '</div>' +
          '<div class="home-event-countdown tabular-nums" data-event-countdown>' + fmtCountdown(ev.endsAt) + '</div>' +
        '</div>'
      );
    }).join("");
    return (
      '<section class="card home-event-card">' +
        '<div class="home-section-title">開催中イベント</div>' +
        items +
      '</section>'
    );
  }

  function renderQuests(quests) {
    var items = (quests || []).map(function (q) {
      var goal = q.goal || 0;
      var done = q.done || 0;
      var pct = goal > 0 ? TW.util.clamp(Math.round((done / goal) * 100), 0, 100) : 0;
      var achieved = done >= goal;
      var claimBtnClass = "btn home-quest-claim" + (achieved && !q.claimed ? " ready" : "");
      var claimLabel = q.claimed ? "受取済" : (achieved ? "受取る" : (fmt(done) + "/" + fmt(goal)));
      var disabled = (!achieved || q.claimed) ? "disabled" : "";
      return (
        '<div class="home-quest-item">' +
          '<div class="home-quest-text">' + escapeHtml(questLabel(q)) + '</div>' +
          '<div class="bar home-quest-bar"><div class="bar-fill" style="width:' + pct + '%"></div></div>' +
          '<button type="button" class="' + claimBtnClass + '" data-action="quest-claim" data-quest-id="' +
            escapeHtml(q.id) + '" ' + disabled + '>' + claimLabel + '</button>' +
        '</div>'
      );
    }).join("");
    return (
      '<section class="card home-quest-card">' +
        '<div class="home-section-title">デイリークエスト</div>' +
        items +
      '</section>'
    );
  }

  function renderSeasonCard(season) {
    var beatGhost = season.score > season.bestPastScore;
    return (
      '<section class="card home-season-card">' +
        '<div class="home-section-title">週次シーズン <span class="home-season-week">' +
          escapeHtml(season.weekKey) + '</span></div>' +
        '<div class="home-season-scores">' +
          '<div class="home-season-score-block">' +
            '<div class="home-season-label">今週</div>' +
            '<div class="home-season-value" data-season-score>' + fmt(season.score) + '</div>' +
          '</div>' +
          '<div class="home-season-vs">vs</div>' +
          '<div class="home-season-score-block">' +
            '<div class="home-season-label">ゴースト</div>' +
            '<div class="home-season-value home-season-ghost">' + fmt(season.bestPastScore) + '</div>' +
          '</div>' +
        '</div>' +
        (beatGhost ? '<div class="home-season-beat">ゴースト超え!</div>' : '') +
        '<div class="home-season-days">残り' + fmt(season.daysLeft) + '日</div>' +
      '</section>'
    );
  }

  function renderGachaCard(coins, tickets) {
    // チケットで引く(無料)ボタン (SPEC_ADDICTION §5.1): チケット所持時のみ併設
    var ticketBtn = tickets > 0
      ? '<button type="button" class="btn home-gacha-ticket-btn" data-action="gacha-ticket">🎫 チケットで引く(無料)<span class="badge">' + fmt(tickets) + '</span></button>'
      : '';
    return (
      '<section class="card home-gacha-card">' +
        '<div class="home-gacha-info">' +
          '<div class="home-gacha-title">スカウトガチャ</div>' +
          '<div class="home-gacha-coins">所持 <span data-coin-display>' + fmt(coins) + '</span>🪙</div>' +
        '</div>' +
        '<div class="home-gacha-buttons">' +
          '<button type="button" class="btn btn-primary home-gacha-btn" data-action="gacha">スカウトガチャ 100🪙</button>' +
          ticketBtn +
        '</div>' +
      '</section>'
    );
  }

  function renderWritingLockCard() {
    return (
      '<section class="card home-lock-card">' +
        '<div class="home-lock-icon">🔒</div>' +
        '<div class="home-lock-text">✍ 英作文 — Season 2 で解禁</div>' +
      '</section>'
    );
  }

  // ---------- イベント ----------

  function onClaimClick(id) {
    var oldCoins = TW.store.state.coins;
    var reward = TW.quest.claim(id);
    if (!reward) {
      TW.sfx.play("tap");
      return;
    }
    TW.sfx.play("capture"); // コイン獲得音: SPEC_CORE の sfx 名一覧に専用の"コイン"音が無いため代用
    rerenderHome(oldCoins);
  }

  function onGachaClick() {
    var oldCoins = TW.store.state.coins;
    if (oldCoins < 100) {
      TW.sfx.play("wrong");
      shakeGachaCard();
      return;
    }
    TW.ui.gacha.open(function () {
      rerenderHome(oldCoins);
    });
  }

  // チケットで引く(無料)ボタン (SPEC_ADDICTION §5.1)
  function onTicketGachaClick() {
    var s = TW.store.state;
    if (!((s.tickets || 0) > 0)) {
      TW.sfx.play("wrong");
      shakeGachaCard();
      return;
    }
    var oldCoins = s.coins;
    TW.ui.gacha.open(function () {
      rerenderHome(oldCoins);
    }, { useTicket: true });
  }

  function shakeGachaCard() {
    if (!homeContainer) return;
    var card = homeContainer.querySelector(".home-gacha-card");
    if (!card) return;
    card.classList.add("home-shake");
    setTimeout(function () { card.classList.remove("home-shake"); }, 220);
  }

  // 特訓(復習)へ遷移。特訓ボタンと復習溢れゲージの両方から呼ばれる共通処理。
  function goTrain() {
    TW.sfx.play("tap");
    TW.router.go("battle", { mode: "free" });
  }

  // ブーストを使う (SPEC_ADDICTION §2.2/§5.1): 次の対局のコイン&XPを2倍にする。
  function onUseBoostClick() {
    if (!TW.daily || typeof TW.daily.useBoost !== "function") return;
    var used = TW.daily.useBoost();
    TW.sfx.play(used ? "combo" : "wrong");
    if (used) rerenderHome();
  }

  // ---------- ログインボーナスモーダル (SPEC_ADDICTION §2.1/§5.1) ----------
  // TW.daily が未読込でも home 全体が壊れないよう疎結合ガードする。

  // 表示専用の報酬表(SPEC_ADDICTION §2.1 の報酬表そのもの)。実際の付与判定・状態変更は
  // TW.daily.claimLogin が行い、ここでは7マスカレンダーの見た目を組むためだけに使う。
  var LOGIN_REWARD_TABLE = {
    1: { coins: 50, tickets: 0 },
    2: { coins: 80, tickets: 0 },
    3: { coins: 100, tickets: 0 },
    4: { coins: 0, tickets: 1 },
    5: { coins: 150, tickets: 0 },
    6: { coins: 200, tickets: 0 },
    7: { coins: 300, tickets: 2 }
  };

  function loginRewardLabel(reward) {
    var parts = [];
    if (reward.coins > 0) parts.push(fmt(reward.coins) + "🪙");
    if (reward.tickets > 0) parts.push("🎫×" + reward.tickets);
    return parts.length ? parts.join("+") : "-";
  }

  function maybeShowLoginModal() {
    if (!TW.daily || typeof TW.daily.pendingLogin !== "function") return;
    var pending = TW.daily.pendingLogin();
    if (!pending) return;
    showLoginModal(pending);
  }

  function showLoginModal(pending) {
    var old = document.getElementById("home-login-overlay");
    if (old && old.parentNode) old.parentNode.removeChild(old);

    var overlay = document.createElement("div");
    overlay.id = "home-login-overlay";
    overlay.className = "modal-backdrop home-login-backdrop";

    // pending.day より前は今サイクルで受取済(サイクル開始直後=day1なら受取済0マス)
    var doneUpTo = pending.day > 1 ? pending.day - 1 : 0;
    var cells = "";
    for (var d = 1; d <= 7; d++) {
      var stateCls = d === pending.day ? "today" : (d <= doneUpTo ? "done" : "future");
      cells +=
        '<div class="home-login-cell ' + stateCls + '" data-day="' + d + '"' +
          (d === pending.day ? ' data-action="login-claim"' : '') + '>' +
          '<div class="home-login-daynum">Day' + d + '</div>' +
          '<div class="home-login-reward">' + loginRewardLabel(LOGIN_REWARD_TABLE[d]) + '</div>' +
          (stateCls === "done" ? '<div class="home-login-check">✓</div>' : '') +
        '</div>';
    }

    overlay.innerHTML =
      '<div class="modal home-login-modal">' +
        '<div class="home-login-title">ログインボーナス</div>' +
        '<div class="home-login-grid">' + cells + '</div>' +
        '<div class="home-login-hint">今日のマスをタップして受け取ろう</div>' +
      '</div>';

    document.body.appendChild(overlay);
    requestAnimationFrame(function () { overlay.classList.add("show"); });

    var todayCell = overlay.querySelector('[data-action="login-claim"]');
    if (todayCell) {
      todayCell.addEventListener("click", function () {
        onLoginClaim(todayCell);
      });
    }

    // 背景タップで一旦閉じられるようにする(受取状態自体は変わらないので次回また表示される)
    overlay.addEventListener("click", function (ev) {
      if (ev.target === overlay) closeLoginModal(overlay);
    });
  }

  function closeLoginModal(overlay) {
    overlay.classList.remove("show");
    setTimeout(function () {
      if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
    }, 200);
  }

  function onLoginClaim(cellEl) {
    if (!TW.daily || typeof TW.daily.claimLogin !== "function") return;
    var oldCoins = TW.store.state.coins;
    var claimed = TW.daily.claimLogin();
    if (!claimed) return;

    TW.sfx.play("gacha"); // コインが飛ぶ演出のsfx(SPEC_ADDICTION §5.1指定)

    var fly = document.createElement("div");
    fly.className = "home-login-fly";
    fly.textContent = "+" + loginRewardLabel(claimed);
    cellEl.appendChild(fly);
    cellEl.classList.add("claimed");

    // #app はホーム以外の画面でも同じDOM要素が再利用されるため、遅延実行までの間に
    // 別画面へ遷移されると homeContainer 自体は生存し続けてしまう。今のホーム画面の
    // ルート要素(screenRoot)を控えておき、発火時に isConnected でホーム画面が
    // まだ表示中かを自己検知する(startEventCountdown と同様の防御)。
    var overlay = document.getElementById("home-login-overlay");
    var screenRoot = homeContainer ? homeContainer.querySelector(".home-screen") : null;
    setTimeout(function () {
      if (overlay) closeLoginModal(overlay);
      if (screenRoot && !screenRoot.isConnected) return; // 別画面へ遷移済み: 再描画しない
      rerenderHome(oldCoins);
    }, 650);
  }

  // ---------- イベントカードの残り時間カウントダウン (SPEC_ADDICTION §5.1) ----------
  // 毎秒更新(秒針が動くことが締切の圧=ドーパミン)。画面遷移(=このホーム画面の
  // ルート要素がDOMから外れた時)で自動的にinterval解放する。

  var eventCountdownTimer = null;

  function stopEventCountdown() {
    if (eventCountdownTimer) {
      clearInterval(eventCountdownTimer);
      eventCountdownTimer = null;
    }
  }

  function startEventCountdown(screenRoot) {
    stopEventCountdown();
    if (!screenRoot) return;
    eventCountdownTimer = setInterval(function () {
      // screenRoot は render() ごとに新規生成される .home-screen 要素。
      // 別画面へ遷移して #app の中身が置き換わると isConnected が false になるので、
      // ここで自己検知して interval を解放する(画面遷移でinterval解放)。
      if (!screenRoot.isConnected) {
        stopEventCountdown();
        return;
      }
      var els = screenRoot.querySelectorAll("[data-event-countdown]");
      for (var i = 0; i < els.length; i++) {
        var itemEl = els[i].closest(".home-event-item");
        var endsAt = itemEl ? Number(itemEl.getAttribute("data-ends-at")) : NaN;
        if (!isNaN(endsAt)) els[i].textContent = fmtCountdown(endsAt);
      }
    }, 1000);
  }

  function bindEvents(container) {
    var battleBtn = container.querySelector('[data-action="battle"]');
    if (battleBtn) battleBtn.addEventListener("click", function () {
      TW.sfx.play("tap");
      TW.router.go("battle");
    });

    var trainBtn = container.querySelector('[data-action="train"]');
    // 注: SPEC_CORE §4 の TW.router.go は screen 単独引数のみを契約に明記しているが、
    // 本タスク指示により第2引数で { mode: "free" } を渡す。main.js の TW.router.go
    // 実装がこの第2引数を受け取り TW.ui.battle.render(container, opts) 等へ橋渡しする
    // 必要がある(このファイルの担当外なので実装はしない。deviations に転記)。
    if (trainBtn) trainBtn.addEventListener("click", goTrain);

    // 復習溢れゲージ(タップで特訓へ) — SPEC_ADDICTION §5.1
    var dueGaugeEl = container.querySelector('[data-action="train-gauge"]');
    if (dueGaugeEl) dueGaugeEl.addEventListener("click", goTrain);

    // ブリッツ60ボタン — SPEC_ADDICTION §5.1: TW.router.go("battle", {mode:"blitz"})
    var blitzBtn = container.querySelector('[data-action="blitz"]');
    if (blitzBtn) blitzBtn.addEventListener("click", function () {
      TW.sfx.play("tap");
      TW.router.go("battle", { mode: "blitz" });
    });

    // ワードフィードボタン — SPEC_ADDICTION §5.1: TW.router.go("feed")
    var feedBtn = container.querySelector('[data-action="feed"]');
    if (feedBtn) feedBtn.addEventListener("click", function () {
      TW.sfx.play("tap");
      TW.router.go("feed");
    });

    // ブーストを使う — SPEC_ADDICTION §5.1
    var useBoostBtn = container.querySelector('[data-action="use-boost"]');
    if (useBoostBtn) useBoostBtn.addEventListener("click", onUseBoostClick);

    var claimBtns = container.querySelectorAll('[data-action="quest-claim"]');
    for (var i = 0; i < claimBtns.length; i++) {
      claimBtns[i].addEventListener("click", function () {
        onClaimClick(this.getAttribute("data-quest-id"));
      });
    }

    var gachaBtn = container.querySelector('[data-action="gacha"]');
    if (gachaBtn) gachaBtn.addEventListener("click", onGachaClick);

    // チケットで引く(無料) — SPEC_ADDICTION §5.1
    var gachaTicketBtn = container.querySelector('[data-action="gacha-ticket"]');
    if (gachaTicketBtn) gachaTicketBtn.addEventListener("click", onTicketGachaClick);
  }

  // 実際の描画本体。TW.ui.home.render() と rerenderHome() の両方から呼ばれる。
  // ログボモーダルの自動オープンはここでは行わない(クエスト受取等の内部再描画のたびに
  // モーダルが再度ポップアップしてしまうのを防ぐため、render() 側だけの責務にする)。
  function paintHome(container) {
    homeContainer = container;

    var s = TW.store.state;
    var rank = TW.rating.current();
    var dueCount = TW.srs.dueWords().length;
    var quests = TW.quest.getDaily();
    var season = TW.quest.seasonInfo();
    var events = (TW.daily && typeof TW.daily.currentEvents === "function") ? TW.daily.currentEvents() : [];

    container.innerHTML =
      '<div class="home-screen">' +
        renderRankCard(rank, s) +
        renderXpBar() +
        renderBattleButtons(dueCount) +
        renderDueGauge(dueCount) +
        renderBoostGauge() +
        renderEventCard(events) +
        renderQuests(quests) +
        renderSeasonCard(season) +
        renderGachaCard(s.coins, s.tickets || 0) +
        renderWritingLockCard() +
      '</div>';

    bindEvents(container);

    // イベントカードが無い(=currentEvents未対応 or 開催中イベント無し)ときは
    // 無駄なintervalを立てない。
    var screenRoot = container.querySelector(".home-screen");
    if (screenRoot && screenRoot.querySelector("[data-event-countdown]")) {
      startEventCountdown(screenRoot);
    } else {
      stopEventCountdown();
    }
  }

  function rerenderHome(oldCoins) {
    if (!homeContainer) return;
    var newCoins = TW.store.state.coins;
    paintHome(homeContainer);
    if (typeof oldCoins === "number" && oldCoins !== newCoins) {
      var el = homeContainer.querySelector("[data-coin-display]");
      if (el) countUp(el, oldCoins, newCoins, 300);
    }
  }

  // ============ TW.ui.home ============

  TW.ui.home = {
    render: function (container) {
      paintHome(container);
      // ログボモーダル: pendingLogin があれば home 表示時に自動オープン(SPEC_ADDICTION §5.1)
      maybeShowLoginModal();
    }
  };

  // ============ TW.ui.gacha ============
  // 100コイン消費→未習得語(TW.store.state.srs に無い語)からレア度抽選(N40/R30/SR15/SSR10/UR5%)
  // で3語スカウト→ state.scouted に追加。全画面オーバーレイで3枚裏向き→タップでフリップ。

  var RARITY_WEIGHTS = [["N", 40], ["R", 30], ["SR", 15], ["SSR", 10], ["UR", 5]];

  function weightedPickRarity() {
    var total = 0;
    for (var i = 0; i < RARITY_WEIGHTS.length; i++) total += RARITY_WEIGHTS[i][1];
    var r = Math.random() * total;
    var acc = 0;
    for (var j = 0; j < RARITY_WEIGHTS.length; j++) {
      acc += RARITY_WEIGHTS[j][1];
      if (r < acc) return RARITY_WEIGHTS[j][0];
    }
    return RARITY_WEIGHTS[RARITY_WEIGHTS.length - 1][0];
  }

  function buildGachaPools() {
    var learned = TW.store.state.srs || {};
    // 注: タスク指示の一行仕様は「srsに無い語」のみを除外条件としているが、
    // 既にスカウト中(state.scouted)の語を再度スカウト対象に含めると同じ語が
    // 重複してカードに出るだけで意味が無いため、ここでは追加でスカウト中の語も
    // 候補から除外する(この関数内だけの実装判断。deviations に記載)。
    var scoutedSet = {};
    (TW.store.state.scouted || []).forEach(function (id) { scoutedSet[id] = true; });

    var pools = { N: [], R: [], SR: [], SSR: [], UR: [] };
    TW.store.allWords().forEach(function (w) {
      if (learned[w.id] || scoutedSet[w.id]) return;
      if (pools[w.rarity]) pools[w.rarity].push(w);
    });
    return pools;
  }

  function drawOneWord(pools, pickedIds) {
    var attempts = 0;
    while (attempts < 30) {
      attempts++;
      var rarity = weightedPickRarity();
      var pool = pools[rarity].filter(function (w) { return !pickedIds[w.id]; });
      if (pool.length > 0) return TW.util.pick(pool);
    }
    // 在庫が無いレア度が続けて当たった場合のフォールバック: 在庫があるレア度から拾う
    var rarities = Object.keys(pools);
    for (var i = 0; i < rarities.length; i++) {
      var left = pools[rarities[i]].filter(function (w) { return !pickedIds[w.id]; });
      if (left.length > 0) return TW.util.pick(left);
    }
    return null; // 全レア度で在庫が尽きている(コレクション埋まり間近)
  }

  function pickGachaWords() {
    var pools = buildGachaPools();
    var pickedIds = {};
    var picked = [];
    for (var i = 0; i < 3; i++) {
      var w = drawOneWord(pools, pickedIds);
      if (!w) break;
      picked.push(w);
      pickedIds[w.id] = true;
    }
    return picked;
  }

  function showGachaOverlay(words, onClose) {
    var old = document.getElementById("gacha-overlay");
    if (old) old.parentNode.removeChild(old);

    var overlay = document.createElement("div");
    overlay.id = "gacha-overlay";
    overlay.className = "gacha-overlay";

    var cardsHtml = words.map(function (w, i) {
      var auraClass = w.rarity === "SSR" ? "gacha-aura-ssr" : (w.rarity === "UR" ? "gacha-aura-ur" : "");
      return (
        '<div class="gacha-card ' + auraClass + '" data-idx="' + i + '">' +
          '<div class="gacha-card-inner">' +
            '<div class="gacha-card-face gacha-card-back"><div class="gacha-card-mark">?</div></div>' +
            '<div class="gacha-card-face gacha-card-front ' + rarityClass(w.rarity) + '">' +
              '<div class="gacha-card-rarity">' + escapeHtml(w.rarity) + '</div>' +
              '<div class="gacha-card-word">' + escapeHtml(w.word) + '</div>' +
              '<div class="gacha-card-ja">' + escapeHtml(w.ja) + '</div>' +
            '</div>' +
          '</div>' +
        '</div>'
      );
    }).join("");

    overlay.innerHTML =
      '<div class="gacha-title">スカウトガチャ</div>' +
      '<div class="gacha-hint">タップしてめくる</div>' +
      '<div class="gacha-cards">' + cardsHtml + '</div>' +
      '<button type="button" class="btn btn-primary btn-big gacha-close" disabled>スカウト完了</button>';

    document.body.appendChild(overlay);
    requestAnimationFrame(function () { overlay.classList.add("show"); });

    var flippedCount = 0;

    function finishFlip(cardEl, w) {
      cardEl.classList.add("flipped");
      var isRare = w.rarity === "SSR" || w.rarity === "UR";
      TW.sfx.play(isRare ? "kira" : "capture");
      flippedCount++;
      if (flippedCount === words.length) {
        var closeBtn = overlay.querySelector(".gacha-close");
        closeBtn.disabled = false;
        closeBtn.classList.add("ready");
      }
    }

    // ガチャのニアミス演出 (SPEC_ADDICTION §5.1): R/SRが出た時30%で
    // 「金オーラが立ち上がる→寸前で色が落ちて開示」+「惜しい!!」カットインを挟む。
    function playNearMiss(cardEl, w) {
      cardEl.classList.add("near-miss-playing", "near-miss-gold");
      TW.sfx.play("combo");
      var caption = document.createElement("div");
      caption.className = "gacha-near-miss-text";
      caption.textContent = "惜しい!!";
      overlay.appendChild(caption);
      setTimeout(function () {
        cardEl.classList.remove("near-miss-gold");
        cardEl.classList.add("near-miss-drop");
      }, 550);
      setTimeout(function () {
        cardEl.classList.remove("near-miss-playing", "near-miss-drop");
        if (caption.parentNode) caption.parentNode.removeChild(caption);
        finishFlip(cardEl, w);
      }, 820);
    }

    var cardEls = overlay.querySelectorAll(".gacha-card");
    for (var i = 0; i < cardEls.length; i++) {
      (function (cardEl, idx) {
        cardEl.addEventListener("click", function () {
          if (cardEl.classList.contains("flipped") || cardEl.classList.contains("near-miss-playing")) return;
          var w = words[idx];
          var nearMissEligible = w.rarity === "R" || w.rarity === "SR";
          if (nearMissEligible && Math.random() < 0.3) {
            playNearMiss(cardEl, w);
          } else {
            finishFlip(cardEl, w);
          }
        });
      })(cardEls[i], i);
    }

    overlay.querySelector(".gacha-close").addEventListener("click", function () {
      overlay.classList.remove("show");
      setTimeout(function () {
        if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
        if (typeof onClose === "function") onClose();
      }, 200);
    });
  }

  TW.ui.gacha = {
    // ガチャを実行して全画面オーバーレイを表示する。onClose はオーバーレイを閉じた後に呼ばれる。
    // opts.useTicket: true の場合、コイン100の代わりにチケット1枚を消費する
    // (SPEC_ADDICTION §5.1「チケットで引く(無料)」)。opts は追加の任意引数なので既存呼び出しに影響しない。
    open: function (onClose, opts) {
      opts = opts || {};
      var useTicket = !!opts.useTicket;
      var s = TW.store.state;

      if (useTicket) {
        if (!((s.tickets || 0) > 0)) {
          TW.sfx.play("wrong");
          return;
        }
      } else if (s.coins < 100) {
        TW.sfx.play("wrong");
        return;
      }

      var picks = pickGachaWords();
      if (picks.length === 0) {
        // スカウト対象語が尽きている(図鑑がほぼ埋まっている等) → コイン/チケットは消費しない
        TW.sfx.play("wrong");
        return;
      }

      if (useTicket) {
        s.tickets -= 1;
      } else {
        s.coins -= 100;
      }
      s.scouted = s.scouted || [];
      var already = {};
      s.scouted.forEach(function (id) { already[id] = true; });
      picks.forEach(function (w) {
        if (!already[w.id]) { s.scouted.push(w.id); already[w.id] = true; }
      });
      TW.store.save();

      TW.sfx.play("gacha");
      showGachaOverlay(picks, onClose);
    }
  };
})();
