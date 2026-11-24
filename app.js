/**
 * 115學年度第1學期第2次段考（B卷）生活化學複習網站 — 主應用程式邏輯
 * 無外部依賴，支援 file:// 直接開啟與 HTTP 伺服器瀏覽
 */
(function () {
  'use strict';

  const DATA = window.EXAM_DATA;
  if (!DATA) {
    alert('題庫資料 data.js 載入失敗，請確認檔案位於同一資料夾。');
    return;
  }

  const STORAGE_KEY = 'chem_exam_115_1_2_v1';
  const VIEW_TITLES = {
    dashboard: '總覽儀表板',
    practice: '智慧刷題練習',
    exam: '仿真模擬段考（共35題｜70分）',
    flashcards: '互動翻轉記憶卡',
    wrongbook: '錯題本與全題庫搜尋',
    guides: '考前重點整理'
  };

  const TOPIC_MAP = {};
  DATA.topics.forEach(t => { TOPIC_MAP[t.id] = t; });

  const QUESTION_MAP = {};
  DATA.questions.forEach(q => { QUESTION_MAP[q.id] = q; });

  /* =========================
     狀態與 LocalStorage 管理
     ========================= */
  function createDefaultState() {
    return {
      theme: 'light',
      history: {},        // { [qId]: { attempts, correct, wrong, lastAnswer, lastCorrect } }
      wrongBook: [],      // [qId, ...]
      bookmarks: [],      // [qId, ...]
      notes: {},          // { [qId]: string }
      examHistory: [],    // [{ date, score, maxScore, correctCount, totalCount, durationSec, topicStats }]
      flashcardMastery: {}, // { [cardId]: 'known' | 'fuzzy' | 'new' }
      streak: 0,
      bestStreak: 0
    };
  }

  function loadState() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return createDefaultState();
      const parsed = JSON.parse(raw);
      return Object.assign(createDefaultState(), parsed);
    } catch (e) {
      return createDefaultState();
    }
  }

  let appState = loadState();

  function saveState() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(appState));
    } catch (e) {
      console.warn('無法儲存至 localStorage', e);
    }
    updateNavBadges();
  }

  /* 執行期暫存狀態 */
  const runtime = {
    currentView: 'dashboard',
    // Practice
    practiceList: DATA.questions.map(q => q.id),
    practiceIndex: 0,
    practiceAnswers: {},      // session selected original key: { [qId]: 'A'|'B'|'C'|'D' }
    practiceShuffleQ: false,
    practiceShuffleOpt: false,
    practiceOptOrder: {},     // { [qId]: ['B','D','A','C'] }
    practiceShowExp: true,
    q25Annotated: false,
    // Exam
    examPhase: 'setup',       // 'setup' | 'running' | 'report'
    examConfig: { minutes: 35, shuffleQ: false, shuffleOpt: false },
    examOrder: [],
    examIndex: 0,
    examAnswers: {},          // { [qId]: originalKey }
    examFlags: {},            // { [qId]: true }
    examOptOrder: {},
    examRemainSec: 0,
    examElapsedSec: 0,
    examTimerId: null,
    examReport: null,
    examReportFilter: 'all',
    // Flashcards
    fcDeckType: 'concept',    // 'concept' | 'questions' | 'wrong' | 'topic:<id>'
    fcQueue: [],
    fcCurrentIdx: 0,
    fcFlipped: false,
    fcDoneCount: 0,
    // Wrongbook / Search
    wbTab: 'wrong',
    wbSearchQuery: '',
    // Guides
    activeGuideId: 'matter',
    // Paper Modal
    paperPage: 0,
    paperZoom: 1
  };

  /* =========================
     共用工具函式
     ========================= */
  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function formatStem(q) {
    let html = escapeHtml(q.stem);
    if (q.negativeWords && q.negativeWords.length) {
      q.negativeWords.forEach(w => {
        const safeW = escapeHtml(w);
        html = html.split(safeW).join(`<span class="neg-emph">${safeW}</span>`);
      });
    }
    return html;
  }

  function shuffleArray(arr) {
    const copy = arr.slice();
    for (let i = copy.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [copy[i], copy[j]] = [copy[j], copy[i]];
    }
    return copy;
  }

  function getOptionDisplayMap(qId, shuffleOpt, storeObj) {
    const base = ['A', 'B', 'C', 'D'];
    if (!shuffleOpt) {
      return { A: 'A', B: 'B', C: 'C', D: 'D' };
    }
    if (!storeObj[qId]) {
      storeObj[qId] = shuffleArray(base);
    }
    const origKeys = storeObj[qId];
    const map = {};
    base.forEach((dispKey, idx) => {
      map[dispKey] = origKeys[idx];
    });
    return map;
  }

  function showToast(msg) {
    const el = document.getElementById('toast');
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(showToast._timer);
    showToast._timer = setTimeout(() => el.classList.remove('show'), 2200);
  }

  function formatDuration(sec) {
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }

  /* 第 25 題專用分子示意圖 SVG */
  function renderQ25Svg(annotated) {
    if (!annotated) {
      return `
        <svg viewBox="0 0 460 130" width="430" height="122" aria-label="清潔劑分子示意圖">
          <defs>
            <radialGradient id="headGrad" cx="35%" cy="35%" r="65%">
              <stop offset="0%" stop-color="#e2e8f0" />
              <stop offset="55%" stop-color="#94a3b8" />
              <stop offset="100%" stop-color="#475569" />
            </radialGradient>
          </defs>
          <polyline
            points="32,62 56,42 80,62 104,42 128,62 152,42 176,62 200,42 224,62 248,42 272,62 296,42 320,62 344,42 365,58"
            fill="none"
            stroke="currentColor"
            stroke-width="3.2"
            stroke-linecap="round"
            stroke-linejoin="round"
          />
          <circle cx="388" cy="56" r="22" fill="url(#headGrad)" stroke="currentColor" stroke-width="2" />
          <text x="195" y="106" font-size="19" font-weight="700" fill="currentColor" text-anchor="middle">甲</text>
          <text x="388" y="106" font-size="19" font-weight="700" fill="currentColor" text-anchor="middle">乙</text>
        </svg>
      `;
    }
    return `
      <svg viewBox="0 0 540 245" width="520" height="235" aria-label="軟性與硬性清潔劑結構對照圖">
        <defs>
          <radialGradient id="headGrad2" cx="35%" cy="35%" r="65%">
            <stop offset="0%" stop-color="#bae6fd" />
            <stop offset="60%" stop-color="#2563eb" />
            <stop offset="100%" stop-color="#1e3a8a" />
          </radialGradient>
        </defs>
        <!-- 上排：軟性（直鏈） -->
        <text x="14" y="24" font-size="14" font-weight="800" fill="#059669">① 軟性清潔劑（本題附圖：無支鏈直鏈 → 易被細菌分解）</text>
        <polyline
          points="36,64 60,46 84,64 108,46 132,64 156,46 180,64 204,46 228,64 252,46 276,64 300,46 324,64 348,46 370,60"
          fill="none" stroke="#0d9488" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"
        />
        <circle cx="394" cy="58" r="20" fill="url(#headGrad2)" stroke="#1d4ed8" stroke-width="2" />
        <text x="394" y="63" font-size="14" font-weight="800" fill="#ffffff" text-anchor="middle">－</text>
        <text x="200" y="96" font-size="12.5" font-weight="700" fill="#0d9488" text-anchor="middle">甲：親油端（直鏈長碳鏈，約 12～19 個碳）</text>
        <text x="415" y="96" font-size="12.5" font-weight="700" fill="#2563eb" text-anchor="middle">乙：親水端（帶負電）</text>

        <line x1="16" y1="118" x2="524" y2="118" stroke="currentColor" stroke-opacity="0.18" stroke-dasharray="5,5" />

        <!-- 下排：硬性（支鏈） -->
        <text x="14" y="144" font-size="14" font-weight="800" fill="#e11d48">② 硬性清潔劑（第32題考點：含支鏈 → 難被細菌分解）</text>
        <polyline
          points="36,188 66,170 96,188 126,170 156,188 186,170 216,188 246,170 276,188 306,170 336,188 368,176"
          fill="none" stroke="#e11d48" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"
        />
        <!-- 支鏈 -->
        <line x1="96" y1="188" x2="96" y2="214" stroke="#e11d48" stroke-width="3" stroke-linecap="round" />
        <line x1="156" y1="188" x2="170" y2="212" stroke="#e11d48" stroke-width="3" stroke-linecap="round" />
        <line x1="216" y1="188" x2="216" y2="214" stroke="#e11d48" stroke-width="3" stroke-linecap="round" />
        <line x1="276" y1="188" x2="262" y2="212" stroke="#e11d48" stroke-width="3" stroke-linecap="round" />
        <circle cx="394" cy="180" r="20" fill="url(#headGrad2)" stroke="#1d4ed8" stroke-width="2" />
        <text x="394" y="185" font-size="14" font-weight="800" fill="#ffffff" text-anchor="middle">－</text>
        <text x="195" y="234" font-size="12.5" font-weight="700" fill="#e11d48" text-anchor="middle">含分支碳鏈（如支鏈烷基苯磺酸鈉 ABS）</text>
      </svg>
    `;
  }

  /* =========================
     主題與導覽控制
     ========================= */
  function applyTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    const btn = document.getElementById('btn-theme-toggle');
    btn.textContent = theme === 'dark' ? '☀️ 淺色' : '🌙 深色';
  }

  function updateNavBadges() {
    const badge = document.getElementById('nav-wrong-badge');
    const count = appState.wrongBook.length;
    badge.textContent = count;
    badge.hidden = count === 0;
  }

  function switchView(viewId) {
    if (!VIEW_TITLES[viewId]) return;
    runtime.currentView = viewId;

    document.querySelectorAll('.nav-item').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.view === viewId);
    });
    document.querySelectorAll('.view-section').forEach(sec => {
      sec.classList.toggle('active', sec.id === `view-${viewId}`);
    });
    document.getElementById('page-title').textContent = VIEW_TITLES[viewId];

    // 關閉手機版側欄
    document.getElementById('sidebar').classList.remove('open');
    document.getElementById('sidebar-backdrop').classList.remove('open');

    if (viewId === 'dashboard') renderDashboard();
    if (viewId === 'practice') renderPractice();
    if (viewId === 'exam') renderExam();
    if (viewId === 'flashcards') renderFlashcards();
    if (viewId === 'wrongbook') renderWrongBook();
    if (viewId === 'guides') renderGuides();
  }

  /* =========================
     1. 總覽儀表板
     ========================= */
  function renderDashboard() {
    const totalQ = DATA.questions.length;
    const practicedIds = Object.keys(appState.history).map(Number);
    const practicedCount = practicedIds.length;
    let totalAttempts = 0;
    let totalCorrect = 0;
    practicedIds.forEach(id => {
      const h = appState.history[id];
      totalAttempts += h.attempts || 0;
      totalCorrect += h.correct || 0;
    });
    const accuracy = totalAttempts > 0 ? Math.round((totalCorrect / totalAttempts) * 100) : 0;
    const bestExam = appState.examHistory.reduce((max, item) => Math.max(max, item.score), 0);

    const topicRowsHtml = DATA.topics.map(topic => {
      const qIds = topic.questionIds;
      let mastered = 0;
      qIds.forEach(id => {
        if (appState.history[id] && appState.history[id].lastCorrect) mastered++;
      });
      const pct = Math.round((mastered / qIds.length) * 100);
      return `
        <div class="topic-progress-item" data-jump-topic="${topic.id}" title="點擊立即練習本單元">
          <div class="topic-progress-head">
            <span>${topic.icon} ${topic.name} <small style="color:var(--text-subtle); font-weight:500;">(${qIds.length}題)</small></span>
            <span style="color:${topic.color};">${mastered} / ${qIds.length} 題掌握 (${pct}%)</span>
          </div>
          <div class="progress-track">
            <div class="progress-fill" style="width:${pct}%; background:${topic.color};"></div>
          </div>
        </div>
      `;
    }).join('');

    const recentExamsHtml = appState.examHistory.length === 0
      ? `<p style="color:var(--text-subtle); font-size:14px;">尚無模擬考紀錄。建議直接挑戰「仿真模擬段考」，熟悉 35 題／70 分的完整節奏！</p>`
      : appState.examHistory.slice(0, 5).map(ex => {
          const pct100 = Math.round((ex.score / ex.maxScore) * 100);
          return `
            <div style="display:flex; justify-content:space-between; align-items:center; padding:10px 12px; border:1px solid var(--border); border-radius:10px; margin-bottom:8px; background:var(--bg-surface-2);">
              <div>
                <div style="font-weight:800; font-size:14px;">${ex.score} / ${ex.maxScore} 分 <span class="pill">換算 ${pct100} 分</span></div>
                <div style="font-size:12px; color:var(--text-subtle);">${ex.date}｜答對 ${ex.correctCount}/${ex.totalCount} 題｜用時 ${formatDuration(ex.durationSec)}</div>
              </div>
            </div>
          `;
        }).join('');

    document.getElementById('dashboard-content').innerHTML = `
      <div class="hero-banner">
        <div>
          <h1>${DATA.meta.title}</h1>
          <p>${DATA.meta.subtitle}｜收錄完整 35 題單選題、逐選項解析、Q25 分子圖解、記憶卡與錯題特訓</p>
        </div>
        <div class="hero-cta">
          <button id="dash-start-practice" class="btn btn-primary btn-lg" type="button">✏️ 開始刷題練習</button>
          <button id="dash-start-exam" class="btn btn-cobalt btn-lg" type="button">📝 模擬段考 (70分)</button>
          ${appState.wrongBook.length > 0 ? `<button id="dash-start-wrong" class="btn btn-rose btn-lg" type="button">🔥 消滅錯題 (${appState.wrongBook.length})</button>` : ''}
        </div>
      </div>

      <div class="kpi-grid">
        <div class="kpi-card">
          <div class="kpi-label">已練習題庫覆蓋</div>
          <div class="kpi-value" style="color:var(--primary);">${practicedCount} <small style="font-size:15px; color:var(--text-subtle);">/ ${totalQ}</small></div>
          <div class="kpi-sub">完成度 ${Math.round((practicedCount / totalQ) * 100)}%</div>
        </div>
        <div class="kpi-card">
          <div class="kpi-label">累計答題正確率</div>
          <div class="kpi-value" style="color:var(--emerald);">${accuracy}%</div>
          <div class="kpi-sub">共作答 ${totalAttempts} 次</div>
        </div>
        <div class="kpi-card">
          <div class="kpi-label">待複習錯題數</div>
          <div class="kpi-value" style="color:var(--rose);">${appState.wrongBook.length}</div>
          <div class="kpi-sub">答錯自動收錄，答對可移出</div>
        </div>
        <div class="kpi-card">
          <div class="kpi-label">模擬考最高成績</div>
          <div class="kpi-value" style="color:var(--cobalt);">${bestExam} <small style="font-size:15px; color:var(--text-subtle);">/ 70 分</small></div>
          <div class="kpi-sub">最高連對紀錄：${appState.bestStreak} 題</div>
        </div>
      </div>

      <div class="dash-two-col">
        <div class="card">
          <div class="card-title">
            <span>🎯 五大考點單元掌握度</span>
            <span style="font-size:12px; color:var(--text-subtle); font-weight:500;">點擊單元直接練習</span>
          </div>
          ${topicRowsHtml}
        </div>
        <div class="card">
          <div class="card-title">
            <span>📈 近期模擬段考紀錄</span>
            <button id="dash-open-guides" class="btn btn-sm" type="button">📖 看考前重點</button>
          </div>
          ${recentExamsHtml}
          <div style="margin-top:14px; padding:12px; border-radius:10px; background:var(--amber-soft); font-size:13px;">
            <strong>💡 考前衝刺建議：</strong><br/>
            先刷過一輪題庫並把「錯題本」清零，再利用「翻轉記憶卡」速記纖維燃燒味、維生素缺乏症與皂化反應，最後測一次 70 分模擬考！
          </div>
        </div>
      </div>
    `;

    document.getElementById('dash-start-practice').addEventListener('click', () => switchView('practice'));
    document.getElementById('dash-start-exam').addEventListener('click', () => switchView('exam'));
    document.getElementById('dash-open-guides').addEventListener('click', () => switchView('guides'));
    const wrongBtn = document.getElementById('dash-start-wrong');
    if (wrongBtn) wrongBtn.addEventListener('click', () => startWrongPractice());

    document.querySelectorAll('[data-jump-topic]').forEach(el => {
      el.addEventListener('click', () => {
        document.getElementById('practice-topic').value = el.dataset.jumpTopic;
        document.getElementById('practice-status').value = 'all';
        applyPracticeFilters();
        switchView('practice');
      });
    });
  }

  /* =========================
     2. 智慧刷題練習
     ========================= */
  function initPracticeControls() {
    const topicSel = document.getElementById('practice-topic');
    topicSel.innerHTML = `<option value="all">全部單元（35題）</option>` +
      DATA.topics.map(t => `<option value="${t.id}">${t.icon} ${t.name}（${t.questionIds.length}題）</option>`).join('');

    topicSel.addEventListener('change', applyPracticeFilters);
    document.getElementById('practice-status').addEventListener('change', applyPracticeFilters);
    document.getElementById('practice-search').addEventListener('input', applyPracticeFilters);
    document.getElementById('chk-shuffle-q').addEventListener('change', (e) => {
      runtime.practiceShuffleQ = e.target.checked;
      applyPracticeFilters();
    });
    document.getElementById('chk-shuffle-opt').addEventListener('change', (e) => {
      runtime.practiceShuffleOpt = e.target.checked;
      runtime.practiceOptOrder = {};
      renderPractice();
    });
    document.getElementById('btn-practice-reset-filter').addEventListener('click', () => {
      document.getElementById('practice-topic').value = 'all';
      document.getElementById('practice-status').value = 'all';
      document.getElementById('practice-search').value = '';
      document.getElementById('chk-shuffle-q').checked = false;
      document.getElementById('chk-shuffle-opt').checked = false;
      runtime.practiceShuffleQ = false;
      runtime.practiceShuffleOpt = false;
      runtime.practiceOptOrder = {};
      applyPracticeFilters();
    });

    const noteInput = document.getElementById('practice-note-input');
    noteInput.addEventListener('input', () => {
      const qId = runtime.practiceList[runtime.practiceIndex];
      if (!qId) return;
      const val = noteInput.value.trim();
      if (val) appState.notes[qId] = noteInput.value;
      else delete appState.notes[qId];
      saveState();
      const hint = document.getElementById('note-saved-hint');
      hint.textContent = '已自動儲存';
      clearTimeout(noteInput._hintTimer);
      noteInput._hintTimer = setTimeout(() => { hint.textContent = ''; }, 1500);
    });
  }

  function applyPracticeFilters() {
    const topicVal = document.getElementById('practice-topic').value;
    const statusVal = document.getElementById('practice-status').value;
    const keyword = document.getElementById('practice-search').value.trim().toLowerCase();

    let list = DATA.questions.filter(q => {
      if (topicVal !== 'all' && q.topic !== topicVal) return false;
      if (statusVal === 'unanswered' && appState.history[q.id]) return false;
      if (statusVal === 'wrong' && !appState.wrongBook.includes(q.id)) return false;
      if (statusVal === 'bookmarked' && !appState.bookmarks.includes(q.id)) return false;
      if (keyword) {
        const hay = [q.stem, q.options.A, q.options.B, q.options.C, q.options.D, q.explanation, q.tip, ...q.tags].join(' ').toLowerCase();
        if (!hay.includes(keyword)) return false;
      }
      return true;
    }).map(q => q.id);

    if (runtime.practiceShuffleQ) {
      list = shuffleArray(list);
    }

    runtime.practiceList = list;
    runtime.practiceIndex = 0;
    renderPractice();
  }

  function jumpToPracticeQuestion(qId) {
    if (!runtime.practiceList.includes(qId)) {
      document.getElementById('practice-topic').value = 'all';
      document.getElementById('practice-status').value = 'all';
      document.getElementById('practice-search').value = '';
      runtime.practiceList = DATA.questions.map(q => q.id);
    }
    runtime.practiceIndex = runtime.practiceList.indexOf(qId);
    switchView('practice');
  }

  function startWrongPractice() {
    if (appState.wrongBook.length === 0) {
      showToast('目前錯題本是空的，太棒了！');
      return;
    }
    document.getElementById('practice-topic').value = 'all';
    document.getElementById('practice-status').value = 'wrong';
    document.getElementById('practice-search').value = '';
    applyPracticeFilters();
    switchView('practice');
  }

  function renderPractice() {
    const area = document.getElementById('practice-question-area');
    const grid = document.getElementById('practice-nav-grid');
    const pill = document.getElementById('practice-count-pill');
    const noteInput = document.getElementById('practice-note-input');

    const list = runtime.practiceList;
    if (list.length === 0) {
      pill.textContent = '0 / 35';
      grid.innerHTML = '';
      noteInput.value = '';
      noteInput.disabled = true;
      area.innerHTML = `
        <div class="question-card" style="text-align:center; padding:42px 24px;">
          <div style="font-size:36px; margin-bottom:10px;">🔍</div>
          <h3 style="margin:0 0 8px;">沒有符合目前篩選條件的題目</h3>
          <p style="color:var(--text-subtle); margin-bottom:18px;">請嘗試更換單元、狀態篩選或清除關鍵字。</p>
          <button id="btn-empty-reset" class="btn btn-primary" type="button">顯示全部 35 題</button>
        </div>
      `;
      document.getElementById('btn-empty-reset').addEventListener('click', () => {
        document.getElementById('btn-practice-reset-filter').click();
      });
      return;
    }

    noteInput.disabled = false;
    if (runtime.practiceIndex >= list.length) runtime.practiceIndex = 0;
    const qId = list[runtime.practiceIndex];
    const q = QUESTION_MAP[qId];
    const topic = TOPIC_MAP[q.topic];
    const isBookmarked = appState.bookmarks.includes(qId);
    const selectedOrig = runtime.practiceAnswers[qId] || null;
    const dispMap = getOptionDisplayMap(qId, runtime.practiceShuffleOpt, runtime.practiceOptOrder);

    pill.textContent = `${runtime.practiceIndex + 1} / ${list.length}`;
    noteInput.value = appState.notes[qId] || '';

    const diagramHtml = q.hasDiagram ? `
      <div class="diagram-box">
        <div id="q25-svg-wrap">${renderQ25Svg(runtime.q25Annotated)}</div>
        <div class="diagram-caption">
          <span>${q.diagramCaption}</span>
          <button id="btn-toggle-q25-annotate" class="btn btn-sm" type="button">
            ${runtime.q25Annotated ? '📐 切換回原卷示意圖' : '🔬 顯示標註與軟/硬性對照圖'}
          </button>
        </div>
      </div>
    ` : '';

    const optionsHtml = ['A', 'B', 'C', 'D'].map(dispKey => {
      const origKey = dispMap[dispKey];
      let cls = 'option-btn';
      if (selectedOrig) {
        if (origKey === q.answer) cls += ' correct';
        else if (origKey === selectedOrig) cls += ' wrong';
      }
      return `
        <button class="${cls}" data-disp-key="${dispKey}" data-orig-key="${origKey}" type="button">
          <span class="option-letter">${dispKey}</span>
          <span>${escapeHtml(q.options[origKey])}</span>
        </button>
      `;
    }).join('');

    let expHtml = '';
    if (selectedOrig) {
      const isCorrect = selectedOrig === q.answer;
      // 找出正確選項目前顯示的代號
      const correctDispKey = ['A', 'B', 'C', 'D'].find(k => dispMap[k] === q.answer) || q.answer;
      const optListHtml = ['A', 'B', 'C', 'D'].map(dispKey => {
        const origKey = dispMap[dispKey];
        const isAns = origKey === q.answer;
        return `<li class="${isAns ? 'is-ans' : ''}"><strong>(${dispKey})</strong> ${escapeHtml(q.optionExplanations[origKey])}</li>`;
      }).join('');

      const relatedBtns = (q.relatedIds || []).map(rid =>
        `<button class="btn btn-sm" data-jump-qid="${rid}" type="button">第 ${rid} 題</button>`
      ).join('');

      expHtml = `
        <div class="explanation-box">
          <div style="display:flex; justify-content:space-between; align-items:center; gap:8px; flex-wrap:wrap;">
            <div class="explanation-status ${isCorrect ? 'is-correct' : 'is-wrong'}">
              ${isCorrect ? '✅ 答對了！' : `❌ 答錯了！正確答案為 (${correctDispKey})`}
              ${runtime.practiceShuffleOpt ? `<small style="font-weight:500; color:var(--text-subtle);">（原卷選項 ${q.answer}）</small>` : ''}
            </div>
            <button id="btn-toggle-exp" class="btn btn-sm" type="button">${runtime.practiceShowExp ? '收合解析 (S)' : '展開解析 (S)'}</button>
          </div>
          ${runtime.practiceShowExp ? `
            <p style="margin:6px 0 10px; font-size:14.5px;">${escapeHtml(q.explanation)}</p>
            <ul class="opt-breakdown">${optListHtml}</ul>
            <div class="tip-callout">💡 速記口訣：${escapeHtml(q.tip)}</div>
            ${relatedBtns ? `<div class="related-row"><span>🔗 相關連動題：</span>${relatedBtns}</div>` : ''}
          ` : ''}
        </div>
      `;
    }

    const inWrongBook = appState.wrongBook.includes(qId);

    area.innerHTML = `
      <div class="question-card">
        <div class="q-meta-bar">
          <div style="display:flex; align-items:center; gap:8px; flex-wrap:wrap;">
            <span class="q-number-badge">原卷第 ${q.id} 題</span>
            <span class="pill" style="color:${topic.color};">${topic.icon} ${topic.name}</span>
            ${inWrongBook ? `<span class="pill" style="background:var(--rose-soft); color:var(--rose);">錯題本收錄中</span>` : ''}
          </div>
          <div style="display:flex; gap:8px; flex-wrap:wrap;">
            <button id="btn-practice-paper-ref" class="btn btn-sm" type="button">📄 看原卷</button>
            <button id="btn-practice-bookmark" class="btn btn-sm ${isBookmarked ? 'btn-primary' : ''}" type="button">
              ${isBookmarked ? '★ 已收藏 (F)' : '☆ 收藏 (F)'}
            </button>
          </div>
        </div>

        <h2 class="q-stem">${formatStem(q)}</h2>
        ${diagramHtml}
        <div class="options-list">${optionsHtml}</div>
        ${expHtml}

        <div class="q-nav-footer">
          <div style="display:flex; gap:8px;">
            <button id="btn-prev-q" class="btn" type="button" ${runtime.practiceIndex === 0 ? 'disabled' : ''}>← 上一題</button>
            <button id="btn-next-q" class="btn btn-primary" type="button" ${runtime.practiceIndex >= list.length - 1 ? 'disabled' : ''}>下一題 →</button>
          </div>
          <div style="display:flex; gap:8px; align-items:center;">
            ${selectedOrig ? `<button id="btn-retry-q" class="btn btn-sm" type="button">↻ 重做本題</button>` : ''}
            ${inWrongBook ? `<button id="btn-remove-wrong-inline" class="btn btn-sm" type="button">✓ 移出錯題本</button>` : ''}
          </div>
        </div>
      </div>
    `;

    // 綁定選項點擊
    area.querySelectorAll('.option-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        if (runtime.practiceAnswers[qId]) return; // 需點「重做本題」才能重選
        submitPracticeAnswer(qId, btn.dataset.origKey);
      });
    });

    // Q25 示意圖切換
    const q25Btn = document.getElementById('btn-toggle-q25-annotate');
    if (q25Btn) {
      q25Btn.addEventListener('click', () => {
        runtime.q25Annotated = !runtime.q25Annotated;
        renderPractice();
      });
    }

    // 收藏與解析收合
    document.getElementById('btn-practice-bookmark').addEventListener('click', () => toggleBookmark(qId));
    document.getElementById('btn-practice-paper-ref').addEventListener('click', () => openPaperModal(qId <= 20 ? 0 : 1));
    document.getElementById('btn-prev-q').addEventListener('click', () => movePractice(-1));
    document.getElementById('btn-next-q').addEventListener('click', () => movePractice(1));

    const expToggle = document.getElementById('btn-toggle-exp');
    if (expToggle) expToggle.addEventListener('click', () => {
      runtime.practiceShowExp = !runtime.practiceShowExp;
      renderPractice();
    });

    const retryBtn = document.getElementById('btn-retry-q');
    if (retryBtn) retryBtn.addEventListener('click', () => {
      delete runtime.practiceAnswers[qId];
      if (runtime.practiceShuffleOpt) delete runtime.practiceOptOrder[qId];
      renderPractice();
    });

    const removeWrongBtn = document.getElementById('btn-remove-wrong-inline');
    if (removeWrongBtn) removeWrongBtn.addEventListener('click', () => {
      appState.wrongBook = appState.wrongBook.filter(id => id !== qId);
      saveState();
      showToast(`已將第 ${qId} 題移出錯題本`);
      renderPractice();
    });

    area.querySelectorAll('[data-jump-qid]').forEach(b => {
      b.addEventListener('click', () => jumpToPracticeQuestion(Number(b.dataset.jumpQid)));
    });

    // 右側題號網格
    grid.innerHTML = list.map((id, idx) => {
      const h = appState.history[id];
      const sesAns = runtime.practiceAnswers[id];
      let stateCls = '';
      if (sesAns) {
        stateCls = sesAns === QUESTION_MAP[id].answer ? 'state-correct' : 'state-wrong';
      } else if (h) {
        stateCls = h.lastCorrect ? 'state-correct' : 'state-wrong';
      }
      const curCls = idx === runtime.practiceIndex ? 'current' : '';
      const flagCls = appState.bookmarks.includes(id) ? 'flagged' : '';
      return `<button class="q-grid-btn ${stateCls} ${curCls} ${flagCls}" data-pidx="${idx}" type="button">${id}</button>`;
    }).join('');

    grid.querySelectorAll('[data-pidx]').forEach(btn => {
      btn.addEventListener('click', () => {
        runtime.practiceIndex = Number(btn.dataset.pidx);
        renderPractice();
      });
    });
  }

  function submitPracticeAnswer(qId, origKey) {
    const q = QUESTION_MAP[qId];
    const isCorrect = origKey === q.answer;
    runtime.practiceAnswers[qId] = origKey;

    if (!appState.history[qId]) {
      appState.history[qId] = { attempts: 0, correct: 0, wrong: 0, lastAnswer: null, lastCorrect: false };
    }
    const h = appState.history[qId];
    h.attempts += 1;
    if (isCorrect) {
      h.correct += 1;
      appState.streak += 1;
      if (appState.streak > appState.bestStreak) appState.bestStreak = appState.streak;
    } else {
      h.wrong += 1;
      appState.streak = 0;
      if (!appState.wrongBook.includes(qId)) {
        appState.wrongBook.push(qId);
      }
    }
    h.lastAnswer = origKey;
    h.lastCorrect = isCorrect;
    saveState();
    renderPractice();
  }

  function movePractice(delta) {
    const next = runtime.practiceIndex + delta;
    if (next >= 0 && next < runtime.practiceList.length) {
      runtime.practiceIndex = next;
      renderPractice();
    }
  }

  function toggleBookmark(qId) {
    if (appState.bookmarks.includes(qId)) {
      appState.bookmarks = appState.bookmarks.filter(id => id !== qId);
      showToast(`已取消收藏第 ${qId} 題`);
    } else {
      appState.bookmarks.push(qId);
      showToast(`已收藏第 ${qId} 題`);
    }
    saveState();
    if (runtime.currentView === 'practice') renderPractice();
    if (runtime.currentView === 'wrongbook') renderWrongBook();
  }

  /* =========================
     3. 仿真模擬段考 (35題 / 70分)
     ========================= */
  function renderExam() {
    const container = document.getElementById('exam-container');
    if (runtime.examPhase === 'setup') {
      container.innerHTML = `
        <div class="card" style="max-width:680px; margin:0 auto;">
          <h2 style="margin-top:0;">📝 仿真模擬段考設定</h2>
          <p style="color:var(--text-muted); font-size:14.5px;">
            完全比照原卷規格：<strong>單選題共 35 題，每題 2 分，總分 70 分</strong>（交卷後系統將同步換算百分制並分析各單元得分率，錯題將自動收入錯題本）。
          </p>
          <div style="display:grid; gap:14px; margin:20px 0;">
            <label style="display:flex; flex-direction:column; gap:6px; font-weight:700; font-size:14px;">
              測驗時間限制
              <select id="exam-duration-sel" class="select">
                <option value="25">25 分鐘（快速衝刺）</option>
                <option value="35" selected>35 分鐘（建議段考配速）</option>
                <option value="45">45 分鐘（充裕作答）</option>
                <option value="0">不限時間（自由計時）</option>
              </select>
            </label>
            <label class="toggle-chip" style="width:fit-content;">
              <input id="exam-shuffle-q" type="checkbox" /> 題目順序隨機打亂
            </label>
            <label class="toggle-chip" style="width:fit-content;">
              <input id="exam-shuffle-opt" type="checkbox" /> 選項順序隨機打亂
            </label>
          </div>
          <div style="display:flex; gap:10px; flex-wrap:wrap;">
            <button id="btn-start-mock-exam" class="btn btn-cobalt btn-lg" type="button">🚀 開始正式計時測驗</button>
          </div>
        </div>
      `;
      document.getElementById('btn-start-mock-exam').addEventListener('click', startMockExam);
      return;
    }

    if (runtime.examPhase === 'running') {
      const qId = runtime.examOrder[runtime.examIndex];
      const q = QUESTION_MAP[qId];
      const dispMap = getOptionDisplayMap(qId, runtime.examConfig.shuffleOpt, runtime.examOptOrder);
      const selectedOrig = runtime.examAnswers[qId] || null;
      const answeredCount = Object.keys(runtime.examAnswers).length;
      const isFlagged = Boolean(runtime.examFlags[qId]);

      const timeDisplay = runtime.examConfig.minutes > 0
        ? `剩餘時間：${formatDuration(runtime.examRemainSec)}`
        : `已用時間：${formatDuration(runtime.examElapsedSec)}`;
      const lowTimeCls = (runtime.examConfig.minutes > 0 && runtime.examRemainSec <= 180) ? 'low-time' : '';

      const optionsHtml = ['A', 'B', 'C', 'D'].map(dispKey => {
        const origKey = dispMap[dispKey];
        const selCls = selectedOrig === origKey ? 'selected' : '';
        return `
          <button class="option-btn ${selCls}" data-exam-orig="${origKey}" type="button">
            <span class="option-letter">${dispKey}</span>
            <span>${escapeHtml(q.options[origKey])}</span>
          </button>
        `;
      }).join('');

      const gridHtml = runtime.examOrder.map((id, idx) => {
        const clsAns = runtime.examAnswers[id] ? 'state-answered' : '';
        const clsCur = idx === runtime.examIndex ? 'current' : '';
        const clsFlag = runtime.examFlags[id] ? 'flagged' : '';
        return `<button class="q-grid-btn ${clsAns} ${clsCur} ${clsFlag}" data-eidx="${idx}" type="button">${idx + 1}</button>`;
      }).join('');

      container.innerHTML = `
        <div class="exam-timer-bar">
          <div style="display:flex; align-items:center; gap:12px; flex-wrap:wrap;">
            <span class="timer-clock ${lowTimeCls}" id="exam-clock-display">${timeDisplay}</span>
            <span class="pill">已作答 ${answeredCount} / 35 題</span>
          </div>
          <div style="display:flex; gap:8px;">
            <button id="btn-exam-abort" class="btn btn-sm" type="button">放棄測驗</button>
            <button id="btn-exam-submit-open" class="btn btn-primary btn-sm" type="button">✅ 交卷計分</button>
          </div>
        </div>

        <div class="practice-layout">
          <div class="question-card">
            <div class="q-meta-bar">
              <span class="q-number-badge">第 ${runtime.examIndex + 1} / 35 題（原卷第 ${q.id} 題｜2分）</span>
              <button id="btn-exam-flag" class="btn btn-sm ${isFlagged ? 'btn-primary' : ''}" type="button">
                ${isFlagged ? '🚩 已標記待檢查 (F)' : '🏳️ 標記待檢查 (F)'}
              </button>
            </div>
            <h2 class="q-stem">${formatStem(q)}</h2>
            ${q.hasDiagram ? `<div class="diagram-box">${renderQ25Svg(false)}<div class="diagram-caption"><span>${q.diagramCaption}</span></div></div>` : ''}
            <div class="options-list">${optionsHtml}</div>
            <div class="q-nav-footer">
              <div style="display:flex; gap:8px;">
                <button id="btn-exam-prev" class="btn" type="button" ${runtime.examIndex === 0 ? 'disabled' : ''}>← 上一題</button>
                <button id="btn-exam-next" class="btn btn-primary" type="button" ${runtime.examIndex >= 34 ? 'disabled' : ''}>下一題 →</button>
              </div>
              <span style="font-size:12.5px; color:var(--text-subtle);">作答時不顯示答案，交卷後統一閱卷</span>
            </div>
          </div>

          <div class="card">
            <div class="card-title"><span>答案卡進度</span></div>
            <div class="q-grid">${gridHtml}</div>
            <div style="margin-top:12px; font-size:12px; color:var(--text-subtle); display:flex; gap:10px; flex-wrap:wrap;">
              <span>🔵 已填答</span>
              <span>⚪ 未填答</span>
              <span>🟡 待檢查</span>
            </div>
          </div>
        </div>
      `;

      container.querySelectorAll('[data-exam-orig]').forEach(btn => {
        btn.addEventListener('click', () => {
          runtime.examAnswers[qId] = btn.dataset.examOrig;
          renderExam();
        });
      });
      container.querySelectorAll('[data-eidx]').forEach(btn => {
        btn.addEventListener('click', () => {
          runtime.examIndex = Number(btn.dataset.eidx);
          renderExam();
        });
      });
      document.getElementById('btn-exam-flag').addEventListener('click', () => {
        if (runtime.examFlags[qId]) delete runtime.examFlags[qId];
        else runtime.examFlags[qId] = true;
        renderExam();
      });
      document.getElementById('btn-exam-prev').addEventListener('click', () => {
        if (runtime.examIndex > 0) { runtime.examIndex--; renderExam(); }
      });
      document.getElementById('btn-exam-next').addEventListener('click', () => {
        if (runtime.examIndex < 34) { runtime.examIndex++; renderExam(); }
      });
      document.getElementById('btn-exam-abort').addEventListener('click', () => {
        stopExamTimer();
        runtime.examPhase = 'setup';
        renderExam();
      });
      document.getElementById('btn-exam-submit-open').addEventListener('click', openExamSubmitModal);
      return;
    }

    if (runtime.examPhase === 'report' && runtime.examReport) {
      const r = runtime.examReport;
      const pct100 = Math.round((r.score / r.maxScore) * 100);
      const topicBars = DATA.topics.map(t => {
        const ts = r.topicStats[t.id];
        const p = Math.round((ts.correct / ts.total) * 100);
        return `
          <div style="margin-bottom:10px;">
            <div style="display:flex; justify-content:space-between; font-size:13.5px; font-weight:700; margin-bottom:4px;">
              <span>${t.icon} ${t.name}</span>
              <span>${ts.correct} / ${ts.total} 題 (${p}%)</span>
            </div>
            <div class="progress-track"><div class="progress-fill" style="width:${p}%; background:${t.color};"></div></div>
          </div>
        `;
      }).join('');

      const filteredItems = r.items.filter(it => {
        if (runtime.examReportFilter === 'wrong') return !it.isCorrect;
        if (runtime.examReportFilter === 'flagged') return it.flagged;
        return true;
      });

      const reviewHtml = filteredItems.map(it => {
        const q = QUESTION_MAP[it.qId];
        return `
          <div class="list-item-card" style="border-left:4px solid ${it.isCorrect ? 'var(--emerald)' : 'var(--rose)'};">
            <div style="display:flex; justify-content:space-between; align-items:center; gap:8px; flex-wrap:wrap; margin-bottom:6px;">
              <strong>第 ${it.orderNo} 題（原卷第 ${q.id} 題）${it.flagged ? '🚩' : ''}</strong>
              <span class="pill" style="background:${it.isCorrect ? 'var(--emerald-soft)' : 'var(--rose-soft)'}; color:${it.isCorrect ? 'var(--emerald)' : 'var(--rose)'};">
                ${it.isCorrect ? '✓ 正確 (+2分)' : `✗ 錯誤｜你選：${it.userOrig || '未答'} ｜正解：${q.answer}`}
              </span>
            </div>
            <div style="font-weight:700; margin-bottom:8px;">${formatStem(q)}</div>
            <div style="font-size:13.5px; color:var(--text-muted); background:var(--bg-surface-2); padding:10px 12px; border-radius:8px;">
              <strong>正解 (${q.answer}) ${escapeHtml(q.options[q.answer])}</strong><br/>
              ${escapeHtml(q.explanation)}
            </div>
          </div>
        `;
      }).join('') || `<p style="color:var(--text-subtle);">此篩選分類下沒有題目。</p>`;

      container.innerHTML = `
        <div class="card" style="margin-bottom:18px;">
          <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:16px;">
            <div>
              <span class="pill" style="background:var(--cobalt-soft); color:var(--cobalt);">模擬段考成績單</span>
              <h2 style="margin:8px 0 4px; font-size:28px;">${r.score} <small style="font-size:16px; color:var(--text-subtle);">/ 70 分（換算百分制 ${pct100} 分）</small></h2>
              <p style="margin:0; color:var(--text-muted); font-size:14px;">答對 ${r.correctCount} / 35 題｜總耗時 ${formatDuration(r.durationSec)}｜錯題已自動同步至錯題本</p>
            </div>
            <div style="display:flex; gap:10px; flex-wrap:wrap;">
              <button id="btn-exam-retry" class="btn btn-cobalt" type="button">🔄 再測一次</button>
              <button id="btn-exam-to-wrong" class="btn btn-rose" type="button">🔥 檢視錯題本 (${appState.wrongBook.length})</button>
            </div>
          </div>
          <hr style="border:none; border-top:1px solid var(--border); margin:18px 0;" />
          <h3 style="margin:0 0 12px; font-size:15px;">各單元診斷分析</h3>
          ${topicBars}
        </div>

        <div class="card">
          <div class="card-title">
            <span>逐題檢討報告</span>
            <div class="tabs-row" style="margin:0;">
              <button class="tab-btn ${runtime.examReportFilter === 'all' ? 'active' : ''}" data-rf="all" type="button">全部 (35)</button>
              <button class="tab-btn ${runtime.examReportFilter === 'wrong' ? 'active' : ''}" data-rf="wrong" type="button">只看錯題 (${35 - r.correctCount})</button>
              <button class="tab-btn ${runtime.examReportFilter === 'flagged' ? 'active' : ''}" data-rf="flagged" type="button">待檢查題目</button>
            </div>
          </div>
          ${reviewHtml}
        </div>
      `;

      document.getElementById('btn-exam-retry').addEventListener('click', () => {
        runtime.examPhase = 'setup';
        renderExam();
      });
      document.getElementById('btn-exam-to-wrong').addEventListener('click', () => switchView('wrongbook'));
      container.querySelectorAll('[data-rf]').forEach(btn => {
        btn.addEventListener('click', () => {
          runtime.examReportFilter = btn.dataset.rf;
          renderExam();
        });
      });
    }
  }

  function startMockExam() {
    const minutes = Number(document.getElementById('exam-duration-sel').value);
    const shuffleQ = document.getElementById('exam-shuffle-q').checked;
    const shuffleOpt = document.getElementById('exam-shuffle-opt').checked;

    let order = DATA.questions.map(q => q.id);
    if (shuffleQ) order = shuffleArray(order);

    runtime.examConfig = { minutes, shuffleQ, shuffleOpt };
    runtime.examOrder = order;
    runtime.examIndex = 0;
    runtime.examAnswers = {};
    runtime.examFlags = {};
    runtime.examOptOrder = {};
    runtime.examRemainSec = minutes * 60;
    runtime.examElapsedSec = 0;
    runtime.examPhase = 'running';

    stopExamTimer();
    runtime.examTimerId = setInterval(() => {
      runtime.examElapsedSec += 1;
      if (runtime.examConfig.minutes > 0) {
        runtime.examRemainSec -= 1;
        if (runtime.examRemainSec <= 0) {
          stopExamTimer();
          showToast('時間到，系統已自動交卷計分！');
          finishMockExam();
          return;
        }
      }
      const clock = document.getElementById('exam-clock-display');
      if (clock) {
        clock.textContent = runtime.examConfig.minutes > 0
          ? `剩餘時間：${formatDuration(runtime.examRemainSec)}`
          : `已用時間：${formatDuration(runtime.examElapsedSec)}`;
        if (runtime.examConfig.minutes > 0 && runtime.examRemainSec <= 180) {
          clock.classList.add('low-time');
        }
      }
    }, 1000);

    renderExam();
  }

  function stopExamTimer() {
    if (runtime.examTimerId) {
      clearInterval(runtime.examTimerId);
      runtime.examTimerId = null;
    }
  }

  function openExamSubmitModal() {
    const answered = Object.keys(runtime.examAnswers).length;
    const unanswered = 35 - answered;
    const flaggedCount = Object.keys(runtime.examFlags).length;
    document.getElementById('exam-submit-summary').innerHTML = `
      目前已完成 <strong>${answered} / 35</strong> 題，尚有 <strong>${unanswered}</strong> 題未填答、<strong>${flaggedCount}</strong> 題標記待檢查。<br/>
      確定要現在交卷並產生診斷成績單嗎？
    `;
    document.getElementById('modal-exam-submit').classList.add('open');
  }

  function finishMockExam() {
    stopExamTimer();
    document.getElementById('modal-exam-submit').classList.remove('open');

    const topicStats = {};
    DATA.topics.forEach(t => { topicStats[t.id] = { correct: 0, total: t.questionIds.length }; });

    let correctCount = 0;
    const items = runtime.examOrder.map((qId, idx) => {
      const q = QUESTION_MAP[qId];
      const userOrig = runtime.examAnswers[qId] || null;
      const isCorrect = userOrig === q.answer;
      if (isCorrect) {
        correctCount += 1;
        topicStats[q.topic].correct += 1;
      } else if (!appState.wrongBook.includes(qId)) {
        appState.wrongBook.push(qId);
      }

      if (!appState.history[qId]) {
        appState.history[qId] = { attempts: 0, correct: 0, wrong: 0, lastAnswer: null, lastCorrect: false };
      }
      appState.history[qId].attempts += 1;
      if (isCorrect) appState.history[qId].correct += 1;
      else appState.history[qId].wrong += 1;
      appState.history[qId].lastAnswer = userOrig;
      appState.history[qId].lastCorrect = isCorrect;

      return {
        orderNo: idx + 1,
        qId,
        userOrig,
        isCorrect,
        flagged: Boolean(runtime.examFlags[qId])
      };
    });

    const score = correctCount * DATA.meta.pointsPerQuestion;
    const nowStr = new Date().toLocaleString('zh-TW', { hour12: false });

    const report = {
      date: nowStr,
      score,
      maxScore: DATA.meta.totalPoints,
      correctCount,
      totalCount: 35,
      durationSec: runtime.examElapsedSec,
      topicStats,
      items
    };

    appState.examHistory.unshift({
      date: report.date,
      score: report.score,
      maxScore: report.maxScore,
      correctCount: report.correctCount,
      totalCount: report.totalCount,
      durationSec: report.durationSec
    });
    saveState();

    runtime.examReport = report;
    runtime.examReportFilter = 'all';
    runtime.examPhase = 'report';
    renderExam();
  }

  /* =========================
     4. 互動翻轉記憶卡
     ========================= */
  function buildFlashcardDeck(deckType) {
    runtime.fcDeckType = deckType;
    let cards = [];
    if (deckType === 'concept') {
      cards = DATA.conceptCards.slice();
    } else if (deckType === 'questions') {
      cards = DATA.questions.map(q => ({
        id: `q${q.id}`,
        topic: q.topic,
        front: `第 ${q.id} 題｜${q.stem}`,
        hint: `標籤：${q.tags.join('、')}`,
        back: `答案：(${q.answer}) ${q.options[q.answer]}\n\n${q.explanation}\n\n💡 ${q.tip}`,
        relatedIds: [q.id]
      }));
    } else if (deckType === 'wrong') {
      cards = appState.wrongBook.map(id => {
        const q = QUESTION_MAP[id];
        return {
          id: `q${q.id}`,
          topic: q.topic,
          front: `錯題複習 第 ${q.id} 題｜${q.stem}`,
          hint: '試著在心裡回想正確選項與原因',
          back: `答案：(${q.answer}) ${q.options[q.answer]}\n\n${q.explanation}\n\n💡 ${q.tip}`,
          relatedIds: [q.id]
        };
      });
    } else if (deckType.startsWith('topic:')) {
      const tid = deckType.split(':')[1];
      cards = DATA.conceptCards.filter(c => c.topic === tid);
    }

    runtime.fcQueue = cards;
    runtime.fcCurrentIdx = 0;
    runtime.fcFlipped = false;
    runtime.fcDoneCount = 0;
    renderFlashcards();
  }

  function renderFlashcards() {
    const container = document.getElementById('flashcards-container');
    if (runtime.fcQueue.length === 0 && runtime.fcDoneCount === 0 && runtime.fcDeckType === 'concept') {
      runtime.fcQueue = DATA.conceptCards.slice();
    }

    const topicOpts = DATA.topics.map(t => `<option value="topic:${t.id}" ${runtime.fcDeckType === `topic:${t.id}` ? 'selected' : ''}>${t.icon} 觀念卡：${t.name}</option>`).join('');

    const toolbarHtml = `
      <div class="filter-toolbar" style="justify-content:space-between;">
        <div style="display:flex; gap:10px; align-items:center; flex-wrap:wrap;">
          <label style="font-weight:700; font-size:13.5px;">選擇卡組：</label>
          <select id="fc-deck-select" class="select">
            <option value="concept" ${runtime.fcDeckType === 'concept' ? 'selected' : ''}>⭐ 高頻核心觀念卡 (${DATA.conceptCards.length}張)</option>
            <option value="questions" ${runtime.fcDeckType === 'questions' ? 'selected' : ''}>📝 全 35 題考題快閃卡</option>
            <option value="wrong" ${runtime.fcDeckType === 'wrong' ? 'selected' : ''}>🔥 錯題專屬複習卡 (${appState.wrongBook.length}張)</option>
            ${topicOpts}
          </select>
          <button id="btn-fc-shuffle" class="btn btn-sm" type="button">🔀 洗牌重來</button>
        </div>
        <span class="pill">本輪待完成：${runtime.fcQueue.length} 張｜已記住：${runtime.fcDoneCount} 張</span>
      </div>
    `;

    if (runtime.fcQueue.length === 0) {
      container.innerHTML = toolbarHtml + `
        <div class="card" style="max-width:620px; margin:28px auto; text-align:center; padding:42px 24px;">
          <div style="font-size:44px; margin-bottom:10px;">🎉</div>
          <h2 style="margin:0 0 8px;">${runtime.fcDoneCount > 0 ? '太厲害了！本組記憶卡已全部記住！' : '目前此卡組沒有卡片'}</h2>
          <p style="color:var(--text-muted); margin-bottom:20px;">
            ${runtime.fcDeckType === 'wrong' && appState.wrongBook.length === 0 ? '你的錯題本是空的！可切換至「高頻核心觀念卡」繼續衝刺。' : '你可以重新洗牌複習一次，或切換其他卡組。'}
          </p>
          <button id="btn-fc-restart" class="btn btn-primary" type="button">↻ 重新複習高頻觀念卡</button>
        </div>
      `;
      bindFlashcardToolbar();
      document.getElementById('btn-fc-restart').addEventListener('click', () => buildFlashcardDeck('concept'));
      return;
    }

    const card = runtime.fcQueue[0];
    const topic = TOPIC_MAP[card.topic];

    container.innerHTML = toolbarHtml + `
      <div class="flashcard-stage">
        <div id="flashcard-scene" class="flashcard-scene" title="點擊翻轉卡片 (Space)">
          <div class="flashcard-inner ${runtime.fcFlipped ? 'is-flipped' : ''}">
            <div class="flashcard-face">
              <div style="display:flex; justify-content:space-between; align-items:center;">
                <span class="pill" style="color:${topic.color};">${topic.icon} ${topic.name}</span>
                <span style="font-size:12.5px; color:var(--text-subtle);">正面・點擊翻面 (Space)</span>
              </div>
              <div class="flashcard-main">${escapeHtml(card.front)}</div>
              <div style="font-size:13px; color:var(--text-subtle);">💭 提示：${escapeHtml(card.hint)}</div>
            </div>

            <div class="flashcard-face flashcard-back">
              <div style="display:flex; justify-content:space-between; align-items:center;">
                <span class="pill" style="background:var(--emerald-soft); color:var(--emerald);">解析與重點</span>
                <span style="font-size:12.5px; color:var(--text-subtle);">背面・請評估熟悉度</span>
              </div>
              <div class="flashcard-main">${escapeHtml(card.back)}</div>
              <div style="font-size:12.5px; color:var(--text-subtle);">相關題號：${(card.relatedIds || []).map(id => `第${id}題`).join('、')}</div>
            </div>
          </div>
        </div>

        ${runtime.fcFlipped ? `
          <div class="flashcard-rating-row">
            <button class="btn btn-rose" data-fc-rate="again" type="button">1️⃣ 還不熟（稍後重出）</button>
            <button class="btn" style="border-color:var(--amber); color:var(--amber);" data-fc-rate="fuzzy" type="button">2️⃣ 有點模糊（排到隊尾）</button>
            <button class="btn btn-primary" data-fc-rate="known" type="button">3️⃣ 完全記住（過關）</button>
          </div>
        ` : `
          <div style="text-align:center;">
            <button id="btn-fc-flip" class="btn btn-primary btn-lg" type="button">🔄 翻轉看答案 (Space)</button>
          </div>
        `}
      </div>
    `;

    bindFlashcardToolbar();
    document.getElementById('flashcard-scene').addEventListener('click', () => {
      runtime.fcFlipped = !runtime.fcFlipped;
      renderFlashcards();
    });
    const flipBtn = document.getElementById('btn-fc-flip');
    if (flipBtn) flipBtn.addEventListener('click', () => {
      runtime.fcFlipped = true;
      renderFlashcards();
    });
    container.querySelectorAll('[data-fc-rate]').forEach(btn => {
      btn.addEventListener('click', () => rateFlashcard(btn.dataset.fcRate));
    });
  }

  function bindFlashcardToolbar() {
    const sel = document.getElementById('fc-deck-select');
    if (sel) sel.addEventListener('change', (e) => buildFlashcardDeck(e.target.value));
    const shuf = document.getElementById('btn-fc-shuffle');
    if (shuf) shuf.addEventListener('click', () => {
      buildFlashcardDeck(runtime.fcDeckType);
      runtime.fcQueue = shuffleArray(runtime.fcQueue);
      renderFlashcards();
    });
  }

  function rateFlashcard(level) {
    if (runtime.fcQueue.length === 0) return;
    const current = runtime.fcQueue.shift();
    if (level === 'again') {
      const insertPos = Math.min(2, runtime.fcQueue.length);
      runtime.fcQueue.splice(insertPos, 0, current);
      appState.flashcardMastery[current.id] = 'new';
    } else if (level === 'fuzzy') {
      runtime.fcQueue.push(current);
      appState.flashcardMastery[current.id] = 'fuzzy';
    } else {
      runtime.fcDoneCount += 1;
      appState.flashcardMastery[current.id] = 'known';
    }
    runtime.fcFlipped = false;
    saveState();
    renderFlashcards();
  }

  /* =========================
     5. 錯題本、收藏、筆記與全題庫搜尋
     ========================= */
  function renderWrongBook() {
    const container = document.getElementById('wrongbook-container');
    const noteIds = Object.keys(appState.notes).map(Number).filter(id => appState.notes[id] && appState.notes[id].trim());

    const tabsHtml = `
      <div class="filter-toolbar" style="justify-content:space-between;">
        <div class="tabs-row" style="margin:0;">
          <button class="tab-btn ${runtime.wbTab === 'wrong' ? 'active' : ''}" data-wbtab="wrong" type="button">🔥 錯題本 (${appState.wrongBook.length})</button>
          <button class="tab-btn ${runtime.wbTab === 'bookmarks' ? 'active' : ''}" data-wbtab="bookmarks" type="button">⭐ 收藏夾 (${appState.bookmarks.length})</button>
          <button class="tab-btn ${runtime.wbTab === 'notes' ? 'active' : ''}" data-wbtab="notes" type="button">📝 我的筆記 (${noteIds.length})</button>
          <button class="tab-btn ${runtime.wbTab === 'search' ? 'active' : ''}" data-wbtab="search" type="button">🔍 全題庫搜尋</button>
        </div>
        ${runtime.wbTab === 'wrong' && appState.wrongBook.length > 0 ? `<button id="btn-wb-train" class="btn btn-rose btn-sm" type="button">🚀 開始錯題特訓 (${appState.wrongBook.length}題)</button>` : ''}
      </div>
    `;

    let bodyHtml = '';
    if (runtime.wbTab === 'search') {
      const qStr = runtime.wbSearchQuery.trim();
      const kw = qStr.toLowerCase();
      const matches = kw
        ? DATA.questions.filter(q => {
            const hay = [String(q.id), q.stem, q.options.A, q.options.B, q.options.C, q.options.D, q.explanation, q.tip, ...q.tags].join(' ').toLowerCase();
            return hay.includes(kw);
          })
        : DATA.questions;

      bodyHtml = `
        <div style="margin-bottom:14px;">
          <input id="wb-search-input" class="input" style="width:100%; max-width:520px; font-size:15px; padding:11px 14px;" type="search" value="${escapeHtml(qStr)}" placeholder="輸入任何關鍵字搜尋題幹、選項或解析（例如：濃硝酸、皂化、腳氣病、烏龍茶）" />
          <span style="margin-left:10px; font-size:13px; color:var(--text-subtle);">找到 ${matches.length} 題</span>
        </div>
        ${matches.map(q => renderQuestionSummaryCard(q, 'search')).join('')}
      `;
    } else {
      const targetIds = runtime.wbTab === 'wrong'
        ? appState.wrongBook
        : runtime.wbTab === 'bookmarks'
          ? appState.bookmarks
          : noteIds;

      if (targetIds.length === 0) {
        const emptyMsgs = {
          wrong: '目前沒有錯題！作答或模擬考答錯的題目會自動收錄在這裡。',
          bookmarks: '尚未收藏題目。刷題時可按「☆ 收藏 (F)」將重點題目加入收藏夾。',
          notes: '尚未撰寫任何筆記。在「智慧刷題練習」右側即可隨時寫下筆記。'
        };
        bodyHtml = `<div class="card" style="text-align:center; padding:38px 20px; color:var(--text-subtle);">${emptyMsgs[runtime.wbTab]}</div>`;
      } else {
        bodyHtml = targetIds.map(id => renderQuestionSummaryCard(QUESTION_MAP[id], runtime.wbTab)).join('');
      }
    }

    container.innerHTML = tabsHtml + bodyHtml;

    container.querySelectorAll('[data-wbtab]').forEach(btn => {
      btn.addEventListener('click', () => {
        runtime.wbTab = btn.dataset.wbtab;
        renderWrongBook();
      });
    });

    const trainBtn = document.getElementById('btn-wb-train');
    if (trainBtn) trainBtn.addEventListener('click', startWrongPractice);

    const searchInp = document.getElementById('wb-search-input');
    if (searchInp) {
      searchInp.focus();
      searchInp.setSelectionRange(searchInp.value.length, searchInp.value.length);
      searchInp.addEventListener('input', (e) => {
        runtime.wbSearchQuery = e.target.value;
        renderWrongBook();
      });
    }

    container.querySelectorAll('[data-wb-practice]').forEach(btn => {
      btn.addEventListener('click', () => jumpToPracticeQuestion(Number(btn.dataset.wbPractice)));
    });
    container.querySelectorAll('[data-wb-remove-wrong]').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = Number(btn.dataset.wbRemoveWrong);
        appState.wrongBook = appState.wrongBook.filter(x => x !== id);
        saveState();
        showToast(`已將第 ${id} 題移出錯題本`);
        renderWrongBook();
      });
    });
    container.querySelectorAll('[data-wb-unbookmark]').forEach(btn => {
      btn.addEventListener('click', () => toggleBookmark(Number(btn.dataset.wbUnbookmark)));
    });
  }

  function renderQuestionSummaryCard(q, mode) {
    const topic = TOPIC_MAP[q.topic];
    const h = appState.history[q.id];
    const note = appState.notes[q.id];
    return `
      <div class="list-item-card">
        <div style="display:flex; justify-content:space-between; align-items:center; gap:8px; flex-wrap:wrap; margin-bottom:8px;">
          <div style="display:flex; gap:8px; align-items:center; flex-wrap:wrap;">
            <span class="q-number-badge">第 ${q.id} 題</span>
            <span class="pill" style="color:${topic.color};">${topic.icon} ${topic.name}</span>
            ${h ? `<span style="font-size:12px; color:var(--text-subtle);">作答 ${h.attempts} 次（對 ${h.correct} / 錯 ${h.wrong}）</span>` : ''}
          </div>
          <div style="display:flex; gap:8px;">
            <button class="btn btn-sm btn-primary" data-wb-practice="${q.id}" type="button">前往練習</button>
            ${mode === 'wrong' ? `<button class="btn btn-sm" data-wb-remove-wrong="${q.id}" type="button">✓ 已掌握移出</button>` : ''}
            ${mode === 'bookmarks' ? `<button class="btn btn-sm" data-wb-unbookmark="${q.id}" type="button">取消收藏</button>` : ''}
          </div>
        </div>
        <div style="font-weight:700; font-size:15.5px; margin-bottom:6px;">${formatStem(q)}</div>
        <div style="font-size:13.5px; color:var(--text-muted);">
          <strong>正解 (${q.answer})：</strong>${escapeHtml(q.options[q.answer])} — ${escapeHtml(q.explanation)}
        </div>
        ${note ? `<div style="margin-top:8px; padding:8px 10px; border-radius:8px; background:var(--amber-soft); font-size:13px;">📝 個人筆記：${escapeHtml(note)}</div>` : ''}
      </div>
    `;
  }

  /* =========================
     6. 考前重點整理
     ========================= */
  function renderGuides() {
    const container = document.getElementById('guides-container');
    const guide = DATA.studyGuides.find(g => g.id === runtime.activeGuideId) || DATA.studyGuides[0];

    const tabsHtml = DATA.studyGuides.map(g => {
      const t = TOPIC_MAP[g.id];
      return `<button class="tab-btn ${g.id === guide.id ? 'active' : ''}" data-gid="${g.id}" type="button">${t.icon} ${t.shortName}</button>`;
    }).join('');

    const tablesHtml = (guide.tables || []).map(tb => `
      <div class="guide-table-wrap">
        <div style="font-weight:800; font-size:14px; margin-bottom:6px;">📌 ${escapeHtml(tb.caption)}</div>
        <table class="guide-table">
          <thead><tr>${tb.headers.map(h => `<th>${escapeHtml(h)}</th>`).join('')}</tr></thead>
          <tbody>${tb.rows.map(r => `<tr>${r.map(c => `<td>${escapeHtml(c)}</td>`).join('')}</tr>`).join('')}</tbody>
        </table>
      </div>
    `).join('');

    const selfCheckHtml = (guide.selfCheck || []).map((sc, idx) => `
      <div style="padding:10px 12px; border:1px solid var(--border); border-radius:10px; margin-bottom:8px; background:var(--bg-surface-2);">
        <div style="font-weight:700; font-size:14px; margin-bottom:6px;">Q${idx + 1}. ${escapeHtml(sc.q)}</div>
        <div style="font-size:13.5px;">答案：<span class="spoiler-answer" title="點擊顯示／隱藏答案">${escapeHtml(sc.a)}</span> <small style="color:var(--text-subtle);">（點擊模糊處顯示）</small></div>
      </div>
    `).join('');

    const extraSoapDiagram = guide.id === 'soap' ? `
      <div class="diagram-box" style="margin-top:16px;">
        ${renderQ25Svg(true)}
        <div class="diagram-caption"><span>💡 清潔劑分子結構對比圖（對應題庫第 25 題與第 32 題）</span></div>
      </div>
    ` : '';

    container.innerHTML = `
      <div class="filter-toolbar" style="justify-content:space-between;">
        <div class="tabs-row" style="margin:0;">${tabsHtml}</div>
        <div style="display:flex; gap:8px;" class="no-print">
          <button id="btn-guide-practice" class="btn btn-primary btn-sm" type="button">✏️ 練習本單元題目</button>
          <button id="btn-guide-print" class="btn btn-sm" type="button">🖨️ 列印重點</button>
        </div>
      </div>

      <div class="card">
        <h2 style="margin-top:0;">${escapeHtml(guide.title)}</h2>
        <p style="color:var(--text-muted); margin-top:0;">${escapeHtml(guide.summary)}</p>

        <h3 style="font-size:15px; margin:16px 0 8px;">核心必考觀念</h3>
        <ul style="padding-left:20px; margin:0 0 14px; display:flex; flex-direction:column; gap:6px;">
          ${guide.keyPoints.map(pt => `<li>${escapeHtml(pt)}</li>`).join('')}
        </ul>

        ${tablesHtml}
        ${extraSoapDiagram}

        <div class="tip-callout" style="margin:16px 0;">🔥 考前秒殺口訣：${escapeHtml(guide.mnemonic)}</div>

        <h3 style="font-size:15px; margin:16px 0 8px;">快速自我檢測（主動回憶）</h3>
        ${selfCheckHtml}

        <div class="related-row" style="margin-top:14px;">
          <span>對應考卷題號：</span>
          ${guide.relatedIds.map(id => `<button class="btn btn-sm" data-guide-qid="${id}" type="button">第 ${id} 題</button>`).join('')}
        </div>
      </div>
    `;

    container.querySelectorAll('[data-gid]').forEach(btn => {
      btn.addEventListener('click', () => {
        runtime.activeGuideId = btn.dataset.gid;
        renderGuides();
      });
    });
    container.querySelectorAll('.spoiler-answer').forEach(sp => {
      sp.addEventListener('click', () => sp.classList.toggle('revealed'));
    });
    container.querySelectorAll('[data-guide-qid]').forEach(btn => {
      btn.addEventListener('click', () => jumpToPracticeQuestion(Number(btn.dataset.guideQid)));
    });
    document.getElementById('btn-guide-practice').addEventListener('click', () => {
      document.getElementById('practice-topic').value = guide.id;
      document.getElementById('practice-status').value = 'all';
      applyPracticeFilters();
      switchView('practice');
    });
    document.getElementById('btn-guide-print').addEventListener('click', () => window.print());
  }

  /* =========================
     原卷影像檢視器與系統 Modal
     ========================= */
  function openPaperModal(pageIdx) {
    runtime.paperPage = typeof pageIdx === 'number' ? pageIdx : 0;
    runtime.paperZoom = 1;
    updatePaperModalView();
    document.getElementById('modal-paper').classList.add('open');
  }

  function updatePaperModalView() {
    const imgInfo = DATA.meta.sourceImages[runtime.paperPage];
    const imgEl = document.getElementById('paper-preview-img');
    imgEl.src = imgInfo.src;
    imgEl.style.transform = `scale(${runtime.paperZoom})`;
    document.getElementById('paper-zoom-label').textContent = `${Math.round(runtime.paperZoom * 100)}%`;
    document.getElementById('btn-paper-p1').classList.toggle('btn-primary', runtime.paperPage === 0);
    document.getElementById('btn-paper-p2').classList.toggle('btn-primary', runtime.paperPage === 1);
  }

  function exportBackupJson() {
    const blob = new Blob([JSON.stringify(appState, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `chem-exam-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    showToast('已匯出學習紀錄備份檔');
  }

  function importBackupJson(file) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(reader.result);
        appState = Object.assign(createDefaultState(), parsed);
        saveState();
        applyTheme(appState.theme);
        switchView(runtime.currentView);
        document.getElementById('modal-backup').classList.remove('open');
        showToast('備份資料匯入成功！');
      } catch (e) {
        alert('JSON 格式錯誤，無法匯入備份檔。');
      }
    };
    reader.readAsText(file);
  }

  /* =========================
     鍵盤快捷鍵與全域事件綁定
     ========================= */
  function handleKeyDown(e) {
    if (e.key === 'Escape') {
      document.querySelectorAll('.modal-overlay.open').forEach(m => m.classList.remove('open'));
      return;
    }

    const tag = (e.target && e.target.tagName) ? e.target.tagName.toLowerCase() : '';
    if (tag === 'input' || tag === 'textarea' || tag === 'select') return;

    const keyUpper = e.key.toUpperCase();
    const numToLetter = { '1': 'A', '2': 'B', '3': 'C', '4': 'D' };

    if (runtime.currentView === 'practice') {
      const qId = runtime.practiceList[runtime.practiceIndex];
      if (!qId) return;
      const letter = ['A', 'B', 'C', 'D'].includes(keyUpper) ? keyUpper : numToLetter[e.key];
      if (letter && !runtime.practiceAnswers[qId]) {
        const dispMap = getOptionDisplayMap(qId, runtime.practiceShuffleOpt, runtime.practiceOptOrder);
        submitPracticeAnswer(qId, dispMap[letter]);
      } else if (e.key === 'ArrowLeft') {
        movePractice(-1);
      } else if (e.key === 'ArrowRight') {
        movePractice(1);
      } else if (keyUpper === 'F') {
        toggleBookmark(qId);
      } else if (keyUpper === 'S' && runtime.practiceAnswers[qId]) {
        runtime.practiceShowExp = !runtime.practiceShowExp;
        renderPractice();
      }
    } else if (runtime.currentView === 'exam' && runtime.examPhase === 'running') {
      const qId = runtime.examOrder[runtime.examIndex];
      const letter = ['A', 'B', 'C', 'D'].includes(keyUpper) ? keyUpper : numToLetter[e.key];
      if (letter) {
        const dispMap = getOptionDisplayMap(qId, runtime.examConfig.shuffleOpt, runtime.examOptOrder);
        runtime.examAnswers[qId] = dispMap[letter];
        renderExam();
      } else if (e.key === 'ArrowLeft' && runtime.examIndex > 0) {
        runtime.examIndex--;
        renderExam();
      } else if (e.key === 'ArrowRight' && runtime.examIndex < 34) {
        runtime.examIndex++;
        renderExam();
      } else if (keyUpper === 'F') {
        if (runtime.examFlags[qId]) delete runtime.examFlags[qId];
        else runtime.examFlags[qId] = true;
        renderExam();
      }
    } else if (runtime.currentView === 'flashcards' && runtime.fcQueue.length > 0) {
      if (e.code === 'Space') {
        e.preventDefault();
        runtime.fcFlipped = !runtime.fcFlipped;
        renderFlashcards();
      } else if (runtime.fcFlipped && e.key === '1') {
        rateFlashcard('again');
      } else if (runtime.fcFlipped && e.key === '2') {
        rateFlashcard('fuzzy');
      } else if (runtime.fcFlipped && e.key === '3') {
        rateFlashcard('known');
      }
    }
  }

  function init() {
    applyTheme(appState.theme);
    updateNavBadges();
    initPracticeControls();

    // 導覽切換
    document.querySelectorAll('.nav-item[data-view]').forEach(btn => {
      btn.addEventListener('click', () => switchView(btn.dataset.view));
    });

    // 手機版側欄
    document.getElementById('btn-menu-toggle').addEventListener('click', () => {
      document.getElementById('sidebar').classList.add('open');
      document.getElementById('sidebar-backdrop').classList.add('open');
    });
    document.getElementById('sidebar-backdrop').addEventListener('click', () => {
      document.getElementById('sidebar').classList.remove('open');
      document.getElementById('sidebar-backdrop').classList.remove('open');
    });

    // 主題切換
    document.getElementById('btn-theme-toggle').addEventListener('click', () => {
      appState.theme = appState.theme === 'dark' ? 'light' : 'dark';
      applyTheme(appState.theme);
      saveState();
    });

    // 快捷按鈕
    document.getElementById('btn-quick-search').addEventListener('click', () => {
      runtime.wbTab = 'search';
      switchView('wrongbook');
    });
    document.getElementById('btn-open-paper').addEventListener('click', () => openPaperModal(0));
    document.getElementById('btn-sidebar-paper').addEventListener('click', () => openPaperModal(0));
    document.getElementById('btn-sidebar-shortcuts').addEventListener('click', () => {
      document.getElementById('modal-shortcuts').classList.add('open');
    });
    document.getElementById('btn-sidebar-backup').addEventListener('click', () => {
      document.getElementById('modal-backup').classList.add('open');
    });

    // 原卷檢視控制
    document.getElementById('btn-paper-p1').addEventListener('click', () => {
      runtime.paperPage = 0;
      updatePaperModalView();
    });
    document.getElementById('btn-paper-p2').addEventListener('click', () => {
      runtime.paperPage = 1;
      updatePaperModalView();
    });
    document.getElementById('btn-zoom-in').addEventListener('click', () => {
      runtime.paperZoom = Math.min(2.4, +(runtime.paperZoom + 0.2).toFixed(2));
      updatePaperModalView();
    });
    document.getElementById('btn-zoom-out').addEventListener('click', () => {
      runtime.paperZoom = Math.max(0.6, +(runtime.paperZoom - 0.2).toFixed(2));
      updatePaperModalView();
    });
    document.getElementById('btn-zoom-reset').addEventListener('click', () => {
      runtime.paperZoom = 1;
      updatePaperModalView();
    });

    // 備份與重置
    document.getElementById('btn-export-json').addEventListener('click', exportBackupJson);
    document.getElementById('input-import-json').addEventListener('change', (e) => {
      importBackupJson(e.target.files[0]);
      e.target.value = '';
    });
    document.getElementById('btn-reset-all').addEventListener('click', () => {
      if (confirm('確定要清除所有刷題統計、錯題本、收藏、筆記與模擬考紀錄嗎？')) {
        const keepTheme = appState.theme;
        appState = createDefaultState();
        appState.theme = keepTheme;
        runtime.practiceAnswers = {};
        saveState();
        document.getElementById('modal-backup').classList.remove('open');
        switchView('dashboard');
        showToast('已重置所有學習紀錄');
      }
    });

    // 模擬考交卷確認
    document.getElementById('btn-confirm-submit-exam').addEventListener('click', finishMockExam);

    // 關閉 Modal 通用處理
    document.querySelectorAll('[data-close-modal]').forEach(btn => {
      btn.addEventListener('click', () => {
        document.getElementById(btn.dataset.closeModal).classList.remove('open');
      });
    });
    document.querySelectorAll('.modal-overlay').forEach(overlay => {
      overlay.addEventListener('click', (e) => {
        if (e.target === overlay) overlay.classList.remove('open');
      });
    });

    document.addEventListener('keydown', handleKeyDown);
    renderDashboard();
  }

  init();
})();
