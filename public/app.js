const PAGE_SIZE = 50;

const els = {
  login: document.getElementById("login"),
  loginForm: document.getElementById("login-form"),
  usernameInput: document.getElementById("username-input"),
  chat: document.getElementById("chat"),
  status: document.getElementById("status"),
  reconnect: document.getElementById("reconnect"),
  mute: document.getElementById("mute"),
  changeName: document.getElementById("change-name"),
  messages: document.getElementById("messages"),
  loadMore: document.getElementById("load-more"),
  messageForm: document.getElementById("message-form"),
  messageInput: document.getElementById("message-input"),
  typing: document.getElementById("typing"),
};

let username = localStorage.getItem("username") || "";
let ws = null;
let oldestId = null; // smallest message id currently shown (for pagination)
let latestId = null; // largest message id currently shown (for catch-up)
let hasMore = true;

// ---- Username ----
function showLogin() {
  els.chat.classList.add("hidden");
  els.login.classList.remove("hidden");
  els.usernameInput.value = username;
  els.usernameInput.focus();
}

function reset() {
  // Tear down any existing session so re-entering (e.g. after a name change)
  // doesn't duplicate the socket or the rendered history.
  if (ws) {
    ws.intentionalClose = true; // suppress the reconnect handler below
    ws.close();
    ws = null;
  }
  for (const msg of els.messages.querySelectorAll(".msg")) msg.remove();
  oldestId = null;
  latestId = null;
  hasMore = true;
  for (const id of typers.values()) clearTimeout(id);
  typers.clear();
  renderTypers();
}

function start(name) {
  reset();
  username = name;
  localStorage.setItem("username", name);
  els.login.classList.add("hidden");
  els.chat.classList.remove("hidden");
  els.messageInput.focus();
  if (!muted) {
    unlockAudio();
    ensureNotifyPermission();
  }
  loadHistory().then(connect);
}

els.loginForm.addEventListener("submit", (e) => {
  e.preventDefault();
  const name = els.usernameInput.value.trim();
  if (name) start(name);
});

els.changeName.addEventListener("click", () => {
  showLogin();
});

// ---- History (lazy loaded) ----
function renderMessage(msg, { prepend = false } = {}) {
  const div = document.createElement("div");
  div.className = "msg" + (msg.username === username ? " mine" : "");
  const time = new Date(msg.ts).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
  const meta = document.createElement("div");
  meta.className = "meta";
  const name = document.createElement("span");
  name.className = "name";
  name.textContent = msg.username;
  meta.append(name, document.createTextNode(` · ${time}`));

  const text = document.createElement("div");
  text.className = "text";
  text.textContent = msg.text;

  div.append(meta, text);

  if (prepend) {
    els.messages.insertBefore(div, els.loadMore.nextSibling);
  } else {
    els.messages.appendChild(div);
  }
  return div;
}

async function loadHistory(before) {
  const url = new URL("/api/messages", location.origin);
  url.searchParams.set("limit", PAGE_SIZE);
  if (before) url.searchParams.set("before", before);

  const res = await fetch(url);
  const msgs = await res.json();

  if (msgs.length < PAGE_SIZE) hasMore = false;
  els.loadMore.classList.toggle("hidden", !hasMore);

  if (!msgs.length) return;

  if (before) {
    // Keep scroll position stable while prepending older messages.
    const prevHeight = els.messages.scrollHeight;
    // Insert oldest-first, each prepended just after the Load button.
    for (let i = msgs.length - 1; i >= 0; i--) {
      renderMessage(msgs[i], { prepend: true });
    }
    els.messages.scrollTop = els.messages.scrollHeight - prevHeight;
  } else {
    for (const m of msgs) renderMessage(m);
    els.messages.scrollTop = els.messages.scrollHeight;
    latestId = msgs[msgs.length - 1].id; // newest (msgs are oldest-first)
  }

  oldestId = msgs[0].id;
}

els.loadMore.addEventListener("click", () => {
  if (oldestId) loadHistory(oldestId);
});

// Fetch every message newer than the newest one we're showing and append it.
// Used after a (re)connect or when the tab wakes up, so a dropped/idle socket
// doesn't leave a gap. Loops in case the backlog exceeds one page.
let catchingUp = false;
async function catchUp() {
  if (latestId === null || catchingUp) return;
  catchingUp = true;
  try {
    const m = els.messages;
    const atBottom = m.scrollHeight - m.scrollTop - m.clientHeight < 80;
    let added = 0;
    while (true) {
      const url = new URL("/api/messages", location.origin);
      url.searchParams.set("after", latestId);
      url.searchParams.set("limit", PAGE_SIZE);
      let msgs;
      try {
        const res = await fetch(url);
        msgs = await res.json();
      } catch {
        break; // offline / server unreachable; try again on next trigger
      }
      if (!Array.isArray(msgs) || !msgs.length) break;
      for (const msg of msgs) {
        if (msg.id <= latestId) continue;
        renderMessage(msg);
        latestId = msg.id;
        added++;
      }
      if (msgs.length < PAGE_SIZE) break; // drained the backlog
    }
    if (added && atBottom) m.scrollTop = m.scrollHeight;
  } finally {
    catchingUp = false;
  }
}

// Make sure we have a live socket and have caught up. A backgrounded mobile tab
// often freezes the socket without firing 'close', so on resume we reconnect if
// it looks dead, or just catch up if it's still open.
function ensureConnected() {
  if (!username) return;
  if (!ws || ws.readyState === WebSocket.CLOSED || ws.readyState === WebSocket.CLOSING) {
    connect();
  } else if (ws.readyState === WebSocket.OPEN) {
    catchUp();
  }
  // CONNECTING: leave it; its open handler will catch up.
}

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") ensureConnected();
});
window.addEventListener("online", ensureConnected);
window.addEventListener("pageshow", ensureConnected);

// Manual refresh: catch up immediately, then force a clean socket in case the
// current one is silently half-dead.
function manualRefresh() {
  if (!username) return;
  catchUp();
  if (ws) {
    ws.intentionalClose = true;
    ws.close();
    ws = null;
  }
  els.status.textContent = "reconnecting…";
  connect();
}

els.reconnect.addEventListener("click", manualRefresh);

// ---- Live WebSocket ----
function connect() {
  const proto = location.protocol === "https:" ? "wss" : "ws";
  const socket = new WebSocket(`${proto}://${location.host}/ws`);
  ws = socket;

  socket.addEventListener("open", () => {
    els.status.textContent = "connected";
    socket.send(JSON.stringify({ type: "join", username }));
    // Pull anything that arrived while we were disconnected — the fresh socket
    // only carries future messages, not the gap.
    catchUp();
  });

  socket.addEventListener("message", (e) => {
    const msg = JSON.parse(e.data);
    if (msg.type === "message") {
      // Skip anything we've already shown (e.g. delivered by a concurrent
      // catch-up fetch); ids are monotonic so this is a safe dedup.
      if (latestId !== null && msg.id <= latestId) return;
      const atBottom =
        els.messages.scrollHeight - els.messages.scrollTop - els.messages.clientHeight < 80;
      renderMessage(msg);
      if (oldestId === null) oldestId = msg.id;
      latestId = msg.id;
      if (atBottom) els.messages.scrollTop = els.messages.scrollHeight;
      setTyping(msg.username, false); // they just sent, so they stopped typing
      alertMessage(msg);
    } else if (msg.type === "typing") {
      setTyping(msg.username, msg.state);
    }
  });

  socket.addEventListener("close", () => {
    if (socket.intentionalClose) return;
    els.status.textContent = "reconnecting…";
    setTimeout(connect, 1500);
  });

  socket.addEventListener("error", () => socket.close());
}

// ---- Typing indicator ----
// Map of username -> timeout id; presence means "currently typing".
const typers = new Map();

function renderTypers() {
  const names = [...typers.keys()];
  if (!names.length) {
    // Keep the strip in the layout (space stays reserved) — just clear it so
    // showing/hiding never resizes the scrollable message list.
    els.typing.textContent = "";
    return;
  }
  let label;
  if (names.length === 1) label = `${names[0]} is typing…`;
  else if (names.length === 2) label = `${names[0]} and ${names[1]} are typing…`;
  else label = "Several people are typing…";
  els.typing.textContent = label;
}

function setTyping(name, on) {
  if (!name || name === username) return;
  clearTimeout(typers.get(name));
  if (on) {
    // Auto-clear if no refresh arrives (covers dropped "stopped" events).
    typers.set(name, setTimeout(() => setTyping(name, false), 5000));
  } else {
    typers.delete(name);
  }
  renderTypers();
}

// ---- Sending ----
let lastTypingSent = 0;

function sendTyping(state) {
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  ws.send(JSON.stringify({ type: "typing", state }));
}

// Grow the textarea with its content, up to the CSS max-height.
function autoResizeInput() {
  els.messageInput.style.height = "auto";
  els.messageInput.style.height = `${els.messageInput.scrollHeight}px`;
}

// Enter sends; Shift+Enter (and pasted text) insert a newline.
els.messageInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    els.messageForm.requestSubmit();
  }
});

els.messageInput.addEventListener("input", autoResizeInput);

els.messageInput.addEventListener("input", () => {
  if (!els.messageInput.value) {
    sendTyping(false);
    lastTypingSent = 0;
    return;
  }
  // Throttle "typing" pings to at most one every 2s.
  const now = Date.now();
  if (now - lastTypingSent > 2000) {
    sendTyping(true);
    lastTypingSent = now;
  }
});

els.messageForm.addEventListener("submit", (e) => {
  e.preventDefault();
  const text = els.messageInput.value.trim();
  if (!text || !ws || ws.readyState !== WebSocket.OPEN) return;
  ws.send(JSON.stringify({ type: "message", text }));
  els.messageInput.value = "";
  autoResizeInput();
  sendTyping(false);
  lastTypingSent = 0;
});

// ---- Viewport height (mobile keyboard) ----
// On Android the soft keyboard overlays the page rather than resizing it, so
// 100dvh stays full-screen and the app appears too tall / scrollable. Track the
// visualViewport height instead and expose it as --app-height; keep the latest
// message pinned above the input when the viewport shrinks.
function syncViewportHeight() {
  const vv = window.visualViewport;
  if (!vv) return;
  const m = els.messages;
  const atBottom = m.scrollHeight - m.scrollTop - m.clientHeight < 80;
  document.documentElement.style.setProperty("--app-height", `${vv.height}px`);
  if (atBottom) m.scrollTop = m.scrollHeight;
}

if (window.visualViewport) {
  window.visualViewport.addEventListener("resize", syncViewportHeight);
  window.visualViewport.addEventListener("scroll", syncViewportHeight);
  syncViewportHeight();
}

// ---- Notifications & sound ----
// Alerts on other people's messages: a short ping when the chat tab is focused,
// an OS Notification (with its own sound) when it isn't. Muteable; state in
// localStorage.
let muted = localStorage.getItem("muted") === "1";

// Web Audio "ping". The context starts suspended until a user gesture unlocks
// it (browser autoplay policy), so we prime it on first interaction / on join.
let audioCtx = null;
function unlockAudio() {
  if (!audioCtx) {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    audioCtx = new Ctx();
  }
  if (audioCtx.state === "suspended") audioCtx.resume();
}

function playPing() {
  if (!audioCtx) return; // not unlocked yet
  const now = audioCtx.currentTime;
  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  osc.type = "sine";
  osc.frequency.setValueAtTime(880, now);
  osc.frequency.exponentialRampToValueAtTime(1320, now + 0.12);
  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.exponentialRampToValueAtTime(0.18, now + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.3);
  osc.connect(gain).connect(audioCtx.destination);
  osc.start(now);
  osc.stop(now + 0.32);
}

function ensureNotifyPermission() {
  if ("Notification" in window && Notification.permission === "default") {
    Notification.requestPermission();
  }
}

function alertMessage(msg) {
  if (muted || msg.username === username) return;
  const focused = document.visibilityState === "visible" && document.hasFocus();
  if (focused) {
    playPing();
    return;
  }
  if ("Notification" in window && Notification.permission === "granted") {
    try {
      const n = new Notification(msg.username, {
        body: msg.text.slice(0, 120),
        icon: "icon.svg",
        tag: "lcb-chat", // collapse rapid messages into one banner
      });
      n.onclick = () => {
        window.focus();
        n.close();
      };
      return;
    } catch {
      // fall through to sound
    }
  }
  playPing(); // unfocused but no notification permission
}

function renderMute() {
  els.mute.textContent = muted ? "🔕" : "🔔";
  els.mute.title = muted ? "Unmute sounds" : "Mute sounds";
}

els.mute.addEventListener("click", () => {
  muted = !muted;
  localStorage.setItem("muted", muted ? "1" : "0");
  renderMute();
  if (!muted) {
    unlockAudio();
    ensureNotifyPermission();
  }
});
renderMute();

// Unlock audio on the first interaction (covers an auto-rejoin where no gesture
// has happened yet); the join click also unlocks below.
function primeAudioOnce() {
  unlockAudio();
  window.removeEventListener("pointerdown", primeAudioOnce);
  window.removeEventListener("keydown", primeAudioOnce);
}
window.addEventListener("pointerdown", primeAudioOnce);
window.addEventListener("keydown", primeAudioOnce);

// ---- Boot ----
if (username) {
  start(username);
} else {
  showLogin();
}
