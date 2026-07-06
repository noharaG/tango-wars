window.TW = window.TW || {};
window.TW.ui = window.TW.ui || {};

// js/ui/battle-ui.js — バトル画面 (TW.ui.battle) + リザルト画面 (TW.ui.result)
// SPEC_UI §2.2(バトル) §2.3(リザルト) §3(演出メモ) を実装。
// 担当ファイル: js/ui/battle-ui.js, js/ui/fx.js, css/battle.css のみ。
//
// 実装上の注記(契約に明記が無く、本ファイルで判断した点。詳細は末尾のコメントも参照):
// - TW.ui.battle.render(container, opts) は SPEC_CORE 契約上 render(container) だが、
//   js/ui/home.js が既に TW.router.go("battle", { mode: "free" }) という第2引数付き呼び出しを
//   実装済み(コメントで明記)。main.js のルータがこの opts を render の第2引数へ橋渡しする前提で、
//   ここでは render(container, opts) として opts.mode を受け取る(未指定/"rank"以外は既定 "rank")。
// - TW.battle.start の onEvent はここでは no-op にしている。next/submit/end の戻り値だけで
//   UI更新に必要な情報が全て得られるため(onEvent は将来の拡張フック用と判断)。
// - 実際の js/game/battle.js 実装では Session.tick(now) の now は Date.now() 基準
//   (Session.startAt = Date.now())。SPEC_CORE には基準時刻の明記が無いが、これに合わせて
//   Date.now() を渡す(performance.now() を渡すと基準がずれて壊れるため重要)。
// - DESIGN.md は特訓(free)を「時間無制限・10問1セット」としているが、実装済みの
//   TW.battle Session は durationMs 経過(next()がnullを返す)を前提に end() のボット最終スコアを
//   計算する作りになっており、UI側で早期に end() を呼ぶとボットスコアが実際の経過時間と
//   矛盾する(不整合な数値になる)。SPEC_CORE の Session.end も「時間切れ時に呼ぶ」と明記して
//   いるため、free モードもタイマー画面込みで rank と同じ DURATION_MS フローに統一し、モード表示
//   ラベルとレート変動の有無だけを差別化した(コインは battle.js 側で free=15固定、
//   rank は applyResult を実行、が既に実装されている)。
// - Result.rank(TW.rating.applyResult の戻り値)には rank: {name,index,progress,elo} が
//   ネストしている(js/core/rating.js の実装を確認済み)。
// - js/game/battle.js の Session.end() は TW.quest.checkAchievements を呼んでいない
//   (quest.onAction/addSeasonScore のみ)。実績を実際に解除させるため、リザルト表示時に
//   ここから TW.quest.checkAchievements を呼ぶ(公開APIの利用のみで battle.js 本体は変更しない)。
// - 同様に Result.questEvents は battle.js 実装上 TW.quest.getDaily()(doneが常に0の再生成)
//   が入っており対局中の実際の進捗を反映していない。リザルトのクエスト進捗表示は
//   TW.store.state.quests.items(実際の進捗)を優先して読み、取れない場合のみ
//   result.questEvents にフォールバックする。
// - js/game/battle.js の Session.end() は(addCoins/applyResult/srs.answer/onAction等で
//   state を書き換えるにもかかわらず)どこからも TW.store.save() を呼んでいない。
//   SPEC_CORE の TW.store.save 契約注記「対局中は battle 側が節度を持つ」は対局終了時には
//   保存されることを前提にしていると読めるため、リザルト表示開始時に保護的に
//   TW.store.save() を呼び、対局の成果(コイン・Elo・段位・クエスト進捗・SRS等)が
//   確実に永続化されるようにした(公開APIの呼び出しのみ)。
//
// ---- SPEC_ADDICTION §5.2 追加分の注記 ----
// - TW.bgm / TW.level / TW.daily は本ファイルの担当外(js/core/level.js 等)。存在しない/
//   読み込み順が前後する環境でも壊れないよう、呼び出しは全て typeof ガード付きの bgmCall() 経由。
// - ブリッツ(mode:"blitz")はボット不在(Session.botInfo=null)のため、対向バーは「自己ベスト」の
//   ゴースト(TW.store.state.blitzBest を経過時間に対して線形補間した想定ペース)を表示する。
//   既存の #bt-bot-score/#bt-bot-bar の更新関数をそのまま再利用し、見た目のラベルだけ差し替える。
// - 1問3秒の強制タイムアウトは本UIが setTimeout で管理し、時間切れは
//   Session.submit(null, ms, {skipSrs:true}) を「誤答」として送る(battle.js 側で SRS 記録をスキップする)。
//   画面遷移・回答完了時は必ずタイマーを止める(clearBlitzTimer)。

(function () {
  "use strict";

  var DURATION_MS = 60000;    // ランク/特訓は1分(2026-07-05: 30秒を試したが1分に戻した)
  var BLITZ_DURATION_MS = 60000;   // SPEC_ADDICTION §3 ブリッツ60
  var BLITZ_QUESTION_MS = 3000;    // SPEC_ADDICTION §5.2 1問3秒の円形タイマー
  var TICK_INTERVAL_MS = 200;
  var WRONG_DELAY_MS = 1300;  // 誤答時のみ正解表示を挟んで待つ(SPEC_UI §2.2改修: 650msでは読めないため2026-07-05に強化)
  var CORRECT_DELAY_MS = 110; // 正解時はテンポ優先でごく短い間だけ演出を見せて次へ
  var FEVER_MS = 15000;

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

  function clamp(x, lo, hi) {
    if (TW.util && typeof TW.util.clamp === "function") return TW.util.clamp(x, lo, hi);
    return Math.min(hi, Math.max(lo, x));
  }

  // TW.bgm 呼び出し用の疎結合ヘルパ(SPEC_ADDICTION §4 / §5.2: typeofガード付きで結線する)
  function bgmCall(method, args) {
    if (window.TW && TW.bgm && typeof TW.bgm[method] === "function") {
      TW.bgm[method].apply(TW.bgm, args || []);
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
      if (p < 1) window.requestAnimationFrame(step);
    }
    window.requestAnimationFrame(step);
  }

  function rectCenter(el) {
    var r = el.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  }

  // ============================================================
  // TW.ui.battle
  // ============================================================

  var st = null; // 現在の対局UI状態(render() ごとに再生成)

  function stopTicking() {
    if (st && st.tickTimer) {
      window.clearInterval(st.tickTimer);
      st.tickTimer = null;
    }
  }

  // ブリッツの1問3秒タイマー(SPEC_ADDICTION §5.2)。画面遷移・回答完了時に必ず止める。
  function clearBlitzTimer() {
    if (st && st.blitzTimer) {
      window.clearTimeout(st.blitzTimer);
      st.blitzTimer = null;
    }
  }

  // botInfo.name(TW.rating.botFor 由来の二つ名)を表示名として使う。二つ名生成ロジック自体は
  // rating.js に一本化済み(以前ここにあったEPITHETSランダム合成は削除)。
  function buildBotFlavor(botInfo) {
    // 注: Sessionの段位(botElo由来)は公開されないため、表示する段位は近似として
    // プレイヤー自身の現在の段位名を流用する(自Elo±150なので大きく外れることは無い)。
    // スコアそのものは常にSession.tick()/submit()の返り値を使うので、表示上の近似が
    // 数値の食い違いを生むことは無い。
    var rankName = "";
    try {
      rankName = TW.rating.current().name;
    } catch (e) { /* 取得失敗時は空表示 */ }
    var label = (botInfo && botInfo.name) ? botInfo.name : "ライバル";
    return { label: label, rankName: rankName };
  }

  function screenHtml(mode, bot) {
    var isBlitz = mode === "blitz";
    var modeLabel = isBlitz ? "⚡ ブリッツ60(自己ベスト勝負)" :
      (mode === "free" ? "📖 特訓(レート変動なし)" : "⚔ ランク対局");
    // ブリッツはボット無し(SPEC_ADDICTION §3)なので対向側は「自己ベスト」のゴースト表示にする
    var rightLabelHtml = isBlitz
      ? "🏆 自己ベスト"
      : escapeHtml(bot.label) + '<span class="battle-bot-rank">' + escapeHtml(bot.rankName) + '</span>';
    return (
      '<div class="battle-screen">' +
        '<div class="card battle-top' + (isBlitz ? ' battle-top-blitz' : '') + '">' +
          '<div class="battle-mode-label">' + escapeHtml(modeLabel) + '</div>' +
          '<div class="bar battle-timer"><div class="bar-fill" id="bt-timer-fill"></div></div>' +
          '<div class="battle-vs-row">' +
            '<div class="battle-vs-side battle-vs-me">' +
              '<div class="battle-vs-label">YOU</div>' +
              '<div class="battle-vs-score tabular-nums" id="bt-my-score">0</div>' +
            '</div>' +
            '<div class="battle-vs-mid">' + (isBlitz ? "🏁" : "VS") + '</div>' +
            '<div class="battle-vs-side battle-vs-bot' + (isBlitz ? ' battle-vs-ghost' : '') + '">' +
              '<div class="battle-vs-label">' + rightLabelHtml + '</div>' +
              '<div class="battle-vs-score tabular-nums" id="bt-bot-score">0</div>' +
            '</div>' +
          '</div>' +
          '<div class="battle-vs-bars">' +
            '<div class="bar battle-vs-bar battle-vs-bar-me"><div class="bar-fill" id="bt-me-bar"></div></div>' +
            '<div class="bar battle-vs-bar battle-vs-bar-bot"><div class="bar-fill" id="bt-bot-bar"></div></div>' +
          '</div>' +
          '<div class="badge battle-combo-badge hidden" id="bt-combo">0 COMBO</div>' +
        '</div>' +
        '<div class="battle-mid">' +
          '<div class="card battle-question-card" id="bt-qcard">' +
            '<div class="bar battle-fever-bar hidden" id="bt-fever-bar"><div class="bar-fill" id="bt-fever-fill"></div></div>' +
            '<div class="badge battle-event-badge hidden" id="bt-event-badge">×1.5</div>' +
            '<div id="bt-qcontent"></div>' +
          '</div>' +
        '</div>' +
        '<div class="battle-answer-area" id="bt-answer-area"></div>' +
      '</div>'
    );
  }

  // ブリッツ用の1問3秒円形タイマー(SPEC_ADDICTION §5.2)。問題ごとに新規DOMとして挿入し、
  // CSSアニメ(battle-blitz-ring-kf, 3s)を毎回最初から再生させる(JS側でのアニメ再始動処理は不要)。
  function blitzRingHtml() {
    return (
      '<div class="battle-blitz-ring" aria-hidden="true">' +
        '<svg viewBox="0 0 60 60">' +
          '<circle class="battle-blitz-ring-bg" cx="30" cy="30" r="26"></circle>' +
          '<circle class="battle-blitz-ring-fg" cx="30" cy="30" r="26"></circle>' +
        '</svg>' +
      '</div>'
    );
  }

  // 出題語が現在の強化週間カテゴリと一致する場合の倍率(SPEC_ADDICTION §2.3/§5.2)。
  // TW.daily 未読込・イベント無しなら null(疎結合ガード)。
  function currentEventMultForWord(word) {
    if (!(window.TW && TW.daily && typeof TW.daily.currentEvents === "function")) return null;
    var events;
    try {
      events = TW.daily.currentEvents();
    } catch (e) {
      return null;
    }
    if (!Array.isArray(events)) return null;
    for (var i = 0; i < events.length; i++) {
      var ev = events[i];
      if (ev && ev.type === "cat" && ev.cat === word.cat) return ev.mult;
    }
    return null;
  }

  function questionContentHtml(q) {
    if (q.type === "en2ja") {
      return (
        '<div class="battle-q-en">' +
          '<div class="word-display battle-word">' + escapeHtml(q.prompt) + '</div>' +
          (q.word.ipa ? '<div class="battle-ipa">' + escapeHtml(q.word.ipa) + '</div>' : '') +
          '<button type="button" class="battle-speak-btn" id="bt-speak" aria-label="発音を聞く">🔊</button>' +
        '</div>'
      );
    }
    if (q.type === "cloze") {
      // 例文穴埋め: 英文をやや小さめのフォントで表示し、下にexJa(和訳ヒント)を小さく併記する
      return (
        '<div class="battle-q-cloze">' +
          '<div class="battle-cloze-ex">' + escapeHtml(q.prompt) + '</div>' +
          (q.word.exJa ? '<div class="battle-cloze-hint">' + escapeHtml(q.word.exJa) + '</div>' : '') +
        '</div>'
      );
    }
    // ja2en / typing はどちらも日本語の意味を大きく見せる
    return '<div class="battle-q-ja"><div class="battle-prompt-ja">' + escapeHtml(q.prompt) + '</div></div>';
  }

  function typingHint(word) {
    var w = word.word || "";
    if (w.length === 0) return "";
    var first = w[0].toUpperCase();
    var blanks = [];
    for (var i = 1; i < w.length; i++) blanks.push("_");
    return first + " " + blanks.join(" ") + "  (" + w.length + "文字)";
  }

  function answerAreaHtml(q) {
    if (q.type === "typing") {
      return (
        '<div class="battle-typing-area">' +
          '<div class="battle-typing-hint">' + escapeHtml(typingHint(q.word)) + '</div>' +
          '<input type="text" class="battle-typing-input" id="bt-typing-input" ' +
            'autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false" placeholder="英単語を入力">' +
          '<button type="button" class="btn btn-primary btn-big battle-typing-submit" id="bt-typing-submit">決定</button>' +
          '<div class="battle-typing-reveal" id="bt-typing-reveal"></div>' +
        '</div>'
      );
    }
    // cloze の選択肢はja2enと同じ英単語4択の見た目を流用する
    var extra = (q.type === "ja2en" || q.type === "cloze") ? " battle-choice-en" : "";
    var buttons = q.choices.map(function (text, i) {
      return '<button type="button" class="btn battle-choice-btn' + extra + '" data-idx="' + i + '">' +
        escapeHtml(text) + '</button>';
    }).join("");
    return '<div class="battle-choices-grid" id="bt-choices">' + buttons + '</div>';
  }

  function cacheDom(container) {
    st.dom = {
      screen: container.querySelector(".battle-screen"),
      timerFill: container.querySelector("#bt-timer-fill"),
      timerBar: container.querySelector(".battle-timer"),
      myScoreEl: container.querySelector("#bt-my-score"),
      botScoreEl: container.querySelector("#bt-bot-score"),
      meBar: container.querySelector("#bt-me-bar"),
      botBar: container.querySelector("#bt-bot-bar"),
      comboEl: container.querySelector("#bt-combo"),
      qcard: container.querySelector("#bt-qcard"),
      qcontent: container.querySelector("#bt-qcontent"),
      feverBarWrap: container.querySelector("#bt-fever-bar"),
      feverFill: container.querySelector("#bt-fever-fill"),
      eventBadge: container.querySelector("#bt-event-badge"),
      answerArea: container.querySelector("#bt-answer-area")
    };
  }

  function updateTimer(remainMs) {
    var pct = clamp((remainMs / st.durationMs) * 100, 0, 100);
    st.dom.timerFill.style.width = pct + "%";
    var danger = remainMs <= 10000; // 1分対局の赤点滅は残り10秒から
    st.dom.timerBar.classList.toggle("battle-timer-danger", danger);
  }

  function updateVsBars(myScore, botScore) {
    var total = Math.max(myScore + botScore, 1);
    st.dom.meBar.style.width = (myScore / total * 100) + "%";
    st.dom.botBar.style.width = (botScore / total * 100) + "%";
  }

  function updateBotScore(botScore) {
    if (botScore !== st.botScoreShown) {
      countUp(st.dom.botScoreEl, st.botScoreShown, botScore, 300);
      st.botScoreShown = botScore;
    }
    updateVsBars(st.myScoreShown, botScore);
  }

  function updateMyScore(myScore) {
    if (myScore !== st.myScoreShown) {
      countUp(st.dom.myScoreEl, st.myScoreShown, myScore, 300);
      st.myScoreShown = myScore;
    }
    updateVsBars(myScore, st.botScoreShown);
  }

  function updateCombo(combo) {
    if (combo > 0) {
      st.dom.comboEl.textContent = fmt(combo) + " COMBO";
      st.dom.comboEl.classList.remove("hidden");
    } else {
      st.dom.comboEl.classList.add("hidden");
    }
  }

  // ブリッツの自己ベスト・ゴーストバー(SPEC_ADDICTION §5.2): botScoreの代わりに、経過時間に対して
  // 自己ベストを線形補間した「想定ペース」を#bt-bot-score/#bt-bot-bar(見た目はラベル差し替え済み)に流用する。
  function updateGhostScore(remainMs) {
    var elapsed = st.durationMs - remainMs;
    var pct = clamp(elapsed / st.durationMs, 0, 1);
    updateBotScore(Math.round(st.blitzBest * pct));
  }

  // フィーバーLvの視覚強度(SPEC_UI §2.2改修): .fever に加え .fever-lv2/3/4 を付け外しする。
  // Lv1は追加クラス無し(.feverの既存演出のまま)、Lv2以上でbattle.cssの段階的な強化が効く。
  function setFeverLevelClasses(level) {
    document.body.classList.toggle("fever-lv2", level >= 2);
    document.body.classList.toggle("fever-lv3", level >= 3);
    document.body.classList.toggle("fever-lv4", level >= 4);
  }

  function setFeverOn(level) {
    if (st.feverOn) return;
    st.feverOn = true;
    document.body.classList.add("fever");
    setFeverLevelClasses(level || 1);
    st.dom.qcard.classList.add("battle-fever-glow");
    st.dom.feverBarWrap.classList.remove("hidden");
    bgmCall("setFever", [true]);
  }

  function setFeverOff() {
    if (!st.feverOn) return;
    st.feverOn = false;
    document.body.classList.remove("fever");
    setFeverLevelClasses(0);
    st.dom.qcard.classList.remove("battle-fever-glow");
    st.dom.feverBarWrap.classList.add("hidden");
    bgmCall("setFever", [false]);
  }

  function updateFeverBar(feverRemainMs) {
    if (feverRemainMs > 0) {
      setFeverOn();
      st.dom.feverFill.style.width = clamp(feverRemainMs / FEVER_MS * 100, 0, 100) + "%";
    } else {
      setFeverOff();
    }
  }

  function onTick() {
    if (!st || !st.session) return;
    var t = st.session.tick(Date.now());
    updateTimer(t.remainMs);
    if (st.mode === "blitz") {
      updateGhostScore(t.remainMs); // ブリッツはボット不在なのでbotScoreは見ない(常に0)
    } else {
      updateBotScore(t.botScore);
    }
    updateFeverBar(t.feverRemainMs);
    // 時間切れ時、設問未回答のまま放置されても対局を強制終了させる(考え込んで
    // 固まって見えるのを防ぐ)。ロック中(採点演出待ち)はscheduleNext経由の
    // askNext()->finishBattle()に任せ、ここでは横取りしない。
    if (t.remainMs <= 0 && !st.locked) {
      finishBattle();
    }
  }

  function startTicking() {
    st.tickTimer = window.setInterval(onTick, TICK_INTERVAL_MS);
  }

  function bindQuestionExtras(q) {
    // en2ja の発音ボタン(SPEC_UI §2.2)。listen出題(2026-07-05廃止)の自動再生・もう一度ボタンは削除済み。
    var speakBtn = st.dom.qcontent.querySelector("#bt-speak");
    if (speakBtn) {
      speakBtn.addEventListener("click", function () {
        TW.sfx.speak(q.word.word);
      });
    }
  }

  function disableAnswerArea() {
    var els = st.dom.answerArea.querySelectorAll("button, input");
    for (var i = 0; i < els.length; i++) els[i].disabled = true;
  }

  function scheduleNext(correct) {
    var delay = correct ? CORRECT_DELAY_MS : WRONG_DELAY_MS;
    window.setTimeout(function () {
      if (!st || st.finished) return;
      askNext();
    }, delay);
  }

  // 正解/フィーバー/コンボ演出などスコア系の共通処理(対象要素の座標を使うエフェクト以外)
  function applyCommonFeedback(result) {
    updateMyScore(result.playerScore);
    // ブリッツはボット不在で result.botScore は常に0(Session側)。ゴーストバーは
    // onTick の updateGhostScore に一元化し、ここで0上書きしないようにする。
    if (st.mode !== "blitz") {
      updateBotScore(result.botScore);
    }
    updateCombo(result.combo);
    bgmCall("setCombo", [result.combo]); // SPEC_ADDICTION §4/§5.2: コンボ変化でBGM加速

    if (result.feverJustStarted) {
      TW.fx.cutIn("FEVER!!");
      TW.sfx.play("fever");
      setFeverOn(result.feverLevel);
    } else if (result.feverChained) {
      // フィーバー中の再発動(チェイン): Lvを上げてカットイン+BGMをもう一度転調させる(SPEC_UI §2.2改修)。
      // setFeverOn()は既にfeverOn中だと早期returnするため、ここでは直接クラス更新+bgm呼び出しを行う。
      TW.fx.cutIn("FEVER CHAIN!! Lv" + result.feverLevel);
      TW.sfx.play("fever");
      setFeverLevelClasses(result.feverLevel);
      bgmCall("setFever", [true]); // bgm.jsは呼ぶたびに半音転調(上限+4、既存仕様のまま)
      if (st.dom.feverFill) st.dom.feverFill.style.width = "100%"; // 残り時間バーをリセット表示
    } else if (result.correct && result.combo > 0 && result.combo % 5 === 0) {
      TW.fx.cutIn(result.combo + "連撃!");
      TW.sfx.play("combo");
    }
    if (result.correct && result.combo > 0 && result.combo % 5 === 0) {
      TW.fx.shake(st.dom.screen);
    }
  }

  function applyCorrectVisual(result, targetEl) {
    var pt = targetEl ? rectCenter(targetEl) : { x: window.innerWidth / 2, y: window.innerHeight / 2 };
    var scoreText = (result.feverActive ? "+" + result.scoreGained + "!" : "+" + result.scoreGained);
    TW.fx.burst(pt.x, pt.y, result.feverActive ? "#EC4899" : "#3B82F6");
    TW.fx.popScore(pt.x, pt.y, scoreText);
    if (result.bonusCoin > 0) {
      window.setTimeout(function () {
        TW.fx.popScore(pt.x, pt.y - 34, "+" + result.bonusCoin + "🪙");
      }, 90);
    }
    TW.sfx.play("correct", { pitch: result.combo });
    if (targetEl) TW.fx.flash(targetEl, "battle-flash-correct");
  }

  function applyWrongVisual(targetEl) {
    if (targetEl) {
      TW.fx.flash(targetEl, "battle-flash-wrong");
      TW.fx.shake(targetEl);
    }
    TW.sfx.play("wrong");
  }

  // 誤答時、正解以外の選択肢ボタン(誤選択したものも含む)を減光する(SPEC_UI §2.2改修)。
  // 誤選択ボタンの赤フラッシュ(battle-flash-wrong)はapplyWrongVisualが別途付与するので、
  // ここでは重ねて opacity を下げるだけで良い(次の問題でinnerHTML差し替えにより自然に外れる)。
  function dimOtherChoiceButtons(correctIdx) {
    var buttons = st.dom.answerArea.querySelectorAll("button[data-idx]");
    for (var i = 0; i < buttons.length; i++) {
      if (Number(buttons[i].getAttribute("data-idx")) !== correctIdx) {
        buttons[i].classList.add("battle-choice-dim");
      }
    }
  }

  function onChoiceSubmit(idx, btnEl) {
    if (st.locked) return;
    st.locked = true;
    clearBlitzTimer(); // 時間内に回答されたのでブリッツの3秒タイムアウトは発火させない
    var q = st.currentQuestion;
    var ms = Date.now() - st.qStartAt;
    var result = st.session.submit(idx, ms);
    if (!result) return;

    applyCommonFeedback(result);
    disableAnswerArea();

    if (result.correct) {
      applyCorrectVisual(result, btnEl);
    } else {
      applyWrongVisual(btnEl);
      var correctBtn = st.dom.answerArea.querySelector('[data-idx="' + q.answerIndex + '"]');
      if (correctBtn) correctBtn.classList.add("battle-choice-correct-reveal");
      dimOtherChoiceButtons(q.answerIndex);
    }
    scheduleNext(result.correct);
  }

  function onTypingSubmit(inputEl) {
    if (st.locked) return;
    var value = inputEl.value.trim();
    if (value.length === 0) {
      TW.fx.shake(inputEl);
      return;
    }
    st.locked = true;
    clearBlitzTimer(); // 時間内に回答されたのでブリッツの3秒タイムアウトは発火させない
    var q = st.currentQuestion;
    var ms = Date.now() - st.qStartAt;
    var result = st.session.submit(value, ms);
    if (!result) return;

    applyCommonFeedback(result);
    disableAnswerArea();

    if (result.correct) {
      applyCorrectVisual(result, inputEl);
    } else {
      applyWrongVisual(inputEl);
      var revealEl = st.dom.answerArea.querySelector("#bt-typing-reveal");
      if (revealEl) revealEl.textContent = "正解: " + q.word.word;
    }
    scheduleNext(result.correct);
  }

  // ブリッツの1問3秒タイムアウト(SPEC_ADDICTION §3/§5.2): 誤答扱いでSRSには記録しない
  // (submit の第3引数 opts.skipSrs)。既存の誤答フローと同じ見た目(正解ハイライト+WRONG_DELAY_MS待ち)にする。
  function onBlitzTimeout() {
    if (!st || st.finished || st.locked) return;
    st.blitzTimer = null;
    st.locked = true;
    var q = st.currentQuestion;
    var ms = Date.now() - st.qStartAt;
    var result = st.session.submit(null, ms, { skipSrs: true });
    if (!result) return;

    applyCommonFeedback(result);
    disableAnswerArea();
    if (st.dom.qcard) TW.fx.flash(st.dom.qcard, "battle-flash-wrong");
    applyWrongVisual(null);

    if (q) {
      var correctBtn = st.dom.answerArea.querySelector('[data-idx="' + q.answerIndex + '"]');
      if (correctBtn) correctBtn.classList.add("battle-choice-correct-reveal");
      dimOtherChoiceButtons(q.answerIndex);
      var revealEl = st.dom.answerArea.querySelector("#bt-typing-reveal");
      if (revealEl) revealEl.textContent = "正解: " + q.word.word;
    }
    scheduleNext(false);
  }

  function bindAnswerArea(q) {
    if (q.type === "typing") {
      // typing用のinput/buttonは毎問innerHTMLで作り直される新規ノードなので、
      // 都度bindしても古いノードごとリスナーも破棄され蓄積しない。
      var input = st.dom.answerArea.querySelector("#bt-typing-input");
      var submitBtn = st.dom.answerArea.querySelector("#bt-typing-submit");
      if (input) {
        window.setTimeout(function () { input.focus(); }, 0);
        input.addEventListener("keydown", function (e) {
          if (e.key === "Enter") onTypingSubmit(input);
        });
      }
      if (submitBtn) {
        submitBtn.addEventListener("click", function () { onTypingSubmit(input); });
      }
      return;
    }
    // 4択グリッドは #bt-answer-area 自体(対局中は同じノードを再利用しinnerHTMLだけ差し替える)への
    // イベント委任で処理する。問題ごとに呼ばれる bindAnswerArea 内で毎回 addEventListener すると
    // 同じ親ノードにリスナーが積み重なってしまうため、委任登録は対局中一度だけ行う。
    if (!st.choiceDelegationBound) {
      st.choiceDelegationBound = true;
      st.dom.answerArea.addEventListener("click", function (e) {
        var btn = e.target.closest ? e.target.closest("button[data-idx]") : null;
        if (!btn) return;
        onChoiceSubmit(Number(btn.getAttribute("data-idx")), btn);
      });
    }
  }

  function renderQuestion(q) {
    var contentHtml = questionContentHtml(q);
    if (st.mode === "blitz") contentHtml = blitzRingHtml() + contentHtml; // 毎問新規DOMなのでアニメが毎回最初から再生される
    st.dom.qcontent.innerHTML = contentHtml;
    st.dom.answerArea.innerHTML = answerAreaHtml(q);
    bindQuestionExtras(q);
    bindAnswerArea(q);

    // 強化週間カテゴリの出題に「×1.5」バッジ(SPEC_ADDICTION §5.2)
    if (st.dom.eventBadge) {
      var mult = currentEventMultForWord(q.word);
      if (mult) {
        st.dom.eventBadge.textContent = "×" + mult;
        st.dom.eventBadge.classList.remove("hidden");
      } else {
        st.dom.eventBadge.classList.add("hidden");
      }
    }
  }

  function askNext() {
    clearBlitzTimer();
    var q = st.session.next();
    if (!q) {
      finishBattle();
      return;
    }
    st.currentQuestion = q;
    st.locked = false;
    st.qStartAt = Date.now();
    renderQuestion(q);
    if (st.mode === "blitz") {
      st.blitzTimer = window.setTimeout(onBlitzTimeout, BLITZ_QUESTION_MS);
    }
  }

  function finishBattle() {
    if (!st || st.finished) return;
    st.finished = true;
    stopTicking();
    clearBlitzTimer();
    bgmCall("stop"); // SPEC_ADDICTION §5.2: リザルト遷移で確実に止める
    var result = st.session.end();
    st.session = null;
    document.body.classList.remove("in-battle");
    document.body.classList.remove("fever");
    if (TW.router && typeof TW.router.showResult === "function") {
      TW.router.showResult(result);
    }
  }

  TW.ui.battle = {
    render: function (container, opts) {
      // 前回セッションが残っていれば後始末(再入防止)
      if (st) {
        stopTicking();
        clearBlitzTimer();
      }

      var mode = "rank";
      if (opts && opts.mode === "free") mode = "free";
      else if (opts && opts.mode === "blitz") mode = "blitz";
      var durationMs = mode === "blitz" ? BLITZ_DURATION_MS : DURATION_MS;
      // ブリッツの自己ベスト(ゴーストバー用)。store.jsのver2移行前でも0扱いにする(typeofガード)。
      var blitzBest = (TW.store && TW.store.state && typeof TW.store.state.blitzBest === "number")
        ? TW.store.state.blitzBest : 0;

      var sessionOpts = {
        mode: mode,
        durationMs: durationMs,
        onEvent: function () {} // 直接の戻り値で十分な情報が得られるため no-op
      };
      // SPEC_ADDICTION §3: リベンジ(nearMiss)は同じボットプロファイルで再戦する
      if (opts && opts.bot) sessionOpts.bot = opts.bot;
      var session = TW.battle.start(sessionOpts);

      // session.botInfo.name(rating.js botFor由来の二つ名)をボット表示名として使う
      var bot = mode === "blitz" ? null : buildBotFlavor(session.botInfo);

      st = {
        mode: mode,
        durationMs: durationMs,
        blitzBest: blitzBest,
        session: session,
        tickTimer: null,
        blitzTimer: null,
        currentQuestion: null,
        qStartAt: 0,
        locked: false,
        finished: false,
        feverOn: false,
        myScoreShown: 0,
        botScoreShown: 0,
        choiceDelegationBound: false,
        dom: null
      };

      document.body.classList.add("in-battle");
      document.body.classList.remove("fever");
      container.innerHTML = screenHtml(mode, bot || {});
      cacheDom(container);

      bgmCall("start", [mode === "blitz" ? "blitz" : "battle"]); // SPEC_ADDICTION §5.2: 対局開始でBGM結線
      startTicking();
      askNext();
    }
  };

  // ============================================================
  // TW.ui.result
  // ============================================================

  function mergeCapturedForDisplay(result) {
    var kiraIds = {};
    (result.kiraWords || []).forEach(function (w) { kiraIds[w.id] = true; });
    var seen = {};
    var list = [];
    (result.capturedWords || []).forEach(function (w) {
      if (seen[w.id]) return;
      seen[w.id] = true;
      list.push({ word: w, kira: !!kiraIds[w.id] });
    });
    (result.kiraWords || []).forEach(function (w) {
      if (seen[w.id]) return;
      seen[w.id] = true;
      list.push({ word: w, kira: true });
    });
    return list;
  }

  function capturedCardHtml(entry) {
    var w = entry.word;
    var cls = "card result-captured-card " + rarityClass(w.rarity) + (entry.kira ? " kira" : "");
    return (
      '<div class="' + cls + '">' +
        (entry.kira ? '<div class="result-kira-tag">✨キラ</div>' : '') +
        '<div class="result-captured-rarity">' + escapeHtml(w.rarity) + '</div>' +
        '<div class="result-captured-word">' + escapeHtml(w.word) + '</div>' +
        '<div class="result-captured-ja">' + escapeHtml(w.ja) + '</div>' +
      '</div>'
    );
  }

  // 注: js/game/battle.js の Session.end() は Result.questEvents に
  // TW.quest.getDaily()(日付シードでの再生成。done は常に0)を入れており、対局中の
  // onAction() による実際の進捗を反映していない。リザルトでは実際の進捗が分かる方が
  // ドパミン設計上も有用なため、TW.store.state.quests.items(公開状態)を優先して使い、
  // 取得できない場合のみ result.questEvents にフォールバックする。
  function currentQuestItems(result) {
    try {
      if (TW.store && TW.store.state && TW.store.state.quests && Array.isArray(TW.store.state.quests.items)) {
        return TW.store.state.quests.items;
      }
    } catch (e) { /* フォールバックへ */ }
    return result.questEvents;
  }

  // QuestItem に表示ラベルが無い(SPEC_CORE契約上 id/done/goal/claimedのみ)ため、
  // js/ui/home.js と同様に id の命名から簡易的に推測する(表示用途のみ・実装依存の穏やかなフォールバック)。
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

  function questEventsHtml(items) {
    if (!Array.isArray(items) || items.length === 0) return "";
    var rows = items.map(function (q) {
      var goal = q.goal || 0;
      var done = Math.min(goal, q.done || 0);
      var pct = goal > 0 ? clamp(Math.round(done / goal * 100), 0, 100) : 0;
      return (
        '<div class="result-quest-item">' +
          '<div class="result-quest-label">' + escapeHtml(questLabel(q)) + (q.claimed ? "(受取済)" : "") + '</div>' +
          '<div class="bar result-quest-bar"><div class="bar-fill" style="width:' + pct + '%"></div></div>' +
          '<div class="result-quest-text">' + fmt(done) + ' / ' + fmt(goal) + '</div>' +
        '</div>'
      );
    }).join("");
    return '<section class="card result-quest-section"><div class="result-section-title">デイリークエスト進捗</div>' + rows + '</section>';
  }

  function showPromotionOverlay(rankInfo, onDone) {
    var overlay = document.createElement("div");
    overlay.className = "result-promo-overlay";
    overlay.innerHTML =
      '<div class="result-promo-label">昇級!</div>' +
      '<div class="result-promo-name">' + escapeHtml(rankInfo.name) + '</div>';
    document.body.appendChild(overlay);
    TW.sfx.play("levelup");
    TW.fx.confetti();
    window.requestAnimationFrame(function () { overlay.classList.add("show"); });
    window.setTimeout(function () {
      overlay.classList.remove("show");
      window.setTimeout(function () {
        if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
        if (typeof onDone === "function") onDone();
      }, 260);
    }, 1500);
  }

  // LEVEL UP全画面演出(SPEC_ADDICTION §5.2)。昇級演出(showPromotionOverlay)とは別イベントなので
  // 見た目は似せつつ独立させる(段位の昇級とプレイヤーLvは無関係)。
  function showLevelUpOverlay(newLevel, rewards, onDone) {
    var overlay = document.createElement("div");
    overlay.className = "result-levelup-overlay";
    var rewardParts = [];
    if (rewards) {
      if (rewards.coins > 0) rewardParts.push("🪙+" + fmt(rewards.coins));
      if (rewards.tickets > 0) rewardParts.push("🎫+" + fmt(rewards.tickets));
    }
    overlay.innerHTML =
      '<div class="result-levelup-label">LEVEL UP!</div>' +
      '<div class="result-levelup-name">Lv.' + fmt(newLevel) + '</div>' +
      (rewardParts.length > 0 ? '<div class="result-levelup-reward">' + rewardParts.join(" ") + '</div>' : '');
    document.body.appendChild(overlay);
    TW.sfx.play("levelup");
    TW.fx.confetti();
    window.requestAnimationFrame(function () { overlay.classList.add("show"); });
    window.setTimeout(function () {
      overlay.classList.remove("show");
      window.setTimeout(function () {
        if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
        if (typeof onDone === "function") onDone();
      }, 260);
    }, 1500);
  }

  // TW.level が読み込まれていれば{level,xpInto,xpNeed,totalXp}の妥当な値を返す(SPEC_ADDICTION §1)。
  // 未読込・値が壊れている場合は null(XPバー自体を表示しない疎結合ガード)。
  function safeLevelInfo() {
    try {
      if (!(TW.level && typeof TW.level.current === "function")) return null;
      var info = TW.level.current();
      if (!info || typeof info.level !== "number" || typeof info.xpNeed !== "number" ||
          typeof info.xpInto !== "number") return null;
      return info;
    } catch (e) {
      return null;
    }
  }

  // リザルトのXPバー(SPEC_ADDICTION §5.2)。TW.level未読込なら空文字("" = 非表示)。
  function xpSectionHtml(result, levelInfo) {
    if (!levelInfo) return "";
    return (
      '<section class="card result-xp-section result-stage" data-stage="2">' +
        '<div class="result-xp-row">' +
          '<div class="result-xp-level">Lv.' + fmt(levelInfo.level) + '</div>' +
          '<div class="result-xp-gain">+' + fmt(result.xpGained || 0) + ' XP</div>' +
        '</div>' +
        '<div class="bar result-xp-bar"><div class="bar-fill" id="rs-xp-bar-fill"></div></div>' +
        '<div class="result-xp-need">' + fmt(levelInfo.xpInto) + ' / ' + fmt(levelInfo.xpNeed) + '</div>' +
      '</section>'
    );
  }

  // ブリッツ結果ブロック(SPEC_ADDICTION §3/§5.2): result.blitz が無いモードでは表示しない。
  function blitzResultHtml(result) {
    if (!result.blitz) return "";
    var isNew = !!result.blitz.isNewBest;
    return (
      '<section class="card result-blitz-block' + (isNew ? " is-new-best" : "") + ' result-stage" data-stage="2">' +
        '<div class="result-blitz-label">⚡ ブリッツ60</div>' +
        (isNew ? '<div class="result-blitz-newbest">🏆 自己ベスト更新!!</div>' : '') +
        '<div class="result-blitz-scores">' +
          '<span class="result-blitz-score tabular-nums">' + fmt(result.blitz.score) + '</span>' +
          '<span class="result-blitz-best-label">自己ベスト ' + fmt(result.blitz.best) + '</span>' +
        '</div>' +
      '</section>'
    );
  }

  // 「もう1局」のモード引き継ぎ: ブリッツ結果ならブリッツを継続する(既存はrank/freeのみ判定していた)。
  function againOpts(result) {
    if (result.blitz) return { mode: "blitz" };
    if (result.rank) return { mode: "rank" };
    return { mode: "free" };
  }

  TW.ui.result = {
    render: function (container, result) {
      document.body.classList.remove("in-battle");
      document.body.classList.remove("fever");
      bgmCall("stop"); // SPEC_ADDICTION §5.2: リザルト画面ではBGMを鳴らさない(finishBattle側と合わせた保護的停止)

      // battle.js の Session.end() が保存を行わないため、対局成果をここで確実に永続化する。
      try { TW.store.save(); } catch (e) { /* 保存失敗時もリザルト表示は継続する */ }

      var win = !!result.win;
      var levelInfo = safeLevelInfo();

      // ニアミス(SPEC_ADDICTION §3/§5.2): rank戦で僅差負けのときだけ battle.js が立てるフラグ
      var nearMiss = !!result.nearMiss;
      var nearMissDiff = 0;
      if (nearMiss && typeof result.botScore === "number" && typeof result.playerScore === "number") {
        nearMissDiff = Math.max(0, result.botScore - result.playerScore);
      }
      var nearMissHtml = nearMiss
        ? '<div class="result-near-miss result-stage" data-stage="1">あと' + fmt(nearMissDiff) + '点だった!!</div>'
        : "";
      var showRevenge = nearMiss && !!result.rematchBot;
      // ブリッツはボット不在(SPEC_ADDICTION §3)。上部スコア対比の「ライバル」欄も
      // 混乱を避けるため自己ベストに差し替える(botScoreは常に0で意味を持たないため)。
      var rivalLabel = result.blitz ? "自己ベスト" : "ライバル";
      var rivalScore = result.blitz ? result.blitz.best : result.botScore;

      var rankBlock = "";
      if (result.rank && result.rank.rank) {
        var r = result.rank.rank;
        rankBlock =
          '<section class="card result-rank-block result-stage" data-stage="3">' +
            '<div class="result-rank-name">' + escapeHtml(r.name) + '</div>' +
            '<div class="bar result-rank-bar"><div class="bar-fill" id="rs-rank-bar"></div></div>' +
            '<div class="result-rank-delta">達成率 ' + (result.rank.progressDelta >= 0 ? "+" : "") +
              fmt(result.rank.progressDelta) + '% / Elo ' + (result.rank.eloDelta >= 0 ? "+" : "") +
              fmt(result.rank.eloDelta) + '</div>' +
          '</section>';
      }

      var capturedList = mergeCapturedForDisplay(result);
      var capturedHtml = capturedList.length > 0
        ? '<section class="card result-captured-section result-stage" data-stage="4">' +
            '<div class="result-section-title">捕獲した単語</div>' +
            '<div class="result-captured-grid">' + capturedList.map(capturedCardHtml).join("") + '</div>' +
            '<div class="result-coin-line">🪙 +' + fmt(result.coinsEarned) + '</div>' +
          '</section>'
        : '<section class="card result-captured-section result-stage" data-stage="4">' +
            '<div class="result-coin-line">🪙 +' + fmt(result.coinsEarned) + '</div>' +
          '</section>';

      var againBtnClass = "btn result-again-btn" + (showRevenge ? "" : " btn-primary btn-big");
      var revengeHtml = showRevenge
        ? '<button type="button" class="btn btn-primary btn-big result-revenge-btn" id="rs-revenge">🔥リベンジ</button>'
        : "";

      container.innerHTML =
        '<div class="result-screen">' +
          '<div class="result-banner ' + (win ? "win" : "lose") + ' result-stage" data-stage="1">' +
            (win ? "WIN!" : "LOSE...") +
          '</div>' +
          nearMissHtml +
          '<section class="card result-score-row result-stage" data-stage="2">' +
            '<div class="result-score-side">' +
              '<div class="result-score-label">YOU</div>' +
              '<div class="result-score-value tabular-nums" id="rs-my-score">0</div>' +
            '</div>' +
            '<div class="result-score-vs">-</div>' +
            '<div class="result-score-side">' +
              '<div class="result-score-label">' + escapeHtml(rivalLabel) + '</div>' +
              '<div class="result-score-value tabular-nums" id="rs-bot-score">0</div>' +
            '</div>' +
          '</section>' +
          '<div class="result-correct-line result-stage" data-stage="2">正答 ' + fmt(result.correct) +
            ' / ' + fmt(result.total) + '(最大コンボ ' + fmt(result.maxCombo) + ')</div>' +
          (result.maxFeverLevel >= 1
            ? '<div class="result-fever-line result-stage" data-stage="2">最大フィーバー Lv' + fmt(result.maxFeverLevel) + '</div>'
            : '') +
          blitzResultHtml(result) +
          xpSectionHtml(result, levelInfo) +
          rankBlock +
          capturedHtml +
          questEventsHtml(currentQuestItems(result)) +
          '<div class="result-actions result-stage" data-stage="5">' +
            revengeHtml +
            '<button type="button" class="' + againBtnClass + '" id="rs-again">もう1局</button>' +
            '<button type="button" class="btn result-home-btn" id="rs-home">ホームへ</button>' +
          '</div>' +
        '</div>';

      // ---- 時間差演出(各300ms間隔。SPEC_UI §2.3) ----
      // 画面遷移後もタイマーが生き残ることがあるため、実行時に
      // このリザルト画面がまだDOMに残っているかを都度確認する。
      var screenEl = container.querySelector(".result-screen");

      TW.sfx.play(win ? "win" : "lose");

      var stage1 = container.querySelector('[data-stage="1"]');
      if (stage1) stage1.classList.add("show");
      if (win) TW.fx.confetti();

      window.setTimeout(function () {
        if (!screenEl.isConnected) return;
        var stage2 = container.querySelectorAll('[data-stage="2"]');
        for (var i = 0; i < stage2.length; i++) stage2[i].classList.add("show");
        countUp(container.querySelector("#rs-my-score"), 0, result.playerScore, 500);
        countUp(container.querySelector("#rs-bot-score"), 0, rivalScore, 500);

        // ブリッツ自己ベスト更新演出(SPEC_ADDICTION §5.2)
        if (result.blitz && result.blitz.isNewBest) {
          TW.fx.confetti();
          TW.sfx.play("kira");
        }

        // XPバーのアニメ+LEVEL UP演出(SPEC_ADDICTION §5.2)。TW.level未読込時は levelInfo が null で
        // xpSectionHtml自体が空文字を返しているため #rs-xp-bar-fill も存在せず、この節は何もしない。
        var xpBarFill = container.querySelector("#rs-xp-bar-fill");
        if (xpBarFill && levelInfo) {
          var xpGained = result.xpGained || 0;
          var leveledUp = !!(result.levelUp && result.levelUp.levelsGained > 0);
          if (leveledUp) {
            // 満タンまで一気に伸びる→LEVEL UP!→リセットして新レベルの進捗を表示
            xpBarFill.style.width = "100%";
            window.setTimeout(function () {
              if (!screenEl.isConnected) return;
              showLevelUpOverlay(levelInfo.level, result.levelUp.rewards, function () {
                if (!xpBarFill.isConnected) return;
                xpBarFill.style.transition = "none";
                xpBarFill.style.width = "0%";
                window.requestAnimationFrame(function () {
                  xpBarFill.style.transition = "";
                  var pct = levelInfo.xpNeed > 0 ? clamp(levelInfo.xpInto / levelInfo.xpNeed * 100, 0, 100) : 0;
                  xpBarFill.style.width = pct + "%";
                });
              });
            }, 500);
          } else {
            var beforeInto = clamp(levelInfo.xpInto - xpGained, 0, levelInfo.xpNeed);
            var startPct = levelInfo.xpNeed > 0 ? (beforeInto / levelInfo.xpNeed * 100) : 0;
            var endPct = levelInfo.xpNeed > 0 ? (levelInfo.xpInto / levelInfo.xpNeed * 100) : 0;
            xpBarFill.style.transition = "none";
            xpBarFill.style.width = startPct + "%";
            window.requestAnimationFrame(function () {
              xpBarFill.style.transition = "";
              xpBarFill.style.width = endPct + "%";
            });
          }
        }
      }, 300);

      window.setTimeout(function () {
        if (!screenEl.isConnected) return;
        if (rankBlock) {
          var stage3 = container.querySelector('[data-stage="3"]');
          if (stage3) stage3.classList.add("show");
          var rankBar = container.querySelector("#rs-rank-bar");
          if (rankBar && result.rank && result.rank.rank) {
            window.requestAnimationFrame(function () {
              rankBar.style.width = clamp(result.rank.rank.progress, 0, 100) + "%";
            });
          }
          if (result.rank && result.rank.promoted) {
            showPromotionOverlay(result.rank.rank);
          }
        }
      }, 600);

      window.setTimeout(function () {
        if (!screenEl.isConnected) return;
        var stage4 = container.querySelector('[data-stage="4"]');
        if (stage4) stage4.classList.add("show");
        var cards = stage4 ? stage4.querySelectorAll(".result-captured-card") : [];
        for (var i = 0; i < cards.length; i++) {
          (function (card, idx) {
            window.setTimeout(function () {
              card.classList.add("show");
              TW.sfx.play(card.classList.contains("kira") ? "kira" : "capture");
            }, idx * 90);
          })(cards[i], i);
        }
        if (cards.length === 0) {
          // 捕獲0件でもコイン加算はある。専用のコイン音がSPEC_CORE契約に無いため、
          // js/ui/home.js の onClaimClick と同様に "capture" 音で代用する。
          TW.sfx.play("capture");
        }
      }, 900);

      window.setTimeout(function () {
        if (!screenEl.isConnected) return;
        var stage5 = container.querySelector('[data-stage="5"]');
        if (stage5) stage5.classList.add("show");

        // battle.js の Session.end() は checkAchievements を呼んでいないため、
        // ここで公開APIを呼んで実績解除を反映させる(表示は簡易トースト)。
        try {
          var newly = TW.quest.checkAchievements({
            win: win,
            promoted: !!(result.rank && result.rank.promoted),
            maxCombo: result.maxCombo,
            capturedWords: result.capturedWords
          });
          if (newly && newly.length > 0) {
            TW.store.save(); // checkAchievements による state.achievements 更新分を保存
            if (TW.quest.ACHIEVEMENTS) {
              var names = newly.map(function (id) {
                var found = TW.quest.ACHIEVEMENTS.filter(function (a) { return a.id === id; })[0];
                return found ? found.name : id;
              });
              var toast = document.createElement("div");
              toast.className = "result-achv-toast";
              toast.textContent = "実績解除: " + names.join(" / ");
              container.querySelector(".result-screen").appendChild(toast);
              window.requestAnimationFrame(function () { toast.classList.add("show"); });
            }
          }
        } catch (e) { /* 実績解除は失敗してもリザルト表示自体は継続する */ }
      }, 1200);

      // ---- ボタン ----
      container.querySelector("#rs-again").addEventListener("click", function () {
        TW.sfx.play("tap");
        if (TW.router && typeof TW.router.go === "function") {
          TW.router.go("battle", againOpts(result));
        }
      });
      container.querySelector("#rs-home").addEventListener("click", function () {
        TW.sfx.play("tap");
        if (TW.router && typeof TW.router.go === "function") {
          TW.router.go("home");
        }
      });
      // 🔥リベンジ(SPEC_ADDICTION §3/§5.2): nearMiss時のみ。同じボットプロファイル(rematchBot)で即再戦。
      var revengeBtn = container.querySelector("#rs-revenge");
      if (revengeBtn) {
        revengeBtn.addEventListener("click", function () {
          TW.sfx.play("tap");
          if (TW.router && typeof TW.router.go === "function") {
            TW.router.go("battle", { mode: "rank", bot: result.rematchBot });
          }
        });
      }
    }
  };
})();
