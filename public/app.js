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

function start(name) {
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
  ws = new WebSocket(`${proto}://${location.host}/ws`);

  ws.addEventListener("open", () => {
    els.status.textContent = "connected";
    ws.send(JSON.stringify({ type: "join", username }));
  });

  ws.addEventListener("message", (e) => {
    const msg = JSON.parse(e.data);
    if (msg.type === "message") {
      const atBottom =
        els.messages.scrollHeight - els.messages.scrollTop - els.messages.clientHeight < 80;
      renderMessage(msg);
      if (oldestId === null) oldestId = msg.id;
      if (atBottom) els.messages.scrollTop = els.messages.scrollHeight;
    }
  });

  ws.addEventListener("close", () => {
    els.status.textContent = "reconnecting…";
    setTimeout(connect, 1500);
  });

  ws.addEventListener("error", () => ws.close());
}

// ---- Sending ----
els.messageForm.addEventListener("submit", (e) => {
  e.preventDefault();
  const text = els.messageInput.value.trim();
  if (!text || !ws || ws.readyState !== WebSocket.OPEN) return;
  ws.send(JSON.stringify({ type: "message", text }));
  els.messageInput.value = "";
});

// ---- Boot ----
if (username) {
  start(username);
} else {
  showLogin();
}
