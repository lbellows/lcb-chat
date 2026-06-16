const PAGE_SIZE = 50;

const els = {
  login: document.getElementById("login"),
  loginForm: document.getElementById("login-form"),
  usernameInput: document.getElementById("username-input"),
  chat: document.getElementById("chat"),
  status: document.getElementById("status"),
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
  }

  oldestId = msgs[0].id;
}

els.loadMore.addEventListener("click", () => {
  if (oldestId) loadHistory(oldestId);
});

// ---- Live WebSocket ----
function connect() {
  const proto = location.protocol === "https:" ? "wss" : "ws";
  const socket = new WebSocket(`${proto}://${location.host}/ws`);
  ws = socket;

  socket.addEventListener("open", () => {
    els.status.textContent = "connected";
    socket.send(JSON.stringify({ type: "join", username }));
  });

  socket.addEventListener("message", (e) => {
    const msg = JSON.parse(e.data);
    if (msg.type === "message") {
      const atBottom =
        els.messages.scrollHeight - els.messages.scrollTop - els.messages.clientHeight < 80;
      renderMessage(msg);
      if (oldestId === null) oldestId = msg.id;
      if (atBottom) els.messages.scrollTop = els.messages.scrollHeight;
      setTyping(msg.username, false); // they just sent, so they stopped typing
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
    els.typing.classList.add("hidden");
    els.typing.textContent = "";
    return;
  }
  let label;
  if (names.length === 1) label = `${names[0]} is typing…`;
  else if (names.length === 2) label = `${names[0]} and ${names[1]} are typing…`;
  else label = "Several people are typing…";
  els.typing.textContent = label;
  els.typing.classList.remove("hidden");
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

// ---- Boot ----
if (username) {
  start(username);
} else {
  showLogin();
}
