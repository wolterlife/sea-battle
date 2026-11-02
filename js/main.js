import {
  FLEET,
  LETTERS,
  applyFog,
  canPlace,
  clampOrigin,
  coordName,
  emptyBoard,
  emptyFog,
  fireAt,
  fleetComplete,
  placeShip,
  placedCount,
  randomBoard,
  removeShip,
  shipName,
  sunkShips,
  wrecksFromFog,
} from "./engine.js";
import { startSea } from "./sea.js";

const root = document.querySelector("#root");
const toastEl = document.querySelector("#toast");
const soundBtn = document.querySelector("#sound");
const sea = startSea(document.querySelector("#sea"));
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

const state = {
  phase: "lobby",
  rendered: "",
  mode: null,
  name: localStorage.getItem("sb-name") || "Капитан",
  roomInput: new URLSearchParams(location.search).get("room")?.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 4) || "",
  room: "",
  host: false,
  connected: false,
  foeName: "Соперник",
  meReady: false,
  foeReady: false,
  turn: "me",
  pending: false,
  board: emptyBoard(),
  fog: emptyFog(),
  selected: "4",
  dir: "h",
  hover: null,
  mobileView: "own",
  log: [],
  enemySunk: 0,
  winner: null,
  lastMark: null,
  curtain: null,
  rematchMe: false,
  rematchFoe: false,
  players: null,
  error: "",
};

const audio = {
  ctx: null,
  muted: localStorage.getItem("sb-muted") === "1",
  ensure() {
    if (this.muted) return null;
    if (!this.ctx) this.ctx = new AudioContext();
    if (this.ctx.state === "suspended") this.ctx.resume();
    return this.ctx;
  },
  tone(freq, dur, type = "sine", gain = 0.05, slide = 0) {
    const ctx = this.ensure();
    if (!ctx) return;
    const osc = ctx.createOscillator();
    const amp = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, ctx.currentTime);
    if (slide) osc.frequency.exponentialRampToValueAtTime(Math.max(40, freq + slide), ctx.currentTime + dur);
    amp.gain.setValueAtTime(gain, ctx.currentTime);
    amp.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + dur);
    osc.connect(amp).connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + dur);
  },
  noise(dur, gain = 0.04) {
    const ctx = this.ensure();
    if (!ctx) return;
    const count = Math.floor(ctx.sampleRate * dur);
    const buffer = ctx.createBuffer(1, count, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < count; i += 1) data[i] = (Math.random() * 2 - 1) * (1 - i / count);
    const src = ctx.createBufferSource();
    const amp = ctx.createGain();
    const filter = ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = 900;
    src.buffer = buffer;
    amp.gain.value = gain;
    src.connect(filter).connect(amp).connect(ctx.destination);
    src.start();
  },
  place() { this.tone(520, 0.08, "triangle", 0.03); },
  miss() { this.tone(680, 0.12, "sine", 0.04, -280); },
  hit() { this.noise(0.18, 0.05); this.tone(140, 0.2, "sawtooth", 0.03); },
  sunk() { this.noise(0.28, 0.06); this.tone(220, 0.35, "triangle", 0.05, -160); },
  win() { [523, 659, 784, 1046].forEach((freq, i) => setTimeout(() => this.tone(freq, 0.18, "triangle", 0.05), i * 120)); },
};

soundBtn.setAttribute("aria-pressed", audio.muted ? "true" : "false");
soundBtn.addEventListener("click", () => {
  audio.muted = !audio.muted;
  localStorage.setItem("sb-muted", audio.muted ? "1" : "0");
  soundBtn.setAttribute("aria-pressed", audio.muted ? "true" : "false");
  if (!audio.muted) audio.place();
});

let toastTimer = 0;
function toast(text) {
  toastEl.textContent = text;
  toastEl.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove("show"), 2200);
}

function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, (ch) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[ch]));
}

function sanitizeName(value) {
  const clean = String(value || "").replace(/\s+/g, " ").trim().slice(0, 16);
  return clean || "Капитан";
}

function pushLog(text) {
  state.log.unshift(text);
  state.log = state.log.slice(0, 4);
}

function freshMatch() {
  state.board = emptyBoard();
  state.fog = emptyFog();
  state.meReady = false;
  state.foeReady = false;
  state.turn = state.host ? "me" : "foe";
  state.pending = false;
  state.selected = "4";
  state.dir = "h";
  state.hover = null;
  state.mobileView = "own";
  state.log = [];
  state.enemySunk = 0;
  state.winner = null;
  state.lastMark = null;
  state.rematchMe = false;
  state.rematchFoe = false;
  state.curtain = null;
}

const net = {
  peer: null,
  conn: null,
  tries: 0,
  ping: 0,
  heard: 0,
  bind(conn) {
    this.conn = conn;
    conn.on("open", () => {
      state.connected = true;
      state.error = "";
      this.heard = Date.now();
      this.send({ t: "hello", name: state.name });
      if (state.meReady) this.send({ t: "ready" });
      if (state.phase === "connecting" || state.phase === "wait") state.phase = "place";
      commit();
    });
    conn.on("data", (msg) => this.onData(msg));
    conn.on("close", () => {
      if (this.conn !== conn || state.phase === "connecting") return;
      this.lost();
    });
  },
  send(msg) {
    if (this.conn?.open) this.conn.send(msg);
  },
  lost() {
    if (!state.mode || state.phase === "lobby") return;
    state.connected = false;
    state.error = "Связь с капитаном прервалась.";
    state.phase = "disconnect";
    commit();
  },
  stop() {
    clearInterval(this.ping);
    this.conn?.close();
    this.peer?.destroy();
    this.conn = null;
    this.peer = null;
  },
  startPeer(id) {
    clearInterval(this.ping);
    if (typeof Peer === "undefined") {
      state.error = "В этом браузере нет WebRTC, онлайн-бой недоступен.";
      state.phase = "disconnect";
      commit();
      return;
    }
    this.peer = new Peer(id || undefined, {
      debug: 0,
      config: {
        iceServers: [
          { urls: "stun:stun.l.google.com:19302" },
          { urls: "stun:stun1.l.google.com:19302" },
        ],
      },
    });
    this.peer.on("open", () => {
      if (state.host) {
        state.room = this.peer.id.slice(2).toUpperCase();
        state.phase = "place";
      } else {
        this.connectGuest();
      }
      commit();
    });
    this.peer.on("connection", (conn) => {
      if (this.conn && this.conn.open) {
        conn.on("open", () => {
          conn.send({ t: "full" });
          conn.close();
        });
        return;
      }
      this.bind(conn);
    });
    this.peer.on("error", (err) => {
      if (err.type === "unavailable-id" && state.host && this.tries < 5) {
        this.tries += 1;
        this.peer.destroy();
        this.startPeer(`sb${makeCode().toLowerCase()}`);
        return;
      }
      if (err.type === "peer-unavailable" && !state.host && this.tries < 6) {
        this.tries += 1;
        setTimeout(() => this.connectGuest(), 1500);
        return;
      }
      state.error = err.type === "peer-unavailable"
        ? "Комната не найдена. Проверьте код — капитан должен быть онлайн."
        : "Не удалось открыть комнату. Можно сыграть на одном устройстве.";
      state.phase = "disconnect";
      commit();
    });
    this.ping = setInterval(() => {
      if (this.conn?.open) this.send({ t: "ping" });
    }, 8000);
  },
  host() {
    this.stop();
    state.mode = "online";
    state.host = true;
    state.connected = false;
    state.phase = "connecting";
    state.error = "";
    this.tries = 0;
    freshMatch();
    state.turn = "me";
    commit();
    this.startPeer(`sb${makeCode().toLowerCase()}`);
  },
  join(code) {
    this.stop();
    state.mode = "online";
    state.host = false;
    state.room = code;
    state.connected = false;
    state.phase = "connecting";
    state.error = "";
    this.tries = 0;
    freshMatch();
    state.turn = "foe";
    commit();
    this.startPeer();
  },
  connectGuest() {
    if (!this.peer || state.host || state.connected) return;
    const conn = this.peer.connect(`sb${state.room.toLowerCase()}`, { reliable: true });
    this.bind(conn);
  },
  onData(msg) {
    this.heard = Date.now();
    if (!msg || typeof msg !== "object") return;
    if (msg.t === "full") {
      state.error = "В этой комнате уже два капитана.";
      state.phase = "disconnect";
      commit();
      return;
    }
    if (msg.t === "ping") {
      this.send({ t: "pong" });
      return;
    }
    if (msg.t === "pong" || msg.t === "hello") {
      if (msg.t === "hello") state.foeName = sanitizeName(msg.name);
      commit();
      return;
    }
    if (msg.t === "ready") {
      state.foeReady = true;
      maybeStart();
      return;
    }
    if (msg.t === "shot") {
      const result = fireAt(state.board, msg.x, msg.y);
      if (result.error) return;
      state.lastMark = { x: msg.x, y: msg.y, n: Date.now() };
      state.mobileView = "own";
      describeIncoming(result);
      this.send({ t: "result", ...result, again: result.hit && !result.win });
      if (result.win) finish("foe");
      else state.turn = result.hit ? "foe" : "me";
      commit();
      return;
    }
    if (msg.t === "result") {
      state.pending = false;
      applyFog(state.fog, msg);
      state.lastMark = { x: msg.x, y: msg.y, n: Date.now() };
      if (msg.sunk) state.enemySunk += 1;
      describeOutgoing(msg);
      if (msg.win) finish("me");
      else state.turn = msg.again ? "me" : "foe";
      if (!msg.win) state.mobileView = state.turn === "me" ? "foe" : "own";
      commit();
      return;
    }
    if (msg.t === "resign") {
      pushLog(`${state.foeName} сдаётся`);
      finish("me");
      return;
    }
    if (msg.t === "again-ask") {
      state.rematchFoe = true;
      if (state.rematchMe) beginRematch();
      else commit();
    }
  },
};

function makeCode() {
  return Array.from({ length: 4 }, () => ALPHABET[(Math.random() * ALPHABET.length) | 0]).join("");
}

function maybeStart() {
  if (!state.meReady || !state.foeReady || state.phase === "battle" || state.phase === "over") return;
  state.phase = "battle";
  state.turn = state.host ? "me" : "foe";
  state.mobileView = state.turn === "me" ? "foe" : "own";
  pushLog(state.turn === "me" ? "Ваш залп. Огонь по готовности." : `Первым стреляет ${state.foeName}.`);
  commit();
}

function finish(winner) {
  state.phase = "over";
  state.winner = winner;
  state.pending = false;
  state.curtain = null;
  audio.win();
  if (winner === "me") sea.burst();
  if (navigator.vibrate) navigator.vibrate(winner === "me" ? [30, 40, 30] : 40);
  commit();
}

function describeOutgoing(result) {
  const where = coordName(result.x, result.y);
  if (result.win) {
    audio.sunk();
    pushLog(`${where} — ${shipName(result.len)} потоплен. Победа.`);
  } else if (result.sunk) {
    audio.sunk();
    pushLog(`${where} — ${shipName(result.len)} потоплен.`);
  } else if (result.hit) {
    audio.hit();
    pushLog(`${where} — попадание, стреляйте ещё.`);
  } else {
    audio.miss();
    pushLog(`${where} — мимо.`);
  }
  if (navigator.vibrate) navigator.vibrate(result.hit ? 24 : 8);
}

function describeIncoming(result) {
  const where = coordName(result.x, result.y);
  if (result.win) pushLog(`${where} — ваш флот разбит.`);
  else if (result.sunk) {
    audio.sunk();
    pushLog(`${where} — потерян ${shipName(result.len)}.`);
  } else if (result.hit) {
    audio.hit();
    pushLog(`${where} — нас накрыло.`);
  } else {
    audio.miss();
    pushLog(`${where} — соперник промахнулся.`);
  }
}

function shareRoom() {
  const url = new URL(location.href);
  url.searchParams.set("room", state.room);
  const text = `Морской бой, комната ${state.room}`;
  if (navigator.share) {
    navigator.share({ title: "Морской бой", text, url: url.toString() }).catch(() => copyLink(url));
    return;
  }
  copyLink(url);
}

function copyLink(url) {
  const value = url.toString();
  const done = () => toast("Ссылка скопирована");
  if (navigator.clipboard?.writeText) navigator.clipboard.writeText(value).then(done).catch(done);
  else done();
}

function onCell(boardName, x, y) {
  if (state.curtain) return;
  if (state.phase === "place" && boardName === "own") {
    const ship = state.board.ships[Object.keys(state.board.ships).find((id) =>
      state.board.ships[id].cells.some((cell) => cell.x === x && cell.y === y)
    )];
    if (ship && state.selected === ship.id) {
      removeShip(state.board, ship.id);
      audio.place();
      commit();
      return;
    }
    if (ship) {
      state.selected = ship.id;
      state.dir = ship.dir;
      commit();
      return;
    }
    placeSelected(x, y);
    return;
  }
  if (state.phase === "battle" && boardName === "foe") shoot(x, y);
}

function placeSelected(x, y) {
  const spec = FLEET.find((item) => item.id === state.selected);
  if (!spec) return;
  const origin = clampOrigin(x, y, spec.len, state.dir);
  if (!canPlace(state.board, origin.x, origin.y, spec.len, state.dir, spec.id)) {
    toast("Здесь корабль не встанет");
    return;
  }
  const replacing = Boolean(state.board.ships[spec.id]);
  placeShip(state.board, spec.id, spec.len, origin.x, origin.y, state.dir);
  audio.place();
  if (!replacing) {
    const next = FLEET.find((item) => !state.board.ships[item.id]);
    state.selected = next ? next.id : null;
  }
  commit();
}

function shoot(x, y) {
  if (state.turn !== "me" || state.pending || state.phase !== "battle") return;
  if (state.mode === "online") {
    if (state.fog[y][x] !== "unknown") return;
    state.pending = true;
    state.lastMark = { x, y, n: Date.now() };
    net.send({ t: "shot", x, y });
    commit();
    return;
  }
  const other = state.players.current === 1 ? 2 : 1;
  const result = fireAt(state.players.boards[other], x, y);
  if (result.error) return;
  applyFog(state.players.fogs[state.players.current], result);
  state.lastMark = { x, y, n: Date.now() };
  describeOutgoing(result);
  if (result.win) {
    state.winner = "me";
    state.phase = "over";
    state.curtain = null;
    syncLocalView();
    audio.win();
    sea.burst();
    commit();
    return;
  }
  if (!result.hit) {
    state.players.current = state.players.current === 1 ? 2 : 1;
    state.curtain = `Игрок ${state.players.current}, возьмите устройство`;
  }
  syncLocalView();
  commit();
}

function syncLocalView() {
  const current = state.players.current;
  const other = current === 1 ? 2 : 1;
  state.board = state.players.boards[current];
  state.fog = state.players.fogs[current];
  state.enemySunk = sunkShips(state.players.boards[other]);
  state.name = `Игрок ${current}`;
  state.foeName = `Игрок ${other}`;
}

function ready() {
  if (!fleetComplete(state.board)) {
    toast("Сначала поставьте все 10 кораблей");
    return;
  }
  if (state.mode === "local") {
    if (state.players.stage === 1) {
      state.players.boards[1] = state.board;
      state.players.stage = 2;
      state.board = emptyBoard();
      state.selected = "4";
      state.curtain = "Игрок 2, расставьте свой флот";
      commit();
      return;
    }
    state.players.boards[2] = state.board;
    state.players.current = 1;
    state.players.fogs = { 1: emptyFog(), 2: emptyFog() };
    state.phase = "battle";
    state.turn = "me";
    state.mobileView = "foe";
    syncLocalView();
    state.curtain = "Игрок 1, ваш залп";
    pushLog("Корабли скрыты. Стреляйте по чужому полю.");
    commit();
    return;
  }
  state.meReady = true;
  net.send({ t: "ready" });
  maybeStart();
  commit();
}

function beginRematch() {
  if (state.mode === "local") {
    startLocal();
    return;
  }
  freshMatch();
  state.phase = "place";
  state.turn = state.host ? "me" : "foe";
  commit();
}

function startLocal() {
  net.stop();
  state.mode = "local";
  state.host = true;
  state.connected = true;
  state.players = { stage: 1, current: 1, boards: { 1: null, 2: null }, fogs: { 1: emptyFog(), 2: emptyFog() } };
  freshMatch();
  state.phase = "place";
  state.name = "Игрок 1";
  state.foeName = "Игрок 2";
  state.curtain = null;
  commit();
}

function goLobby() {
  net.stop();
  const params = new URLSearchParams(location.search);
  params.delete("room");
  const next = `${location.pathname}${params.toString() ? `?${params}` : ""}`;
  history.replaceState(null, "", next);
  state.mode = null;
  state.phase = "lobby";
  state.room = "";
  state.curtain = null;
  state.error = "";
  state.name = sanitizeName(localStorage.getItem("sb-name") || state.name);
  commit();
}

function renderBoard(kind, interactive) {
  const fog = kind === "foe";
  const cols = LETTERS.map((letter) => `<span>${letter}</span>`).join("");
  const rows = Array.from({ length: 10 }, (_, i) => `<span>${i + 1}</span>`).join("");
  const cells = [];
  for (let y = 0; y < 10; y += 1) {
    for (let x = 0; x < 10; x += 1) {
      const status = fog ? state.fog[y][x] : "own";
      cells.push(`<button type="button" class="cell" data-board="${kind}" data-x="${x}" data-y="${y}" data-s="${status}" aria-label="${coordName(x, y)}"></button>`);
    }
  }
  return `
    <section class="board-card ${kind === "own" ? "own" : "foe"}" data-kind="${kind}">
      <h3>${fog ? esc(state.foeName) : esc(state.name)} <span>${fog ? `потоплено ${state.enemySunk}/10` : state.phase === "place" ? `на поле ${placedCount(state.board)}/10` : `на дне ${sunkShips(state.board)}/10`}</span></h3>
      <div class="board-wrap">
        <div></div>
        <div class="axis cols">${cols}</div>
        <div class="axis rows">${rows}</div>
        <div class="plot ${interactive ? "aim" : ""}">
          <div class="cells">${cells.join("")}</div>
          <div class="fleet"></div>
          <div class="marks"></div>
        </div>
      </div>
    </section>`;
}

function screenSignature() {
  return [state.phase, state.curtain || "", state.rematchMe, state.rematchFoe, state.room, state.connected].join("|");
}

function render() {
  if (state.phase === "lobby") {
    root.innerHTML = `
      <section class="panel lobby">
        <div class="hero" aria-hidden="true">
          <svg viewBox="0 0 640 150">
            <path d="M40 92h560" stroke="rgba(180,240,230,.35)" stroke-width="2"/>
            <path d="M70 96c40-16 70-16 110 0s70 16 110 0 70-16 110 0 80 18 150 0" fill="none" stroke="rgba(232,201,138,.45)" stroke-width="3"/>
            <path d="M86 96h430l-24 28H112z" fill="#d7e7ec"/>
            <path d="M150 96V62h150v34" fill="#8eafb8"/>
            <path d="M188 62V42h70v20" fill="#d5e4ea"/>
            <rect x="330" y="78" width="90" height="18" rx="3" fill="#6e8c96"/>
            <rect x="400" y="48" width="10" height="48" fill="#f0d59a"/>
            <path d="M86 96l-28 8 36 14 24-22z" fill="#9eb4bc"/>
          </svg>
          <div class="wake"></div>
        </div>
        <h2>Два капитана.<br>Одно тёмное море.</h2>
        <p class="lede">Расставьте флот и топите корабли по очереди. Попадание даёт ещё выстрел.</p>
        <div class="stack">
          <label>Ваше имя
            <input id="captain" type="text" maxlength="16" autocomplete="nickname" value="${esc(state.name)}">
          </label>
          <button class="btn primary" type="button" data-act="host">Создать комнату</button>
          <div class="row">
            <input id="room" type="text" inputmode="latin" autocapitalize="characters" maxlength="4" placeholder="КОД" aria-label="Код комнаты" value="${esc(state.roomInput)}">
            <button class="btn" type="button" data-act="join">Войти</button>
          </div>
          <button class="ghost-btn" type="button" data-act="local">На одном устройстве</button>
        </div>
        <details>
          <summary>Правила</summary>
          <p>Поле 10×10. Флот: линкор, два крейсера, три эсминца и четыре катера. Корабли не касаются даже углами. Попадание — стреляете снова, мимо — ход переходит. В онлайн-игре расстановка остаётся только у вас.</p>
        </details>
      </section>`;
    return;
  }
  if (state.phase === "connecting") {
    root.innerHTML = `
      <section class="panel center-card">
        <div class="radar" aria-hidden="true"><div class="sweep"></div></div>
        <h2>Выходим в море</h2>
        <p class="substatus">${state.host ? "Открываем комнату…" : `Ищем комнату ${esc(state.room)}…`}</p>
        <button class="ghost-btn" type="button" data-act="lobby">Отмена</button>
      </section>`;
    return;
  }
  if (state.phase === "disconnect") {
    root.innerHTML = `
      <section class="panel center-card">
        <h2>Шторм</h2>
        <p class="substatus">${esc(state.error || "Связь потеряна.")}</p>
        <div class="stack">
          <button class="btn primary" type="button" data-act="lobby">В порт</button>
          <button class="ghost-btn" type="button" data-act="local">Сыграть на одном устройстве</button>
        </div>
      </section>`;
    return;
  }

  const placing = state.phase === "place";
  const showFoe = state.phase !== "place";
  const ownInteractive = placing;
  const foeInteractive = state.phase === "battle" && state.turn === "me" && !state.pending;
  root.innerHTML = `
    <section class="layout ${placing ? "place" : "battle"}">
      <div>
        ${state.mode === "online" && state.room ? `
          <div class="room-strip">
            <div>
              <small>${state.connected ? "Комната" : "Код для второго игрока"}</small>
              <strong>${esc(state.room)}</strong>
            </div>
            <button type="button" data-act="copy">Ссылка</button>
            <button type="button" data-act="share">Пригласить</button>
          </div>` : ""}
        <div class="battle-head">
          <p class="status-line" id="status" aria-live="polite"></p>
          <div class="pill ${state.connected ? "live" : ""}" id="link-pill"></div>
        </div>
        ${showFoe ? `<div class="switcher">
          <button type="button" data-act="view" data-view="foe">Огонь</button>
          <button type="button" data-act="view" data-view="own">Мой флот</button>
        </div>` : ""}
        <div class="boards">
          ${renderBoard("own", ownInteractive)}
          ${showFoe ? renderBoard("foe", foeInteractive) : ""}
        </div>
        <ul class="log" id="log"></ul>
      </div>
      <aside class="side">
        ${placing ? `
          <div class="dock" id="dock"></div>
          <div class="tools">
            <button type="button" data-act="rotate">Повернуть</button>
            <button type="button" data-act="random">Случайно</button>
            <button type="button" data-act="clear">Убрать</button>
            <button class="btn primary" type="button" data-act="ready">К бою · ${placedCount(state.board)}/10</button>
          </div>
          <p class="fine">Нос встаёт на выбранную клетку, корабль смотрит вправо или вниз и не касается соседей.</p>
        ` : `
          <div class="tools">
            ${state.phase === "battle" && state.mode === "online" ? `<button type="button" data-act="resign">Сдаться</button>` : ""}
            <button type="button" data-act="lobby">В порт</button>
          </div>`}
      </aside>
    </section>
    ${state.phase === "over" ? `
      <div class="modal">
        <div class="panel">
          <h2>${state.winner === "me" ? "Победа" : "Поражение"}</h2>
          <p class="substatus">${state.mode === "local"
            ? `${esc(state.name)} ${state.winner === "me" ? "потопил флот соперника" : "теряет флот"}.`
            : state.winner === "me" ? "Вражеский флот на дне." : "Ваши корабли не вернутся в порт."}</p>
          <div class="stack">
            <button class="btn primary" type="button" data-act="rematch">${state.rematchMe && !state.rematchFoe ? "Ждём соперника" : state.rematchFoe && !state.rematchMe ? "Соперник ждёт реванш" : "Ещё партия"}</button>
            <button class="ghost-btn" type="button" data-act="lobby">В порт</button>
          </div>
        </div>
      </div>` : ""}
    ${state.curtain ? `
      <div class="curtain">
        <div>
          <div class="radar" aria-hidden="true"><div class="sweep"></div></div>
          <h2>${esc(state.curtain)}</h2>
          <p class="substatus">Чужие корабли скрыты, пока устройство не у того, кто ходит.</p>
          <button class="btn primary" type="button" data-act="lift">Я готов</button>
        </div>
      </div>` : ""}`;
}

function vesselMarkup(ship, extra = "") {
  return `<div class="vessel ${ship.dir} ${extra}" data-len="${ship.len}" style="--x:${ship.x};--y:${ship.y};--len:${ship.len}"><div class="hull"><i class="deck"></i><i class="tower"></i></div></div>`;
}

function paintBoard(card, kind) {
  if (!card) return;
  const fog = kind === "foe";
  const off = window.matchMedia("(max-width: 899px)").matches
    && window.matchMedia("(min-height: 521px)").matches
    && ((kind === "own" && state.mobileView !== "own") || (kind === "foe" && state.mobileView !== "foe"));
  card.classList.toggle("is-off", off && state.phase !== "place");
  const fleet = card.querySelector(".fleet");
  const marks = card.querySelector(".marks");
  const ships = fog
    ? wrecksFromFog(state.fog).map((wreck) => vesselMarkup(wreck, "wreck"))
    : Object.values(state.board.ships).map((ship) => vesselMarkup(ship, ship.sunk ? "wreck" : ""));
  if (kind === "own" && state.phase === "place" && state.selected && state.hover) {
    const spec = FLEET.find((item) => item.id === state.selected);
    const origin = clampOrigin(state.hover.x, state.hover.y, spec.len, state.dir);
    const ok = canPlace(state.board, origin.x, origin.y, spec.len, state.dir, spec.id);
    ships.push(vesselMarkup({ ...origin, len: spec.len, dir: state.dir }, ok ? "ghost" : "ghost bad"));
  }
  const shipHtml = ships.join("");
  if (fleet.dataset.html !== shipHtml) {
    fleet.dataset.html = shipHtml;
    fleet.innerHTML = shipHtml;
  }
  const bits = [];
  for (let y = 0; y < 10; y += 1) {
    for (let x = 0; x < 10; x += 1) {
      let mark = "";
      if (fog) mark = state.fog[y][x];
      else if (state.board.cells[y][x].shot && !state.board.cells[y][x].shipId) mark = "miss";
      else if (state.board.cells[y][x].shot && state.board.cells[y][x].shipId) {
        const ship = state.board.ships[state.board.cells[y][x].shipId];
        mark = ship?.sunk ? "sunk" : "hit";
      }
      const pop = state.lastMark && state.lastMark.x === x && state.lastMark.y === y;
      if (mark && mark !== "unknown") {
        bits.push(`<i class="mark ${mark}${pop ? " pop" : ""}" style="--x:${x};--y:${y};left:calc(${x} * 10%);top:calc(${y} * 10%)"></i>`);
      }
      const cell = card.querySelector(`.cell[data-x="${x}"][data-y="${y}"]`);
      if (cell) cell.dataset.s = fog ? state.fog[y][x] : "own";
    }
  }
  const markHtml = bits.join("");
  if (marks.dataset.html !== markHtml) {
    marks.dataset.html = markHtml;
    marks.innerHTML = markHtml;
  }
  const plot = card.querySelector(".plot");
  const aim = kind === "foe" && state.phase === "battle" && state.turn === "me" && !state.pending;
  plot.classList.toggle("aim", aim);
}

function sync() {
  if (state.phase === "lobby" || state.phase === "connecting" || state.phase === "disconnect") return;
  const status = document.querySelector("#status");
  const pill = document.querySelector("#link-pill");
  if (status) {
    if (state.phase === "place") {
      status.textContent = state.mode === "local"
        ? `${state.name}: поставьте 10 кораблей`
        : state.meReady
          ? "Флот на позиции. Ждём соперника."
          : state.connected || state.mode === "local"
            ? `Расставьте флот · ${placedCount(state.board)}/10`
            : "Комната открыта. Можно расставлять флот, пока ждёте.";
    } else if (state.phase === "over") {
      status.textContent = state.winner === "me" ? "Бой окончен. Вы победили." : "Бой окончен.";
    } else if (state.pending) status.textContent = "Снаряд в полёте…";
    else status.textContent = state.turn === "me" ? "Ваш ход — бейте по чужому полю" : `Ход: ${state.foeName}`;
  }
  if (pill) {
    pill.textContent = state.mode === "local" ? "Одно устройство" : state.connected ? "На связи" : "Ждём капитана";
    pill.classList.toggle("live", state.connected && state.mode === "online");
  }
  document.querySelectorAll(".switcher button").forEach((button) => {
    button.setAttribute("aria-pressed", button.dataset.view === state.mobileView ? "true" : "false");
  });
  paintBoard(document.querySelector('.board-card[data-kind="own"]'), "own");
  paintBoard(document.querySelector('.board-card[data-kind="foe"]'), "foe");
  const log = document.querySelector("#log");
  if (log) log.innerHTML = state.log.map((line) => `<li>${esc(line)}</li>`).join("");
  const dock = document.querySelector("#dock");
  if (dock) {
    dock.innerHTML = FLEET.map((spec) => {
      const placed = Boolean(state.board.ships[spec.id]);
      const width = 18 + spec.len * 16;
      return `<button type="button" data-act="pick" data-id="${spec.id}" class="${placed ? "done" : ""}" aria-pressed="${state.selected === spec.id}">
        <span class="ship-mini" style="width:${width}px"></span>
        <span>${spec.title}</span>
        <small>${placed ? "на поле" : `${spec.len} пал.`}</small>
      </button>`;
    }).join("");
  }
  const readyBtn = document.querySelector('[data-act="ready"]');
  if (readyBtn) {
    readyBtn.textContent = state.meReady && state.mode === "online"
      ? "Ждём соперника"
      : `К бою · ${placedCount(state.board)}/10`;
    readyBtn.disabled = state.meReady && state.mode === "online";
  }
}

function commit() {
  const signature = screenSignature();
  if (state.rendered !== signature) {
    state.rendered = signature;
    render();
  }
  sync();
}

root.addEventListener("click", (event) => {
  const cell = event.target.closest(".cell");
  if (cell && root.contains(cell)) {
    onCell(cell.dataset.board, Number(cell.dataset.x), Number(cell.dataset.y));
    return;
  }
  const button = event.target.closest("[data-act]");
  if (!button || !root.contains(button)) return;
  const act = button.dataset.act;
  if (act === "host") {
    state.name = sanitizeName(document.querySelector("#captain")?.value || state.name);
    localStorage.setItem("sb-name", state.name);
    net.host();
  } else if (act === "join") {
    state.name = sanitizeName(document.querySelector("#captain")?.value || state.name);
    localStorage.setItem("sb-name", state.name);
    const code = (document.querySelector("#room")?.value || state.roomInput).toUpperCase().replace(/[^A-Z2-9]/g, "").slice(0, 4);
    if (code.length < 4) toast("Введите код из 4 символов");
    else net.join(code);
  } else if (act === "local") startLocal();
  else if (act === "lobby") goLobby();
  else if (act === "rotate") {
    state.dir = state.dir === "h" ? "v" : "h";
    commit();
  } else if (act === "random") {
    state.board = randomBoard();
    state.selected = null;
    audio.place();
    commit();
  } else if (act === "clear") {
    state.board = emptyBoard();
    state.selected = "4";
    state.meReady = false;
    commit();
  } else if (act === "pick") {
    const id = button.dataset.id;
    if (state.board.ships[id] && state.selected === id) removeShip(state.board, id);
    state.selected = id;
    if (state.board.ships[id]) state.dir = state.board.ships[id].dir;
    commit();
  } else if (act === "ready") ready();
  else if (act === "view") {
    state.mobileView = button.dataset.view;
    sync();
  } else if (act === "lift") {
    state.curtain = null;
    if (state.players?.stage === 2 && state.phase === "place") state.name = "Игрок 2";
    commit();
  } else if (act === "resign") {
    net.send({ t: "resign" });
    pushLog("Вы спустили флаг");
    finish("foe");
  } else if (act === "rematch") {
    if (state.mode === "local") beginRematch();
    else {
      state.rematchMe = true;
      net.send({ t: "again-ask" });
      if (state.rematchFoe) beginRematch();
      else {
        toast("Ждём согласия соперника");
        commit();
      }
    }
  } else if (act === "share") shareRoom();
  else if (act === "copy") {
    const url = new URL(location.href);
    url.searchParams.set("room", state.room);
    copyLink(url);
  }
});

root.addEventListener("input", (event) => {
  if (event.target.id === "captain") {
    state.name = sanitizeName(event.target.value);
    localStorage.setItem("sb-name", state.name);
  }
  if (event.target.id === "room") state.roomInput = event.target.value.toUpperCase();
});

root.addEventListener("pointerover", (event) => {
  const cell = event.target.closest?.(".cell");
  if (!cell || event.pointerType === "touch" || state.phase !== "place") return;
  state.hover = { x: Number(cell.dataset.x), y: Number(cell.dataset.y) };
  sync();
});
root.addEventListener("pointerleave", () => {
  if (!state.hover) return;
  state.hover = null;
  sync();
});

window.addEventListener("keydown", (event) => {
  if (event.target.matches("input, textarea") || state.curtain) return;
  if (state.phase === "place") {
    if (event.key === "r" || event.key === "R" || event.key === "к" || event.key === "К") {
      state.dir = state.dir === "h" ? "v" : "h";
      commit();
    }
  }
});

const params = new URLSearchParams(location.search);
if (params.get("room")) {
  state.roomInput = params.get("room").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 4);
}

commit();

if (state.roomInput.length === 4 && params.get("room")) {
  net.join(state.roomInput);
}
