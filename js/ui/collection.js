window.TW = window.TW || {};
window.TW.ui = window.TW.ui || {};

// TW.ui.collection — 図鑑画面 (SPEC_UI §2.4)
// 依存(内部実装には依存せず、SPEC_CORE §4 の契約のみを使用):
//   TW.store.allWords() / TW.store.wordById(id) / TW.store.state.srs
//   TW.sfx.speak(word)
//
// 2400語を一度に全部DOM化すると重いため、フィルタ結果は200件ずつ
// 「もっと見る」で追加描画する(タスク指示)。
(function () {
  "use strict";

  var PAGE_SIZE = 200;

  var CAT_LABELS = [
    { value: "all", label: "全部" },
    { value: "general", label: "一般" },
    { value: "academic", label: "学術" },
    { value: "it", label: "IT" },
    { value: "robotics", label: "ロボット" }
  ];

  var STATUS_LABELS = [
    { value: "all", label: "全部" },
    { value: "captured", label: "捕獲済" },
    { value: "kira", label: "キラ" },
    { value: "uncaptured", label: "未" }
  ];

  var RARITY_ORDER = ["N", "R", "SR", "SSR", "UR"];

  // render() 毎にリセットされる画面ローカル状態
  var view = {
    cat: "all",
    status: "all",
    filtered: [],
    shown: 0
  };

  function fmt(n) {
    return TW.util && typeof TW.util.fmt === "function" ? TW.util.fmt(n) : String(n);
  }

  function escapeHtml(str) {
    return String(str).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  function rarityClass(rarity) {
    switch (rarity) {
      case "N": return "rarity-n";
      case "R": return "rarity-r";
      case "SR": return "rarity-sr";
      case "SSR": return "rarity-ssr";
      case "UR": return "rarity-ur";
      default: return "";
    }
  }

  // SPEC_CORE §2: captured は mastery>=3 で導出、kira は mastery>=5 && interval>=21
  function wordStatus(wordId) {
    var srsMap = (TW.store && TW.store.state && TW.store.state.srs) || {};
    var srs = srsMap[wordId];
    if (!srs) return { learned: false, captured: false, kira: false, mastery: 0, srs: null };
    var captured = srs.mastery >= 3;
    var kira = srs.mastery >= 5 && srs.interval >= 21;
    return { learned: true, captured: captured, kira: kira, mastery: srs.mastery, srs: srs };
  }

  function matchesFilter(word, st) {
    if (view.cat !== "all" && word.cat !== view.cat) return false;
    if (view.status === "captured" && !st.captured) return false;
    if (view.status === "kira" && !st.kira) return false;
    if (view.status === "uncaptured" && st.captured) return false;
    return true;
  }

  function computeFiltered() {
    var all = TW.store.allWords();
    var out = [];
    for (var i = 0; i < all.length; i++) {
      var w = all[i];
      var st = wordStatus(w.id);
      if (matchesFilter(w, st)) out.push(w);
    }
    view.filtered = out;
    view.shown = 0;
  }

  function starsHtml(mastery) {
    var s = "";
    for (var i = 0; i < 5; i++) s += i < mastery ? "★" : "☆";
    return s;
  }

  function formatDue(due, now) {
    if (due <= now) return "復習可能";
    var d = new Date(due);
    return (d.getMonth() + 1) + "/" + d.getDate();
  }

  function chipGroupHtml(name, options, current) {
    return options.map(function (o) {
      return '<button type="button" class="chip' + (o.value === current ? " active" : "") + '" data-filter-group="' + name + '" data-filter-value="' + o.value + '">' + o.label + "</button>";
    }).join("");
  }

  function buildHeaderHtml() {
    var all = TW.store.allWords();
    var totalCount = all.length;
    var capturedCount = 0;
    var rarityTotal = {}, rarityCaptured = {};
    RARITY_ORDER.forEach(function (r) { rarityTotal[r] = 0; rarityCaptured[r] = 0; });

    all.forEach(function (w) {
      var st = wordStatus(w.id);
      if (rarityTotal.hasOwnProperty(w.rarity)) rarityTotal[w.rarity]++;
      if (st.captured) {
        capturedCount++;
        if (rarityCaptured.hasOwnProperty(w.rarity)) rarityCaptured[w.rarity]++;
      }
    });

    var pct = totalCount > 0 ? Math.round((capturedCount / totalCount) * 100) : 0;

    var pillsHtml = RARITY_ORDER.map(function (r) {
      return '<div class="meta-rarity-pill ' + rarityClass(r) + '">' +
        '<span class="meta-rarity-pill-label">' + r + "</span>" +
        '<span class="meta-rarity-pill-count">' + rarityCaptured[r] + "/" + rarityTotal[r] + "</span>" +
        "</div>";
    }).join("");

    return "" +
      '<div class="card meta-header">' +
      '<div class="meta-header-top">' +
      '<div class="meta-header-title">捕獲図鑑</div>' +
      '<div class="meta-header-count">' + fmt(capturedCount) + ' <span class="meta-header-count-slash">/ ' + fmt(totalCount) + "</span></div>" +
      "</div>" +
      '<div class="bar meta-header-bar"><div class="bar-fill" style="width:' + pct + '%"></div></div>' +
      '<div class="meta-rarity-row">' + pillsHtml + "</div>" +
      "</div>";
  }

  function buildFiltersHtml() {
    return "" +
      '<div class="meta-filters">' +
      '<div class="meta-filter-group"><span class="meta-filter-label">カテゴリ</span><div class="meta-filter-chips">' + chipGroupHtml("cat", CAT_LABELS, view.cat) + "</div></div>" +
      '<div class="meta-filter-group"><span class="meta-filter-label">状態</span><div class="meta-filter-chips">' + chipGroupHtml("status", STATUS_LABELS, view.status) + "</div></div>" +
      "</div>";
  }

  function cardHtml(word) {
    var st = wordStatus(word.id);
    if (!st.captured) {
      return '<div class="card meta-card meta-card--locked" data-id="' + word.id + '">' +
        '<div class="meta-card-locked-mark">???</div>' +
        '<div class="meta-card-level">Lv.' + word.level + "</div>" +
        "</div>";
    }
    var cls = "card meta-card " + rarityClass(word.rarity) + (st.kira ? " meta-card--kira" : "");
    return '<div class="' + cls + '" data-id="' + word.id + '" tabindex="0">' +
      (st.kira ? '<div class="meta-card-kira-badge">✨</div>' : "") +
      '<div class="badge meta-card-rarity-badge">' + word.rarity + "</div>" +
      '<div class="meta-card-word">' + escapeHtml(word.word) + "</div>" +
      '<div class="meta-card-ja">' + escapeHtml(word.ja) + "</div>" +
      "</div>";
  }

  function render(container) {
    view.cat = "all";
    view.status = "all";
    computeFiltered();

    container.innerHTML = "" +
      buildHeaderHtml() +
      buildFiltersHtml() +
      '<div class="meta-grid" id="tw-col-grid"></div>' +
      '<div class="meta-empty" id="tw-col-empty" style="display:none">該当する単語がありません</div>' +
      '<div class="meta-loadmore"><button type="button" class="btn btn-primary" id="tw-col-more">もっと見る</button></div>' +
      '<div class="modal-backdrop" id="tw-col-backdrop" style="display:none"><div class="modal" id="tw-col-modal"></div></div>';

    var gridEl = container.querySelector("#tw-col-grid");
    var moreBtn = container.querySelector("#tw-col-more");
    var emptyEl = container.querySelector("#tw-col-empty");
    var backdropEl = container.querySelector("#tw-col-backdrop");
    var modalEl = container.querySelector("#tw-col-modal");

    function renderGridAppend(count) {
      var start = view.shown;
      var end = Math.min(view.filtered.length, start + count);
      var html = "";
      for (var i = start; i < end; i++) html += cardHtml(view.filtered[i]);
      gridEl.insertAdjacentHTML("beforeend", html);
      view.shown = end;
    }

    function updateMoreBtn() {
      moreBtn.style.display = view.shown < view.filtered.length ? "" : "none";
    }

    function refreshGrid() {
      gridEl.innerHTML = "";
      view.shown = 0;
      renderGridAppend(PAGE_SIZE);
      updateMoreBtn();
      emptyEl.style.display = view.filtered.length === 0 ? "" : "none";
    }

    function closeModal() {
      backdropEl.style.display = "none";
      modalEl.innerHTML = "";
    }

    function openModal(word) {
      var st = wordStatus(word.id);
      var now = Date.now();
      var collocHtml = (word.collocations && word.collocations.length)
        ? '<div class="meta-modal-section"><div class="meta-modal-section-title">コロケーション</div><div class="meta-modal-chips">' +
          word.collocations.map(function (c) { return '<span class="chip">' + escapeHtml(c) + "</span>"; }).join("") +
          "</div></div>"
        : "";
      var synHtml = (word.synonyms && word.synonyms.length)
        ? '<div class="meta-modal-section"><div class="meta-modal-section-title">類義語</div><div class="meta-modal-chips">' +
          word.synonyms.map(function (c) { return '<span class="chip">' + escapeHtml(c) + "</span>"; }).join("") +
          "</div></div>"
        : "";

      modalEl.innerHTML = "" +
        '<div class="meta-modal-head">' +
        '<div class="meta-modal-word">' + escapeHtml(word.word) + "</div>" +
        '<button type="button" class="btn meta-modal-speak" id="tw-modal-speak" aria-label="発音を聞く">🔊</button>' +
        "</div>" +
        '<div class="meta-modal-ipa">' + (word.ipa ? "/" + escapeHtml(word.ipa) + "/" : "") + "</div>" +
        '<span class="badge ' + rarityClass(word.rarity) + '">' + word.rarity + "</span>" +
        '<div class="meta-modal-ja">' + escapeHtml(word.ja) + "</div>" +
        '<div class="meta-modal-section"><div class="meta-modal-section-title">例文</div>' +
        '<div class="meta-modal-ex">' + escapeHtml(word.ex || "") + "</div>" +
        '<div class="meta-modal-exja">' + escapeHtml(word.exJa || "") + "</div>" +
        "</div>" +
        collocHtml + synHtml +
        '<div class="meta-modal-section"><div class="meta-modal-section-title">習熟度</div><div class="meta-modal-stars">' + starsHtml(st.mastery) + "</div></div>" +
        '<div class="meta-modal-section"><div class="meta-modal-section-title">次回復習</div><div class="meta-modal-due">' + (st.srs ? formatDue(st.srs.due, now) : "-") + "</div></div>" +
        '<button type="button" class="btn btn-primary meta-modal-close">閉じる</button>';

      backdropEl.style.display = "";

      var speakBtn = modalEl.querySelector("#tw-modal-speak");
      if (speakBtn) speakBtn.addEventListener("click", function () {
        if (TW.sfx && typeof TW.sfx.speak === "function") TW.sfx.speak(word.word);
      });
      var closeBtn = modalEl.querySelector(".meta-modal-close");
      if (closeBtn) closeBtn.addEventListener("click", closeModal);
    }

    moreBtn.addEventListener("click", function () {
      renderGridAppend(PAGE_SIZE);
      updateMoreBtn();
    });

    container.querySelector(".meta-filters").addEventListener("click", function (ev) {
      var btn = ev.target.closest(".chip");
      if (!btn) return;
      var group = btn.getAttribute("data-filter-group");
      var value = btn.getAttribute("data-filter-value");
      if (group === "cat") view.cat = value;
      else if (group === "status") view.status = value;

      var groupEl = btn.parentElement;
      var chips = groupEl.querySelectorAll(".chip");
      for (var i = 0; i < chips.length; i++) chips[i].classList.remove("active");
      btn.classList.add("active");

      computeFiltered();
      refreshGrid();
    });

    gridEl.addEventListener("click", function (ev) {
      var card = ev.target.closest(".meta-card");
      if (!card || card.classList.contains("meta-card--locked")) return;
      var id = card.getAttribute("data-id");
      var word = TW.store.wordById(id);
      if (!word) return;
      openModal(word);
    });

    backdropEl.addEventListener("click", function (ev) {
      if (ev.target === backdropEl) closeModal();
    });

    refreshGrid();
  }

  window.TW.ui.collection = { render: render };
})();
