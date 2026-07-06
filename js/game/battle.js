// js/game/battle.js — TW.battle (SPEC_CORE §4)
// 純ロジックのみ。DOM/speechSynthesis には触らない(存在チェックのみ可)。
window.TW = window.TW || {};

(function () {
  "use strict";

  var FEVER_COMBO = 10;
  var FEVER_MS = 15000;
  var BONUS_COIN_RATE = 0.10;
  var BONUS_COIN_VALUE = 3; // 2026-07-05: 対局系コインを約1/6へチューニング(旧15)
  var QUEUE_BATCH = 30;
  var QUEUE_REFILL = 20;
  var QUEUE_LOW_WATER = 5;

  // feverLevel: 非フィーバー中は0、フィーバー中は1〜4(チェインごとに+1、上限4)。
  // extraMult: SPEC_ADDICTION §3 のブリッツ(×1.2)・強化週間(×1.5)用の追加乗数(省略時1、既存呼び出しは無変更)
  function scoreFormula(combo, feverLevel, ms, extraMult) {
    var comboMult = 1 + Math.min(combo, 20) * 0.05;
    var feverMult = 1 + (feverLevel || 0);
    var speedBonus = ms < 2000 ? 50 : (ms < 4000 ? 25 : 0);
    var mult = extraMult || 1;
    return Math.round((100 * comboMult * feverMult + speedBonus) * mult);
  }

  // 出題タイプの重み抽選: en2ja50% / ja2en25% / cloze15% / typing10%。
  // 無効typeの取り分はen2jaへ振替。listen(音声出題)は2026-07-05に廃止。
  function pickType(settings) {
    var typingOk = !!(settings && settings.typing);
    var wEn2ja = 0.50 + (typingOk ? 0 : 0.10);
    var wJa2en = 0.25;
    var wCloze = 0.15;
    // 残りはtyping(typingOk時のみ) — 判定はr未満の最後の分岐(typingOk?"typing":"en2ja")で行う
    var r = Math.random();
    var acc = wEn2ja;
    if (r < acc) return "en2ja";
    acc += wJa2en;
    if (r < acc) return "ja2en";
    acc += wCloze;
    if (r < acc) return "cloze";
    return typingOk ? "typing" : "en2ja";
  }

  // 英綴りの紛らわしさの簡易スコア(先頭一致文字数 - 長さ差)
  function spellSimilarity(a, b) {
    a = a.toLowerCase();
    b = b.toLowerCase();
    var len = Math.min(a.length, b.length);
    var common = 0;
    for (var i = 0; i < len; i++) {
      if (a[i] === b[i]) common++;
      else break;
    }
    return common * 3 - Math.abs(a.length - b.length);
  }

  // en2ja 用の誤答(日本語訳)を3個作る。distractorHint優先、不足はlevel±1の他語jaから補填。
  function buildJaDistractors(word, allWords) {
    var used = {};
    used[word.ja] = true;
    var synonymSet = {};
    (word.synonyms || []).forEach(function (s) { synonymSet[s.toLowerCase()] = true; });

    var result = [];
    (word.distractorHint || []).forEach(function (h) {
      if (result.length >= 3) return;
      if (h && !used[h]) { result.push(h); used[h] = true; }
    });

    function fillFrom(pool) {
      pool = pool.filter(function (w) {
        return w.id !== word.id && !used[w.ja] && !synonymSet[(w.word || "").toLowerCase()];
      });
      pool = TW.util.shuffle(pool);
      for (var i = 0; i < pool.length && result.length < 3; i++) {
        var ja = pool[i].ja;
        if (!used[ja]) { result.push(ja); used[ja] = true; }
      }
    }

    if (result.length < 3) {
      fillFrom(allWords.filter(function (w) { return Math.abs(w.level - word.level) <= 1; }));
    }
    if (result.length < 3) {
      fillFrom(allWords);
    }
    var i = 0;
    while (result.length < 3) { result.push("???" + (i++)); }
    return result;
  }

  // 出題語と語義が被る(=正解が実質複数になる)語を判定する。SPEC_CORE §4「英単語ひっかけの
  // 類義語除外(2026-07-06追加)」: ①出題語のsynonymsに含まれる語 ②その語のsynonymsに出題語が
  // 含まれる語(逆参照) ③jaの語義(「、」区切りで分割・トリム)が出題語と1つでも重複する語。
  function isMeaningOverlap(word, other) {
    var wordSynonyms = (word.synonyms || []).map(function (s) { return s.toLowerCase(); });
    var otherSynonyms = (other.synonyms || []).map(function (s) { return s.toLowerCase(); });
    var otherWordLower = (other.word || "").toLowerCase();
    var wordWordLower = (word.word || "").toLowerCase();
    if (wordSynonyms.indexOf(otherWordLower) !== -1) return true;
    if (otherSynonyms.indexOf(wordWordLower) !== -1) return true;

    var wordJaSenses = (word.ja || "").split("、").map(function (s) { return s.trim(); }).filter(Boolean);
    var otherJaSenses = (other.ja || "").split("、").map(function (s) { return s.trim(); }).filter(Boolean);
    for (var i = 0; i < wordJaSenses.length; i++) {
      if (otherJaSenses.indexOf(wordJaSenses[i]) !== -1) return true;
    }
    return false;
  }

  // ja2en/cloze 用の誤答(英単語)を3個作る。level±1・同cat優先、綴りが紛らわしい語を優先。
  // 類義語(synonyms相互参照・ja語義重複)は正解が複数になるため誤答候補から除外する
  // (SPEC_CORE §4 2026-07-06追加)。除外で母集団が3語未満に痩せる場合、フォールバック
  // (level±1条件を外して全語から)側にも同じ除外を適用する。
  function buildEnDistractors(word, allWords) {
    var used = {};
    used[word.word.toLowerCase()] = true;

    function baseFilter(w) {
      return w.id !== word.id && !used[(w.word || "").toLowerCase()] && !isMeaningOverlap(word, w);
    }

    var pool = allWords.filter(function (w) {
      return baseFilter(w) && Math.abs(w.level - word.level) <= 1;
    });
    if (pool.length < 3) {
      pool = allWords.filter(baseFilter);
    }
    pool.sort(function (a, b) {
      var scoreA = (a.cat === word.cat ? 1000 : 0) + spellSimilarity(a.word, word.word);
      var scoreB = (b.cat === word.cat ? 1000 : 0) + spellSimilarity(b.word, word.word);
      return scoreB - scoreA;
    });
    var top = TW.util.shuffle(pool.slice(0, 12));
    var result = [];
    for (var i = 0; i < top.length && result.length < 3; i++) {
      var w = top[i].word.toLowerCase();
      if (!used[w]) { result.push(top[i].word); used[w] = true; }
    }
    var j = 0;
    while (result.length < 3) { result.push("---" + (j++)); }
    return result;
  }

  // 正解+誤答3個をシャッフルしてchoices/answerIndexを作る
  function assembleChoices(correctText, distractors) {
    var items = [{ t: correctText, c: true }];
    distractors.forEach(function (d) { items.push({ t: d, c: false }); });
    var shuffled = TW.util.shuffle(items);
    var answerIndex = -1;
    var choices = shuffled.map(function (it, i) {
      if (it.c) answerIndex = i;
      return it.t;
    });
    return { choices: choices, answerIndex: answerIndex };
  }

  // ex中で見出し語(活用形含む、語頭一致)が最初に現れる単語トークンを探す(大文字小文字無視)。
  function findClozeToken(ex, headword) {
    var re = /[A-Za-z']+/g;
    var lowerHead = (headword || "").toLowerCase();
    if (!lowerHead) return null;
    var m;
    while ((m = re.exec(ex))) {
      var token = m[0];
      if (token.toLowerCase().indexOf(lowerHead) === 0) {
        return { start: m.index, end: m.index + token.length };
      }
    }
    return null;
  }

  // cloze(例文穴埋め): ex中の見出し語を"____"に置換。見つからなければnull(呼び元でen2jaへ振替)。
  function buildClozeQuestion(word, allWords) {
    var ex = word.ex || "";
    var hit = findClozeToken(ex, word.word);
    if (!hit) return null;
    var prompt = ex.slice(0, hit.start) + "____" + ex.slice(hit.end);
    var en = assembleChoices(word.word, buildEnDistractors(word, allWords));
    return { word: word, type: "cloze", prompt: prompt, choices: en.choices, answerIndex: en.answerIndex };
  }

  function buildQuestion(word, type, allWords) {
    if (type === "cloze") {
      var cloze = buildClozeQuestion(word, allWords);
      if (cloze) return cloze;
      type = "en2ja"; // exに見出し語が見つからない場合の振替
    }
    if (type === "typing") {
      return { word: word, type: type, prompt: word.ja, choices: null, answerIndex: null };
    }
    if (type === "ja2en") {
      var en = assembleChoices(word.word, buildEnDistractors(word, allWords));
      return { word: word, type: type, prompt: word.ja, choices: en.choices, answerIndex: en.answerIndex };
    }
    // en2ja: 日本語訳4択
    var ja = assembleChoices(word.ja, buildJaDistractors(word, allWords));
    return { word: word, type: type, prompt: word.word, choices: ja.choices, answerIndex: ja.answerIndex };
  }

  // デイリークエスト「コンボN」用: TW.quest.onAction は type 別に done+=n を積算する契約
  // (js/core/quest.js, 担当外ファイルのため変更しない)。この積算はコンボの「ピーク値」を
  // 累計加算してしまい、対局を重ねるだけで達成扱いになってしまう(単発対局内の最大コンボが
  // goal に届かなくても複数対局の合計で届く)。ここでは対象クエスト項目の現在の done を読み、
  // 「不足分だけ」を n として渡すことで、積算後の done が Math.max(旧done, maxCombo) に一致する
  // ようにする(=事実上ピーク比較と同じ挙動になる)。対象項目の判別は id 接頭辞 "combo" で行う
  // (js/ui/battle-ui.js の questLabel と同じ、id 命名からの推測に合わせた)。
  function comboQuestDelta(maxCombo) {
    var state = TW.store.state;
    var items = (state && state.quests && state.quests.items) || [];
    var delta = 0;
    for (var i = 0; i < items.length; i++) {
      var item = items[i];
      if (String(item.id || "").indexOf("combo") !== 0) continue;
      var peak = Math.min(item.goal, maxCombo);
      var need = peak - item.done;
      if (need > delta) delta = need;
    }
    return delta;
  }

  function checkAnswer(q, answer) {
    if (q.type === "typing") {
      if (typeof answer !== "string") return false;
      return answer.trim().toLowerCase() === q.word.word.trim().toLowerCase();
    }
    return typeof answer === "number" && answer === q.answerIndex;
  }

  // ボットの回答スケジュールを開始時に生成(乱数はここだけ)。tick/end はこの配列と経過時間から
  // 決定的にスコアを再計算する(何度呼んでも同じnowなら同じ結果)。
  // botInfo.style を反映: rush=経過時間の前半×0.75・後半×1.35(その逆がcloser)、
  // streaky=間隔の乱数揺らぎを±70%に拡大(通常±40%)。
  function buildBotSchedule(botInfo, durationMs) {
    var schedule = [];
    var t = 0;
    var guard = 0;
    var style = botInfo.style;
    var half = durationMs / 2;
    var jitterRange = style === "streaky" ? 0.7 : 0.4;
    while (t < durationMs && guard < 5000) {
      guard++;
      var jitter = 1 + (Math.random() * 2 * jitterRange - jitterRange);
      var paceMult = 1;
      if (style === "rush") paceMult = t < half ? 0.75 : 1.35;
      else if (style === "closer") paceMult = t < half ? 1.35 : 0.75;
      var ansMs = Math.max(300, botInfo.avgMs * jitter * paceMult);
      var nt = t + ansMs;
      if (nt > durationMs) break;
      t = nt;
      schedule.push({ t: t, ms: ansMs, correct: Math.random() < botInfo.accuracy });
    }
    return schedule;
  }

  // schedule上でelapsedMsまでの結果をプレイヤーと同じスコア式(コンボ・フィーバーチェイン込み)で再生する
  // 注: Session.submit()と同じ順序(コンボ増加→時間切れ判定→10の倍数チェイン判定→feverActive確定→スコア計算)
  // にすること。順序を変えるとフィーバー発動コンボ(10の倍数)目の判定がプレイヤーとボットで食い違う
  // (ボーナス有無・Lvが非対称になる)。
  function computeBotStateAt(schedule, elapsedMs) {
    var score = 0, combo = 0, feverEndAt = -Infinity, feverLevel = 0;
    for (var i = 0; i < schedule.length; i++) {
      var e = schedule[i];
      if (e.t > elapsedMs) break;
      if (e.correct) {
        combo++;
        if (e.t >= feverEndAt) feverLevel = 0; // 時間切れならLv0に戻す
        if (combo % FEVER_COMBO === 0) {
          feverLevel = feverLevel > 0 ? Math.min(4, feverLevel + 1) : 1; // フィーバー中ならチェイン、そうでなければLv1発動
          feverEndAt = e.t + FEVER_MS;
        }
      } else {
        combo = 0;
        feverEndAt = -Infinity;
        feverLevel = 0;
      }
      var feverActive = e.t < feverEndAt;
      if (e.correct) {
        score += scoreFormula(combo, feverActive ? feverLevel : 0, e.ms);
      }
    }
    return { score: score, combo: combo };
  }

  function Session(opts) {
    this.mode = (opts && opts.mode) || "rank";
    this.durationMs = (opts && opts.durationMs) || 60000; // ランク/特訓は1分(30秒を試して戻した。ブリッツはUI側で60000を明示指定)
    this.onEvent = (opts && opts.onEvent) || function () {};

    this.startAt = Date.now();
    this._lastNow = this.startAt; // tick(now)で外部から進められる単調時計(実時間のDate.now()と併用)
    this.playerScore = 0;
    this.combo = 0;
    this.maxCombo = 0;
    this.feverEndAt = -Infinity;
    this.feverLevel = 0;    // 0=非フィーバー、1-4=フィーバーLv(チェインで上限4まで加算)
    this.maxFeverLevel = 0; // Resultに載せる対局最大Lv
    this.correct = 0;
    this.total = 0;
    this._newWordCount = 0;
    this._reviewCount = 0;
    this._bonusCoinTotal = 0;
    this._capturedWords = [];
    this._kiraWords = [];
    this._capturedIds = {};
    this._kiraIds = {};
    this._scoutedAtCapture = {};
    this._currentQuestion = null;
    this._queue = [];
    this._allWords = TW.store.allWords();

    // SPEC_ADDICTION §3: ブリッツはボット無し(自己ベスト勝負)。opts.bot 指定時はリベンジ用に
    // 相手を完全固定(弱体化しない=同じ相手と約束通り戦える)。固定が無い通常時のみ、
    // 序盤3戦(state.history.length<3)でボットを弱体化する(見た目には出さない)。
    if (this.mode === "blitz") {
      this.botInfo = null;
      this._botSchedule = [];
    } else if (opts && opts.bot) {
      this.botInfo = opts.bot;
      this._botSchedule = buildBotSchedule(this.botInfo, this.durationMs);
    } else {
      var elo = TW.rating.current().elo;
      this.botInfo = TW.rating.botFor(elo);
      // mode未設定の履歴(旧データ・テストのダミー履歴)はrank扱いとみなす
      var histLen = ((TW.store.state && TW.store.state.history) || []).filter(function (h) {
        return !h.mode || h.mode === "rank";
      }).length;
      if (histLen < 3) {
        this.botInfo = {
          elo: this.botInfo.elo,
          accuracy: TW.util.clamp(this.botInfo.accuracy - 0.20, 0, 1),
          avgMs: this.botInfo.avgMs + 1500,
          name: this.botInfo.name,
          style: this.botInfo.style
        };
      }
      this._botSchedule = buildBotSchedule(this.botInfo, this.durationMs);
    }

    // SPEC_ADDICTION §2.3: 週替わり強化週間(該当カテゴリの単語スコア×1.5)。TW.daily未ロードでも落ちない。
    this._catEvent = null;
    if (typeof TW.daily !== "undefined" && TW.daily && typeof TW.daily.currentEvents === "function") {
      var events = TW.daily.currentEvents(this.startAt) || [];
      for (var i = 0; i < events.length; i++) {
        if (events[i] && events[i].type === "cat") { this._catEvent = events[i]; break; }
      }
    }
    this._eventApplied = false; // このセッションで実際にcatイベント倍率が適用されたか

    this.onEvent({ type: "start", mode: this.mode });
  }

  // 単調時計を進める。tick(now)からの明示的な時刻とDate.now()の両方を受け付け、大きい方を採用する。
  // これによりtick()を使って時間を進めれば(テスト等で)next()の終了判定も決定的に制御できる。
  Session.prototype._touch = function (t) {
    if (t > this._lastNow) this._lastNow = t;
    return this._lastNow;
  };

  Session.prototype._ensureQueue = function () {
    while (this._queue.length < QUEUE_LOW_WATER) {
      this._queue = this._queue.concat(TW.srs.buildQueue(this._queue.length === 0 ? QUEUE_BATCH : QUEUE_REFILL));
    }
  };

  Session.prototype._botScoreAt = function (elapsedMs) {
    return computeBotStateAt(this._botSchedule, elapsedMs).score;
  };

  Session.prototype.next = function () {
    var now = this._touch(Date.now());
    var elapsed = now - this.startAt;
    if (elapsed >= this.durationMs) return null;
    this._ensureQueue();
    var word = this._queue.shift();
    if (!word) return null;
    var settings = (TW.store.state && TW.store.state.settings) || {};
    var type = pickType(settings);
    var q = buildQuestion(word, type, this._allWords);
    this._currentQuestion = q;
    this.onEvent({ type: "question", question: q });
    return q;
  };

  Session.prototype.submit = function (answer, ms, opts) {
    var q = this._currentQuestion;
    if (!q) return null;
    this._currentQuestion = null;

    var word = q.word;
    var correct = checkAnswer(q, answer);
    var now = this._touch(Date.now());
    // SPEC_ADDICTION §3: skipSrs時(ブリッツの3秒超過=submit(null))はSRSに一切記録しない
    var skipSrs = !!(opts && opts.skipSrs);

    var srsResult;
    if (skipSrs) {
      var existingSrs = TW.store.state.srs && TW.store.state.srs[word.id];
      srsResult = { captured: false, kira: false, mastery: existingSrs ? existingSrs.mastery : 0 };
    } else {
      var wasNew = !(TW.store.state.srs && TW.store.state.srs[word.id]);
      srsResult = TW.srs.answer(word.id, correct, ms);
      if (wasNew) this._newWordCount++; else this._reviewCount++;

      // 同一対局内で同じ単語が往復してcaptured/kiraを再度跨いだ場合も、
      // コイン加算・リザルト表示はword.id単位で1回に限定する(重複push防止)。
      if (srsResult.captured && !this._capturedIds[word.id]) {
        this._capturedIds[word.id] = true;
        this._capturedWords.push(word);
        this._scoutedAtCapture[word.id] = !!(TW.store.state.scouted && TW.store.state.scouted.indexOf(word.id) !== -1);
      }
      if (srsResult.kira && !this._kiraIds[word.id]) {
        this._kiraIds[word.id] = true;
        this._kiraWords.push(word);
      }
    }

    this.total++;
    if (correct) this.correct++;

    var feverJustStarted = false;
    var feverChained = false;
    var scoreGained = 0;
    var bonusCoin = 0;

    if (correct) {
      this.combo++;
      if (this.combo > this.maxCombo) this.maxCombo = this.combo;

      if (now >= this.feverEndAt) this.feverLevel = 0; // 時間切れが確定していればLvを0に戻す

      // コンボが10の倍数に到達するたびフィーバー発動判定(SPEC_CORE §4/§5)
      if (this.combo % FEVER_COMBO === 0) {
        if (this.feverLevel > 0) {
          // フィーバー中に到達 → チェイン: Lv+1(上限4)、残り時間を15秒にリセット
          this.feverLevel = Math.min(4, this.feverLevel + 1);
          feverChained = true;
        } else {
          // 非フィーバー中に到達 → Lv1で新規発動
          this.feverLevel = 1;
          feverJustStarted = true;
        }
        this.feverEndAt = now + FEVER_MS;
        if (this.feverLevel > this.maxFeverLevel) this.maxFeverLevel = this.feverLevel;
      }
    } else {
      this.combo = 0;
      this.feverEndAt = -Infinity; // フィーバー即終了(タイマー延長も再発動もしない)
      this.feverLevel = 0;
    }

    var feverActive = now < this.feverEndAt;
    var feverLevelNow = feverActive ? this.feverLevel : 0;

    if (correct) {
      // SPEC_ADDICTION §3: ブリッツはスコア×1.2。カテゴリ強化週間中は対象catの単語がさらに×mult
      var extraMult = this.mode === "blitz" ? 1.2 : 1;
      if (this._catEvent && word.cat === this._catEvent.cat) {
        extraMult *= this._catEvent.mult;
        this._eventApplied = true;
      }
      scoreGained = scoreFormula(this.combo, feverLevelNow, ms, extraMult);
      this.playerScore += scoreGained;
      if (Math.random() < BONUS_COIN_RATE) {
        bonusCoin = BONUS_COIN_VALUE;
        this._bonusCoinTotal += bonusCoin;
      }
    }

    var result = {
      correct: correct,
      scoreGained: scoreGained,
      combo: this.combo,
      feverActive: feverActive,
      feverJustStarted: feverJustStarted,
      feverLevel: feverLevelNow,
      feverChained: feverChained,
      playerScore: this.playerScore,
      botScore: this._botScoreAt(now - this.startAt),
      bonusCoin: bonusCoin,
      srs: { captured: srsResult.captured, kira: srsResult.kira, mastery: srsResult.mastery }
    };
    this.onEvent({ type: "submit", result: result, question: q });
    return result;
  };

  // UIがrAF/250ms間隔で呼ぶ。now基準でボットスコア・残時間・フィーバー残を再計算するだけ(副作用なし)。
  Session.prototype.tick = function (now) {
    var t = this._touch(now);
    var elapsed = t - this.startAt;
    var remainMs = TW.util.clamp(this.durationMs - elapsed, 0, this.durationMs);
    var feverRemainMs = t < this.feverEndAt ? (this.feverEndAt - t) : 0;
    return {
      remainMs: remainMs,
      botScore: this._botScoreAt(elapsed),
      feverRemainMs: feverRemainMs
    };
  };

  Session.prototype.end = function () {
    var finalBotScore = this._botScoreAt(this.durationMs);

    // SPEC_ADDICTION §3: ブリッツは自己ベスト更新が「勝利」に相当(対ボット比較は存在しない)。
    var blitzResult = null;
    if (this.mode === "blitz") {
      TW.store.state.blitzBest = TW.store.state.blitzBest || 0;
      var prevBest = TW.store.state.blitzBest;
      var isNewBest = this.playerScore > prevBest;
      if (isNewBest) TW.store.state.blitzBest = this.playerScore;
      blitzResult = { score: this.playerScore, best: TW.store.state.blitzBest, isNewBest: isNewBest };
    }
    var win = this.mode === "blitz" ? !!blitzResult.isNewBest : this.playerScore > finalBotScore;

    // nearMiss: rank戦で負け かつ botScoreとの差が10%以内 → リベンジ用にボットプロファイルを保持
    var nearMiss = false;
    var rematchBot = null;
    if (this.mode === "rank" && !win && finalBotScore > 0) {
      if ((finalBotScore - this.playerScore) / finalBotScore <= 0.10) {
        nearMiss = true;
        rematchBot = this.botInfo;
      }
    }

    // ブーストチケット消費(TW.daily.useBoost()がセットしたpendingをここで読んで倍化・消費する)。
    // state.boost自体はSave(SPEC_ADDICTION §0)のフィールドで、daily.js未ロードでも存在しなければ単にfalse扱い。
    var boostUsed = !!(TW.store.state.boost && TW.store.state.boost.pending);
    if (boostUsed) TW.store.state.boost.pending = false;

    // 2026-07-05: 対局系コインを約1/6へチューニング(XPは一切変更しない)。
    var coinsBase;
    if (this.mode === "blitz") {
      coinsBase = 4 + (blitzResult.isNewBest ? 8 : 0);
    } else {
      coinsBase = this.mode === "rank" ? (win ? 8 : 3) : 3;
    }
    var self = this;
    var captureCoins = 0;
    this._capturedWords.forEach(function (w) {
      captureCoins += self._scoutedAtCapture[w.id] ? 2 : 1;
    });
    var kiraCoins = this._kiraWords.length * 3;
    var totalCoins = coinsBase + captureCoins + kiraCoins + this._bonusCoinTotal;
    if (boostUsed) totalCoins *= 2; // コインとXPが2倍(スコアには掛けない=ランク戦の公平性維持)
    var coinsEarned = TW.store.addCoins(totalCoins);

    // xpGained: 通常は正解×10+誤答×2+対局20+勝利30、ブリッツはfloor(score/50)。ブースト時は2倍。
    var xpGained;
    if (this.mode === "blitz") {
      xpGained = Math.floor(this.playerScore / 50);
    } else {
      xpGained = this.correct * 10 + (this.total - this.correct) * 2 + 20 + (win ? 30 : 0);
    }
    if (boostUsed) xpGained *= 2;

    // TW.level未ロードでも落ちないようguard(単体テスト環境など)
    var levelUp = null;
    if (typeof TW.level !== "undefined" && TW.level && typeof TW.level.addXp === "function") {
      levelUp = TW.level.addXp(xpGained);
    }

    var eventApplied = (this._eventApplied && this._catEvent) ? this._catEvent.name : null;

    var rank = null;
    if (this.mode === "rank") {
      rank = TW.rating.applyResult(win, this.botInfo.elo);
    }

    // SPEC_CORE §2 Save.history への記録。
    // 注: SPEC_CORE §4 のどの関数がこれを書くかは契約に明記が無いが、
    // TW.ui.stats(js/ui/stats.js)がTW.store.state.historyを読む前提で実装されており、
    // 対局結果が確定するここで書かないと統計画面が永久に空になる(統合上必須の最小修正)。
    var histState = TW.store.state;
    histState.history = histState.history || [];
    histState.history.push({
      t: Date.now(),
      mode: this.mode,
      win: win,
      score: this.playerScore,
      botScore: finalBotScore,
      eloAfter: histState.elo,
      correct: this.correct,
      total: this.total,
      maxCombo: this.maxCombo // 2026-07-06追加: 統計画面の「最大コンボ」が常に0だったバグの修正
    });

    TW.quest.onAction("battle", 1);
    if (win) TW.quest.onAction("win", 1);
    if (this._reviewCount > 0) TW.quest.onAction("review", this._reviewCount);
    if (this._newWordCount > 0) TW.quest.onAction("newWord", this._newWordCount);
    if (this.maxCombo > 0) TW.quest.onAction("combo", comboQuestDelta(this.maxCombo));
    TW.quest.addSeasonScore(this.playerScore);

    var result = {
      win: win,
      playerScore: this.playerScore,
      botScore: finalBotScore,
      correct: this.correct,
      total: this.total,
      maxCombo: this.maxCombo,
      maxFeverLevel: this.maxFeverLevel,
      capturedWords: this._capturedWords,
      kiraWords: this._kiraWords,
      coinsEarned: coinsEarned,
      rank: rank,
      // 注: TW.quest.getDaily()は「今日の3件を決定的に選出する」専用関数で進捗を持たない
      // (常にdone:0,claimed:false)。実際の進捗はTW.store.state.quests.itemsにあるため、
      // そちらを渡す(TW.quest.onAction()で更新済み)。
      questEvents: TW.store.state.quests.items,
      // SPEC_ADDICTION §3 追加フィールド
      xpGained: xpGained,
      levelUp: levelUp,
      nearMiss: nearMiss,
      rematchBot: rematchBot,
      boostUsed: boostUsed,
      blitz: blitzResult,
      eventApplied: eventApplied
    };

    TW.store.save();

    this.onEvent({ type: "end", result: result });
    return result;
  };

  TW.battle = {
    start: function (opts) {
      return new Session(opts);
    }
  };
})();
