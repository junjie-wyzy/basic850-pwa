const app = document.querySelector("#app");

const STORAGE_KEY = "basic850-pwa-state-v1";

const navItems = [
  { id: "home", label: "自测" },
  { id: "cards", label: "闪卡" },
  { id: "library", label: "词库" },
  { id: "today", label: "今日" }
];

const noveltyVoiceParts = [
  "bad news",
  "bahh",
  "bells",
  "boing",
  "bubbles",
  "cellos",
  "good news",
  "jester",
  "organ",
  "superstar",
  "trinoids",
  "whisper",
  "wobble",
  "zarvox"
];

const preferredVoiceParts = [
  "samantha",
  "alex",
  "ava",
  "allison",
  "susan",
  "tom",
  "nicky",
  "daniel",
  "kate",
  "serena",
  "moira",
  "karen",
  "eddy",
  "flo",
  "sandy",
  "shelley"
];

let words = [];
let view = "home";
let libraryScope = "pending";
let cardScope = "pending";
let cardIndex = 0;
let checkIndex = 0;
let query = "";
let openRows = new Set();
let activeSince = Date.now();
let currentAudio = null;

const state = loadState();
if (!state.accent) state.accent = "en-US";

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch {
    localStorage.removeItem(STORAGE_KEY);
  }

  return {
    statusByWord: {},
    dailyChopped: {},
    dailySeconds: {},
    accent: "en-US"
  };
}

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function todayKey() {
  const date = new Date();
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function escapeHtml(value = "") {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function encoded(value) {
  return encodeURIComponent(value);
}

function statusOf(word) {
  return state.statusByWord[word] || "pending";
}

function statusLabel(word) {
  const status = statusOf(word);
  if (status === "known") return "已斩";
  if (status === "learning") return "待学";
  return "未开始";
}

function displayPhonetic(value) {
  if (!value) return "/-/";
  const trimmed = String(value).trim().replace(/^\/+|\/+$/g, "");
  return `/${trimmed}/`;
}

function isSpeechAvailable() {
  return "speechSynthesis" in window && "SpeechSynthesisUtterance" in window;
}

function normalizedLang(value = "") {
  return value.replace("_", "-").toLowerCase();
}

function desiredSpeechLang() {
  return state.accent === "auto" ? "en-US" : state.accent;
}

function availableVoices() {
  if (!isSpeechAvailable()) return [];
  return speechSynthesis.getVoices();
}

function isNoveltyVoice(voice) {
  const name = voice.name.toLowerCase();
  return noveltyVoiceParts.some((part) => name.includes(part));
}

function isEnglishVoice(voice) {
  return normalizedLang(voice.lang).startsWith("en-");
}

function voiceScore(voice, lang) {
  if (!isEnglishVoice(voice) || isNoveltyVoice(voice)) return -1000;

  const voiceLang = normalizedLang(voice.lang);
  const target = normalizedLang(lang);
  const name = voice.name.toLowerCase();
  let score = 0;

  if (voiceLang === target) score += 100;
  else if (voiceLang.split("-")[0] === target.split("-")[0]) score += 50;

  const preferredIndex = preferredVoiceParts.findIndex((part) => name.includes(part));
  if (preferredIndex >= 0) score += 80 - preferredIndex;
  if (voice.default) score += 5;
  if (voice.localService) score += 2;

  return score;
}

function preferredVoice(lang = desiredSpeechLang()) {
  return availableVoices()
    .map((voice) => ({ voice, score: voiceScore(voice, lang) }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score)[0]?.voice;
}

function currentVoiceLabel() {
  if (!isSpeechAvailable()) return "当前浏览器不支持朗读";
  const voice = preferredVoice();
  if (voice) return `${voice.name} (${voice.lang})`;
  return "正在准备英语朗读声音";
}

function dictionaryAudioUrl(word) {
  const type = desiredSpeechLang() === "en-GB" ? 1 : 2;
  return `https://dict.youdao.com/dictvoice?audio=${encodeURIComponent(word)}&type=${type}`;
}

function stopCurrentAudio() {
  if (!currentAudio) return;
  currentAudio.pause();
  currentAudio.removeAttribute("src");
  currentAudio.load();
  currentAudio = null;
}

function playDictionaryAudio(word) {
  if (!("Audio" in window)) return Promise.reject(new Error("Audio unavailable"));

  stopCurrentAudio();
  const audio = new Audio(dictionaryAudioUrl(word));
  currentAudio = audio;
  audio.preload = "auto";
  audio.playbackRate = 0.92;

  return new Promise((resolve, reject) => {
    const cleanup = () => {
      audio.onended = null;
      audio.onerror = null;
    };

    audio.onended = () => {
      cleanup();
      resolve();
    };
    audio.onerror = () => {
      cleanup();
      reject(new Error("Dictionary audio failed"));
    };

    audio.play().catch((error) => {
      cleanup();
      reject(error);
    });
  });
}

function getScopeWords(scope) {
  if (scope === "all") return words;
  if (scope === "known") return words.filter((item) => statusOf(item.word) === "known");
  return words.filter((item) => statusOf(item.word) !== "known");
}

function getKnownCount() {
  return words.filter((item) => statusOf(item.word) === "known").length;
}

function getTodayChoppedCount() {
  return new Set(state.dailyChopped[todayKey()] || []).size;
}

function getStoredTodaySeconds() {
  return state.dailySeconds[todayKey()] || 0;
}

function getLiveTodaySeconds() {
  const live = activeSince && !document.hidden ? Math.max(0, (Date.now() - activeSince) / 1000) : 0;
  return getStoredTodaySeconds() + live;
}

function formatDuration(seconds) {
  const total = Math.max(0, Math.floor(seconds));
  if (total < 60) return `${total}秒`;
  const minutes = Math.floor(total / 60);
  if (minutes < 60) return `${minutes}分钟`;
  const hours = Math.floor(minutes / 60);
  return `${hours}小时${minutes % 60}分钟`;
}

function persistElapsed() {
  if (!activeSince) return;
  const key = todayKey();
  const elapsed = Math.max(0, (Date.now() - activeSince) / 1000);
  state.dailySeconds[key] = (state.dailySeconds[key] || 0) + elapsed;
  activeSince = Date.now();
  saveState();
}

function pauseTimer() {
  persistElapsed();
  activeSince = null;
}

function resumeTimer() {
  if (!activeSince) activeSince = Date.now();
}

function markKnown(word) {
  const wasKnown = statusOf(word) === "known";
  state.statusByWord[word] = "known";

  if (!wasKnown) {
    const key = todayKey();
    const list = new Set(state.dailyChopped[key] || []);
    list.add(word);
    state.dailyChopped[key] = [...list];
  }

  saveState();
}

function markLearning(word) {
  state.statusByWord[word] = "learning";
  saveState();
}

function resetProgress() {
  state.statusByWord = {};
  state.dailyChopped = {};
  state.dailySeconds = {};
  saveState();
}

function byCategory() {
  const grouped = new Map();
  for (const item of words) {
    if (!grouped.has(item.category)) {
      grouped.set(item.category, {
        category: item.category,
        categoryLabel: item.categoryLabel,
        categoryZh: item.categoryZh,
        tone: item.tone,
        total: 0,
        known: 0
      });
    }

    const group = grouped.get(item.category);
    group.total += 1;
    if (statusOf(item.word) === "known") group.known += 1;
  }
  return [...grouped.values()];
}

function wordCard(item, mode = "") {
  if (!item) {
    return `<div class="panel empty">没有可显示的单词</div>`;
  }

  const tagTone = item.tone === "green" ? "green" : item.tone === "gold" ? "gold" : "";

  return `
    <article class="word-card ${escapeHtml(mode)}">
      <div class="word-head">
        <div class="word-title">
          <h2>${escapeHtml(item.word)}</h2>
          <span class="phonetic">${escapeHtml(displayPhonetic(item.phonetic))}</span>
        </div>
        <button class="button icon secondary" data-action="speak" data-word="${encoded(item.word)}" aria-label="发音">声</button>
      </div>
      <p class="meaning">${escapeHtml(item.meaningZh || "中文释义待校对")}</p>
      <div class="example">
        <p class="en">${escapeHtml(item.example)}</p>
        <p class="zh">${escapeHtml(item.exampleZh || "例句翻译待校对")}</p>
      </div>
      <div class="tag-row">
        <span class="tag ${tagTone}">${escapeHtml(item.categoryZh)}</span>
        <span class="tag">${escapeHtml(item.categoryLabel)}</span>
        <span class="tag">${escapeHtml(statusLabel(item.word))}</span>
      </div>
    </article>
  `;
}

function renderStats() {
  const known = getKnownCount();
  const percent = words.length ? Math.round((known / words.length) * 100) : 0;

  return `
    <section class="stats-grid">
      <div class="stat">
        <span>今日已斩</span>
        <strong>${getTodayChoppedCount()}</strong>
      </div>
      <div class="stat">
        <span>今日学习</span>
        <strong data-live-time>${formatDuration(getLiveTodaySeconds())}</strong>
      </div>
      <div class="stat">
        <span>总进度</span>
        <strong>${percent}%</strong>
      </div>
    </section>
  `;
}

function renderHeader() {
  return `
    <header class="topbar">
      <div class="brand">
        <img src="./icons/icon.svg" alt="" />
        <div>
          <h1>词骨英语 850</h1>
          <p>Basic English</p>
        </div>
      </div>
      <span class="pill">${getKnownCount()} / ${words.length}</span>
    </header>
  `;
}

function renderHome() {
  return `
    ${renderHeader()}
    ${renderStats()}
    <div class="actions">
      <button class="button green" data-action="start-check">开始自测单词</button>
      <button class="button blue" data-action="open-cards">进入闪卡</button>
    </div>
    <section class="section-title">
      <h2>分类进度</h2>
      <span class="pill">${getScopeWords("pending").length} 个待学</span>
    </section>
    <section class="category-grid">
      ${byCategory()
        .map((item) => {
          const value = item.total ? Math.round((item.known / item.total) * 100) : 0;
          return `
            <div class="category-card">
              <h3>${escapeHtml(item.categoryZh)}</h3>
              <p>${escapeHtml(item.categoryLabel)} · ${item.known}/${item.total}</p>
              <div class="meter" style="--value:${value}%"><div></div></div>
            </div>
          `;
        })
        .join("")}
    </section>
  `;
}

function renderCheck() {
  const queue = getScopeWords("pending");
  const list = queue.length ? queue : words;
  const current = list[checkIndex % list.length];

  return `
    ${renderHeader()}
    <section class="section-title">
      <h2>开始自测单词</h2>
      <span class="pill">${list.length ? (checkIndex % list.length) + 1 : 0} / ${list.length}</span>
    </section>
    ${wordCard(current, "check-card")}
    <div class="toolbar">
      <button class="button secondary" data-action="check-learning" data-word="${current ? encoded(current.word) : ""}" ${current ? "" : "disabled"}>待学</button>
      <button class="button green" data-action="check-known" data-word="${current ? encoded(current.word) : ""}" ${current ? "" : "disabled"}>已斩</button>
      <button class="button blue" data-action="check-next" ${current ? "" : "disabled"}>下一个</button>
    </div>
  `;
}

function renderScopeTabs(scope, prefix) {
  const tabs = [
    { id: "pending", label: "待学" },
    { id: "all", label: "全部" },
    { id: "known", label: "已斩" }
  ];

  return `
    <div class="segmented">
      ${tabs
        .map(
          (tab) =>
            `<button class="${scope === tab.id ? "active" : ""}" data-action="${prefix}-scope" data-scope="${tab.id}">${tab.label}</button>`
        )
        .join("")}
    </div>
  `;
}

function renderCards() {
  const list = getScopeWords(cardScope);
  const current = list[cardIndex % Math.max(1, list.length)];

  return `
    ${renderHeader()}
    <section class="section-title">
      <h2>闪卡</h2>
      <span class="pill">${list.length ? (cardIndex % list.length) + 1 : 0} / ${list.length}</span>
    </section>
    ${renderScopeTabs(cardScope, "card")}
    ${wordCard(current, "flash-card")}
    <div class="toolbar">
      <button class="button secondary" data-action="card-prev" ${list.length ? "" : "disabled"}>上一张</button>
      <button class="button blue" data-action="card-next" ${list.length ? "" : "disabled"}>下一张</button>
    </div>
    <div class="toolbar">
      <button class="button secondary" data-action="mark-learning" data-word="${current ? encoded(current.word) : ""}" ${current ? "" : "disabled"}>待学</button>
      <button class="button green" data-action="mark-known" data-word="${current ? encoded(current.word) : ""}" ${current ? "" : "disabled"}>已斩</button>
    </div>
  `;
}

function renderLibrary() {
  const normalizedQuery = query.trim().toLowerCase();
  const list = getScopeWords(libraryScope).filter((item) => {
    if (!normalizedQuery) return true;
    return (
      item.word.toLowerCase().includes(normalizedQuery) ||
      item.meaningZh.includes(query) ||
      item.example.toLowerCase().includes(normalizedQuery)
    );
  });

  return `
    ${renderHeader()}
    <section class="section-title">
      <h2>词库</h2>
      <span class="pill">${list.length}</span>
    </section>
    ${renderScopeTabs(libraryScope, "library")}
    <input class="search" data-action="search" value="${escapeHtml(query)}" placeholder="搜索单词或中文" />
    <section class="library-list">
      ${
        list.length
          ? list.map(renderLibraryRow).join("")
          : `<div class="panel empty">没有匹配的单词</div>`
      }
    </section>
  `;
}

function renderLibraryRow(item) {
  const isOpen = openRows.has(item.word);
  return `
    <article class="library-row ${isOpen ? "open" : ""}">
      <div class="row-main">
        <div class="row-word">
          <strong>${escapeHtml(item.word)}</strong>
          <span>${escapeHtml(displayPhonetic(item.phonetic))} · ${escapeHtml(item.meaningZh || "")}</span>
        </div>
        <div class="row-actions">
          <button class="button icon secondary" data-action="toggle-row" data-word="${encoded(item.word)}" aria-label="展开">看</button>
          <button class="button icon secondary" data-action="speak" data-word="${encoded(item.word)}" aria-label="发音">声</button>
        </div>
      </div>
      <div class="details">
        <div class="example">
          <p class="en">${escapeHtml(item.example)}</p>
          <p class="zh">${escapeHtml(item.exampleZh || "例句翻译待校对")}</p>
        </div>
        <div class="toolbar">
          <button class="button secondary" data-action="mark-learning" data-word="${encoded(item.word)}">待学</button>
          <button class="button green" data-action="mark-known" data-word="${encoded(item.word)}">已斩</button>
        </div>
      </div>
    </article>
  `;
}

function renderToday() {
  const chopped = new Set(state.dailyChopped[todayKey()] || []);
  const todayWords = words.filter((item) => chopped.has(item.word));

  return `
    ${renderHeader()}
    ${renderStats()}
    <section class="panel">
      <h2>今日已斩</h2>
      ${
        todayWords.length
          ? `<div class="tag-row">${todayWords
              .map((item) => `<span class="tag green">${escapeHtml(item.word)}</span>`)
              .join("")}</div>`
          : `<div class="empty">今天还没有已斩单词</div>`
      }
    </section>
    <section class="panel">
      <h3>发音</h3>
      <p>优先使用词典发音；离线时备用：${escapeHtml(currentVoiceLabel())}</p>
      <div class="segmented">
        <button class="${state.accent === "en-US" ? "active" : ""}" data-action="accent" data-accent="en-US">美音</button>
        <button class="${state.accent === "en-GB" ? "active" : ""}" data-action="accent" data-accent="en-GB">英音</button>
        <button class="${state.accent === "auto" ? "active" : ""}" data-action="accent" data-accent="auto">自动</button>
      </div>
      <button class="button secondary" data-action="test-voice">测试发音</button>
    </section>
    <section class="panel danger-zone">
      <h3>进度</h3>
      <button class="button red" data-action="reset">清空进度</button>
    </section>
  `;
}

function renderNav() {
  return `
    <nav class="bottom-nav">
      <div class="bottom-nav-inner">
        ${navItems
          .map(
            (item) =>
              `<button class="nav-button ${view === item.id || (view === "check" && item.id === "home") ? "active" : ""}" data-action="nav" data-view="${item.id}">${item.label}</button>`
          )
          .join("")}
      </div>
    </nav>
  `;
}

function render() {
  const body =
    view === "check"
      ? renderCheck()
      : view === "cards"
        ? renderCards()
        : view === "library"
          ? renderLibrary()
          : view === "today"
            ? renderToday()
            : renderHome();

  app.innerHTML = `<main class="screen">${body}</main>${renderNav()}`;
}

function updateLiveTime() {
  document.querySelectorAll("[data-live-time]").forEach((node) => {
    node.textContent = formatDuration(getLiveTodaySeconds());
  });
}

function nextCheck() {
  const list = getScopeWords("pending");
  if (!list.length) {
    checkIndex = 0;
  } else {
    checkIndex = (checkIndex + 1) % list.length;
  }
}

function speakWithSystemVoice(word) {
  if (!isSpeechAvailable()) return;

  if (!availableVoices().length) {
    speechSynthesis.onvoiceschanged = () => speakWithSystemVoice(word);
    speechSynthesis.getVoices();
    return;
  }

  const utterance = new SpeechSynthesisUtterance(word);
  utterance.lang = desiredSpeechLang();
  utterance.voice = preferredVoice(utterance.lang) || null;
  utterance.rate = 0.82;
  utterance.pitch = 1;
  speechSynthesis.cancel();
  speechSynthesis.speak(utterance);
}

async function speakWord(word) {
  window.speechSynthesis?.cancel?.();

  try {
    await playDictionaryAudio(word);
  } catch {
    speakWithSystemVoice(word);
  }
}

function currentCardList() {
  return getScopeWords(cardScope);
}

function handleClick(event) {
  const button = event.target.closest("[data-action]");
  if (!button) return;
  const action = button.dataset.action;
  const word = button.dataset.word ? decodeURIComponent(button.dataset.word) : "";

  if (action === "nav") {
    view = button.dataset.view;
  } else if (action === "start-check") {
    view = "check";
    checkIndex = 0;
  } else if (action === "open-cards") {
    view = "cards";
    cardIndex = 0;
  } else if (action === "check-known") {
    markKnown(word);
    const list = getScopeWords("pending");
    if (checkIndex >= list.length) checkIndex = 0;
  } else if (action === "check-learning") {
    markLearning(word);
    nextCheck();
  } else if (action === "check-next") {
    nextCheck();
  } else if (action === "card-scope") {
    cardScope = button.dataset.scope;
    cardIndex = 0;
  } else if (action === "library-scope") {
    libraryScope = button.dataset.scope;
    openRows = new Set();
  } else if (action === "card-prev") {
    const list = currentCardList();
    cardIndex = list.length ? (cardIndex - 1 + list.length) % list.length : 0;
  } else if (action === "card-next") {
    const list = currentCardList();
    cardIndex = list.length ? (cardIndex + 1) % list.length : 0;
  } else if (action === "mark-known") {
    markKnown(word);
  } else if (action === "mark-learning") {
    markLearning(word);
  } else if (action === "toggle-row") {
    if (openRows.has(word)) openRows.delete(word);
    else openRows.add(word);
  } else if (action === "speak") {
    speakWord(word);
  } else if (action === "accent") {
    state.accent = button.dataset.accent;
    saveState();
  } else if (action === "test-voice") {
    speakWord("come");
  } else if (action === "reset") {
    if (confirm("清空全部学习进度？")) resetProgress();
  }

  render();
}

function handleInput(event) {
  const input = event.target.closest("[data-action='search']");
  if (!input) return;
  query = input.value;
  render();
  const nextInput = document.querySelector("[data-action='search']");
  if (nextInput) {
    nextInput.focus();
    nextInput.setSelectionRange(query.length, query.length);
  }
}

async function loadWords() {
  const response = await fetch("./data/words.jsonl", { cache: "no-cache" });
  if (!response.ok) throw new Error(`words load failed: ${response.status}`);
  const text = await response.text();
  words = text
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

async function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) return;
  try {
    await navigator.serviceWorker.register("./sw.js");
  } catch {
    // The app still works online when service workers are unavailable.
  }
}

document.addEventListener("visibilitychange", () => {
  if (document.hidden) pauseTimer();
  else resumeTimer();
});

window.addEventListener("pagehide", pauseTimer);
window.addEventListener("beforeunload", pauseTimer);
app.addEventListener("click", handleClick);
app.addEventListener("input", handleInput);
app.addEventListener("change", handleInput);
setInterval(() => {
  persistElapsed();
  updateLiveTime();
}, 30000);

loadWords()
  .then(() => {
    render();
    registerServiceWorker();
  })
  .catch((error) => {
    app.innerHTML = `<main class="screen"><section class="panel"><h2>词库载入失败</h2><p>${escapeHtml(error.message)}</p></section></main>`;
  });
