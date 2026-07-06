window.TW = window.TW || {};
window.TW.ui = window.TW.ui || {};

// TW.ui.stats(統計) / TW.ui.settings(設定) — SPEC_UI §2.5, §2.6
// (SPEC_CORE §3 の指定により設定画面は本ファイル内に実装する)
//
// 依存(SPEC_CORE §4 契約のみを使用): TW.store / TW.util / TW.sfx
(function () {
  "use strict";

  // ---- 共通ヘルパ ---------------------------------------------------

  function fmt(n) {
    return TW.util && typeof TW.util.fmt === "function" ? TW.util.fmt(n) : String(n);
  }

  function pct(x) {
    return Math.round((x || 0) * 100) + "%";
  }

  function escapeHtml(str) {
    return String(str).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  // ローカル日付("YYYY-MM-DD")。TW.util.todayStr() は「現在」専用なので、
  // 履歴タイムスタンプ(任意の過去時刻)を同じ形式に変換するための自前ヘルパ。
  function ymd(d) {
    var y = d.getFullYear();
    var m = String(d.getMonth() + 1).padStart(2, "0");
    var day = String(d.getDate()).padStart(2, "0");
    return y + "-" + m + "-" + day;
  }

  function cssVar(name, fallback) {
    try {
      var v = getComputedStyle(document.documentElement).getPropertyValue(name);
      return v && v.trim() ? v.trim() : fallback;
    } catch (e) {
      return fallback;
    }
  }

  // =====================================================================
  // TW.ui.stats — 統計画面 (SPEC_UI §2.5)
  // =====================================================================

  function setupHiDPICanvas(canvas, cssHeight) {
    var dpr = window.devicePixelRatio || 1;
    var cssWidth = Math.max(1, canvas.parentElement.clientWidth);
    canvas.width = Math.max(1, Math.round(cssWidth * dpr));
    canvas.height = Math.max(1, Math.round(cssHeight * dpr));
    canvas.style.width = cssWidth + "px";
    canvas.style.height = cssHeight + "px";
    var ctx = canvas.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { ctx: ctx, width: cssWidth, height: cssHeight };
  }

  // 直近50戦の Elo 推移を canvas 折れ線で描く。
  //
  // 補足(逸脱ではなく契約上の制約への対処): SPEC_CORE §2 の Save.history は
  // { t, mode, win, score, botScore, eloAfter, correct, total } のみで、
  // 「その対局が段位到達(昇段)だったか」を示すフラグや botElo は保存されない。
  // そのため厳密な「段位到達点にマーカー」は履歴データから再構成できない。
  // 代替として各対局を勝ち(緑)/負け(赤)の点で表示する。
  function drawEloChart(canvas) {
    var CSS_H = 150;
    var setup = setupHiDPICanvas(canvas, CSS_H);
    var ctx = setup.ctx, w = setup.width, h = setup.height;
    ctx.clearRect(0, 0, w, h);

    var hist = ((TW.store && TW.store.state && TW.store.state.history) || []).slice(-50);

    var padL = 36, padR = 8, padT = 14, padB = 10;
    var plotW = Math.max(1, w - padL - padR);
    var plotH = Math.max(1, h - padT - padB);

    if (hist.length < 2) {
      ctx.fillStyle = cssVar("--text-dim", "#8A97AC");
      ctx.font = "13px sans-serif";
      ctx.fillText("対局データがまだありません", 8, h / 2);
      return;
    }

    var elos = hist.map(function (e) { return e.eloAfter; });
    var minE = Math.min.apply(null, elos);
    var maxE = Math.max.apply(null, elos);
    if (minE === maxE) { minE -= 10; maxE += 10; }
    var margin = (maxE - minE) * 0.12;
    minE -= margin; maxE += margin;

    function xAt(i) { return padL + (i / (hist.length - 1)) * plotW; }
    function yAt(v) { return padT + (1 - (v - minE) / (maxE - minE)) * plotH; }

    ctx.fillStyle = cssVar("--text-dim", "#8A97AC");
    ctx.font = "11px sans-serif";
    ctx.fillText(String(Math.round(maxE)), 2, padT + 4);
    ctx.fillText(String(Math.round(minE)), 2, padT + plotH);

    ctx.strokeStyle = cssVar("--accent", "#3B82F6");
    ctx.lineWidth = 2;
    ctx.beginPath();
    hist.forEach(function (e, i) {
      var x = xAt(i), y = yAt(e.eloAfter);
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    });
    ctx.stroke();

    hist.forEach(function (e, i) {
      var x = xAt(i), y = yAt(e.eloAfter);
      ctx.beginPath();
      ctx.fillStyle = e.win ? cssVar("--green", "#22C55E") : cssVar("--red", "#EF4444");
      ctx.arc(x, y, 2.6, 0, Math.PI * 2);
      ctx.fill();
    });
  }

  function computeSummary() {
    var state = TW.store.state;
    var hist = state.history || [];
    var todayKey = (TW.util && typeof TW.util.todayStr === "function") ? TW.util.todayStr() : ymd(new Date());
    var today = hist.filter(function (h) { return ymd(new Date(h.t)) === todayKey; });

    function agg(list) {
      var battles = list.length;
      var wins = list.filter(function (h) { return h.win; }).length;
      var correct = 0, total = 0;
      list.forEach(function (h) { correct += h.correct || 0; total += h.total || 0; });
      return {
        battles: battles,
        winRate: battles > 0 ? wins / battles : 0,
        total: total,
        accuracy: total > 0 ? correct / total : 0
      };
    }

    var srsMap = state.srs || {};
    var learned = 0, captured = 0, kira = 0;
    Object.keys(srsMap).forEach(function (id) {
      var s = srsMap[id];
      learned++;
      if (s.mastery >= 3) captured++;
      if (s.mastery >= 5 && s.interval >= 21) kira++;
    });

    var newToday = (state.newPerDay && state.newPerDay.date === todayKey) ? state.newPerDay.count : 0;

    // maxCombo: SPEC_CORE の Save.history スキーマには対局ごとの最大コンボは
    // 保存されない(Result.maxCombo はセッション内の一時値)。将来的に history
    // 要素へ任意で maxCombo が追加された場合には拾えるよう寛容に読むが、
    // 現行スキーマ通りであれば常に 0 になる(既知の制約)。
    var maxComboEver = hist.reduce(function (m, h) { return Math.max(m, h.maxCombo || 0); }, 0);

    // Phase2(中毒強化パック): Lv・累積XP・ブリッツ自己ベスト(SPEC_ADDICTION §5.4)。
    // TW.level(js/core/level.js)は別担当が追加する新規名前空間のため、未読込でも
    // 画面が壊れないよう typeof ガード付きで呼ぶ。state.xp/blitzBest も同様に
    // store.js側のマイグレーション未適用時は undefined になり得るため既定値0で受ける。
    var levelInfo = (TW.level && typeof TW.level.current === "function") ? TW.level.current() : null;

    return {
      today: agg(today),
      cumulative: agg(hist),
      learned: learned,
      captured: captured,
      kira: kira,
      newWordsToday: newToday,
      maxComboEver: maxComboEver,
      level: levelInfo ? levelInfo.level : null,
      xp: state.xp || 0,
      blitzBest: state.blitzBest || 0
    };
  }

  function buildSummaryHtml(sum) {
    function row(label, todayVal, cumVal) {
      return '<div class="meta-stat-row"><div class="meta-stat-label">' + label + "</div>" +
        '<div class="meta-stat-today">' + todayVal + "</div>" +
        '<div class="meta-stat-cum">' + cumVal + "</div></div>";
    }
    return "" +
      '<div class="card meta-summary">' +
      '<div class="meta-summary-title">記録</div>' +
      '<div class="meta-stat-row meta-stat-row--head"><div class="meta-stat-label"></div><div class="meta-stat-today">今日</div><div class="meta-stat-cum">累計</div></div>' +
      row("対局数", fmt(sum.today.battles), fmt(sum.cumulative.battles)) +
      row("勝率", pct(sum.today.winRate), pct(sum.cumulative.winRate)) +
      row("回答数", fmt(sum.today.total), fmt(sum.cumulative.total)) +
      row("正答率", pct(sum.today.accuracy), pct(sum.cumulative.accuracy)) +
      row("新規学習語数", fmt(sum.newWordsToday), "-") +
      row("学習済語数", "-", fmt(sum.learned)) +
      row("捕獲数", "-", fmt(sum.captured)) +
      row("キラ数", "-", fmt(sum.kira)) +
      row("最大コンボ", "-", fmt(sum.maxComboEver)) +
      "</div>";
  }

  // Phase2: Lv・累積XP・ブリッツ自己ベストのタイル(SPEC_ADDICTION §5.4)。
  function growthTileHtml(value, label) {
    return '<div class="meta-growth-tile"><div class="meta-growth-value">' + value + '</div>' +
      '<div class="meta-growth-label">' + label + "</div></div>";
  }

  function buildGrowthHtml(sum) {
    var lvText = sum.level != null ? fmt(sum.level) : "-";
    return '<div class="card meta-growth">' +
      '<div class="meta-summary-title">成長</div>' +
      '<div class="meta-growth-grid">' +
      growthTileHtml(lvText, "Lv") +
      growthTileHtml(fmt(sum.xp), "累積XP") +
      growthTileHtml(fmt(sum.blitzBest), "ブリッツ自己ベスト") +
      "</div></div>";
  }

  function buildWeeklyHtml() {
    var state = TW.store.state;
    var hist = state.history || [];
    var weeks = [];
    for (var i = 7; i >= 0; i--) {
      var d = new Date(Date.now() - i * 7 * 86400000);
      var key = (TW.util && typeof TW.util.weekKey === "function") ? TW.util.weekKey(d) : ymd(d);
      weeks.push({ key: key, label: (d.getMonth() + 1) + "/" + d.getDate(), count: 0 });
    }
    var byKey = {};
    weeks.forEach(function (w) { byKey[w.key] = w; });
    hist.forEach(function (h) {
      var key = (TW.util && typeof TW.util.weekKey === "function") ? TW.util.weekKey(new Date(h.t)) : ymd(new Date(h.t));
      if (byKey[key]) byKey[key].count++;
    });
    var maxCount = weeks.reduce(function (m, w) { return Math.max(m, w.count); }, 0) || 1;

    var barsHtml = weeks.map(function (w) {
      var hPct = Math.max(2, Math.round((w.count / maxCount) * 100));
      return '<div class="meta-weekbar-col">' +
        '<div class="meta-weekbar-track"><div class="meta-weekbar-fill" style="height:' + hPct + '%"></div></div>' +
        '<div class="meta-weekbar-count">' + w.count + "</div>" +
        '<div class="meta-weekbar-label">' + w.label + "</div>" +
        "</div>";
    }).join("");

    return '<div class="card meta-weekly"><div class="meta-summary-title">週間アクティビティ(対局数・直近8週)</div><div class="meta-weekbars">' + barsHtml + "</div></div>";
  }

  function renderStats(container) {
    var sum = computeSummary();
    container.innerHTML = "" +
      buildGrowthHtml(sum) +
      '<div class="card meta-elochart">' +
      '<div class="meta-summary-title">レート推移(直近50戦)</div>' +
      '<div class="meta-elo-canvas-wrap"><canvas id="tw-elo-canvas" class="meta-elo-canvas"></canvas></div>' +
      '<div class="meta-elo-legend"><span class="meta-legend-dot meta-legend-dot--win"></span>勝ち<span class="meta-legend-dot meta-legend-dot--lose"></span>負け</div>' +
      "</div>" +
      buildSummaryHtml(sum) +
      buildWeeklyHtml();

    var canvas = container.querySelector("#tw-elo-canvas");
    if (canvas) drawEloChart(canvas);
  }

  window.TW.ui.stats = { render: renderStats };

  // =====================================================================
  // TW.ui.settings — 設定画面 (SPEC_UI §2.6)
  // =====================================================================

  // 実績id⇔表示名の対応表。
  // 補足: SPEC_CORE には実績idの列挙表が存在しない(TW.quest.checkAchievements
  // が何を返すかは実装依存)。DESIGN.md §3 の例示(初昇級/コンボ20/UR捕獲/
  // ストリーク7日)に基づき本UI側で暫定的に id を命名した。TW.quest 側が
  // 実際に発行する id 文字列とここで異なる場合、該当分は下の「未知の実績」
  // フォールバック(save の achievements 配列を id のまま表示)で救済する。
  var ACHIEVEMENT_DEFS = [
    { id: "first_promotion", icon: "🎖", label: "初昇級" },
    { id: "combo20", icon: "🔥", label: "20連撃" },
    { id: "ur_capture", icon: "🌈", label: "UR捕獲" },
    { id: "streak7", icon: "📅", label: "ストリーク7日" }
  ];

  function sectionWrap(title, innerHtml) {
    return '<div class="card meta-settings-section"><div class="meta-settings-section-title">' + title + "</div>" + innerHtml + "</div>";
  }

  function toggleRowHtml(id, label, checked) {
    return '<label class="meta-toggle-row" for="' + id + '">' +
      '<span class="meta-toggle-label">' + label + "</span>" +
      '<span class="meta-toggle-switch"><input type="checkbox" id="' + id + '"' + (checked ? " checked" : "") + '><span class="meta-toggle-slider"></span></span>' +
      "</label>";
  }

  function selectRowHtml(current) {
    var opts = [10, 20, 30, 50, 100, 9999];
    var optsHtml = opts.map(function (n) {
      var label = n === 9999 ? "無制限" : n + "語";
      return '<option value="' + n + '"' + (n === current ? " selected" : "") + '>' + label + "</option>";
    }).join("");
    return '<div class="meta-select-row"><span class="meta-toggle-label">新規単語/日</span><select id="tw-set-newperday" class="meta-select">' + optsHtml + "</select></div>";
  }

  function dataSectionInnerHtml() {
    return "" +
      '<div class="meta-data-block">' +
      '<button type="button" class="btn" id="tw-export-btn">書き出す</button> ' +
      '<button type="button" class="btn" id="tw-copy-btn">コピー</button>' +
      '<textarea class="meta-export-textarea" id="tw-export-area" readonly placeholder="「書き出す」を押すとここにデータが表示されます"></textarea>' +
      '<div class="meta-copy-msg" id="tw-copy-msg"></div>' +
      "</div>" +
      '<div class="meta-data-block">' +
      '<textarea class="meta-export-textarea" id="tw-import-area" placeholder="書き出したデータをここに貼り付け"></textarea>' +
      '<button type="button" class="btn btn-primary" id="tw-import-btn">取り込む</button>' +
      '<div class="meta-copy-msg" id="tw-import-msg"></div>' +
      "</div>" +
      '<div class="meta-danger-zone">' +
      '<button type="button" class="btn meta-btn-danger" id="tw-reset-btn">全データをリセット</button>' +
      "</div>";
  }

  function achievementsInnerHtml() {
    var unlocked = (TW.store.state.achievements || []);
    var unlockedSet = {};
    unlocked.forEach(function (id) { unlockedSet[id] = true; });

    var defsById = {};
    ACHIEVEMENT_DEFS.forEach(function (d) { defsById[d.id] = d; });

    var items = ACHIEVEMENT_DEFS.map(function (d) {
      var on = !!unlockedSet[d.id];
      return '<div class="meta-achv-badge' + (on ? " meta-achv-badge--unlocked" : "") + '">' +
        '<div class="meta-achv-icon">' + (on ? d.icon : "🔒") + "</div>" +
        '<div class="meta-achv-label">' + d.label + "</div>" +
        "</div>";
    });

    unlocked.forEach(function (id) {
      if (!defsById[id]) {
        items.push('<div class="meta-achv-badge meta-achv-badge--unlocked"><div class="meta-achv-icon">🏆</div><div class="meta-achv-label">' + escapeHtml(id) + "</div></div>");
      }
    });

    return '<div class="meta-achv-grid">' + items.join("") + "</div>";
  }

  function renderSettings(container) {
    var s = TW.store.state.settings;
    // settings.bgm はSPEC_ADDICTION §0でstore.js側が既定値trueを補う予定の新規フィールド。
    // マイグレーション未適用の古いセーブ/読込順の都合で未定義な場合に備え、既定trueで読む。
    var bgmOn = typeof s.bgm === "boolean" ? s.bgm : true;

    var togglesHtml = "" +
      toggleRowHtml("tw-set-sound", "音", s.sound) +
      toggleRowHtml("tw-set-bgm", "BGM", bgmOn) +
      toggleRowHtml("tw-set-voice", "発音読み上げ", s.voice) +
      toggleRowHtml("tw-set-typing", "タイピング問題(PC向け)", s.typing) +
      selectRowHtml(s.newWordsPerDay);

    container.innerHTML = "" +
      sectionWrap("プレイ設定", togglesHtml) +
      sectionWrap("データ", dataSectionInnerHtml()) +
      sectionWrap("実績", achievementsInnerHtml());

    container.querySelector("#tw-set-sound").addEventListener("change", function (ev) {
      s.sound = !!ev.target.checked;
      if (TW.sfx && typeof TW.sfx.setEnabled === "function") TW.sfx.setEnabled(s.sound);
      TW.store.save();
    });
    container.querySelector("#tw-set-bgm").addEventListener("change", function (ev) {
      s.bgm = !!ev.target.checked;
      // TW.bgm(js/audio/bgm.js)は別担当が追加する新規名前空間のため未読込でも安全なようガードする。
      if (TW.bgm && typeof TW.bgm.setEnabled === "function") TW.bgm.setEnabled(s.bgm);
      TW.store.save();
    });
    container.querySelector("#tw-set-voice").addEventListener("change", function (ev) {
      s.voice = !!ev.target.checked;
      TW.store.save();
    });
    container.querySelector("#tw-set-typing").addEventListener("change", function (ev) {
      s.typing = !!ev.target.checked;
      TW.store.save();
    });
    container.querySelector("#tw-set-newperday").addEventListener("change", function (ev) {
      s.newWordsPerDay = parseInt(ev.target.value, 10) || 20;
      TW.store.save();
    });

    var exportArea = container.querySelector("#tw-export-area");
    var copyMsg = container.querySelector("#tw-copy-msg");

    container.querySelector("#tw-export-btn").addEventListener("click", function () {
      exportArea.value = TW.store.exportSave();
      exportArea.focus();
      exportArea.select();
      copyMsg.textContent = "";
    });

    container.querySelector("#tw-copy-btn").addEventListener("click", function () {
      if (!exportArea.value) exportArea.value = TW.store.exportSave();
      exportArea.focus();
      exportArea.select();

      function fallbackCopy() {
        var ok = false;
        try { ok = document.execCommand("copy"); } catch (e) { ok = false; }
        copyMsg.textContent = ok ? "コピーしました" : "選択済みです。手動でコピーしてください";
      }

      try {
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(exportArea.value).then(function () {
            copyMsg.textContent = "コピーしました";
          }).catch(fallbackCopy);
          return;
        }
      } catch (e) { /* fallthrough */ }
      fallbackCopy();
    });

    var importArea = container.querySelector("#tw-import-area");
    var importMsg = container.querySelector("#tw-import-msg");

    container.querySelector("#tw-import-btn").addEventListener("click", function () {
      var text = importArea.value.trim();
      if (!text) { importMsg.textContent = "データを貼り付けてください"; return; }
      var ok = false;
      try { ok = TW.store.importSave(text); } catch (e) { ok = false; }
      if (ok) {
        importMsg.textContent = "取り込みました。再読み込みします…";
        setTimeout(function () { window.location.reload(); }, 600);
      } else {
        importMsg.textContent = "取り込みに失敗しました。データを確認してください";
      }
    });

    container.querySelector("#tw-reset-btn").addEventListener("click", function () {
      // 2段confirm(タスク指示): 通常confirmを2回、文言を変えて連続表示する。
      if (!window.confirm("本当に全データをリセットしますか?(進捗・図鑑・コインが全て消えます)")) return;
      if (!window.confirm("元に戻せません。本当に削除してよろしいですか?")) return;
      TW.store.resetAll();
      window.location.reload();
    });
  }

  window.TW.ui.settings = { render: renderSettings };
})();
