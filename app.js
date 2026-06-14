const STORAGE_NAME = "betweenus_display_name_v5";
const STORAGE_DEVICE = "betweenus_device_id_v5";
const DEFAULT_CHANNEL = "main";
const PEER_SILENCE_MS = 30 * 24 * 60 * 60 * 1000;

const els = {
  roomLabel: document.getElementById("roomLabel"),
  nameInput: document.getElementById("nameInput"),
  saveNameBtn: document.getElementById("saveNameBtn"),
  messages: document.getElementById("messages"),
  composer: document.getElementById("composer"),
  messageInput: document.getElementById("messageInput"),
  identityLabel: document.getElementById("identityLabel"),
  toast: document.getElementById("toast"),
  dbHint: document.getElementById("dbHint"),
  sendBtn: document.getElementById("sendBtn"),
  netState: document.getElementById("netState"),
  peerState: document.getElementById("peerState")
};

const settings = window.APP_SETTINGS || {};
const state = {
  name: localStorage.getItem(STORAGE_NAME) || "",
  deviceId: localStorage.getItem(STORAGE_DEVICE) || crypto.randomUUID(),
  channelId: sanitizeChannel(settings.channelId || DEFAULT_CHANNEL),
  db: null,
  channelRef: null,
  channelQuery: null,
  childListener: null,
  presenceRef: null,
  presenceAllRef: null,
  presenceListener: null,
  connectedListener: null,
  heartbeatTimer: null,
  ready: false,
  connectionOnline: false
};

localStorage.setItem(STORAGE_DEVICE, state.deviceId);
els.roomLabel.textContent = "شات";
els.peerState.textContent = "الطرف الآخر: —";

function sanitizeChannel(value) {
  return String(value || "")
    .trim()
    .replace(/\s+/g, "-")
    .replace(/[^a-zA-Z0-9_-]/g, "")
    .slice(0, 48) || DEFAULT_CHANNEL;
}

function getName() {
  return (state.name || localStorage.getItem(STORAGE_NAME) || "").trim();
}

function setName(name) {
  state.name = name.trim();
  localStorage.setItem(STORAGE_NAME, state.name);
  els.nameInput.value = state.name;
  updateIdentity();
  syncPresence();
}

function timeLabel(value) {
  try {
    return new Intl.DateTimeFormat("ar-EG", { hour: "2-digit", minute: "2-digit" }).format(new Date(value));
  } catch {
    return "";
  }
}

function dateLabel(value) {
  try {
    return new Intl.DateTimeFormat("ar-EG", { day: "numeric", month: "long", year: "numeric" }).format(new Date(value));
  } catch {
    return "";
  }
}

function relativeShort(value) {
  const diff = Math.max(0, Date.now() - Number(value || 0));
  const minute = 60 * 1000;
  const hour = 60 * minute;
  const day = 24 * hour;
  if (diff < minute) return "الآن";
  if (diff < hour) return `منذ ${Math.max(1, Math.floor(diff / minute))} د`;
  if (diff < day) return `منذ ${Math.max(1, Math.floor(diff / hour))} س`;
  return `منذ ${Math.max(1, Math.floor(diff / day))} ي`;
}

function formatLastSeen(value) {
  const ts = Number(value || 0);
  if (!ts) return "غير معروف";
  const diff = Math.max(0, Date.now() - ts);
  if (diff < 24 * 60 * 60 * 1000) return timeLabel(ts);
  if (diff < PEER_SILENCE_MS) return relativeShort(ts);
  return `${dateLabel(ts)}، ${timeLabel(ts)}`;
}

function toast(message) {
  els.toast.textContent = message;
  els.toast.classList.add("show");
  clearTimeout(toast._t);
  toast._t = setTimeout(() => els.toast.classList.remove("show"), 1500);
}

function updateIdentity() {
  const name = getName();
  els.identityLabel.textContent = name ? `أنت: ${name}` : "أنت: —";
  els.sendBtn.disabled = !state.ready;
}

function setNetState(isOnline) {
  state.connectionOnline = !!isOnline;
  els.netState.textContent = isOnline ? "متصل" : "غير متصل";
}

function setPeerState(text, online = false) {
  els.peerState.textContent = text;
  els.peerState.style.borderColor = online ? "rgba(25,198,159,.28)" : "rgba(255,255,255,.06)";
}

function renderEmpty() {
  els.messages.innerHTML = `<div class="empty">جرب. ايعت مسج</div>`;
}

function escapeHtml(str) {
  return String(str)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function renderMessage(msg) {
  const mine = msg.senderId === state.deviceId;
  const el = document.createElement("div");
  el.className = `message ${mine ? "me" : "other"}`;
  el.innerHTML = `
    <div class="name">${escapeHtml(msg.name || "حط اسمك")}</div>
    <div class="text">${escapeHtml(msg.text || "")}</div>
    <div class="meta">
      <span>${mine ? "أنا" : "هو"}</span>
      <span>${timeLabel(msg.createdAt || Date.now())}</span>
    </div>
  `;
  return el;
}

function detachChannel() {
  if (state.channelRef && state.childListener) state.channelRef.off("child_added", state.childListener);
  if (state.presenceAllRef && state.presenceListener) state.presenceAllRef.off("value", state.presenceListener);
  if (state.connectedListener && state.db) state.db.ref(".info/connected").off("value", state.connectedListener);
  clearInterval(state.heartbeatTimer);
  state.heartbeatTimer = null;
  state.channelRef = null;
  state.channelQuery = null;
  state.childListener = null;
  state.presenceRef = null;
  state.presenceAllRef = null;
  state.presenceListener = null;
  state.connectedListener = null;
  state.ready = false;
  updateIdentity();
}

function configLooksValid() {
  return window.FIREBASE_CONFIG && window.FIREBASE_CONFIG.apiKey && !String(window.FIREBASE_CONFIG.apiKey).includes("PASTE_YOUR");
}

function syncPresence() {
  if (!state.db || !state.presenceRef) return;
  const name = getName();
  if (!name) return;
  const payload = {
    name,
    state: "online",
    lastChanged: firebase.database.ServerValue.TIMESTAMP,
    deviceId: state.deviceId
  };
  state.presenceRef.onDisconnect().set({ ...payload, state: "offline" });
  state.presenceRef.set(payload).catch(() => {});
  clearInterval(state.heartbeatTimer);
  state.heartbeatTimer = setInterval(() => {
    state.presenceRef.update({
      name: getName(),
      state: "online",
      lastChanged: firebase.database.ServerValue.TIMESTAMP,
      deviceId: state.deviceId
    }).catch(() => {});
  }, 25000);
}

function attachPresence() {
  state.presenceRef = state.db.ref(`presence/${state.deviceId}`);
  state.presenceAllRef = state.db.ref("presence");

  state.connectedListener = (snap) => {
    const online = !!snap.val();
    setNetState(online);
    if (online) syncPresence();
    else setPeerState("الطرف الآخر: —", false);
  };

  state.db.ref(".info/connected").on("value", state.connectedListener);

  state.presenceListener = (snap) => {
    const peers = [];
    snap.forEach((child) => {
      const data = child.val();
      if (!data || child.key === state.deviceId) return;
      peers.push({ id: child.key, ...data });
    });

    if (!peers.length) {
      setPeerState("الطرف الآخر: غير متصل", false);
      return;
    }

    peers.sort((a, b) => Number(b.lastChanged || 0) - Number(a.lastChanged || 0));
    const onlinePeer = peers.find((p) => p.state === "online");
    const peer = onlinePeer || peers[0];

    if (peer.state === "online") {
      setPeerState(`${peer.name || "الطرف الآخر"}: متصل`, true);
      return;
    }

    setPeerState(`${peer.name || "الطرف الآخر"}: آخر ظهور ${formatLastSeen(peer.lastChanged)}`, false);
  };

  state.presenceAllRef.on("value", state.presenceListener);
}

function attachChannel() {
  detachChannel();
  els.messages.innerHTML = "";
  els.dbHint.textContent = "جاري الاتصال";
  setNetState(true);

  if (!window.firebase || !configLooksValid()) {
    els.dbHint.textContent = "Firebase";
    setPeerState("الطرف الآخر: غير متصل", false);
    renderEmpty();
    updateIdentity();
    return;
  }

  if (!firebase.apps.length) firebase.initializeApp(window.FIREBASE_CONFIG);

  state.db = firebase.database();
  state.channelRef = state.db.ref(`channels/${state.channelId}/messages`);
  state.channelQuery = state.channelRef.orderByChild("createdAt");
  state.ready = true;
  els.dbHint.textContent = "جاهز";

  state.childListener = (snap) => {
    const msg = snap.val();
    if (!msg) return;
    if (els.messages.dataset.empty === "1") {
      els.messages.innerHTML = "";
      delete els.messages.dataset.empty;
    }
    els.messages.appendChild(renderMessage(msg));
    els.messages.scrollTop = els.messages.scrollHeight;
  };

  state.channelRef.on("child_added", state.childListener, () => {
    els.dbHint.textContent = "تعذر الاتصال";
    setNetState(false);
  });

  state.channelRef.limitToLast(1).once("value").then((snap) => {
    if (!snap.exists()) {
      els.messages.dataset.empty = "1";
      renderEmpty();
    }
  }).catch(() => {});

  attachPresence();
  updateIdentity();
  syncPresence();
}

async function sendMessage(text) {
  if (!state.channelRef || !state.ready) {
    toast("فيه مشكله");
    return;
  }

  const name = getName();
  if (!name) {
    toast("يسطا اكتب اسمك الاول");
    els.nameInput.focus();
    return;
  }

  await state.channelRef.push({
    text: text.trim(),
    name,
    senderId: state.deviceId,
    createdAt: Date.now()
  });

  syncPresence();
}

els.nameInput.value = getName();

els.saveNameBtn.addEventListener("click", () => {
  setName(els.nameInput.value);
  toast("اتحفظ يدولي");
});

els.nameInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    e.preventDefault();
    setName(els.nameInput.value);
    toast("اتحفظ يدولي");
  }
});

els.composer.addEventListener("submit", async (e) => {
  e.preventDefault();
  const text = els.messageInput.value.trim();
  if (!text) return;
  try {
    await sendMessage(text);
    els.messageInput.value = "";
  } catch (err) {
    console.error(err);
    toast("فشل الارسال");
  }
});

window.addEventListener("online", () => setNetState(true));
window.addEventListener("offline", () => setNetState(false));

setName(els.nameInput.value);
attachChannel();
updateIdentity();
