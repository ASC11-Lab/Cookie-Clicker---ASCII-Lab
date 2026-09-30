"use strict";
// Lógica do jogo, renderização e save. Depende de data.js.
const SAVE_KEY = "asciicookie.v1.save";   // namespaced: localStorage é compartilhado no usuario.github.io
const TAB_KEY = "asciicookie.v1.tab";
const LEGACY_KEY = "ASCII_COOKIE_SAVE";   // formato antigo, migrado automaticamente
const SAVE_VERSION = 2;
const OFFLINE_CAP = 8 * 3600;             // máx. de segundos de ganho offline
const OFFLINE_RATE = 0.5;                 // 50% da produção normal enquanto fora
const TAB_IDS = ["tab-upgrades", "tab-achievements", "tab-stats", "tab-ascend"];
const MAX_LOG_ENTRIES = 100;
const MAX_DELTA = 3600; // segundos de produção recuperados após aba em segundo plano

let lastTickTime = Date.now();
let confirmCallback = null;
let newsIndex = 0;
let wiping = false;
let goldenTimeout = null;

function boxText(lines, width) {
  const bar = "+" + "-".repeat(width) + "+";
  const rows = lines.map(t => {
    const total = width - t.length;
    const left = Math.max(0, Math.floor(total / 2));
    return "|" + " ".repeat(left) + t + " ".repeat(Math.max(0, total - left)) + "|";
  });
  return [bar, ...rows, bar].join("\n");
}

const COOKIE_ART = [
  "    .---.----.---.    ",
  "  ./   (*)    *   \\.  ",
  " /   *    (*)    *  \\ ",
  "|  (*)   *    (*)    |",
  "|   *   (*)  *    *  |",
  " \\  (*)    *   (*)  / ",
  "  '\\   *   (*)   /'   ",
  "    '---'----'---'    ",
  "   [ CLIQUE AQUI! ]   "
].join("\n");

function createInitialState() {
  const buildings = {};
  BUILDINGS_DATA.forEach(b => { buildings[b.id] = { count: 0, mult: 1 }; });
  return {
    cookies: 0, totalBaked: 0, lifetimeBaked: 0, totalClicked: 0, goldenClicked: 0,
    cps: 0, asciiChips: 0, prestigeResets: 0, clickPowerBonus: 0, clickPercentCps: 0,
    frenzyTimer: 0, frenzyMultiplier: 1, clickFrenzyTimer: 0, clickFrenzyMultiplier: 1,
    buildings, upgradesBought: [], achievementsUnlocked: [], startTime: Date.now()
  };
}

let state = createInitialState();
const $ = id => document.getElementById(id);
function setText(el, text) { if (el.textContent !== text) el.textContent = text; }

function safeNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

function logMessage(message) {
  const log = $("system-log");
  const entry = document.createElement("div");
  entry.className = "log-entry";
  entry.textContent = "> " + message;
  log.prepend(entry);
  while (log.children.length > MAX_LOG_ENTRIES) log.lastElementChild.remove();
}

function showAlert(message) {
  $("modal-alert-text").textContent = message;
  $("modal-alert").style.display = "flex";
}

function showConfirm(message, callback) {
  $("modal-confirm-text").textContent = message;
  confirmCallback = callback;
  $("modal-confirm").style.display = "flex";
}

function getBCount(id) {
  return state.buildings[id] ? safeNumber(state.buildings[id].count) : 0;
}

function reapplyUpgrades() {
  BUILDINGS_DATA.forEach(b => { state.buildings[b.id] = { count: getBCount(b.id), mult: 1 }; });
  state.clickPowerBonus = 0;
  state.clickPercentCps = 0;
  state.upgradesBought.forEach(id => {
    const u = UPGRADES_DATA.find(x => x.id === id);
    if (u) u.apply(state);
  });
}

function calculateCPS() {
  let base = 0;
  BUILDINGS_DATA.forEach(b => {
    const o = state.buildings[b.id];
    if (o) base += o.count * b.cps * o.mult;
  });
  const prestige = 1 + state.asciiChips * 0.01;
  const frenzy = state.frenzyTimer > 0 ? state.frenzyMultiplier : 1;
  state.cps = base * prestige * frenzy;
  return state.cps;
}

function getClickPower() {
  const cpsBonus = calculateCPS() * state.clickPercentCps;
  const mult = state.clickFrenzyTimer > 0 ? state.clickFrenzyMultiplier : 1;
  return Math.max(1, (1 + state.clickPowerBonus + cpsBonus) * mult);
}

function getBuildingCost(b) {
  const cost = b.cost * Math.pow(1.15, getBCount(b.id));
  return Number.isFinite(cost) ? Math.floor(cost) : Number.MAX_SAFE_INTEGER;
}

const UNITS = [
  [1e30, "Nonilhões"], [1e27, "Octilhões"], [1e24, "Septilhões"], [1e21, "Sextilhões"],
  [1e18, "Quintilhões"], [1e15, "Quatrilhões"], [1e12, "Trilhões"], [1e9, "Bilhões"], [1e6, "Milhões"]
];

function formatNumber(value, decimals = false) {
  value = safeNumber(value);
  if (value >= 1e33) return value.toExponential(2);
  for (const [limit, label] of UNITS) {
    if (value >= limit) return (value / limit).toFixed(2) + " " + label;
  }
  if (value >= 1000) return Math.floor(value).toLocaleString("pt-BR");
  if (decimals && value < 1000) {
    const rounded = Math.round(value * 10) / 10;
    return rounded.toLocaleString("pt-BR", { minimumFractionDigits: 0, maximumFractionDigits: 1 });
  }
  return Math.floor(value).toString();
}

function spawnFloatingText(text, x, y) {
  const texts = document.querySelectorAll(".floating-text");
  if (texts.length >= 12) texts[0].remove();
  const el = document.createElement("div");
  el.className = "floating-text";
  el.textContent = text;
  el.style.left = x + "px";
  el.style.top = y + "px";
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 700);
}

function checkAchievements() {
  ACHIEVEMENTS_DATA.forEach(a => {
    if (!state.achievementsUnlocked.includes(a.id) && a.req(state)) {
      state.achievementsUnlocked.push(a.id);
      logMessage("[CONQUISTA] " + a.name + ": " + a.desc);
    }
  });
}

function handleCookieClick(event) {
  const amount = getClickPower();
  state.cookies += amount;
  state.totalBaked += amount;
  state.lifetimeBaked += amount;
  state.totalClicked++;
  const rect = event.currentTarget.getBoundingClientRect();
  spawnFloatingText("+" + formatNumber(amount, true),
    event.clientX || rect.left + rect.width / 2,
    event.clientY || rect.top + rect.height / 2);
  checkAchievements();
  renderUI();
}

function buyBuilding(id) {
  const b = BUILDINGS_DATA.find(x => x.id === id);
  if (!b) return;
  const cost = getBuildingCost(b);
  if (state.cookies < cost) return;
  state.cookies -= cost;
  state.buildings[id].count++;
  logMessage("Comprou " + b.name + " por " + formatNumber(cost) + " biscoitos.");
  checkAchievements();
  saveGame();
  renderUI();
}

function buyUpgrade(id) {
  const u = UPGRADES_DATA.find(x => x.id === id);
  if (!u || state.upgradesBought.includes(id) || state.cookies < u.cost || !u.req(state)) return;
  state.cookies -= u.cost;
  state.upgradesBought.push(id);
  reapplyUpgrades();
  $("upgrade-desc").textContent = "";
  logMessage("Melhoria adquirida: " + u.name + "!");
  saveGame();
  renderUI();
}

function updateCounters() {
  setText($("cookie-count"), formatNumber(state.cookies) + " biscoitos");
  setText($("cps-count"), "biscoitos por seg.: " + formatNumber(calculateCPS(), true));
  setText($("click-power-count"), "poder do clique: " + formatNumber(getClickPower(), true));
}

function activateTab(id) {
  if (!TAB_IDS.includes(id)) id = "tab-upgrades";
  document.querySelectorAll(".tab-btn").forEach(b => b.classList.toggle("active", b.dataset.tab === id));
  TAB_IDS.forEach(t => $(t).classList.toggle("active", t === id));
  try { localStorage.setItem(TAB_KEY, id); } catch (e) {}
  renderUI();
}

function restoreTab() {
  let id = null;
  try { id = localStorage.getItem(TAB_KEY); } catch (e) {}
  if (id && TAB_IDS.includes(id)) activateTab(id);
}

function isTabActive(id) { return $(id).classList.contains("active"); }

function renderUI() {
  updateCounters();
  renderBuildings();
  renderUpgrades();
  renderFrenzy();
  if (isTabActive("tab-achievements")) renderAchievements();
  if (isTabActive("tab-stats")) renderStats();
  if (isTabActive("tab-ascend")) renderAscension();
}

function renderFrenzy() {
  const box = $("frenzy-box");
  let visible = true;
  if (state.frenzyTimer > 0) {
    setText($("frenzy-name"), "FRENESI (x" + state.frenzyMultiplier + " CPS)");
    setText($("frenzy-time"), String(Math.ceil(state.frenzyTimer)));
  } else if (state.clickFrenzyTimer > 0) {
    setText($("frenzy-name"), "CLIQUE FRENÉTICO (x" + state.clickFrenzyMultiplier + ")");
    setText($("frenzy-time"), String(Math.ceil(state.clickFrenzyTimer)));
  } else {
    visible = false;
  }
  const v = visible ? "visible" : "hidden";
  if (box.style.visibility !== v) box.style.visibility = v;
}

function renderBuildings() {
  const shop = $("buildings-shop");
  BUILDINGS_DATA.forEach(b => {
    let btn = $("building-" + b.id);
    if (!btn) {
      btn = document.createElement("button");
      btn.id = "building-" + b.id;
      btn.className = "retro-btn";
      btn.innerHTML = '<div style="display:flex;justify-content:space-between;font-weight:bold"><span class="building-name"></span><span class="building-count"></span></div><div class="building-details" style="font-size:10px;color:#444"></div>';
      btn.querySelector(".building-name").textContent = b.icon + " " + b.name;
      btn.addEventListener("click", () => buyBuilding(b.id));
      shop.appendChild(btn);
    }
    const cost = getBuildingCost(b);
    btn.disabled = state.cookies < cost;
    setText(btn.querySelector(".building-count"), "[" + getBCount(b.id) + "]");
    setText(btn.querySelector(".building-details"),
      "Custo: " + formatNumber(cost) + " | +" + formatNumber(b.cps * state.buildings[b.id].mult, true) + " CPS cada");
  });
}

function renderUpgrades() {
  const container = $("upgrade-list");
  UPGRADES_DATA.forEach(u => {
    const existing = $("upgrade-" + u.id);
    const available = !state.upgradesBought.includes(u.id) && u.req(state);
    if (!available) { if (existing) existing.remove(); return; }
    let btn = existing;
    if (!btn) {
      btn = document.createElement("button");
      btn.id = "upgrade-" + u.id;
      btn.className = "upgrade-btn";
      btn.title = u.desc + " (Custo: " + formatNumber(u.cost) + ")";
      btn.textContent = u.icon + " " + u.name + " [" + formatNumber(u.cost) + "]";
      btn.addEventListener("click", () => buyUpgrade(u.id));
      const show = () => { $("upgrade-desc").textContent = u.desc; };
      btn.addEventListener("mouseenter", show);
      btn.addEventListener("focus", show);
      container.appendChild(btn);
    }
    btn.disabled = state.cookies < u.cost;
  });
  let empty = $("no-upgrades");
  const has = container.querySelector(".upgrade-btn") !== null;
  if (!has && !empty) {
    empty = document.createElement("span");
    empty.id = "no-upgrades";
    empty.style.cssText = "font-size:11px;color:#666";
    empty.textContent = "Sem melhorias disponíveis no momento.";
    container.appendChild(empty);
  } else if (has && empty) {
    empty.remove();
  }
}

function renderAchievements() {
  const list = $("achievements-list");
  setText($("achieve-count"), state.achievementsUnlocked.length + "/" + ACHIEVEMENTS_DATA.length);
  ACHIEVEMENTS_DATA.forEach(a => {
    let item = $("achievement-" + a.id);
    const unlocked = state.achievementsUnlocked.includes(a.id);
    if (!item) {
      item = document.createElement("div");
      item.id = "achievement-" + a.id;
      item.className = "badge-item";
      const title = document.createElement("b");
      const desc = document.createElement("span");
      desc.textContent = a.desc;
      item.append(title, document.createElement("br"), desc);
      list.appendChild(item);
    }
    item.classList.toggle("badge-locked", !unlocked);
    setText(item.querySelector("b"), (unlocked ? "[★] " : "[lock] ") + a.name);
  });
}

const STAT_ROWS = [
  ["Biscoitos em mãos", () => formatNumber(state.cookies)],
  ["Produção nesta rodada", () => formatNumber(state.totalBaked)],
  ["Produção total", () => formatNumber(state.lifetimeBaked)],
  ["Cliques", () => formatNumber(state.totalClicked)],
  ["Biscoitos dourados", () => formatNumber(state.goldenClicked)],
  ["Tempo de jogo", () => Math.floor((Date.now() - state.startTime) / 60000) + " minutos"],
  ["Chips ASCII", () => formatNumber(state.asciiChips)],
  ["Ascensões", () => formatNumber(state.prestigeResets)]
];
let statValueEls = null;

function renderStats() {
  const box = $("stats-container");
  if (!statValueEls) {
    statValueEls = [];
    const line = document.createElement("div");
    line.textContent = "----------------------------------";
    box.appendChild(line);
    STAT_ROWS.forEach(([label]) => {
      const row = document.createElement("div");
      row.className = "stat-row";
      const val = document.createElement("b");
      row.append(label + ": ", val);
      box.appendChild(row);
      statValueEls.push(val);
    });
    box.appendChild(line.cloneNode(true));
  }
  STAT_ROWS.forEach(([, fn], i) => setText(statValueEls[i], fn()));
}

// Chips totais merecidos pela produção de toda a vida; ganho = total - já possuídos.
function getPendingAscensionChips() {
  if (state.lifetimeBaked < 1e6) return 0;
  const total = Math.floor(Math.cbrt(state.lifetimeBaked / 1e6));
  return Math.max(0, total - state.asciiChips);
}

function renderAscension() {
  const gain = getPendingAscensionChips();
  setText($("ascend-chips-gain"), formatNumber(gain));
  setText($("ascend-chips-current"), formatNumber(state.asciiChips));
  setText($("ascend-bonus-current"), "+" + formatNumber(state.asciiChips) + "%");
  $("btn-ascend-action").disabled = gain <= 0;
}

function spawnGoldenCookie() {
  if ($("golden-cookie-btn")) return;
  const golden = document.createElement("button");
  golden.id = "golden-cookie-btn";
  golden.className = "golden-cookie";
  golden.textContent = "[ ★ BISCOITO DOURADO ★ ]";
  const maxX = Math.max(20, window.innerWidth - 240);
  const maxY = Math.max(20, window.innerHeight - 80);
  golden.style.left = (10 + Math.random() * (maxX - 10)) + "px";
  golden.style.top = (10 + Math.random() * (maxY - 10)) + "px";
  golden.addEventListener("click", () => { golden.remove(); triggerGoldenCookieEffect(); });
  document.body.appendChild(golden);
  setTimeout(() => golden.remove(), 12000);
}

function scheduleGolden() {
  clearTimeout(goldenTimeout);
  goldenTimeout = setTimeout(() => {
    if (document.visibilityState === "visible") spawnGoldenCookie();
    scheduleGolden();
  }, 45000 + Math.random() * 75000);
}

function triggerGoldenCookieEffect() {
  state.goldenClicked++;
  const r = Math.random();
  if (r < 0.45) {
    state.frenzyTimer = 77;
    state.frenzyMultiplier = 7;
    logMessage("EVENTO DOURADO: Frenesi! Produção x7 por 77 segundos!");
  } else if (r < 0.85) {
    const bonus = Math.max(15, Math.min(state.cookies * 0.15, calculateCPS() * 900)) + 13;
    state.cookies += bonus;
    state.totalBaked += bonus;
    state.lifetimeBaked += bonus;
    logMessage("EVENTO DOURADO: Você ganhou " + formatNumber(bonus) + " biscoitos!");
  } else {
    state.clickFrenzyTimer = 13;
    state.clickFrenzyMultiplier = 777;
    logMessage("EVENTO DOURADO: Cliques x777 por 13 segundos!");
  }
  checkAchievements();
  saveGame();
  renderUI();
}

function performAscension() {
  const chips = getPendingAscensionChips();
  if (chips <= 0) return;
  showConfirm(
    "Tem certeza que deseja ascender?\n\nVocê perderá biscoitos, construções e melhorias, mas ganhará " + chips + " Chips ASCII.",
    () => {
      const gain = getPendingAscensionChips();
      if (gain <= 0) return;
      state.asciiChips += gain;
      state.prestigeResets++;
      state.cookies = 0;
      state.totalBaked = 0;
      state.totalClicked = 0;
      state.upgradesBought = [];
      state.frenzyTimer = 0;
      state.frenzyMultiplier = 1;
      state.clickFrenzyTimer = 0;
      state.clickFrenzyMultiplier = 1;
      BUILDINGS_DATA.forEach(b => { state.buildings[b.id] = { count: 0, mult: 1 }; });
      reapplyUpgrades();
      checkAchievements();
      logMessage("Ascensão concluída! Você recebeu " + gain + " Chips ASCII.");
      saveGame();
      renderUI();
    }
  );
}

function applySaveData(data) {
  if (!data || typeof data !== "object") throw new Error("Save inválido.");
  state.cookies = safeNumber(data.cookies);
  state.totalBaked = safeNumber(data.totalBaked);
  state.lifetimeBaked = safeNumber(data.lifetimeBaked, state.totalBaked);
  state.totalClicked = safeNumber(data.totalClicked);
  state.goldenClicked = safeNumber(data.goldenClicked);
  state.asciiChips = Math.floor(safeNumber(data.asciiChips));
  state.prestigeResets = Math.floor(safeNumber(data.prestigeResets));
  state.startTime = safeNumber(data.startTime, Date.now());
  state.frenzyTimer = safeNumber(data.frenzyTimer);
  state.frenzyMultiplier = Math.max(1, safeNumber(data.frenzyMultiplier, 1));
  state.clickFrenzyTimer = safeNumber(data.clickFrenzyTimer);
  state.clickFrenzyMultiplier = Math.max(1, safeNumber(data.clickFrenzyMultiplier, 1));
  state.upgradesBought = Array.isArray(data.upgradesBought)
    ? [...new Set(data.upgradesBought)].filter(id => UPGRADES_DATA.some(u => u.id === id)) : [];
  state.achievementsUnlocked = Array.isArray(data.achievementsUnlocked)
    ? [...new Set(data.achievementsUnlocked)].filter(id => ACHIEVEMENTS_DATA.some(a => a.id === id)) : [];
  BUILDINGS_DATA.forEach(b => {
    const sb = data.buildings && data.buildings[b.id];
    state.buildings[b.id] = { count: sb ? Math.floor(safeNumber(sb.count)) : 0, mult: 1 };
  });
  reapplyUpgrades();
}

function saveGame() {
  if (wiping) return false;
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify(Object.assign({}, state, { version: SAVE_VERSION, savedAt: Date.now() })));
    return true;
  } catch (e) {
    console.error("Erro ao salvar o jogo:", e);
    return false;
  }
}

function storageAvailable() {
  try {
    const k = "asciicookie.__test";
    localStorage.setItem(k, "1");
    localStorage.removeItem(k);
    return true;
  } catch (e) { return false; }
}

function formatDuration(sec) {
  if (sec >= 3600) return (sec / 3600).toFixed(1).replace(".", ",") + " h";
  return Math.max(1, Math.round(sec / 60)) + " min";
}

function grantOfflineProgress(savedAt) {
  const elapsed = Math.min((Date.now() - safeNumber(savedAt, Date.now())) / 1000, OFFLINE_CAP);
  if (!Number.isFinite(elapsed) || elapsed < 60) return;
  state.frenzyTimer = Math.max(0, state.frenzyTimer - elapsed);
  if (state.frenzyTimer === 0) state.frenzyMultiplier = 1;
  state.clickFrenzyTimer = Math.max(0, state.clickFrenzyTimer - elapsed);
  if (state.clickFrenzyTimer === 0) state.clickFrenzyMultiplier = 1;
  const gain = calculateCPS() * elapsed * OFFLINE_RATE;
  if (gain > 0) {
    state.cookies += gain;
    state.totalBaked += gain;
    state.lifetimeBaked += gain;
    logMessage("Você ficou fora por " + formatDuration(elapsed) + " e seus biscoitos renderam +" + formatNumber(gain) + ".");
  }
}

function loadGame() {
  if (!storageAvailable()) {
    logMessage("ATENÇÃO: o navegador bloqueou o armazenamento; o progresso NÃO será salvo.");
  }
  let saved = null, legacy = false;
  try {
    saved = localStorage.getItem(SAVE_KEY);
    if (!saved) { saved = localStorage.getItem(LEGACY_KEY); legacy = !!saved; }
  } catch (e) { /* indisponível */ }
  if (!saved) { logMessage("Bem-vindo ao Cookie Clicker ASCII 2006!"); return; }
  try {
    const data = JSON.parse(saved);
    applySaveData(data);
    logMessage("Save carregado com sucesso!");
    if (legacy) {
      saveGame();
      try { localStorage.removeItem(LEGACY_KEY); } catch (e) {}
      logMessage("Save antigo migrado para o novo formato.");
    }
    grantOfflineProgress(data.savedAt);
  } catch (e) {
    console.error("Erro ao carregar o save:", e);
    state = createInitialState();
    try {
      localStorage.setItem(SAVE_KEY + ".corrupt", saved); // guarda cópia em vez de perder
      localStorage.removeItem(SAVE_KEY);
      localStorage.removeItem(LEGACY_KEY);
    } catch (_) {}
    logMessage("Save inválido; um jogo novo foi iniciado.");
  }
}

function checksum(str) {
  let h = 5381;
  for (let i = 0; i < str.length; i++) h = ((h << 5) + h + str.charCodeAt(i)) >>> 0;
  return h.toString(16);
}

function toBase64(str) {
  let bin = "";
  new TextEncoder().encode(str).forEach(b => { bin += String.fromCharCode(b); });
  return btoa(bin);
}

function fromBase64(b64) {
  const bin = atob(b64);
  return new TextDecoder().decode(Uint8Array.from(bin, c => c.charCodeAt(0)));
}

function exportSaveCode() {
  try {
    const json = JSON.stringify(Object.assign({}, state, { version: SAVE_VERSION, savedAt: Date.now() }));
    const b64 = toBase64(json);
    $("save-code-input").value = "ACC2." + b64 + "." + checksum(b64);
    $("modal-export").style.display = "flex";
  } catch (e) {
    showAlert("Não foi possível exportar o save.");
  }
}

function importSaveCode() {
  const code = $("save-code-input").value.replace(/\s+/g, "");
  if (!code) { showAlert("Cole um código de save antes de carregar."); return; }
  const previous = state;
  try {
    let payload = code;
    if (code.startsWith("ACC2.")) {
      const parts = code.split(".");
      if (parts.length !== 3 || checksum(parts[1]) !== parts[2]) throw new Error("Código incompleto ou alterado.");
      payload = parts[1];
    }
    const parsed = JSON.parse(fromBase64(payload));
    state = createInitialState();
    applySaveData(parsed);
    if (!saveGame()) throw new Error("Falha ao gravar.");
    location.reload();
  } catch (e) {
    state = previous;
    showAlert("Código de save inválido ou incompleto.");
  }
}

function wipeSave() {
  showConfirm("Deseja apagar todo o progresso? Esta ação não pode ser desfeita.", () => {
    wiping = true; // impede que beforeunload/autosave regravem o progresso
    try { localStorage.removeItem(SAVE_KEY); localStorage.removeItem(LEGACY_KEY); localStorage.removeItem(TAB_KEY); } catch (e) {}
    location.reload();
  });
}

function gameTick() {
  const now = Date.now();
  let delta = (now - lastTickTime) / 1000;
  lastTickTime = now;
  if (!Number.isFinite(delta) || delta <= 0) return;
  delta = Math.min(delta, MAX_DELTA);

  const earned = calculateCPS() * delta;
  state.cookies += earned;
  state.totalBaked += earned;
  state.lifetimeBaked += earned;

  if (state.frenzyTimer > 0) {
    state.frenzyTimer = Math.max(0, state.frenzyTimer - delta);
    if (state.frenzyTimer === 0) { state.frenzyMultiplier = 1; logMessage("O efeito de Frenesi acabou."); }
  }
  if (state.clickFrenzyTimer > 0) {
    state.clickFrenzyTimer = Math.max(0, state.clickFrenzyTimer - delta);
    if (state.clickFrenzyTimer === 0) { state.clickFrenzyMultiplier = 1; logMessage("O efeito de Clique Frenético acabou."); }
  }
  checkAchievements();
  if (document.visibilityState === "visible") renderUI();
}

window.addEventListener("DOMContentLoaded", () => {
  $("banner").textContent = boxText(["COOKIE CLICKER", "[ EDICAO ASCII 2006 ] v2.2"], 60);
  $("footer").textContent = boxText(["Cookie Clicker ASCII Edition (c) 2006"], 60);
  $("cookie-clicker").textContent = COOKIE_ART;

  loadGame();
  checkAchievements();
  renderAchievements();
  renderUI();

  const cookie = $("cookie-clicker");
  cookie.addEventListener("click", handleCookieClick);
  cookie.addEventListener("keydown", e => {
    if (e.key === "Enter" || e.key === " ") { e.preventDefault(); cookie.click(); }
  });

  document.querySelectorAll(".tab-btn").forEach(btn => {
    btn.addEventListener("click", () => activateTab(btn.dataset.tab));
  });
  restoreTab();

  $("btn-save").addEventListener("click", () => {
    showAlert(saveGame() ? "Jogo salvo no navegador!" : "Não foi possível salvar. Verifique o armazenamento do navegador.");
  });
  $("btn-export").addEventListener("click", exportSaveCode);
  $("btn-wipe").addEventListener("click", wipeSave);
  $("btn-ascend-action").addEventListener("click", performAscension);
  $("btn-load-code").addEventListener("click", importSaveCode);
  $("btn-close-export-modal").addEventListener("click", () => { $("modal-export").style.display = "none"; });
  $("btn-close-alert-modal").addEventListener("click", () => { $("modal-alert").style.display = "none"; });
  $("btn-confirm-yes").addEventListener("click", () => {
    $("modal-confirm").style.display = "none";
    const cb = confirmCallback;
    confirmCallback = null;
    if (cb) cb();
  });
  $("btn-confirm-no").addEventListener("click", () => {
    $("modal-confirm").style.display = "none";
    confirmCallback = null;
  });
  $("btn-copy-code").addEventListener("click", async () => {
    const input = $("save-code-input");
    try { await navigator.clipboard.writeText(input.value); }
    catch (e) { input.select(); try { document.execCommand("copy"); } catch (_) {} }
    showAlert("Código copiado!");
  });

  window.addEventListener("beforeunload", saveGame);
  window.addEventListener("pagehide", saveGame);
  window.addEventListener("pageshow", e => {
    if (e.persisted) { lastTickTime = Date.now(); renderUI(); }
  });
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") saveGame(); else renderUI();
  });

  $("news-text").textContent = NEWS_LIST[newsIndex];
  setInterval(() => {
    newsIndex = (newsIndex + 1) % NEWS_LIST.length;
    $("news-text").textContent = NEWS_LIST[newsIndex];
  }, 9000);

  setInterval(saveGame, 30000);
  scheduleGolden();
  lastTickTime = Date.now();
  setInterval(gameTick, 250);
});