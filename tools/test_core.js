'use strict';
/*
 * tools/test_core.js — 純ロジックテスト (SPEC_CORE §6 / SPEC_ADDICTION §7)
 *
 * 対象: js/core/store.js, srs.js, rating.js, quest.js, level.js, daily.js, js/game/battle.js
 * 対象外: DOM依存コード(ui/*, fx, sfx, bgm)
 *
 * 実行: node tools/test_core.js  (ゼロ終了 = 合格)
 *
 * 手順:
 *   1. window/localStorage/navigator の簡易モックをグローバルに注入
 *   2. data/words.js の代わりに自作フィクスチャ(約40語)を TW.WORD_DATA に注入
 *   3. js/core/util.js → (js/audio は読まない) → js/core/store.js → srs.js →
 *      rating.js → quest.js → level.js → daily.js → js/game/battle.js を実行コンテキストに読み込む
 *   4. store/srs/rating/quest/level/daily/battle の数式・遷移を検証する
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');

// ---------------------------------------------------------------------------
// 1. グローバル環境モック
// ---------------------------------------------------------------------------
// ブラウザでは window === globalThis なので、読み込むソースの
// "window.TW = window.TW || {}" と裸の "TW.xxx" 参照が両方成立するように
// window を global 自身に向ける(window だけ別オブジェクトにすると
// window.TW と 裸のTW識別子が別物になってしまう)。
global.window = global;
// Node 21+ は navigator が getter専用の組み込みグローバルなので上書き用に再定義する
Object.defineProperty(global, 'navigator', {
  value: {},
  writable: true,
  configurable: true,
});

function createLocalStorageMock() {
  const data = new Map();
  return {
    getItem(key) { return data.has(String(key)) ? data.get(String(key)) : null; },
    setItem(key, value) { data.set(String(key), String(value)); },
    removeItem(key) { data.delete(String(key)); },
    clear() { data.clear(); },
    key(i) { return Array.from(data.keys())[i] || null; },
    get length() { return data.size; },
  };
}
global.localStorage = createLocalStorageMock();

// window.TW = window.TW || {}; のパターンを各読み込みファイルが使うので先に用意
window.TW = window.TW || {};

// ---------------------------------------------------------------------------
// 2. フィクスチャ単語データ (data/words.js の代わり)
//    level 1〜5 / cat 4種(general/academic/it/robotics) / distractorHint 各3個
// ---------------------------------------------------------------------------
function rarityFor(level, cat) {
  if (cat === 'it' || cat === 'robotics') return 'UR';
  if (level === 1) return 'N';
  if (level === 2) return 'R';
  if (level === 3) return 'SR';
  return 'SSR'; // level 4, 5
}

// [word, pos, ja, level, cat, ipa, ex, exJa, collocations, synonyms, distractorHint(3個)]
const WORD_TUPLES = [
  // -- general (10) --
  ['apple', 'n', 'りんご', 1, 'general', '/ˈæpəl/', 'She ate an apple after lunch today.', '彼女は昼食後にりんごを食べた。', ['apple pie', 'an apple a day'], [], ['みかん', 'バナナの実', '梨の一種']],
  ['run', 'v', '走る', 1, 'general', '/rʌn/', 'The children run around the park every morning.', '子供たちは毎朝公園の周りを走る。', ['run fast', 'run a race'], ['sprint', 'jog'], ['歩く', '泳ぐ', '止まる']],
  ['happy', 'adj', '幸せな', 1, 'general', '/ˈhæpi/', 'We felt very happy after winning the game.', '試合に勝って私たちはとても幸せだった。', ['happy birthday', 'feel happy'], ['glad', 'joyful'], ['悲しい', '怒った', '眠い']],
  ['quickly', 'adv', 'すばやく', 2, 'general', '/ˈkwɪkli/', 'He quickly finished his homework before dinner.', '彼は夕食前にすばやく宿題を終えた。', ['work quickly', 'respond quickly'], ['fast', 'rapidly'], ['ゆっくり', '静かに', '丁寧に']],
  ['journey', 'n', '旅', 2, 'general', '/ˈdʒɜːrni/', 'Their journey across the country took three days.', '彼らの国を横断する旅は3日かかった。', ['long journey', 'begin a journey'], ['trip', 'voyage'], ['休憩', '目的地', '地図']],
  ['curious', 'adj', '好奇心の強い', 2, 'general', '/ˈkjʊriəs/', 'The curious child asked many questions in class.', '好奇心の強いその子は授業で多くの質問をした。', ['curious about', 'curious mind'], ['inquisitive'], ['無関心な', '怠惰な', '礼儀正しい']],
  ['abundant', 'adj', '豊富な', 3, 'general', '/əˈbʌndənt/', 'Fresh water is abundant in this mountain region.', 'この山岳地域では淡水が豊富にある。', ['abundant supply', 'abundant resources'], ['plentiful'], ['不足した', '希少な', '有毒な']],
  ['negotiate', 'v', '交渉する', 3, 'general', '/nɪˈɡoʊʃieɪt/', 'The two companies negotiated a new trade agreement.', '二つの会社は新しい貿易協定を交渉した。', ['negotiate a deal', 'negotiate terms'], ['bargain'], ['拒否する', '無視する', '命令する']],
  ['resilience', 'n', '回復力', 3, 'general', '/rɪˈzɪljəns/', 'Her resilience helped her recover quickly from the setback.', '彼女の回復力は挫折からの早い回復を助けた。', ['show resilience', 'emotional resilience'], ['toughness'], ['脆弱性', '怠慢', '恐怖']],
  ['weather', 'n', '天気', 1, 'general', '/ˈwɛðər/', 'The weather turned cold suddenly this afternoon.', '今日の午後、天気は急に寒くなった。', ['bad weather', 'weather forecast'], ['climate'], ['気分', '風景', '季節']],
  // -- academic (10) --
  ['hypothesis', 'n', '仮説', 4, 'academic', '/haɪˈpɑːθəsɪs/', 'The researcher tested her hypothesis with a controlled experiment.', '研究者は対照実験で自分の仮説を検証した。', ['test a hypothesis', 'null hypothesis'], ['theory'], ['結論', '証拠', '事実']],
  ['empirical', 'adj', '経験的な', 5, 'academic', '/ɪmˈpɪrɪkəl/', 'The study relies on empirical data rather than theory alone.', 'その研究は理論だけでなく経験的データに基づいている。', ['empirical evidence', 'empirical research'], ['observational'], ['理論的な', '架空の', '直感的な']],
  ['paradigm', 'n', '枠組み', 4, 'academic', '/ˈpærədaɪm/', 'This discovery created a new paradigm in modern physics.', 'この発見は現代物理学に新しい枠組みを生み出した。', ['paradigm shift', 'new paradigm'], ['model'], ['例外', '誤り', '結果']],
  ['correlation', 'n', '相関関係', 3, 'academic', '/ˌkɒrəˈleɪʃən/', 'There is a strong correlation between exercise and good health.', '運動と健康の間には強い相関関係がある。', ['positive correlation', 'correlation coefficient'], ['relationship'], ['因果関係', '矛盾', '独立性']],
  ['synthesis', 'n', '統合', 4, 'academic', '/ˈsɪnθəsɪs/', 'The report is a synthesis of many earlier studies.', 'その報告書は多くの先行研究の統合である。', ['protein synthesis', 'a synthesis of ideas'], ['combination'], ['分解', '分析', '要約']],
  ['inference', 'n', '推論', 5, 'academic', '/ˈɪnfərəns/', 'The detective made an inference based on the available clues.', '刑事は手がかりに基づいて推論を行った。', ['logical inference', 'draw an inference'], ['deduction'], ['証明', '感情', '記憶']],
  ['methodology', 'n', '方法論', 4, 'academic', '/ˌmɛθəˈdɑːlədʒi/', 'The paper explains the methodology used for the survey.', 'その論文は調査に使われた方法論を説明している。', ['research methodology', 'teaching methodology'], ['approach'], ['結論', '仮説', '参考文献']],
  ['quantitative', 'adj', '量的な', 5, 'academic', '/ˈkwɑːntɪteɪtɪv/', 'The team collected quantitative data through a large survey.', 'チームは大規模な調査で量的データを収集した。', ['quantitative analysis', 'quantitative research'], ['numerical'], ['質的な', '主観的な', '定性的な']],
  ['discourse', 'n', '言説', 3, 'academic', '/ˈdɪskɔːrs/', 'Public discourse about climate change has grown louder.', '気候変動に関する公的な言説は大きくなっている。', ['public discourse', 'political discourse'], ['dialogue'], ['沈黙', '独白', '結論']],
  ['ambiguous', 'adj', '曖昧な', 4, 'academic', '/æmˈbɪɡjuəs/', 'The instructions were ambiguous and confused many students.', 'その指示は曖昧で多くの生徒を混乱させた。', ['ambiguous statement', 'remain ambiguous'], ['vague'], ['明確な', '正確な', '詳細な']],
  // -- it (10, 常にUR) --
  ['algorithm', 'n', 'アルゴリズム', 3, 'it', '/ˈælɡərɪðəm/', 'The engineer optimized the algorithm to run much faster.', 'エンジニアはアルゴリズムを最適化してもっと速く動かした。', ['sorting algorithm', 'algorithm design'], ['procedure'], ['データベース', 'ハードウェア', '画面']],
  ['latency', 'n', '遅延', 4, 'it', '/ˈleɪtənsi/', 'High latency made the online game difficult to play.', '高い遅延がオンラインゲームを難しくした。', ['network latency', 'reduce latency'], ['delay'], ['帯域幅', '容量', '精度']],
  ['compile', 'v', 'コンパイルする', 2, 'it', '/kəmˈpaɪl/', 'She compiled the source code before running the tests.', '彼女はテストを実行する前にソースコードをコンパイルした。', ['compile code', 'compile a report'], ['build'], ['削除する', '印刷する', '保存する']],
  ['bandwidth', 'n', '帯域幅', 3, 'it', '/ˈbændwɪdθ/', 'The office upgraded its internet bandwidth for video calls.', 'オフィスはビデオ通話のためにインターネット帯域幅を増強した。', ['network bandwidth', 'limited bandwidth'], ['capacity'], ['遅延', '記憶容量', '電圧']],
  ['encryption', 'n', '暗号化', 4, 'it', '/ɪnˈkrɪpʃən/', 'The app uses strong encryption to protect user messages.', 'そのアプリはユーザーのメッセージを守るため強力な暗号化を使う。', ['data encryption', 'encryption key'], ['cipher'], ['圧縮', '認証', '複製']],
  ['asynchronous', 'adj', '非同期の', 5, 'it', '/eɪˈsɪŋkrənəs/', 'The server handles requests in an asynchronous manner.', 'サーバーは非同期の方法でリクエストを処理する。', ['asynchronous call', 'asynchronous processing'], ['non-blocking'], ['同期の', '直列の', '手動の']],
  ['repository', 'n', 'リポジトリ', 2, 'it', '/rɪˈpɑːzɪtɔːri/', 'All the project code is stored in a shared repository.', 'プロジェクトの全コードは共有リポジトリに保存されている。', ['code repository', 'git repository'], ['archive'], ['フォルダ', '端末', '画面']],
  ['debug', 'v', 'デバッグする', 1, 'it', '/diːˈbʌɡ/', 'The programmer spent hours trying to debug the crash.', 'プログラマーはクラッシュをデバッグするのに何時間も費やした。', ['debug a program', 'debug session'], ['troubleshoot'], ['設計する', '印刷する', '起動する']],
  ['middleware', 'n', 'ミドルウェア', 4, 'it', '/ˈmɪdəlwɛr/', 'The middleware connects the database to the web application.', 'ミドルウェアはデータベースとウェブアプリケーションをつなぐ。', ['middleware layer', 'install middleware'], [], ['操作システム', '周辺機器', '端子']],
  ['throughput', 'n', 'スループット', 3, 'it', '/ˈθruːpʊt/', "Adding more servers increased the system's overall throughput.", 'サーバーを増やすことでシステム全体のスループットが上がった。', ['network throughput', 'maximize throughput'], [], ['帯域幅', '誤差', '解像度']],
  // -- robotics (10, 常にUR) --
  ['actuator', 'n', 'アクチュエータ', 3, 'robotics', '/ˈæktʃueɪtər/', 'The robot arm uses a linear actuator to extend smoothly.', 'そのロボットアームは滑らかに伸びるためリニアアクチュエータを使う。', ['linear actuator', 'actuator control'], [], ['センサー', '配線', '歯車']],
  ['servo', 'n', 'サーボ', 2, 'robotics', '/ˈsɜːrvoʊ/', 'A small servo rotates the camera mount on the robot.', '小さなサーボがロボットのカメラマウントを回転させる。', ['servo motor', 'servo control'], [], ['電池', '基板', '車輪']],
  ['kinematics', 'n', '運動学', 5, 'robotics', '/ˌkɪnəˈmætɪks/', 'Inverse kinematics calculates the joint angles for the arm.', '逆運動学はアームの関節角度を計算する。', ['inverse kinematics', 'forward kinematics'], [], ['力学', '静力学', '電磁気学']],
  ['torque', 'n', 'トルク', 3, 'robotics', '/tɔːrk/', 'The motor delivers enough torque to lift the payload.', 'そのモーターは荷物を持ち上げるのに十分なトルクを出す。', ['motor torque', 'torque sensor'], [], ['速度', '電圧', '摩擦']],
  ['calibration', 'n', 'キャリブレーション', 4, 'robotics', '/ˌkælɪˈbreɪʃən/', 'Sensor calibration is required before the robot competition.', 'ロボット大会の前にセンサーのキャリブレーションが必要だ。', ['sensor calibration', 'calibration process'], [], ['修理', '設計', '配線']],
  ['gripper', 'n', 'グリッパー', 2, 'robotics', '/ˈɡrɪpər/', 'The gripper closed gently around the small object.', 'グリッパーは小さな物体をそっと挟んだ。', ['robot gripper', 'gripper design'], [], ['車輪', 'レバー', '基板']],
  ['odometry', 'n', 'オドメトリ', 5, 'robotics', '/oʊˈdɑːmətri/', "Wheel odometry estimates the robot's position over time.", '車輪オドメトリは時間経過に伴うロボットの位置を推定する。', ['wheel odometry', 'odometry drift'], [], ['測距', '経路計画', '画像認識']],
  ['actuation', 'n', '作動', 4, 'robotics', '/ˌæktʃuˈeɪʃən/', 'Pneumatic actuation gives the gripper a fast response.', '空気圧作動はグリッパーに速い応答を与える。', ['pneumatic actuation', 'actuation force'], [], ['制御', '停止', '計測']],
  ['payload', 'n', '搭載物', 2, 'robotics', '/ˈpeɪloʊd/', 'The drone can carry a payload of up to two kilograms.', 'そのドローンは最大2キログラムの搭載物を運べる。', ['carry a payload', 'payload capacity'], [], ['燃料', '機体', '電源']],
  ['telemetry', 'n', 'テレメトリ', 4, 'robotics', '/təˈlɛmətri/', 'Telemetry data streams from the robot to the base station.', 'テレメトリデータはロボットから基地局へ送られる。', ['telemetry data', 'real-time telemetry'], [], ['制御信号', '位置情報', '地図データ']],
  // -- 類義語除外テスト用フィクスチャ(2026-07-06追加, SPEC_CORE §4) --
  // seize(正解語)に対し、grab=synonymsの前方参照、snatch=synonymsの逆参照、
  // plunder=jaの語義重複(「奪う」)で、いずれも誤答候補から除外されるべき語。
  ['seize', 'v', '奪う', 2, 'general', '/siːz/', 'The soldiers seized the fortress before the sun rose.', '兵士たちは日の出前に要塞を奪った。', ['seize power', 'seize the moment'], ['grab'], ['与える', '返す', '見つける']],
  ['grab', 'v', 'つかむ', 2, 'general', '/ɡræb/', 'He grabbed the rope before it slipped away.', '彼はロープが滑り落ちる前につかんだ。', ['grab a chance', 'grab attention'], [], ['放す', '投げる', '避ける']],
  ['snatch', 'v', 'ひったくる', 2, 'general', '/snætʃ/', 'The thief snatched the bag and ran into the crowd.', '泥棒はバッグをひったくって人混みに走った。', ['snatch victory', 'snatch a glance'], ['seize'], ['返す', '差し出す', '守る']],
  ['plunder', 'v', '略奪する、奪う', 2, 'general', '/ˈplʌndər/', 'Pirates plundered the village near the coast.', '海賊たちは海岸近くの村を略奪した。', ['plunder resources', 'plunder a village'], [], ['保護する', '修復する', '寄付する']],
];

window.TW.WORD_DATA = WORD_TUPLES.map((t, i) => {
  const [word, pos, ja, level, cat, ipa, ex, exJa, collocations, synonyms, distractorHint] = t;
  return {
    id: 'w' + String(i + 1).padStart(4, '0'),
    word, pos, ja, level, cat,
    rarity: rarityFor(level, cat),
    ipa, ex, exJa, collocations, synonyms, distractorHint,
  };
});

// ---------------------------------------------------------------------------
// 3. 実装ファイルの読み込み (js/audio は読み込まない)
// ---------------------------------------------------------------------------
function loadScript(relPath) {
  const fullPath = path.join(ROOT, relPath);
  if (!fs.existsSync(fullPath)) {
    throw new Error('依存ファイルが見つからない: ' + relPath +
      ' (store/srs/rating/quest/battle の実装が揃ってから再実行すること)');
  }
  const code = fs.readFileSync(fullPath, 'utf8');
  vm.runInThisContext(code, { filename: fullPath });
}

try {
  loadScript('js/core/util.js');
  loadScript('js/core/packs.js');
  loadScript('js/core/store.js');
  loadScript('js/core/srs.js');
  loadScript('js/core/rating.js');
  loadScript('js/core/quest.js');
  loadScript('js/core/level.js');
  loadScript('js/core/daily.js');
  loadScript('js/game/battle.js');
} catch (e) {
  console.error('[FATAL] 実装ファイルの読み込みに失敗しました:');
  console.error(e && e.stack ? e.stack : String(e));
  process.exit(1);
}

const TW = window.TW;

// ---------------------------------------------------------------------------
// 4. テストハーネス
// ---------------------------------------------------------------------------
let passCount = 0;
let failCount = 0;
const failures = [];

function test(name, fn) {
  try {
    fn();
    passCount++;
  } catch (e) {
    failCount++;
    failures.push({ name, error: e && e.stack ? e.stack : String(e) });
  }
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg || 'assertion failed');
}
function assertEqual(actual, expected, msg) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) {
    throw new Error((msg ? msg + ' — ' : '') +
      `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}
function assertClose(actual, expected, eps, msg) {
  eps = eps === undefined ? 1e-6 : eps;
  if (typeof actual !== 'number' || Number.isNaN(actual) || Math.abs(actual - expected) > eps) {
    throw new Error((msg ? msg + ' — ' : '') +
      `expected ≈${expected} (±${eps}), got ${actual}`);
  }
}

// ===========================================================================
// SECTION A: TW.store
// ===========================================================================

TW.store.load();

test('store.load: 初期値 (elo/coins/rank/newWordsPerDay)', () => {
  const s = TW.store.state;
  assert(s, 'state が存在しない');
  // SPEC_ADDICTION §0: セーブ移行で ver は 2 に上がる(v1のまま初期化されることはない)。
  assertEqual(s.ver, 2, 'ver');
  assertEqual(s.elo, 800, '初期Elo');
  assertEqual(s.coins, 200, '初期コイン');
  assertEqual(s.rank.index, 0, '初期rank.index (30級)');
  assertEqual(s.rank.progress, 0, '初期rank.progress');
  assert(s.srs && typeof s.srs === 'object', 'srs オブジェクトが存在');
  assert(Array.isArray(s.scouted), 'scouted は配列');
  assert(Array.isArray(s.achievements), 'achievements は配列');
  assert(Array.isArray(s.history), 'history は配列');
  assert(s.settings && s.settings.newWordsPerDay === 20, '既定 newWordsPerDay=20');
});

test('store.load: unlockedPacks が ["vol1"] で存在する (SPEC_PACKS §3)', () => {
  const s = TW.store.state;
  assert(Array.isArray(s.unlockedPacks), 'unlockedPacks は配列');
  assertEqual(s.unlockedPacks, ['vol1'], '新規セーブの初期値は ["vol1"]');
});

test('store.load: 既存セーブに unlockedPacks が無い場合は ["vol1"] へ backfill される (SPEC_PACKS §3)', () => {
  // unlockedPacksフィールドを持たない「古い」セーブを直接localStorageへ書き込んでから再ロードし、
  // mergeDefaultsによる欠損フィールド補完(既存セーブを壊さない方針)を検証する。
  const savedRaw = localStorage.getItem('tw_save_v1');
  const legacy = JSON.parse(TW.store.exportSave());
  delete legacy.unlockedPacks;
  localStorage.setItem('tw_save_v1', JSON.stringify(legacy));

  TW.store.load();
  assertEqual(TW.store.state.unlockedPacks, ['vol1'], '欠損フィールドはload時に["vol1"]で補完される');

  localStorage.setItem('tw_save_v1', savedRaw); // 後続テストへの影響を避けて復元(state自体は補完後のままでよい)
});

test('packs.readUnlockedFromStorage: 壊れたJSON/localStorage不在で ["vol1"] を返す (SPEC_PACKS §3)', () => {
  const savedRaw = localStorage.getItem('tw_save_v1');

  // 壊れたJSON
  localStorage.setItem('tw_save_v1', '{ これは不正なJSONです ]]]');
  assertEqual(TW.packs.readUnlockedFromStorage(), ['vol1'], '壊れたJSONは ["vol1"]');

  // unlockedPacksが無い/配列でない場合も ["vol1"]
  localStorage.setItem('tw_save_v1', JSON.stringify({ elo: 800 }));
  assertEqual(TW.packs.readUnlockedFromStorage(), ['vol1'], 'unlockedPacksフィールド自体が無い場合も ["vol1"]');
  localStorage.setItem('tw_save_v1', JSON.stringify({ unlockedPacks: 'not-an-array' }));
  assertEqual(TW.packs.readUnlockedFromStorage(), ['vol1'], 'unlockedPacksが配列でない場合も ["vol1"]');

  // 正常な配列はそのまま返す(store.load前でも呼べる純関数であることの確認)
  localStorage.setItem('tw_save_v1', JSON.stringify({ unlockedPacks: ['vol1', 'vol2'] }));
  assertEqual(TW.packs.readUnlockedFromStorage(), ['vol1', 'vol2'], '正常な配列はそのまま返す');

  // localStorage不在(node環境相当)でも例外を投げず ["vol1"]
  const savedLocalStorage = global.localStorage;
  global.localStorage = undefined;
  let threw = false;
  let result;
  try {
    result = TW.packs.readUnlockedFromStorage();
  } catch (e) {
    threw = true;
  }
  global.localStorage = savedLocalStorage;
  assert(!threw, 'localStorage不在でも例外を投げない');
  assertEqual(result, ['vol1'], 'localStorage不在時は ["vol1"]');

  localStorage.setItem('tw_save_v1', savedRaw); // 後続テストへの影響を避けて復元
});

test('store.wordById / allWords', () => {
  const w = TW.store.wordById('w0001');
  assert(w && w.word === 'apple', 'wordById(w0001) が apple を返す');
  const all = TW.store.allWords();
  assert(Array.isArray(all) && all.length === window.TW.WORD_DATA.length, 'allWords の件数');
});

test('store.addCoins: ストリーク倍率 (1 + min(days,10)*0.05)', () => {
  const s = TW.store.state;

  // addCoinsは週末コイン2倍イベント(TW.daily連動、SPEC_ADDICTION §2.3)も参照するため、
  // 実行日が土日だと期待値がずれる。ここではストリーク倍率そのものだけを検証したいので
  // イベント無しに固定する(withNoDailyEventsはSECTION Fで定義、関数宣言のホイスティングで利用可能)。
  withNoDailyEvents(() => {
    s.streak.days = 0;
    s.coins = 1000;
    let added = TW.store.addCoins(100);
    assertEqual(added, 100, 'streak0日: 倍率1.0');
    assertEqual(s.coins, 1100, 'coins に加算されている(streak0日)');

    s.streak.days = 4;
    s.coins = 1000;
    added = TW.store.addCoins(100);
    assertEqual(added, 120, 'streak4日: 倍率1.2');
    assertEqual(s.coins, 1120, 'coins に加算されている(streak4日)');

    s.streak.days = 10;
    s.coins = 1000;
    added = TW.store.addCoins(100);
    assertEqual(added, 150, 'streak10日: 倍率1.5(上限手前)');

    s.streak.days = 30; // 上限超え → min(30,10)=10 と同じ倍率1.5
    s.coins = 1000;
    added = TW.store.addCoins(100);
    assertEqual(added, 150, 'streak30日: 倍率は10日分でキャップ(+50%上限)');

    s.streak.days = 0; // 後続テストへの影響を避けて復元
  });
});

test('store.exportSave → importSave: 往復一致', () => {
  const s = TW.store.state;
  s.coins = 777;
  s.elo = 913;
  const snapshot = TW.store.exportSave();
  assert(typeof snapshot === 'string' && snapshot.length > 0, 'exportSave は非空文字列');

  s.coins = 1;
  s.elo = 1;
  const ok = TW.store.importSave(snapshot);
  assertEqual(ok, true, 'importSave は成功時 true');
  assertEqual(TW.store.state.coins, 777, 'coins が復元される');
  assertEqual(TW.store.state.elo, 913, 'elo が復元される');
});

test('store.importSave: 不正なJSONは false を返し例外を投げない', () => {
  let ok;
  let threw = false;
  try {
    ok = TW.store.importSave('{ これは不正なJSONです ]]]');
  } catch (e) {
    threw = true;
  }
  assert(!threw, 'importSave は不正入力でも例外を投げない');
  assertEqual(ok, false, '不正なJSONは false');
});

test('store.load: デイリーゴーストの日跨ぎでscore→prevへ繰り越し、scoreは0にリセットされる (SPEC_ADDICTION §2.4)', () => {
  const originalDayScore = TW.store.state.dayScore;

  // 前回プレイ日を過去日にし、score=250を持たせた状態をlocalStorageへ保存してから再ロードする
  // (TW.store.load()はlocalStorageから読むため、in-memoryを書き換えただけでは反映されない)。
  TW.store.state.dayScore = { date: '2020-01-01', score: 250, prev: 0 };
  TW.store.save();
  TW.store.load();

  let ds = TW.store.state.dayScore;
  assertEqual(ds.date, TW.util.todayStr(), '再ロード後のdateは今日になる');
  assertEqual(ds.prev, 250, '日跨ぎで旧scoreがprevへ繰り越される(前回プレイ日のスコア)');
  assertEqual(ds.score, 0, '日跨ぎでscoreは0にリセットされる');

  // 既にdateが今日なので、同日内に再度loadしても変化しない
  TW.store.save();
  TW.store.load();
  ds = TW.store.state.dayScore;
  assertEqual(ds.prev, 250, '同日内の再loadではprevが変化しない');
  assertEqual(ds.score, 0, '同日内の再loadではscoreが変化しない');

  TW.store.state.dayScore = originalDayScore; // 後続テストへの影響を避けて復元
  TW.store.save();
});

// ===========================================================================
// SECTION B: TW.srs
// ===========================================================================

test('srs.answer: 誤答 (q=1) → reps=0/lapses++/interval=0/due=+10分/mastery減少', () => {
  const before = Date.now();
  const r = TW.srs.answer('w0001', false, 3000); // 誤答なので ms は quality に影響しない
  const after = Date.now();

  assert(r && typeof r.mastery === 'number', '戻り値に mastery がある');
  const rec = TW.store.state.srs['w0001'];
  assert(rec, 'srs レコードが作成されている');
  assertEqual(rec.reps, 0, '誤答: reps=0');
  assertEqual(rec.lapses, 1, '誤答: lapses が1増える');
  assertEqual(rec.interval, 0, '誤答: interval=0');
  assertEqual(rec.mastery, 0, '誤答: mastery = max(0, 0-1) = 0');
  assertEqual(r.captured, false, '誤答: captured=false');
  assert(rec.due >= before + 10 * 60 * 1000 - 1000 && rec.due <= after + 10 * 60 * 1000 + 5000,
    'due が現在時刻+10分付近: ' + rec.due);
});

test('srs.answer: 正答連続 → interval=round(interval*ef)・captured・kira', () => {
  const id = 'w0002'; // run
  let r;

  // 早期復習ルール(SPEC_CORE §4 2026-07-06)により、正答かつ期限前(now<due)はSRS状態を
  // 前進させない。この連続正答テストは「期限到来後の再演」を再現するため、2回目以降の
  // 回答前にdueを過去へ動かしてから呼び出す(1回目は初登場語でdue=nowのため不要)。

  // 1回目 正答 (ms<=2000 → q=5): 新規登録 ef=2.5 → reps 0→1, interval=1, ef=2.6, mastery 0→1
  r = TW.srs.answer(id, true, 1000);
  let rec = TW.store.state.srs[id];
  assertEqual(rec.reps, 1, '1回目: reps=1');
  assertEqual(rec.interval, 1, '1回目: interval=1');
  assertClose(rec.ef, 2.6, 1e-6, '1回目: ef=2.6');
  assertEqual(rec.mastery, 1, '1回目: mastery=1');
  assertEqual(r.captured, false, '1回目: captured=false');
  assertEqual(r.kira, false, '1回目: kira=false');

  // 2回目 正答: reps 1→2, interval=3, ef=2.7, mastery=2
  rec.due = Date.now() - 1000; // 期限到来後を再現
  r = TW.srs.answer(id, true, 1000);
  rec = TW.store.state.srs[id];
  assertEqual(rec.reps, 2, '2回目: reps=2');
  assertEqual(rec.interval, 3, '2回目: interval=3');
  assertClose(rec.ef, 2.7, 1e-6, '2回目: ef=2.7');
  assertEqual(rec.mastery, 2, '2回目: mastery=2');
  assertEqual(r.captured, false, '2回目: captured=false (mastery<3)');

  // 3回目 正答: reps 2→3, interval=round(3*2.7)=8, ef=2.8, mastery=3 → 初捕獲
  rec.due = Date.now() - 1000;
  r = TW.srs.answer(id, true, 1000);
  rec = TW.store.state.srs[id];
  assertEqual(rec.reps, 3, '3回目: reps=3');
  assertEqual(rec.interval, 8, '3回目: interval=round(3*2.7)=8');
  assertClose(rec.ef, 2.8, 1e-6, '3回目: ef=2.8');
  assertEqual(rec.mastery, 3, '3回目: mastery=3');
  assertEqual(r.captured, true, '3回目: mastery が3に達して初捕獲');

  // 4回目 正答: reps 3→4, interval=round(8*2.8)=22, ef=2.9, mastery=4, captured は既にtrueなのでfalse
  rec.due = Date.now() - 1000;
  r = TW.srs.answer(id, true, 1000);
  rec = TW.store.state.srs[id];
  assertEqual(rec.interval, 22, '4回目: interval=round(8*2.8)=22');
  assertEqual(rec.mastery, 4, '4回目: mastery=4');
  assertEqual(r.captured, false, '4回目: 既に捕獲済みなのでcaptured=false');
  assertEqual(r.kira, false, '4回目: mastery<5なのでkira=false');

  // 5回目 正答: reps 4→5, interval=round(22*2.9)=64, mastery=5, interval>=21 → kira=true
  rec.due = Date.now() - 1000;
  r = TW.srs.answer(id, true, 1000);
  rec = TW.store.state.srs[id];
  assertEqual(rec.interval, 64, '5回目: interval=round(22*2.9)=64');
  assertEqual(rec.mastery, 5, '5回目: mastery=5');
  assertEqual(r.kira, true, '5回目: mastery>=5 && interval>=21 → kira=true');
});

test('srs.answer: 早期復習ルール — 期限前(now<due)の正答はSRS状態を一切変更しない(SPEC_CORE §4 2026-07-06)', () => {
  const id = 'w0006'; // curious (未使用の語)

  // 1回目: 新規登録 → due=now直後に登録されるため通常どおり前進する(初登場語は本ルールの対象外)
  const r1 = TW.srs.answer(id, true, 1000);
  const rec = TW.store.state.srs[id];
  assert(rec.due > Date.now(), '1回目正答後はdueが未来に進んでいる(前提)');
  assertEqual(rec.reps, 1, '1回目(初登場)は従来どおり前進する: reps=1');
  assertEqual(r1.mastery, 1, '1回目(初登場)は従来どおり前進する: mastery=1');

  const snapshotBefore = JSON.stringify(rec);

  // 2回目: 期限前(due未達)の正答 → 状態を一切変更しない
  const r2 = TW.srs.answer(id, true, 500);
  assertEqual(JSON.stringify(TW.store.state.srs[id]), snapshotBefore,
    '期限前の正答ではreps/interval/due/ef/masteryが不変');
  assertEqual(r2.mastery, rec.mastery, '返り値のmasteryは現状値のまま');
  assertEqual(r2.captured, false, '期限前の正答はcaptured=false');
  assertEqual(r2.kira, false, '期限前の正答はkira=false');

  // 3回目: 続けてもう一度期限前正答しても、依然として不変(連打による机上インターバル膨張が起きない)
  const r3 = TW.srs.answer(id, true, 200);
  assertEqual(JSON.stringify(TW.store.state.srs[id]), snapshotBefore,
    '期限前の正答を連打しても状態は不変のまま');
  assertEqual(r3.captured, false, '連打してもcapturedにはならない');
});

test('srs.answer: 早期復習ルール下でも誤答は期限前から従来どおりlapse処理する', () => {
  const id = 'w0007'; // journey (未使用の語)

  TW.srs.answer(id, true, 1000); // 初回登録してdueを未来に進めておく
  const rec = TW.store.state.srs[id];
  assert(rec.due > Date.now(), '1回目正答後はdueが未来(前提)');
  const masteryBefore = rec.mastery;
  const before = Date.now();

  const r = TW.srs.answer(id, false, 9999); // 期限前だが誤答
  const after = Date.now();

  assertEqual(rec.reps, 0, '期限前でも誤答: reps=0にリセットされる');
  assertEqual(rec.lapses, 1, '期限前でも誤答: lapsesが増える');
  assertEqual(rec.interval, 0, '期限前でも誤答: interval=0');
  assertEqual(rec.mastery, Math.max(0, masteryBefore - 1), '期限前でも誤答: masteryが減少する');
  assert(rec.due >= before + 10 * 60 * 1000 - 1000 && rec.due <= after + 10 * 60 * 1000 + 5000,
    '期限前でも誤答: dueは現在時刻+10分に更新される(忘却はいつでも事実): ' + rec.due);
  assertEqual(r.captured, false, '誤答なのでcaptured=false');
});

test('srs.dueWords: due<=now のみ、due昇順', () => {
  const now = Date.now();
  TW.store.state.srs['w0003'] = { ef: 2.5, interval: 1, due: now - 5000, reps: 1, lapses: 0, mastery: 1 };
  TW.store.state.srs['w0005'] = { ef: 2.5, interval: 2, due: now - 2000, reps: 1, lapses: 0, mastery: 1 };
  TW.store.state.srs['w0004'] = { ef: 2.5, interval: 5, due: now + 99999999, reps: 1, lapses: 0, mastery: 1 };

  const due = TW.srs.dueWords(now);
  const ids = due.map((w) => w.id);
  assert(ids.includes('w0003'), 'w0003 (過去due) が含まれる');
  assert(ids.includes('w0005'), 'w0005 (過去due) が含まれる');
  assert(!ids.includes('w0004'), 'w0004 (未来due) は含まれない');

  const i3 = ids.indexOf('w0003');
  const i5 = ids.indexOf('w0005');
  assert(i3 < i5, 'due昇順: w0003(due小さい)がw0005より先');
});

test('srs.newWords: scouted優先 → 低level → id順、newPerDay残数を超えない', () => {
  // この時点で w0001,w0002,w0003,w0004,w0005 は既に srs 登録済み(未学習ではない)。
  // level1(未学習)の残りは w0010(weather) と w0028(debug) のみ。
  const noScout = TW.srs.newWords(2).map((w) => w.id);
  assertEqual(noScout, ['w0010', 'w0028'], 'scoutedなし: 低level→id順で w0010,w0028');

  TW.store.state.scouted.push('w0030'); // calibration (level4, robotics)
  const withScout1 = TW.srs.newWords(1).map((w) => w.id);
  assertEqual(withScout1, ['w0030'], 'scouted語が最優先で1件返る');

  const withScout3 = TW.srs.newWords(3).map((w) => w.id);
  assertEqual(withScout3, ['w0030', 'w0010', 'w0028'], 'scouted→低level→id順');

  // newPerDay 残数キャップ
  TW.store.state.newPerDay = { date: TW.util.todayStr(), count: 18 }; // 既定20-18=2 残り
  const capped = TW.srs.newWords(10);
  assertEqual(capped.length, 2, 'newPerDay残数(2)を超えない');
});

test('srs.buildQueue: size に関わらず必ず size 個返す', () => {
  assertEqual(TW.srs.buildQueue(5).length, 5, 'size=5');
  assertEqual(TW.srs.buildQueue(15).length, 15, 'size=15');
  assertEqual(TW.srs.buildQueue(60).length, 60, 'size=60 (全40語超・ランダム補填)');
});

test('srs.buildQueue: 新規上限を使い切った状態でも未学習語が補填される(学習済の再演だけにならない)', () => {
  const state = TW.store.state;
  const today = TW.util.todayStr();
  const savedSrs = state.srs;
  const savedNewPerDay = state.newPerDay;
  const savedScouted = state.scouted;

  // 全語を学習済(due遠未来)にした上で、一部だけ未学習(srs未登録)に戻す。
  // due=0件・newPerDay上限も使い切っているため、旧実装なら学習済の再演だけで埋まってしまう状況。
  const all = TW.store.allWords();
  state.srs = {};
  all.forEach((w) => {
    state.srs[w.id] = { ef: 2.5, interval: 30, due: Date.now() + 999999999, reps: 5, lapses: 0, mastery: 5 };
  });
  const unlearnedIds = ['w0001', 'w0002', 'w0003'];
  unlearnedIds.forEach((id) => { delete state.srs[id]; });
  state.newPerDay = { date: today, count: 9999 }; // newPerDay日次上限を使い切った状態
  state.scouted = [];

  const queue = TW.srs.buildQueue(30);
  const queueIds = new Set(queue.map((w) => w.id));
  const includesUnlearned = unlearnedIds.some((id) => queueIds.has(id));
  assert(includesUnlearned,
    '新規上限を使い切っていても未学習ボーナスで未学習語(w0001/w0002/w0003)のいずれかが補填される');

  state.srs = savedSrs;
  state.newPerDay = savedNewPerDay;
  state.scouted = savedScouted;
});

test('srs.buildQueue①: 十分な学習済プールがある状態でdueが空のとき、未学習語(新規)はsizeの30%を超えない', () => {
  const state = TW.store.state;
  const savedSrs = state.srs;
  const savedNewPerDay = state.newPerDay;
  const savedScouted = state.scouted;

  const all = TW.store.allWords(); // 40語
  const today = TW.util.todayStr();
  state.srs = {};
  // 先頭25語を学習済(未来due、非due)にし、残り15語は未学習のまま(due0件)。
  all.slice(0, 25).forEach((w) => {
    state.srs[w.id] = { ef: 2.5, interval: 30, due: Date.now() + 999999999, reps: 5, lapses: 0, mastery: 3 };
  });
  state.newPerDay = { date: today, count: 0 }; // 日次上限は十分残っている
  state.scouted = [];

  const size = 20;
  const newCap = Math.floor(size * 0.3); // 6
  const queue = TW.srs.buildQueue(size);
  assertEqual(queue.length, size, 'size個返る');
  const unlearnedCountInQueue = queue.filter((w) => !state.srs[w.id]).length;
  assert(unlearnedCountInQueue <= newCap,
    `未学習語(新規)はsizeの30%(${newCap})を超えない、実際=${unlearnedCountInQueue}`);

  state.srs = savedSrs;
  state.newPerDay = savedNewPerDay;
  state.scouted = savedScouted;
});

test('srs.buildQueue②: 新規日次上限を使い切っていても新規枠30%ぶんは未学習語で埋まる', () => {
  const state = TW.store.state;
  const savedSrs = state.srs;
  const savedNewPerDay = state.newPerDay;
  const savedScouted = state.scouted;

  const all = TW.store.allWords();
  const today = TW.util.todayStr();
  state.srs = {};
  all.slice(0, 25).forEach((w) => {
    state.srs[w.id] = { ef: 2.5, interval: 30, due: Date.now() + 999999999, reps: 5, lapses: 0, mastery: 3 };
  });
  state.newPerDay = { date: today, count: 9999 }; // newPerDay日次上限を使い切った状態
  state.scouted = [];

  const size = 20;
  const newCap = Math.floor(size * 0.3); // 6
  const queue = TW.srs.buildQueue(size);
  assertEqual(queue.length, size, 'size個返る');
  const unlearnedCountInQueue = queue.filter((w) => !state.srs[w.id]).length;
  assertEqual(unlearnedCountInQueue, newCap,
    '新規日次上限を使い切っていても、未学習語プールが十分あれば新規枠(30%)ぶんは未学習語で埋まる');

  state.srs = savedSrs;
  state.newPerDay = savedNewPerDay;
  state.scouted = savedScouted;
});

test('srs.buildQueue③: 学習済プールが極小の序盤は30%超の未学習補填を許す(全体は必ずsize個)', () => {
  const state = TW.store.state;
  const savedSrs = state.srs;
  const savedNewPerDay = state.newPerDay;
  const savedScouted = state.scouted;

  const all = TW.store.allWords();
  const today = TW.util.todayStr();
  state.srs = {};
  // 学習済は2語のみ(序盤を想定)。残り38語は全て未学習。
  all.slice(0, 2).forEach((w) => {
    state.srs[w.id] = { ef: 2.5, interval: 30, due: Date.now() + 999999999, reps: 5, lapses: 0, mastery: 3 };
  });
  state.newPerDay = { date: today, count: 0 };
  state.scouted = [];

  const size = 20;
  const newCap = Math.floor(size * 0.3); // 6
  const queue = TW.srs.buildQueue(size);
  assertEqual(queue.length, size, '学習済プールが尽きても重複可で必ずsize個返る');
  const unlearnedCountInQueue = queue.filter((w) => !state.srs[w.id]).length;
  assert(unlearnedCountInQueue > newCap,
    `学習済プールが尽きたときは新規枠(30%=${newCap})を超えて未学習語で補われる、実際=${unlearnedCountInQueue}`);

  state.srs = savedSrs;
  state.newPerDay = savedNewPerDay;
  state.scouted = savedScouted;
});

// ===========================================================================
// SECTION C: TW.rating
// ===========================================================================

test('rating.botFor: name(非空文字列)とstyle(3値のいずれか)を返す', () => {
  const styles = new Set();
  for (let i = 0; i < 60; i++) {
    const bot = TW.rating.botFor(800);
    assert(typeof bot.name === 'string' && bot.name.length > 0, 'nameは非空文字列: ' + JSON.stringify(bot));
    assert(['rush', 'closer', 'streaky'].indexOf(bot.style) !== -1, 'styleは3値のいずれか: ' + bot.style);
    styles.add(bot.style);
  }
  assert(styles.size >= 2, '60回呼べば呼ぶたびに変わり複数のstyleが出現する');
});

test('rating.applyResult: Elo K=32・progress・昇級 (勝ち, elo=botElo=800)', () => {
  TW.store.state.elo = 800;
  TW.store.state.rank = { index: 0, progress: 80 };

  const res = TW.rating.applyResult(true, 800);
  // expected = 1/(1+10^((800-800)/400)) = 0.5, delta = round(32*(1-0.5)) = 16
  assertClose(res.eloDelta, 16, 1e-6, 'Elo K=32 (勝ち, 同レート)');
  // progressDelta = clamp(25+(800-800)/20,10,45) = 25
  assertClose(res.progressDelta, 25, 1e-6, 'progressDelta=25');
  // 80+25=105 >= 100 → 昇級, progress=0, index+1
  assertEqual(res.promoted, true, '昇級判定');
  assertEqual(res.rank.index, 1, '昇級後 index=1');
  assertEqual(res.rank.progress, 0, '昇級後 progress=0');
  assertEqual(TW.store.state.rank.index, 1, 'store.state.rank にも反映');
  assertClose(TW.store.state.elo, 816, 1e-6, 'store.state.elo にeloDeltaが反映');
});

test('rating.applyResult: 降級 (負け, elo=botElo=800, index>0)', () => {
  TW.store.state.elo = 800;
  TW.store.state.rank = { index: 2, progress: 10 };

  const res = TW.rating.applyResult(false, 800);
  // eloDelta = round(32*(0-0.5)) = -16
  assertClose(res.eloDelta, -16, 1e-6, 'Elo K=32 (負け, 同レート)');
  // progressDelta = -clamp(15+(800-800)/20,5,30) = -15
  assertClose(res.progressDelta, -15, 1e-6, 'progressDelta=-15');
  // 10-15=-5 <0 → index>0 なら index-1, progress=70
  assertEqual(res.demoted, true, '降級判定');
  assertEqual(res.rank.index, 1, '降級後 index=1');
  assertEqual(res.rank.progress, 70, '降級後 progress=70');
});

test('rating.applyResult: index=0 の下限 (0級より下がらない)', () => {
  TW.store.state.elo = 800;
  TW.store.state.rank = { index: 0, progress: 5 };

  const res = TW.rating.applyResult(false, 800);
  assertEqual(res.rank.index, 0, 'index0止まり(これ以上下がらない)');
  assertEqual(res.rank.progress, 0, 'progressは0で止まる(負値にならない)');
});

// ===========================================================================
// SECTION D: TW.quest
// ===========================================================================

test('quest.getDaily: 日付シードで同日は決定的に同じ3件', () => {
  const a = TW.quest.getDaily();
  const b = TW.quest.getDaily();
  assert(Array.isArray(a) && a.length === 3, 'デイリークエストは3件');
  assertEqual(a.map((q) => q.id), b.map((q) => q.id), '同日2回呼んで同じidの並び');
  assertEqual(a.map((q) => q.goal), b.map((q) => q.goal), '同日2回呼んで同じgoal');
});

test('quest.onAction / claim: 達成でコイン付与、受取済は重複防止', () => {
  // quest.claimはTW.store.addCoins経由でコインを付与するため、週末コイン2倍イベント
  // (実行日依存、SPEC_ADDICTION §2.3)が混入しないようイベント無しに固定する。
  // 同様にストリーク倍率(+5%/日)も掛かる仕様のため、先行テストの状態に依存しないよう
  // ストリークを0日に固定する(実行日によって露見するフレークの防止)。
  withNoDailyEvents(() => {
    TW.store.state.streak.days = 0;
    // QUEST_POOL はプールの id→{type,reward} を得るために公開されている前提(TW.quest.QUEST_POOL)
    const poolById = {};
    (TW.quest.QUEST_POOL || []).forEach((q) => { poolById[q.id] = q; });
    const items = TW.quest.getDaily();

    items.forEach((item) => {
      const meta = poolById[item.id];
      assert(meta, '既知のクエストidであること: ' + item.id);
      // goal 分だけ、対応する type で onAction を呼んで達成させる
      TW.quest.onAction(meta.type, item.goal);
    });

    const after = TW.store.state.quests.items;
    after.forEach((item) => {
      assert(item.done >= item.goal, 'onActionでdoneがgoalに達する: ' + item.id);
    });

    // onAction("battle"等)がストリークを1日に更新するため、claim直前にも0へ固定する
    TW.store.state.streak.days = 0;

    after.forEach((item) => {
      const meta = poolById[item.id];
      const coins = TW.quest.claim(item.id);
      assertEqual(coins, meta.reward, 'claim報酬額が仕様の値と一致: ' + item.id);
      const again = TW.quest.claim(item.id);
      assertEqual(again, 0, '受取済みクエストの再claimは0: ' + item.id);
    });
  });
});

test('quest.addSeasonScore: シーズンスコアとdayScore.scoreの両方に加算される (SPEC_ADDICTION §2.4)', () => {
  const s = TW.store.state;
  const savedSeasonScore = s.season.score;
  const savedDayScore = s.dayScore;

  s.season.score = 100;
  s.dayScore = { date: TW.util.todayStr(), score: 20, prev: 0 };

  TW.quest.addSeasonScore(30);
  assertEqual(s.season.score, 130, 'シーズンスコアに加算される');
  assertEqual(s.dayScore.score, 50, 'dayScore.scoreにも同時に加算される');

  TW.quest.addSeasonScore(5);
  assertEqual(s.season.score, 135, '複数回呼んでもシーズンスコアが積み上がる');
  assertEqual(s.dayScore.score, 55, '複数回呼んでもdayScore.scoreが積み上がる');

  s.season.score = savedSeasonScore;
  s.dayScore = savedDayScore; // 後続テストへの影響を避けて復元
});

test('quest.dailyInfo: beat/diff判定(prev=0のときbeat=falseを含む) (SPEC_ADDICTION §2.4)', () => {
  const s = TW.store.state;
  const savedDayScore = s.dayScore;

  // prev=0(前回プレイ日なし): today>0でも比較対象が無いのでbeatはfalse
  s.dayScore = { date: TW.util.todayStr(), score: 80, prev: 0 };
  let info = TW.quest.dailyInfo();
  assertEqual(info.todayScore, 80, 'todayScoreがそのまま返る');
  assertEqual(info.prevScore, 0, 'prevScoreは0');
  assertEqual(info.beat, false, 'prev=0のときはbeat=false(超えようがない)');
  assertEqual(info.diff, 80, 'diff=today-prev=80');

  // prev>0・today>prev: beat=true
  s.dayScore = { date: TW.util.todayStr(), score: 150, prev: 100 };
  info = TW.quest.dailyInfo();
  assertEqual(info.beat, true, 'today>prevでbeat=true');
  assertEqual(info.diff, 50, 'diff=50');

  // prev>0・today<prev: beat=false・diffは負
  s.dayScore = { date: TW.util.todayStr(), score: 90, prev: 100 };
  info = TW.quest.dailyInfo();
  assertEqual(info.beat, false, 'today<prevでbeat=false');
  assertEqual(info.diff, -10, 'diff=-10(マイナス)');

  // prev>0・today===prev: 同点はbeatではない(厳密に上回る必要がある)
  s.dayScore = { date: TW.util.todayStr(), score: 100, prev: 100 };
  info = TW.quest.dailyInfo();
  assertEqual(info.beat, false, '同点はbeat=false');
  assertEqual(info.diff, 0, '同点はdiff=0');

  s.dayScore = savedDayScore; // 後続テストへの影響を避けて復元
});

// ===========================================================================
// SECTION E: TW.battle
// ===========================================================================

// 選択式(en2ja/ja2en)のみに絞ってテストを決定的にする
TW.store.state.settings.typing = false;
TW.store.state.settings.voice = false;

// typing/voiceを無効化した状態でのpickType配分は en2ja/ja2en/cloze の3種のみ(cloze追加分)
function isChoiceType(t) { return t === 'en2ja' || t === 'ja2en' || t === 'cloze'; }

test('battle: next() は choices 4個・正解が answerIndex 位置にある', () => {
  const session = TW.battle.start({ mode: 'rank', durationMs: 180000, onEvent: () => {} });
  let checked = 0;
  for (let i = 0; i < 30; i++) {
    const q = session.next();
    assert(q, 'next() が問題を返す(時間切れではない)');
    assert(isChoiceType(q.type), 'typing/voiceを無効化したので en2ja/ja2en/cloze のみ: ' + q.type);
    assert(Array.isArray(q.choices) && q.choices.length === 4, 'choices は4個');
    assert(new Set(q.choices).size === 4, 'choices は重複なし');
    assert(Number.isInteger(q.answerIndex) && q.answerIndex >= 0 && q.answerIndex <= 3, 'answerIndexは0-3');

    if (q.type === 'en2ja') {
      assertEqual(q.choices[q.answerIndex], q.word.ja, 'en2ja: 正解位置の選択肢=word.ja');
    } else {
      // ja2en / cloze はどちらも英単語が正解choice
      assertEqual(q.choices[q.answerIndex], q.word.word, q.type + ': 正解位置の選択肢=word.word');
    }
    checked++;
  }
  assert(checked === 30, '30問すべて検証できた');
});

test('battle: cloze の prompt に"____"を含み、answerIndex位置の選択肢が正解の word と一致する', () => {
  const session = TW.battle.start({ mode: 'rank', durationMs: 180000, onEvent: () => {} });
  let found = null;
  for (let i = 0; i < 300 && !found; i++) {
    const q = session.next();
    if (!q) break;
    if (q.type === 'cloze') found = q;
  }
  assert(found, '300問中にclozeタイプが少なくとも1問出題される(重み15%)');
  assert(found.prompt.indexOf('____') !== -1, 'clozeのpromptに"____"が含まれる: ' + found.prompt);
  assert(Array.isArray(found.choices) && found.choices.length === 4, 'clozeのchoicesは4個(ja2enと同じ英単語4択)');
  assertEqual(found.choices[found.answerIndex], found.word.word,
    'answerIndex位置の選択肢が正解の見出し語と一致する');
});

test('battle: 英単語ひっかけの類義語除外(ja2en/cloze) — synonyms相互参照・ja語義重複の語はchoicesに出ない(SPEC_CORE §4 2026-07-06追加)', () => {
  // フィクスチャに意図的な類義語ペアを用意済み: seize(出題語)に対し、
  // grab=seize.synonymsの前方参照、snatch=synonymsの逆参照(snatch.synonymsにseizeを含む)、
  // plunder=ja語義重複(両者とも「奪う」を含む)。いずれも誤答候補に出てはいけない。
  const target = TW.store.allWords().find((w) => w.word === 'seize');
  assert(target, '前提: フィクスチャにseizeが存在する');
  const excluded = ['grab', 'snatch', 'plunder'];

  // buildQueueを一時的にモックし、出題語をseize固定にしてja2en/clozeのサンプル数を稼ぐ
  const originalBuildQueue = TW.srs.buildQueue;
  TW.srs.buildQueue = (size) => {
    const arr = [];
    for (let i = 0; i < size; i++) arr.push(target);
    return arr;
  };
  try {
    const session = TW.battle.start({ mode: 'rank', durationMs: 600000, onEvent: () => {} });
    let sampled = 0;
    for (let i = 0; i < 200; i++) {
      const q = session.next();
      assert(q, 'next()が問題を返す(durationMsは十分大きい)');
      if (q.type === 'ja2en' || q.type === 'cloze') {
        sampled++;
        q.choices.forEach((c) => {
          const lower = String(c).toLowerCase();
          assert(excluded.indexOf(lower) === -1,
            `除外対象語(${lower})がchoicesに出現してはいけない: ${JSON.stringify(q.choices)}`);
        });
      }
    }
    assert(sampled >= 20, `ja2en/clozeが十分な回数サンプルできた(実際${sampled})`);
  } finally {
    TW.srs.buildQueue = originalBuildQueue;
  }
});

test('battle: submit() スコア式・コンボ10でフィーバー発動・誤答でコンボ0', () => {
  // battle.jsのスコア計算は週替わり強化週間(出題語のcatが対象なら×1.5、SPEC_ADDICTION §2.3)
  // に連動するため、実行タイミング依存を避けてイベント無しに固定する。
  withNoDailyEvents(() => {
  const session = TW.battle.start({ mode: 'rank', durationMs: 180000, onEvent: () => {} });

  function speedBonus(ms) { return ms < 2000 ? 50 : (ms < 4000 ? 25 : 0); }
  function expectedScore(combo, feverActive, ms) {
    const mult = 1 + Math.min(combo, 20) * 0.05;
    return 100 * mult * (feverActive ? 2 : 1) + speedBonus(ms);
  }

  // 10連続正解(高速回答) → 10回目でフィーバー発動
  for (let combo = 1; combo <= 10; combo++) {
    const q = session.next();
    assert(q, 'next() が問題を返す');
    const res = session.submit(q.answerIndex, 1000);
    assertEqual(res.correct, true, `combo${combo}: 正解として判定される`);
    assertEqual(res.combo, combo, `combo${combo}: コンボが+1ずつ増える`);
    if (combo < 10) {
      assertEqual(res.feverActive, false, `combo${combo}: まだフィーバーではない`);
      assertEqual(res.feverJustStarted, false, `combo${combo}: フィーバー開始ではない`);
    } else {
      assertEqual(res.feverActive, true, 'combo10: フィーバー発動');
      assertEqual(res.feverJustStarted, true, 'combo10: フィーバー開始フラグ');
    }
    assertClose(res.scoreGained, expectedScore(res.combo, res.feverActive, 1000), 1e-6,
      `combo${combo}: スコア式(base×combo倍率×fever+速度ボーナス)`);
  }

  // 11回目: フィーバー継続中(15秒以内・タイマー未経過)
  {
    const q = session.next();
    const res = session.submit(q.answerIndex, 1000);
    assertEqual(res.combo, 11, 'combo11');
    assertEqual(res.feverActive, true, 'フィーバー継続中');
    assertEqual(res.feverJustStarted, false, '継続中なのでjustStartedはfalse');
    assertClose(res.scoreGained, expectedScore(11, true, 1000), 1e-6, 'フィーバー中のスコア式');
  }

  // 誤答 → コンボ0・フィーバー即終了
  {
    const q = session.next();
    const wrongIndex = (q.answerIndex + 1) % 4;
    const res = session.submit(wrongIndex, 1000);
    assertEqual(res.correct, false, '誤答判定');
    assertEqual(res.combo, 0, '誤答でコンボ0');
    assertEqual(res.feverActive, false, '誤答でフィーバー即終了');
  }

  // 誤答後の正解でコンボが1から再スタート
  {
    const q = session.next();
    const res = session.submit(q.answerIndex, 1000);
    assertEqual(res.combo, 1, '誤答後の正解でコンボ1から再開');
    assertEqual(res.feverActive, false, 'フィーバーは終了済み');
  }
  });
});

// ---------------------------------------------------------------------------
// フィーバーチェイン (2026-07-05改修, SPEC_CORE §4/§5): コンボ「ちょうど10の倍数」到達ごとに判定。
// 非フィーバー中→Lv1(15秒)、フィーバー中→チェイン(Lv+1・上限4・残り15秒にリセット)。
// スコア倍率は固定×2から×(1+feverLevel)に変更(Lv1=×2〜Lv4=×5)。
// ---------------------------------------------------------------------------

test('battle: コンボ20到達がフィーバー中ならLv2になり倍率×3・残り時間が15秒にリセットされる', () => {
  withNoDailyEvents(() => {
    const session = TW.battle.start({ mode: 'rank', durationMs: 180000, onEvent: () => {} });
    function speedBonus(ms) { return ms < 2000 ? 50 : (ms < 4000 ? 25 : 0); }
    function expectedScore(combo, feverLevel, ms) {
      const mult = 1 + Math.min(combo, 20) * 0.05;
      return 100 * mult * (1 + feverLevel) + speedBonus(ms);
    }

    let res;
    // combo1〜9: フィーバー無し(Lv0)
    for (let combo = 1; combo <= 9; combo++) {
      const q = session.next();
      res = session.submit(q.answerIndex, 1000);
      assertEqual(res.feverLevel, 0, `combo${combo}: フィーバー無しはLv0`);
      assertEqual(res.feverChained, false, `combo${combo}: チェインではない`);
    }

    // combo10: 新規発動でLv1
    let q = session.next();
    res = session.submit(q.answerIndex, 1000);
    assertEqual(res.feverJustStarted, true, 'combo10: フィーバー新規発動');
    assertEqual(res.feverChained, false, 'combo10: 新規発動はチェインではない');
    assertEqual(res.feverLevel, 1, 'combo10: Lv1');
    assertClose(res.scoreGained, expectedScore(10, 1, 1000), 1e-6, 'combo10: Lv1倍率×2でスコア計算');

    // 残り時間をわざと減らしておき、後段のチェインで15秒にリセットされることを確認するための下準備
    session.feverEndAt = Date.now() + 4000;

    // combo11〜19: Lv1のまま継続(まだ10の倍数ではない)
    for (let combo = 11; combo <= 19; combo++) {
      q = session.next();
      res = session.submit(q.answerIndex, 1000);
      assertEqual(res.feverChained, false, `combo${combo}: チェインではない`);
      assertEqual(res.feverLevel, 1, `combo${combo}: まだLv1`);
      assertClose(res.scoreGained, expectedScore(combo, 1, 1000), 1e-6, `combo${combo}: Lv1倍率でスコア計算`);
    }

    // combo20: フィーバー中の再到達 → チェイン。Lv2(倍率×3)+残り時間が15秒にリセットされる
    q = session.next();
    res = session.submit(q.answerIndex, 1000);
    assertEqual(res.feverChained, true, 'combo20: チェイン発生');
    assertEqual(res.feverJustStarted, false, 'combo20: 新規発動ではない(チェインと排他)');
    assertEqual(res.feverLevel, 2, 'combo20: Lv2に上昇');
    assertClose(res.scoreGained, expectedScore(20, 2, 1000), 1e-6, 'combo20: Lv2倍率×3でスコア計算');

    const tickRes = session.tick(Date.now());
    assert(tickRes.feverRemainMs > 14000,
      'チェインで残り時間が15秒にリセットされる(直前は4秒まで減らしていたのに14秒超残っている): ' + tickRes.feverRemainMs);

    const result = session.end();
    assertEqual(result.maxFeverLevel, 2, 'ResultのmaxチェインレベルがLv2として記録される');
  });
});

test('battle: フィーバー時間切れ後の再発動はLv1から(チェインではない)', () => {
  withNoDailyEvents(() => {
    const session = TW.battle.start({ mode: 'rank', durationMs: 180000, onEvent: () => {} });
    for (let combo = 1; combo <= 9; combo++) {
      const q = session.next();
      session.submit(q.answerIndex, 1000);
    }
    let q = session.next();
    let res = session.submit(q.answerIndex, 1000); // combo10: Lv1発動
    assertEqual(res.feverLevel, 1, '発動直後はLv1');

    // フィーバーを時間切れにする(期限を過去に設定して強制的に失効させる)
    session.feverEndAt = Date.now() - 1000;

    for (let combo = 11; combo <= 19; combo++) {
      q = session.next();
      res = session.submit(q.answerIndex, 1000);
      assertEqual(res.feverActive, false, `combo${combo}: 時間切れ後はフィーバー非アクティブ`);
      assertEqual(res.feverLevel, 0, `combo${combo}: 時間切れ後はLv0`);
    }

    // combo20: 時間切れ後の再到達は「新規発動」としてLv1から(チェインではない)
    q = session.next();
    res = session.submit(q.answerIndex, 1000);
    assertEqual(res.feverChained, false, 'combo20: 時間切れ後の再発動はチェインではない');
    assertEqual(res.feverJustStarted, true, 'combo20: 新規発動としてカウントされる');
    assertEqual(res.feverLevel, 1, 'combo20: Lv1から再スタート');
  });
});

test('battle: 誤答でコンボ0・フィーバーLv0に即リセットされる(チェイン後でも)', () => {
  withNoDailyEvents(() => {
    const session = TW.battle.start({ mode: 'rank', durationMs: 180000, onEvent: () => {} });
    // combo1〜20まで正解し続けてLv2まで進めておく
    for (let combo = 1; combo <= 20; combo++) {
      const q = session.next();
      const res = session.submit(q.answerIndex, 1000);
      if (combo === 20) assertEqual(res.feverLevel, 2, '前提: combo20でLv2に達している');
    }

    const q = session.next();
    const wrongIndex = (q.answerIndex + 1) % 4;
    const res = session.submit(wrongIndex, 1000);
    assertEqual(res.correct, false, '誤答判定');
    assertEqual(res.combo, 0, '誤答でコンボ0');
    assertEqual(res.feverActive, false, '誤答でフィーバー非アクティブ');
    assertEqual(res.feverLevel, 0, 'チェインでLv2まで進んでいても誤答でLv0に戻る');
    assertEqual(res.feverChained, false, '誤答はチェインではない');
  });
});

test('battle: settings.voice=trueでも"listen"タイプは一切生成されない(2026-07-05廃止)', () => {
  const s = TW.store.state;
  const prevVoice = s.settings.voice;
  const prevTyping = s.settings.typing;
  s.settings.voice = true;
  s.settings.typing = true;
  try {
    const session = TW.battle.start({ mode: 'rank', durationMs: 600000, onEvent: () => {} });
    let checked = 0;
    for (let i = 0; i < 500; i++) {
      const q = session.next();
      assert(q, 'next()が問題を返す(durationMsは十分大きい)');
      assert(q.type !== 'listen', 'listenタイプは廃止済みで生成されない: ' + JSON.stringify(q));
      assert(['en2ja', 'ja2en', 'cloze', 'typing'].indexOf(q.type) !== -1,
        '出題typeはen2ja/ja2en/cloze/typingのいずれか: ' + q.type);
      checked++;
    }
    assert(checked === 500, '500問すべて検証できた');
  } finally {
    s.settings.voice = prevVoice;
    s.settings.typing = prevTyping;
  }
});

test('battle: tick() でボットスコアが単調増加・残り時間が減る', () => {
  const t0 = Date.now();
  const session = TW.battle.start({ mode: 'rank', durationMs: 180000, onEvent: () => {} });

  let prevBotScore = -Infinity;
  let prevRemain = Infinity;
  for (let k = 0; k <= 10; k++) {
    const now = t0 + k * 2000;
    const tickRes = session.tick(now);
    assert(typeof tickRes.botScore === 'number', 'botScoreは数値');
    assert(tickRes.botScore >= prevBotScore, `botScoreは単調増加(非減少): step${k}`);
    assert(tickRes.remainMs <= prevRemain, `remainMsは減少していく: step${k}`);
    prevBotScore = tickRes.botScore;
    prevRemain = tickRes.remainMs;
  }
});

test('battle: end() の勝敗とコイン (プレイヤー勝利)', () => {
  const session = TW.battle.start({ mode: 'rank', durationMs: 180000, onEvent: () => {} });
  const q = session.next();
  const submitRes = session.submit(q.answerIndex, 1000);
  assertEqual(submitRes.correct, true, '正解してplayerScore>0にする');

  // ボットは開始時に生成した3分間フルの回答スケジュールを持ち、end()はそのスケジュール全体
  // (durationMs時点)でのスコアを決定的に算出する(tick呼び出しの有無に依存しない実装のため、
  // 数回の正解だけでは勝敗を統計的にしか制御できない)。勝敗判定ロジック自体を決定的に検証するため、
  // Sessionが公開している素のプロパティ playerScore を直接書き換えて「確実に勝つ」状態を作る。
  session.playerScore = 10000000;

  const result = session.end();
  assertEqual(result.win, true, 'playerScoreがボットの最大想定スコアを確実に上回る');
  assert(result.total >= 1 && result.correct >= 1, '出題数・正答数が記録される');
  assert(Array.isArray(result.capturedWords), 'capturedWordsは配列');
  assert(Array.isArray(result.kiraWords), 'kiraWordsは配列');
  assert(result.rank && typeof result.rank.eloDelta === 'number', 'mode=rank なので rank 結果がある');
  assert(typeof result.coinsEarned === 'number' && result.coinsEarned >= 8,
    'rank勝利の基礎コイン8以上(2026-07-05に約1/6へ調整。捕獲/キラ加算があれば増える)');
});

test('battle: end() の勝敗とコイン (プレイヤー敗北, 無回答)', () => {
  // 統計的テスト: プレイヤーが一度も回答しなければplayerScore=0。
  // ボットは3分間のスケジュールを持ち accuracy>=0.5 なので、end()時点のbotScoreが
  // 0のままになる確率は天文学的に低い(スケジュールは最低でも十数件はある)。
  const session = TW.battle.start({ mode: 'rank', durationMs: 180000, onEvent: () => {} });

  const result = session.end();
  assertEqual(result.win, false, 'botScoreがほぼ確実に0より大きいため敗北');
  assert(typeof result.coinsEarned === 'number' && result.coinsEarned >= 3,
    'rank敗北の基礎コイン3以上(2026-07-05に約1/6へ調整)');
  assert(result.rank && typeof result.rank.eloDelta === 'number', 'mode=rank なので rank 結果がある');
});

// ===========================================================================
// SECTION F: TW.level (SPEC_ADDICTION §1, §7)
// ===========================================================================

// レベルnからn+1に必要なXP。仕様の式そのものをテスト用ヘルパーとして再現し、
// 期待値を「その場でハードコードした数値」ではなく式から導出することで転記ミスを避ける。
function levelXpNeed(n) { return 80 + (n - 1) * 40; }
function levelTotalXp(level) { // レベルlevelに到達するための累積XP(レベル1到達=0)
  let sum = 0;
  for (let n = 1; n < level; n++) sum += levelXpNeed(n);
  return sum;
}

// TW.daily.currentEvents は「週替わり強化週間(スコア×1.5)」「週末コイン2倍」を実行時の
// 現在日時から決定的に算出する(SPEC_ADDICTION §2.3)。store.addCoins / battle.js のスコア計算は
// これに疎結合(typeof TW.daily !== "undefined" ガード)で連動するため、実行日が土日だったり
// 出題語が今週の強化カテゴリに当たったりすると、無関係なテスト(level/quest/battle基礎スコア)の
// 期待値が実行タイミング依存でぶれてしまう。currentEvents自体を検証する専用テスト以外では
// 一時的に「イベント無し」に差し替えて実行日時に依存しない決定的なテストにする。
function withNoDailyEvents(fn) {
  const original = TW.daily && TW.daily.currentEvents;
  if (TW.daily) TW.daily.currentEvents = () => [];
  try {
    fn();
  } finally {
    if (TW.daily && original) TW.daily.currentEvents = original;
  }
}

test('level.current: 曲線境界値 (lvN→N+1必要XP=80+(N-1)*40)', () => {
  const s = TW.store.state;

  s.xp = 0;
  let cur = TW.level.current();
  assertEqual(cur.level, 1, '初期レベル1');
  assertEqual(cur.totalXp, 0, '初期totalXp=0');
  assertEqual(cur.xpInto, 0, '初期xpInto=0');
  assertEqual(cur.xpNeed, levelXpNeed(1), 'lv1→2の必要XP=80');

  s.xp = levelTotalXp(2) - 1; // lv2到達の1XP手前
  cur = TW.level.current();
  assertEqual(cur.level, 1, '境界1XP手前ではまだレベル1');
  assertEqual(cur.xpInto, levelXpNeed(1) - 1, '境界手前のxpInto');

  s.xp = levelTotalXp(2); // ちょうど境界
  cur = TW.level.current();
  assertEqual(cur.level, 2, '境界ちょうどでレベル2に到達');
  assertEqual(cur.xpInto, 0, '境界ちょうど到達直後のxpInto=0');
  assertEqual(cur.xpNeed, levelXpNeed(2), 'lv2→3の必要XP=120');

  s.xp = levelTotalXp(6) - 1;
  assertEqual(TW.level.current().level, 5, '複数レベル分先の境界: 1XP手前はまだlv5');

  s.xp = levelTotalXp(6);
  assertEqual(TW.level.current().level, 6, '複数レベル分先の境界: ちょうどでlv6');
});

test('level.addXp: レベルアップ報酬(コイン50/レベル・5の倍数到達でチケット+1)', () => {
  const s = TW.store.state;
  s.streak.days = 0; // addCoinsの倍率を1.0に固定して検証を単純化(後続テストへの影響を避けて末尾で復元)

  // addCoinsは週末コイン2倍イベント(TW.daily連動)も参照するため、実行日に依存しないよう無効化する
  withNoDailyEvents(() => {
    // 単発の1レベルアップ(5の倍数ではない lv2)
    s.xp = 0;
    s.tickets = 0;
    s.coins = 0;
    let r = TW.level.addXp(levelXpNeed(1));
    assertEqual(r.gained, levelXpNeed(1), 'gainedは渡したnと同じ');
    assertEqual(r.levelsGained, 1, '1レベル分上がる');
    assertEqual(r.rewards.coins, 50, '1レベルアップでコイン50(倍率1.0)');
    assertEqual(r.rewards.tickets, 0, 'lv2は5の倍数ではないのでチケット無し');
    assertEqual(s.coins, 50, 'store.coinsに反映される');
    assertEqual(s.tickets, 0, 'ticketsは増えない');
    assertEqual(TW.level.current().level, 2, '実際にlv2になっている');

    // 複数レベルを一度に跨ぎ、5の倍数(lv5)をちょうど含む
    s.xp = 0;
    s.tickets = 0;
    s.coins = 0;
    const gainTo5 = levelXpNeed(1) + levelXpNeed(2) + levelXpNeed(3) + levelXpNeed(4); // lv1→lv5ちょうど
    r = TW.level.addXp(gainTo5);
    assertEqual(TW.level.current().level, 5, 'lv5にちょうど到達');
    assertEqual(r.levelsGained, 4, '1→5で4レベル分上がる');
    assertEqual(r.rewards.coins, 200, '4レベル分のコイン50×4=200');
    assertEqual(r.rewards.tickets, 1, 'lv5(5の倍数)にちょうど到達しチケット+1');
    assertEqual(s.tickets, 1, 'store.ticketsに反映される');

    // 5の倍数を2つ(lv5, lv10)跨ぐ場合はチケット+2
    s.xp = 0;
    s.tickets = 0;
    s.coins = 0;
    r = TW.level.addXp(levelTotalXp(11));
    assertEqual(TW.level.current().level, 11, 'lv11に到達');
    assertEqual(r.levelsGained, 10, '1→11で10レベル分上がる');
    assertEqual(r.rewards.coins, 500, '10レベル分のコイン50×10=500');
    assertEqual(r.rewards.tickets, 2, 'lv5とlv10の2つの5の倍数を跨ぐのでチケット+2');
    assertEqual(s.tickets, 2, 'store.ticketsに反映される');
  });

  s.streak.days = 0; // 復元
});

// ===========================================================================
// SECTION G: TW.daily (SPEC_ADDICTION §2, §7)
// ===========================================================================

test('daily.boostState: 4時間ごとの遅延チャージ計算(now引数で決定的)', () => {
  const s = TW.store.state;
  const HOUR = 3600 * 1000;
  const base = 1700000000000; // 固定基準時刻(now引数を明示して決定的に検証)

  s.boost = { stock: 0, lastChargeAt: base, pending: false };

  let st = TW.daily.boostState(base);
  assertEqual(st.stock, 0, '経過0ではstock=0');
  assertEqual(st.full, false, 'stock<2なのでfullではない');
  assertEqual(st.nextChargeMin, 240, '次チャージまで240分(4時間)');

  // 同じnowで直後にもう一度呼んでも結果が変わらない(決定的)。時間を遡って呼ぶのは実運用上あり得ないため検証しない。
  const repeat = TW.daily.boostState(base);
  assertEqual(repeat.stock, 0, '同じnowを連続で呼んでも結果が変わらない(決定的)');
  assertEqual(repeat.nextChargeMin, 240, '同じnowを連続で呼んでもnextChargeMinも変わらない');

  st = TW.daily.boostState(base + HOUR); // 1時間経過
  assertEqual(st.stock, 0, '1時間経過ではまだ+1しない');
  assertEqual(st.nextChargeMin, 180, '残り180分');

  st = TW.daily.boostState(base + 4 * HOUR); // ちょうど4時間
  assertEqual(st.stock, 1, 'ちょうど4時間でstock+1');
  assertEqual(st.full, false, 'stock=1はまだ上限(2)未満');
  assertEqual(st.nextChargeMin, 240, '次の+1までまた240分');

  st = TW.daily.boostState(base + 4 * HOUR * 2); // ちょうど8時間(2回分)
  assertEqual(st.stock, 2, '8時間で2回チャージされ上限2に到達');
  assertEqual(st.full, true, 'stock=2で満タン');
  assertEqual(st.nextChargeMin, null, '満タン時はnextChargeMinがnull');

  st = TW.daily.boostState(base + 4 * HOUR * 5); // 上限を超える経過でも2でキャップ
  assertEqual(st.stock, 2, '上限2でキャップされる(それ以上は増えない)');
  assertEqual(st.full, true, '依然満タン');
});

test('daily.useBoost: stock消費とpending設定', () => {
  const s = TW.store.state;
  s.boost = { stock: 2, lastChargeAt: Date.now(), pending: false };

  const ok1 = TW.daily.useBoost();
  assertEqual(ok1, true, 'stock>0ならuseBoostはtrue');
  assertEqual(s.boost.pending, true, 'useBoost後はpending=true');
  assertEqual(TW.daily.boostState().stock, 1, 'useBoost後はstockが1減る(2→1)');

  s.boost.stock = 0;
  s.boost.pending = false;
  const ok2 = TW.daily.useBoost();
  assertEqual(ok2, false, 'stock=0ならuseBoostはfalse');
  assertEqual(s.boost.pending, false, 'stock不足時はpendingも変化しない');
});

test('daily.pendingLogin/claimLogin: 報酬表・7日循環・同日二重受取防止', () => {
  const s = TW.store.state;
  const DAY_MS = 24 * 60 * 60 * 1000;
  const base = new Date(2026, 0, 1).getTime();
  const REWARDS = [
    { day: 1, coins: 50 },
    { day: 2, coins: 80 },
    { day: 3, coins: 100 },
    { day: 4, tickets: 1 },
    { day: 5, coins: 150 },
    { day: 6, coins: 200 },
    { day: 7, coins: 300, tickets: 2 },
  ];

  s.login = { cycleDay: 0, lastDate: '' };
  s.tickets = 0;

  // claimLoginが内部でTW.store.addCoins経由でコインを付与する実装だった場合、週末コイン2倍
  // イベント(実行日依存)が報酬額に混入しうる。この7日分の日付は実行タイミングにより土日を含む
  // ことがあるため、報酬表そのものの数値検証は「イベント無し」に固定して行う。
  withNoDailyEvents(() => {
    let t = base;
    REWARDS.forEach((expected) => {
      const pending = TW.daily.pendingLogin(t);
      assert(pending, `day${expected.day}: pendingLoginが報酬を返す`);
      assertEqual(pending.day, expected.day, `day${expected.day}: dayが一致`);
      if (expected.coins !== undefined) assertEqual(pending.coins, expected.coins, `day${expected.day}: コイン報酬`);
      if (expected.tickets !== undefined) assertEqual(pending.tickets, expected.tickets, `day${expected.day}: チケット報酬`);

      const claimed = TW.daily.claimLogin(t);
      assertEqual(claimed.day, expected.day, `day${expected.day}: claim結果のdayも一致`);
      assertEqual(s.login.cycleDay, expected.day, `day${expected.day}: claim後cycleDayが${expected.day}`);

      // 同日の二重受取防止
      const dupPending = TW.daily.pendingLogin(t + 3600000);
      assert(dupPending === null, `day${expected.day}: 同日はpendingLoginがnull`);
      const dupClaim = TW.daily.claimLogin(t + 3600000);
      assert(dupClaim === null, `day${expected.day}: 同日の二重claimは無効`);
      assertEqual(s.login.cycleDay, expected.day, `day${expected.day}: 二重claim後もcycleDayは変化しない`);

      t += DAY_MS; // 翌日へ
    });

    // 7日サイクルが循環してday1に戻る
    const wrapped = TW.daily.pendingLogin(t);
    assertEqual(wrapped.day, 1, '7日目の翌日はday1に循環する');
    TW.daily.claimLogin(t);
    assertEqual(s.login.cycleDay, 1, '循環後cycleDay=1');

    // 日を飛ばしてもサイクルはリセットされない(3日休んでも単純に次のdayへ進むだけ)
    t += DAY_MS * 4;
    const afterGap = TW.daily.pendingLogin(t);
    assertEqual(afterGap.day, 2, '日を飛ばしてもサイクルはリセットされず単純に+1(day2)');
  });
});

test('daily.currentEvents: 同一週内は決定的に同じ強化週間イベント', () => {
  // 2026-07-06(月)〜07-12(日) が同一ISO週。週内の異なる2時点で比較する。
  const monday = new Date(2026, 6, 6, 0, 1, 0).getTime();
  const wednesday = new Date(2026, 6, 8, 12, 0, 0).getTime();

  const evA = TW.daily.currentEvents(monday);
  const evB = TW.daily.currentEvents(wednesday);
  const catA = evA.find((e) => e.type === 'cat');
  const catB = evB.find((e) => e.type === 'cat');

  assert(catA, '週替わり強化週間イベント(type=cat)が存在する');
  assert(catB, '同じ週内でもcatイベントが存在する');
  assert(['general', 'academic', 'it', 'robotics'].indexOf(catA.cat) !== -1, 'catは4カテゴリのいずれか');
  assertEqual(catA.cat, catB.cat, '同一週内は同じカテゴリが選ばれる(決定的)');
  assertEqual(catA.id, catB.id, '同一週内は同じイベントidになる');
  assertClose(catA.mult, 1.5, 1e-9, '強化週間の倍率は1.5');
  assertEqual(catA.mult, catB.mult, '倍率も同一週内で一致');
  assertEqual(catA.endsAt, catB.endsAt, '終了時刻(次の月曜0時)も同一週内で一致');
});

test('daily.currentEvents: 週末コイン2倍イベントの判定(土日のみ)', () => {
  const sat = new Date(2026, 6, 11, 10, 0, 0).getTime(); // 土曜
  const sun = new Date(2026, 6, 12, 23, 0, 0).getTime(); // 日曜
  const wed = new Date(2026, 6, 8, 12, 0, 0).getTime(); // 平日(水曜)
  const nextMonday0 = new Date(2026, 6, 13, 0, 0, 0).getTime();

  const coinSat = TW.daily.currentEvents(sat).find((e) => e.type === 'coin');
  assert(coinSat, '土曜は週末コイン2倍イベントが存在する');
  assertEqual(coinSat.mult, 2, '週末コインイベントの倍率は2');
  assertEqual(coinSat.endsAt, nextMonday0, '週末イベントの終了は次の月曜0時');

  const coinSun = TW.daily.currentEvents(sun).find((e) => e.type === 'coin');
  assert(coinSun, '日曜も週末コイン2倍イベントが存在する');
  assertEqual(coinSun.mult, 2, '日曜のコインイベントも倍率2');

  const coinWed = TW.daily.currentEvents(wed).find((e) => e.type === 'coin');
  assert(coinWed === undefined, '平日は週末コインイベントが無い');
});

// ===========================================================================
// SECTION H: TW.battle — SPEC_ADDICTION §3 拡張 (§7)
// ===========================================================================

test('battle: blitzモードはスコア×1.2(rank基準スコアとの比較)', () => {
  function speedBonus(ms) { return ms < 2000 ? 50 : (ms < 4000 ? 25 : 0); }
  function baseScore(combo, feverActive, ms) {
    const mult = 1 + Math.min(combo, 20) * 0.05;
    return 100 * mult * (feverActive ? 2 : 1) + speedBonus(ms);
  }

  // 強化週間イベント(出題語のcatが今週の対象カテゴリだとスコア×1.5)はランダムに引く語に依存して
  // 混入しうるため、blitz×1.2そのものの検証はイベント無しに固定して行う。
  withNoDailyEvents(() => {
    const rankSession = TW.battle.start({ mode: 'rank', durationMs: 180000, onEvent: () => {} });
    const q1 = rankSession.next();
    const rankRes = rankSession.submit(q1.answerIndex, 1000);
    assertEqual(rankRes.correct, true, 'rank: 1問目は正解として判定');

    const blitzSession = TW.battle.start({ mode: 'blitz', durationMs: 60000, onEvent: () => {} });
    const q2 = blitzSession.next();
    const blitzRes = blitzSession.submit(q2.answerIndex, 1000);
    assertEqual(blitzRes.correct, true, 'blitz: 1問目は正解として判定');

    // 両者とも1問目・combo=1・feverなしなので基準スコアは同一。blitzはその1.2倍(四捨五入誤差は±2まで許容)。
    const expectedBase = baseScore(1, false, 1000);
    assertClose(rankRes.scoreGained, Math.round(expectedBase), 1, 'rankはbase式そのまま');
    const diff = Math.abs(blitzRes.scoreGained - expectedBase * 1.2);
    assert(diff <= 2, `blitzスコアはbase×1.2に近い値であるべき(期待≈${expectedBase * 1.2}, 実際${blitzRes.scoreGained})`);
  });
});

test('battle: submit()のskipSrsオプションでSRSレコードが変化しない', () => {
  const session = TW.battle.start({ mode: 'blitz', durationMs: 60000, onEvent: () => {} });
  const q = session.next();
  const before = TW.store.state.srs[q.word.id];
  const beforeSnapshot = before ? JSON.stringify(before) : undefined;

  const res = session.submit(null, 3000, { skipSrs: true });
  assertEqual(res.correct, false, '3秒超過相当のnull回答は誤答扱い');

  const after = TW.store.state.srs[q.word.id];
  const afterSnapshot = after ? JSON.stringify(after) : undefined;
  assertEqual(afterSnapshot, beforeSnapshot, 'skipSrs=trueならSRSレコードが変化しない(新規登録もされない)');
});

test('battle: 序盤3戦(state.history.length<3)はボットを弱体化する', () => {
  const s = TW.store.state;
  function rawBotAccuracy(botElo) { return TW.util.clamp(0.55 + (botElo - 800) / 2400, 0.5, 0.95); }
  function rawBotAvgMs(botElo) { return TW.util.clamp(5200 - botElo * 1.2, 2200, 6000); }

  s.history = []; // 序盤(0戦目)
  const early = TW.battle.start({ mode: 'rank', durationMs: 180000, onEvent: () => {} });
  assertClose(early.botInfo.accuracy, rawBotAccuracy(early.botInfo.elo) - 0.20, 1e-6, '序盤はaccuracyが-0.20弱体化される');
  assertClose(early.botInfo.avgMs, rawBotAvgMs(early.botInfo.elo) + 1500, 1e-6, '序盤はavgMsが+1500弱体化される(遅くなる)');
  assert(typeof early.botInfo.name === 'string' && early.botInfo.name.length > 0,
    '序盤弱体化後もnameは失われない(非空文字列)');
  assert(['rush', 'closer', 'streaky'].indexOf(early.botInfo.style) !== -1,
    '序盤弱体化後もstyleは失われない(3値のいずれか)');

  s.history = [{ t: 1 }, { t: 2 }, { t: 3 }]; // 3戦以上済み → 弱体化なし
  const later = TW.battle.start({ mode: 'rank', durationMs: 180000, onEvent: () => {} });
  assertClose(later.botInfo.accuracy, rawBotAccuracy(later.botInfo.elo), 1e-6, '3戦以上済みなら弱体化されない(通常のaccuracy)');
  assertClose(later.botInfo.avgMs, rawBotAvgMs(later.botInfo.elo), 1e-6, '3戦以上済みなら弱体化されない(通常のavgMs)');

  s.history = []; // 後続テストへの影響を避けて復元
});

test('battle: nearMissの境界判定(ちょうど10%差はtrueになる)', () => {
  // ちょうど10%差で負け: botScore=1000, playerScore=900 → (1000-900)/1000=0.10
  let session = TW.battle.start({ mode: 'rank', durationMs: 180000, onEvent: () => {} });
  session.playerScore = 900;
  session._botScoreAt = function () { return 1000; };
  let result = session.end();
  assertEqual(result.win, false, 'playerScore<botScoreなので負け');
  assertEqual(result.nearMiss, true, 'ちょうど10%差はnearMiss=true(境界は<=10%でtrue)');
  assert(result.rematchBot, 'nearMissのときrematchBotが提供される');

  // 10%を少し超える差(11%)はfalseになるはず
  session = TW.battle.start({ mode: 'rank', durationMs: 180000, onEvent: () => {} });
  session.playerScore = 890; // (1000-890)/1000=0.11
  session._botScoreAt = function () { return 1000; };
  result = session.end();
  assertEqual(result.win, false, '負けであることは同じ');
  assertEqual(result.nearMiss, false, '11%差はnearMissの範囲外(false)');
  assert(!result.rematchBot, 'nearMissでないときrematchBotは無い');

  // 勝った場合はnearMissは常にfalse
  session = TW.battle.start({ mode: 'rank', durationMs: 180000, onEvent: () => {} });
  session.playerScore = 1000000;
  session._botScoreAt = function () { return 1; };
  result = session.end();
  assertEqual(result.win, true, '勝利');
  assertEqual(result.nearMiss, false, '勝利時はnearMissは常にfalse');
  assert(!result.rematchBot, '勝利時はrematchBotも無い');
});

// ---------------------------------------------------------------------------
// 5. 集計・終了
// ---------------------------------------------------------------------------
console.log(`\n合格: ${passCount} / 失敗: ${failCount}`);
if (failures.length > 0) {
  console.log('\n--- 失敗一覧 ---');
  failures.forEach((f, i) => {
    console.log(`\n[${i + 1}] ${f.name}`);
    console.log(f.error);
  });
}
process.exit(failCount ? 1 : 0);
