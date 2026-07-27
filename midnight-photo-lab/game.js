(function () {
  "use strict";

  const SAVE_KEY = "midnight-photo-lab-save-v1";
  const STATION_DEFS = [
    { id: "developer", name: "現像槽", time: 4000, auto: 40, speed: 18, capacity: 28 },
    { id: "dryer", name: "乾燥機", time: 5000, auto: 70, speed: 28, capacity: 42 },
    { id: "scanner", name: "スキャナー", time: 4000, auto: 110, speed: 42, capacity: 65 },
    { id: "color", name: "色補正卓", time: 6000, auto: 170, speed: 62, capacity: 95 },
    { id: "printer", name: "プリンター", time: 5000, auto: 250, speed: 90, capacity: 135 },
    { id: "frame", name: "額装台", time: 7000, auto: 360, speed: 125, capacity: 190 }
  ];
  const THEMES = ["雨の駅", "月と鉄塔", "夜の海", "青い路地", "眠る猫", "ネオンの喫茶店", "湖面の月", "古い観覧車", "深夜の横断歩道", "花束と窓辺", "夜行列車", "雨上がりの屋上"];
  const RARITIES = {
    common: { label: "コモン", value: 12 }, uncommon: { label: "アンコモン", value: 22 },
    rare: { label: "レア", value: 45 }, masterpiece: { label: "マスターピース", value: 100 }
  };
  let nextFilmId = 1;
  let selected = 0;
  let lastFrame = Date.now();
  let dirty = true;
  let audioContext = null;

  function initialState() {
    return {
      money: 20, completedCount: 0, incomingQueue: [],
      stations: STATION_DEFS.map(() => ({ queue: [], current: null, automated: false, speedLevel: 0, capacityLevel: 0 })),
      album: [], logs: ["午前二時。現像所を開きました。"], settings: { sound: false, reducedMotion: false },
      lastSavedAt: Date.now(), goalReached: false, nextArrivalAt: Date.now() + randomArrival()
    };
  }
  let state = initialState();

  const $ = (id) => document.getElementById(id);
  const dom = {};
  function randomArrival() { return 5000 + Math.random() * 3000; }
  function seeded(seed) { let x = seed | 0; return function () { x = Math.imul(x ^ x >>> 15, 1 | x); x ^= x + Math.imul(x ^ x >>> 7, 61 | x); return ((x ^ x >>> 14) >>> 0) / 4294967296; }; }
  function rarityRoll(rand) { const n = rand(); return n < .01 ? "masterpiece" : n < .10 ? "rare" : n < .35 ? "uncommon" : "common"; }
  function makeFilm() {
    const seed = Math.floor(Math.random() * 2147483647); const rand = seeded(seed); const rarity = rarityRoll(rand);
    return { id: nextFilmId++, theme: THEMES[Math.floor(rand() * THEMES.length)], rarity, seed, stage: -1, value: RARITIES[rarity].value, status: "受付待ち", createdAt: Date.now() };
  }
  function stationCapacity(st) { return 1 + st.capacityLevel; }
  function processDuration(index) { return STATION_DEFS[index].time * Math.pow(.85, state.stations[index].speedLevel); }
  function log(message) { state.logs.push(message); state.logs = state.logs.slice(-6); dirty = true; }

  function arrive(now) {
    if (now < state.nextArrivalAt) return;
    if (state.incomingQueue.length < 8) { const film = makeFilm(); state.incomingQueue.push(film); log(`「${film.theme}」のフィルムを預かりました`); }
    else if (state.logs[state.logs.length - 1] !== "受付がいっぱいです") log("受付がいっぱいです");
    state.nextArrivalAt = now + randomArrival();
  }
  function feedQueues() {
    const first = state.stations[0];
    while (state.incomingQueue.length && first.queue.length < stationCapacity(first)) {
      const film = state.incomingQueue.shift(); film.stage = 0; film.status = "待機中"; first.queue.push(film);
    }
  }
  function startStation(index, manual) {
    const st = state.stations[index];
    if (st.current || !st.queue.length) return false;
    if (!manual && !st.automated) return false;
    const film = st.queue.shift(); film.status = "処理中"; st.current = { film, startedAt: Date.now(), duration: processDuration(index), done: false };
    sound("start"); dirty = true; return true;
  }
  function updateStations(now) {
    state.stations.forEach((st, i) => {
      if (st.current && !st.current.done && now - st.current.startedAt >= st.current.duration) {
        st.current.done = true; st.current.film.status = "次工程への移動待ち"; log(`「${st.current.film.theme}」の${STATION_DEFS[i].name}が完了しました`);
      }
      if (st.current && st.current.done) {
        if (i === state.stations.length - 1) completeFilm(st.current.film);
        else {
          const next = state.stations[i + 1];
          if (next.queue.length < stationCapacity(next)) { const film = st.current.film; film.stage = i + 1; film.status = "待機中"; next.queue.push(film); st.current = null; dirty = true; }
        }
      }
      if (st.automated) startStation(i, false);
    });
  }
  function completeFilm(film, quiet) {
    state.stations[5].current = null; state.money += film.value; state.completedCount++;
    const photo = { id: film.id, theme: film.theme, rarity: film.rarity, seed: film.seed, value: film.value, firstObtainedAt: new Date().toISOString(), number: state.completedCount };
    state.album.unshift(photo); state.album = state.album.slice(0, 50);
    if (!quiet) { log(`${film.rarity === "rare" || film.rarity === "masterpiece" ? "希少な" : ""}写真「${film.theme}」が完成しました`); log(`売上を${film.value}獲得しました`); showMoney(film.value); sound(film.rarity === "common" ? "complete" : "rare"); }
    checkGoal(); dirty = true;
  }
  function checkGoal() {
    if (!state.goalReached && state.completedCount >= 25 && state.stations.every(s => s.automated)) {
      state.goalReached = true; document.body.classList.add("goal-reached");
      showModal("夜明けの気配", "<p>25枚の夜が、壁を彩りました。</p><p><strong>現像所は、あなたの手を離れて動き始めた。</strong></p><p>窓の外が、わずかに朝へ近づいています。ゲームはこのまま続けられます。</p>", true); sound("rare"); save();
    }
  }
  function tick() {
    const now = Date.now(); lastFrame = now; arrive(now); feedQueues(); updateStations(now); updateDynamic(now);
    if (dirty) { render(); dirty = false; }
    requestAnimationFrame(tick);
  }

  function buildStations() {
    dom.stationEls = [];
    STATION_DEFS.forEach((def, i) => {
      const el = document.createElement("button"); el.className = "station"; el.dataset.id = def.id; el.dataset.index = i;
      el.title = `${i + 1}: ${def.name}`; el.innerHTML = `<h3>${i + 1}. ${def.name}</h3><div class="machine"></div><small class="state">待機中</small><div class="progress-track"><div class="progress-fill"></div></div>`;
      el.addEventListener("click", () => { selected = i; dirty = true; }); $("stations").appendChild(el); dom.stationEls.push(el);
    });
  }
  function render() {
    $("money").textContent = state.money; $("completed").textContent = state.completedCount; $("autoCount").textContent = state.stations.filter(s => s.automated).length;
    $("queueCount").textContent = `${state.incomingQueue.length} / 8`; $("incomingQueue").innerHTML = state.incomingQueue.map(f => `<span class="queue-film" title="${f.theme}">#${f.id}</span>`).join("");
    state.stations.forEach((st, i) => {
      const el = dom.stationEls[i]; el.classList.toggle("selected", i === selected); el.classList.toggle("running", !!st.current); el.classList.toggle("auto", st.automated);
      const text = st.current ? (st.current.done ? "移動待ち" : "処理中") : st.queue.length ? `待機 ${st.queue.length}本` : "待機中"; el.querySelector(".state").textContent = `${text}${st.automated ? "・自動" : ""}`;
    });
    renderUpgrade(); renderLogs(); renderRecent(); renderWall(); $("albumCount").textContent = `${state.album.length} / 50`; $("emptyAlbum").hidden = state.album.length > 0;
    document.body.classList.toggle("reduced-motion", state.settings.reducedMotion); document.body.classList.toggle("goal-reached", state.goalReached);
  }
  function updateDynamic(now) {
    const minutes = Math.min(239, Math.floor((state.completedCount / 25) * 210)); $("nightClock").textContent = `${String(2 + Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
    $("nextArrival").textContent = state.incomingQueue.length >= 8 ? "受付停止中：空きを作ってください" : `次の到着まで ${Math.max(0, Math.ceil((state.nextArrivalAt - now) / 1000))}秒`;
    state.stations.forEach((st, i) => { const fill = dom.stationEls[i].querySelector(".progress-fill"); if (st.current) { const p = st.current.done ? 100 : Math.min(100, (now - st.current.startedAt) / st.current.duration * 100); fill.style.width = `${p}%`; dom.stationEls[i].querySelector(".state").textContent = st.current.done ? "次の工程に空き待ち" : `処理中 ${(Math.max(0, st.current.duration - now + st.current.startedAt) / 1000).toFixed(1)}秒`; } else fill.style.width = "0"; });
  }
  function renderUpgrade() {
    const st = state.stations[selected], def = STATION_DEFS[selected]; $("selectedTitle").textContent = `${selected + 1}. ${def.name}`;
    $("selectedState").textContent = `待機 ${st.queue.length}/${stationCapacity(st)}・速度 ${Math.round(processDuration(selected) / 100) / 10}秒`;
    $("workButton").disabled = !!st.current || !st.queue.length; $("workButton").textContent = st.automated ? "自動運転中" : "作業する Space";
    const speedCost = def.speed + st.speedLevel * Math.ceil(def.speed * .65), capCost = def.capacity + st.capacityLevel * Math.ceil(def.capacity * .8);
    $("upgradeButtons").innerHTML = `
      <button class="upgrade" data-upgrade="auto" ${st.automated ? "disabled" : ""}><span>自動化 ${st.automated ? "導入済み" : ""}</span><em>${st.automated ? "✓" : def.auto}</em></button>
      <button class="upgrade" data-upgrade="speed" ${st.speedLevel >= 3 ? "disabled" : ""}><span>高速化 Lv.${st.speedLevel}/3</span><em>${st.speedLevel >= 3 ? "MAX" : speedCost}</em></button>
      <button class="upgrade" data-upgrade="capacity" ${st.capacityLevel >= 2 ? "disabled" : ""}><span>容量増加 Lv.${st.capacityLevel}/2</span><em>${st.capacityLevel >= 2 ? "MAX" : capCost}</em></button>`;
    $("upgradeButtons").querySelectorAll("button").forEach(b => b.addEventListener("click", () => buyUpgrade(b.dataset.upgrade)));
  }
  function buyUpgrade(type) {
    const st = state.stations[selected], def = STATION_DEFS[selected]; let cost;
    if (type === "auto") { if (st.automated) return; cost = def.auto; }
    if (type === "speed") { if (st.speedLevel >= 3) return; cost = def.speed + st.speedLevel * Math.ceil(def.speed * .65); }
    if (type === "capacity") { if (st.capacityLevel >= 2) return; cost = def.capacity + st.capacityLevel * Math.ceil(def.capacity * .8); }
    if (state.money < cost) { $("buyReason").textContent = `売上があと${cost - state.money}必要です`; return; }
    state.money -= cost; if (type === "auto") { st.automated = true; log(`${def.name}を自動化しました`); } else if (type === "speed") { st.speedLevel++; log(`${def.name}を高速化しました`); } else { st.capacityLevel++; log(`${def.name}の容量を増やしました`); }
    $("buyReason").textContent = "導入しました"; sound("button"); checkGoal(); save(); dirty = true;
  }
  function renderLogs() { $("eventLog").innerHTML = state.logs.slice().reverse().map(x => `<li>${x}</li>`).join(""); }
  function photoCard(photo) { return `<button class="album-card ${photo.rarity === "rare" || photo.rarity === "masterpiece" ? "rare" : ""}" data-photo="${photo.id}"><canvas width="64" height="48"></canvas><h3>${photo.theme}</h3><p class="rarity-${photo.rarity}">${RARITIES[photo.rarity].label} ・ ${photo.value}</p><p>撮影番号 #${photo.number}</p><p>${new Date(photo.firstObtainedAt).toLocaleString("ja-JP")}</p></button>`; }
  function renderAlbum() { $("albumGrid").innerHTML = state.album.map(photoCard).join(""); $("albumGrid").querySelectorAll(".album-card").forEach((el, i) => { drawPhoto(el.querySelector("canvas"), state.album[i]); el.addEventListener("click", () => previewPhoto(state.album[i])); }); }
  function renderRecent() { const p = state.album[0]; if (!p) return; $("recentPhoto").innerHTML = `<canvas width="64" height="48"></canvas><strong>${p.theme}</strong><p class="rarity-${p.rarity}">${RARITIES[p.rarity].label} ・ +${p.value}</p>`; drawPhoto($("recentPhoto").querySelector("canvas"), p); }
  function renderWall() { $("wallPhotos").innerHTML = state.album.slice(0, 3).map(() => `<canvas width="64" height="48"></canvas>`).join(""); $("wallPhotos").querySelectorAll("canvas").forEach((c, i) => drawPhoto(c, state.album[i])); }

  function drawPhoto(canvas, photo) {
    const c = canvas.getContext("2d"), r = seeded(photo.seed), rare = photo.rarity === "rare" || photo.rarity === "masterpiece";
    c.imageSmoothingEnabled = false; c.fillStyle = "#07142f"; c.fillRect(0, 0, 64, 48);
    const variant = THEMES.indexOf(photo.theme) % 6;
    c.fillStyle = variant % 2 ? "#10275b" : "#193ca3"; c.fillRect(0, 20, 64, 28);
    c.fillStyle = rare ? "#ecd283" : "#9aafef"; c.fillRect(45 + Math.floor(r() * 8), 5, 8, 8);
    if (variant === 0 || variant === 4) { c.fillStyle = "#091a38"; for (let x = 0; x < 64; x += 12) c.fillRect(x, 20 - Math.floor(r() * 8), 9, 28); c.fillStyle = "#e1b941"; for (let x = 3; x < 60; x += 11) if (r() > .35) c.fillRect(x, 25 + Math.floor(r() * 12), 3, 4); }
    if (variant === 1) { c.fillStyle = "#07142f"; c.fillRect(29, 12, 3, 29); c.fillRect(20, 22, 22, 2); c.fillRect(24, 16, 14, 2); }
    if (variant === 2) { for (let y = 25; y < 47; y += 4) { c.fillStyle = y % 8 ? "#4169e1" : "#9aafef"; c.fillRect(Math.floor(r() * 8), y, 55, 2); } c.fillStyle = "#e1b941"; c.fillRect(48, 22, 3, 20); }
    if (variant === 3) { c.fillStyle = "#07142f"; c.fillRect(0, 28, 64, 20); c.fillStyle = "#9aafef"; for (let i = 0; i < 10; i++) c.fillRect(Math.floor(r() * 64), Math.floor(r() * 48), 1, 6); }
    if (variant === 5) { c.fillStyle = "#050b19"; c.fillRect(19, 29, 25, 10); c.fillRect(24, 24, 13, 8); c.fillRect(21, 22, 4, 5); c.fillRect(36, 22, 4, 5); }
    const lights = rare ? 15 : photo.rarity === "uncommon" ? 8 : 4; c.fillStyle = rare ? "#e1b941" : "#9aafef"; for (let i = 0; i < lights; i++) c.fillRect(Math.floor(r() * 64), Math.floor(r() * 25), r() > .7 ? 2 : 1, 1);
    if (rare) { c.strokeStyle = "#e1b941"; c.lineWidth = 2; c.strokeRect(1, 1, 62, 46); }
  }
  function previewPhoto(photo) { showModal(photo.theme, `<canvas id="previewCanvas" class="preview-canvas" width="64" height="48"></canvas><p class="rarity-${photo.rarity}">${RARITIES[photo.rarity].label} ・ 売値 ${photo.value}</p><p>撮影番号 #${photo.number}<br>${new Date(photo.firstObtainedAt).toLocaleString("ja-JP")}</p>`); drawPhoto($("previewCanvas"), photo); }
  function showModal(title, html, goal) { $("modalTitle").textContent = title; $("modalBody").innerHTML = html; $("modal").hidden = false; $("modal").querySelector(".modal-card").classList.toggle("goal", !!goal); $("modalClose").focus(); }
  function closeModal() { $("modal").hidden = true; }
  function showMoney(amount) { const e = document.createElement("div"); e.className = "float-money"; e.textContent = `+${amount}`; $("toast").appendChild(e); setTimeout(() => e.remove(), 1900); }

  function save() { $("saveStatus").textContent = "保存中…"; try { state.lastSavedAt = Date.now(); localStorage.setItem(SAVE_KEY, JSON.stringify(state)); setTimeout(() => $("saveStatus").textContent = "保存しました", 180); } catch (e) { $("saveStatus").textContent = "保存エラー"; } }
  function load() {
    try { const raw = localStorage.getItem(SAVE_KEY); if (!raw) return; const data = JSON.parse(raw); state = Object.assign(initialState(), data); state.settings = Object.assign({ sound: false, reducedMotion: false }, data.settings); state.stations = STATION_DEFS.map((_, i) => Object.assign({ queue: [], current: null, automated: false, speedLevel: 0, capacityLevel: 0 }, data.stations[i]));
      const ids = [...state.incomingQueue, ...state.stations.flatMap(s => [...s.queue, ...(s.current ? [s.current.film] : [])]), ...state.album].map(x => x.id || 0); nextFilmId = Math.max(0, ...ids) + 1; offlineProgress(Date.now() - (data.lastSavedAt || Date.now()));
    } catch (e) { state = initialState(); log("セーブを読み込めなかったため、新しい夜を始めました"); }
  }
  function offlineProgress(elapsed) {
    if (elapsed < 15000 || !state.stations.every(s => s.automated)) return; const capped = Math.min(elapsed, 7200000); const cycle = Math.max(...state.stations.map((_, i) => processDuration(i))); const count = Math.min(120, Math.floor(capped / cycle)); if (!count) return;
    let earned = 0; for (let i = 0; i < count; i++) { const f = makeFilm(); earned += f.value; state.money += f.value; state.completedCount++; state.album.unshift({ id: f.id, theme: f.theme, rarity: f.rarity, seed: f.seed, value: f.value, firstObtainedAt: new Date().toISOString(), number: state.completedCount }); } state.album = state.album.slice(0, 50); setTimeout(() => showModal("留守の間の現像", `<p>留守の間に<strong>${count}枚</strong>の写真が完成し、売上<strong>${earned}</strong>を獲得しました。</p>`), 200);
  }
  function sound(type) { if (!state.settings.sound) return; audioContext = audioContext || new (window.AudioContext || window.webkitAudioContext)(); const osc = audioContext.createOscillator(), gain = audioContext.createGain(); osc.connect(gain); gain.connect(audioContext.destination); osc.type = "square"; osc.frequency.value = type === "rare" ? 740 : type === "complete" ? 520 : 180; gain.gain.setValueAtTime(.035, audioContext.currentTime); gain.gain.exponentialRampToValueAtTime(.001, audioContext.currentTime + .15); osc.start(); osc.stop(audioContext.currentTime + .16); }

  function bind() {
    $("workButton").addEventListener("click", () => startStation(selected, true));
    document.querySelectorAll(".tab").forEach(btn => btn.addEventListener("click", () => { document.querySelectorAll(".tab,.screen").forEach(x => x.classList.remove("active")); btn.classList.add("active"); $(btn.dataset.tab).classList.add("active"); if (btn.dataset.tab === "album") renderAlbum(); }));
    $("modalClose").addEventListener("click", closeModal); $("modal").addEventListener("click", e => { if (e.target.dataset.close) closeModal(); });
    $("soundToggle").addEventListener("change", e => { state.settings.sound = e.target.checked; sound("button"); save(); });
    $("motionToggle").addEventListener("change", e => { state.settings.reducedMotion = e.target.checked; dirty = true; save(); });
    $("saveNow").addEventListener("click", save); $("resetSave").addEventListener("click", () => { if (confirm("セーブデータを削除し、最初から始めますか？\nこの操作は取り消せません。")) { localStorage.removeItem(SAVE_KEY); location.reload(); } });
    document.addEventListener("keydown", e => { if (e.key === "Escape") closeModal(); if (!$("modal").hidden) return; if (/^[1-6]$/.test(e.key)) { selected = Number(e.key) - 1; dirty = true; } if (e.code === "Space" && !["INPUT", "BUTTON"].includes(document.activeElement.tagName)) { e.preventDefault(); startStation(selected, true); } });
  }
  buildStations(); bind(); load(); $("soundToggle").checked = state.settings.sound; $("motionToggle").checked = state.settings.reducedMotion; render(); setInterval(save, 5000); requestAnimationFrame(tick);
}());
