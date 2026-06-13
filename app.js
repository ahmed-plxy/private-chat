const STORAGE_SESSION = "betweenus_session_v3";
const STORAGE_DEVICE = "betweenus_device_id_v5";
const DEFAULT_CHANNEL = "main";
const READ_WINDOW_MS = 60_000;
const LIMIT_MESSAGES = 100;

const USERS = {
  ahmed: { key: "ahmed", name: "أحمد", pin: "2468" },
  muaz: { key: "muaz", name: "معاذ", pin: "1357" }
};

const els = {
  authScreen: document.getElementById("authScreen"),
  authForm: document.getElementById("authForm"),
  authUser: document.getElementById("authUser"),
  authPin: document.getElementById("authPin"),
  authHint: document.getElementById("authHint"),
  logoutBtn: document.getElementById("logoutBtn"),
  clearChatBtn: document.getElementById("clearChatBtn"),
  newChatBtn: document.getElementById("newChatBtn"),
  roomLabel: document.getElementById("roomLabel"),
  messages: document.getElementById("messages"),
  composer: document.getElementById("composer"),
  messageInput: document.getElementById("messageInput"),
  identityLabel: document.getElementById("identityLabel"),
  peerStatusLabel: document.getElementById("peerStatusLabel"),
  toast: document.getElementById("toast"),
  dbHint: document.getElementById("dbHint"),
  sendBtn: document.getElementById("sendBtn"),
  netState: document.getElementById("netState"),
  currentUserLabel: document.getElementById("currentUserLabel"),
  pinnedBanner: document.getElementById("pinnedBanner"),
  replyBar: document.getElementById("replyBar"),
  replyText: document.getElementById("replyText"),
  cancelReplyBtn: document.getElementById("cancelReplyBtn"),
  messageMenu: document.getElementById("messageMenu"),
  messageMenuTitle: document.getElementById("messageMenuTitle"),
  messageMenuActions: document.getElementById("messageMenuActions")
};

const settings = window.APP_SETTINGS || {};
const savedSession = safeParse(localStorage.getItem(STORAGE_SESSION));

const state = {
  session: isValidSession(savedSession) ? savedSession : null,
  deviceId: localStorage.getItem(STORAGE_DEVICE) || crypto.randomUUID(),
  channelId: sanitizeChannel(settings.channelId || DEFAULT_CHANNEL),
  db: null,
  messagesRef: null,
  messagesQuery: null,
  metaRef: null,
  presenceRoomRef: null,
  presenceSelfRef: null,
  listeners: null,
  ready: false,
  messages: [],
  meta: { lastRead: {}, pinned: null },
  presences: {},
  lastAutoReadAt: 0,
  readTimer: null,
  typingTimer: null,
  typingHeartbeat: null,
  replyTo: null,
  lastRenderWasNearBottom: true,
  inputTyping: false,
  actionMenu: { open: false, key: null },
  longPressTimer: null,
  longPressStart: null,
  suppressNextMessageClick: false
};

localStorage.setItem(STORAGE_DEVICE, state.deviceId);
els.roomLabel.textContent = "شات خاص";
els.messageInput.disabled = true;

function safeParse(value) {
  if (!value) return null;
  try { return JSON.parse(value); } catch { return null; }
}

function isValidSession(session) {
  return session && USERS[session.userKey] && session.userName === USERS[session.userKey].name;
}

function sanitizeChannel(value) {
  return String(value || "").trim().replace(/\s+/g, "-").replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 48) || DEFAULT_CHANNEL;
}

function getCurrentUser() {
  if (!state.session) return null;
  return USERS[state.session.userKey] || null;
}

function getPeerKey() {
  const user = getCurrentUser();
  if (!user) return null;
  return user.key === "ahmed" ? "muaz" : "ahmed";
}

function setSession(userKey) {
  const user = USERS[userKey];
  if (!user) return false;
  state.session = { userKey: user.key, userName: user.name };
  localStorage.setItem(STORAGE_SESSION, JSON.stringify(state.session));
  return true;
}

function clearSession() {
  state.session = null;
  localStorage.removeItem(STORAGE_SESSION);
}

function timeLabel(value) {
  try { return new Intl.DateTimeFormat("ar-EG", { hour: "2-digit", minute: "2-digit" }).format(new Date(value)); } catch { return ""; }
}

function shortDateTime(value) {
  try { return new Intl.DateTimeFormat("ar-EG", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }).format(new Date(value)); } catch { return ""; }
}

function formatLastSeen(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const diffDays = Math.floor((Date.now() - date.getTime()) / 86400000);
  if (diffDays < 30) {
    try { return new Intl.DateTimeFormat("ar-EG", { hour: "2-digit", minute: "2-digit" }).format(date); } catch { return ""; }
  }
  try { return new Intl.DateTimeFormat("ar-EG", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }).format(date); } catch { return ""; }
}

function toast(message) {
  els.toast.textContent = message;
  els.toast.classList.add("show");
  clearTimeout(toast._t);
  toast._t = setTimeout(() => els.toast.classList.remove("show"), 1400);
}

function escapeHtml(str) {
  return String(str)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function showAuthScreen(show) {
  els.authScreen.classList.toggle("show", show);
  document.body.classList.toggle("locked", show);
}

function getLastReadFor(userKey) {
  return Number(state.meta?.lastRead?.[userKey] || 0);
}

function getPinnedMessage() {
  const pinned = state.meta?.pinned;
  if (!pinned?.key) return null;
  return state.messages.find((msg) => msg.key === pinned.key) || pinned;
}

function renderPinned() {
  const pinned = getPinnedMessage();
  if (!pinned || pinned.system || !pinned.text) {
    els.pinnedBanner.hidden = true;
    els.pinnedBanner.textContent = "";
    return;
  }
  els.pinnedBanner.hidden = false;
  els.pinnedBanner.textContent = `مثبت: ${pinned.senderName || ""} — ${pinned.text}`;
}

function updateIdentity() {
  const user = getCurrentUser();
  const peerKey = getPeerKey();
  const peer = peerKey ? USERS[peerKey] : null;
  const peerPresence = peerKey ? state.presences[peerKey] || {} : {};
  const typingNow = peerPresence.online && peerPresence.typing && Date.now() - Number(peerPresence.typingAt || 0) < 3500;

  els.identityLabel.textContent = user ? `أنت: ${user.name}` : "أنت: غير مسجل";
  els.currentUserLabel.textContent = user ? user.name : "—";
  els.peerStatusLabel.textContent = peer
    ? typingNow
      ? `${peer.name} يكتب الآن...`
      : peerPresence.online
        ? `${peer.name} متصل`
        : peerPresence.lastSeen
          ? `آخر ظهور: ${formatLastSeen(peerPresence.lastSeen)}`
          : `${peer.name} غير متصل`
    : "—";
  els.sendBtn.disabled = !state.ready || !user;
  els.logoutBtn.disabled = !user;
  els.clearChatBtn.disabled = !state.ready;
  els.newChatBtn.disabled = !state.ready;
}

function renderAuthOptions() {
  els.authUser.innerHTML = `
    <option value="" selected disabled>اختار اسمك</option>
    <option value="ahmed">أحمد</option>
    <option value="muaz">معاذ</option>
  `;
}

function detachChannel() {
  const { messagesQuery, metaRef, presenceRoomRef, listeners } = state;
  if (messagesQuery && listeners) {
    messagesQuery.off("child_added", listeners.childAdded);
    messagesQuery.off("child_changed", listeners.childChanged);
    messagesQuery.off("child_removed", listeners.childRemoved);
  }
  if (metaRef && listeners) metaRef.off("value", listeners.meta);
  if (presenceRoomRef && listeners) presenceRoomRef.off("value", listeners.presence);

  if (state.typingHeartbeat) clearInterval(state.typingHeartbeat);
  if (state.typingTimer) clearTimeout(state.typingTimer);
  if (state.readTimer) clearTimeout(state.readTimer);

  state.db = null;
  state.messagesRef = null;
  state.messagesQuery = null;
  state.metaRef = null;
  state.presenceRoomRef = null;
  state.presenceSelfRef = null;
  state.listeners = null;
  state.ready = false;
  state.messages = [];
  state.meta = { lastRead: {}, pinned: null };
  state.presences = {};
  state.replyTo = null;
  state.inputTyping = false;
  renderReplyBar();
  renderPinned();
  hideActionMenu();
  updateIdentity();
}

function configLooksValid() {
  return window.FIREBASE_CONFIG && window.FIREBASE_CONFIG.apiKey && !String(window.FIREBASE_CONFIG.apiKey).includes("PASTE_YOUR");
}

function renderEmpty() {
  els.messages.innerHTML = `<div class="empty">مفيش رسائل لسه</div>`;
}

function renderReplyBar() {
  if (!state.replyTo || !state.replyTo.text) {
    state.replyTo = null;
    els.replyBar.hidden = true;
    els.replyText.textContent = "";
    return;
  }
  els.replyBar.hidden = false;
  els.replyText.textContent = `${state.replyTo.senderName || ""}: ${state.replyTo.text || ""}`;
}

function setReplyTo(msg) {
  state.replyTo = msg ? {
    key: msg.key,
    text: msg.text || "",
    senderKey: msg.senderKey || "",
    senderName: msg.senderName || ""
  } : null;
  renderReplyBar();
}

function hideActionMenu() {
  state.actionMenu.open = false;
  state.actionMenu.key = null;
  state.suppressNextMessageClick = false;
  if (els.messageMenu) {
    els.messageMenu.hidden = true;
    els.messageMenu.style.left = "-9999px";
    els.messageMenu.style.top = "-9999px";
    els.messageMenu.style.visibility = "hidden";
  }
}

function closeReplyAndMenu() {
  setReplyTo(null);
  hideActionMenu();
}

function getMessageByKey(key) {
  return state.messages.find((m) => m.key === key) || null;
}

function clearLongPressTimer() {
  if (state.longPressTimer) clearTimeout(state.longPressTimer);
  state.longPressTimer = null;
  state.longPressStart = null;
}

function openActionMenu(msg, x, y) {
  const user = getCurrentUser();
  if (!msg || !els.messageMenu || !user) return;
  const mine = msg.senderKey === user.key;
  const editable = mine && state.messages[state.messages.length - 1]?.key === msg.key && Date.now() - (msg.createdAt || 0) <= READ_WINDOW_MS;
  const items = ['<button type="button" data-action="reply">رد</button>'];
  if (mine) {
    items.push('<button type="button" data-action="pin">تثبيت</button>');
    if (editable) items.push('<button type="button" data-action="edit">تعديل</button>');
    items.push('<button type="button" data-action="delete" class="danger">حذف</button>');
  }

  els.messageMenuTitle.textContent = msg.senderName || "خيارات الرسالة";
  els.messageMenuActions.innerHTML = items.join('');
  els.messageMenu.hidden = false;
  els.messageMenu.style.visibility = "hidden";
  els.messageMenu.style.left = "0px";
  els.messageMenu.style.top = "0px";

  const pad = 12;
  const rect = els.messageMenu.getBoundingClientRect();
  const left = Math.min(Math.max(pad, x - rect.width * 0.35), window.innerWidth - rect.width - pad);
  const top = Math.min(Math.max(pad, y), window.innerHeight - rect.height - pad);
  els.messageMenu.style.left = `${left}px`;
  els.messageMenu.style.top = `${top}px`;
  els.messageMenu.style.visibility = "visible";
  state.actionMenu.open = true;
  state.actionMenu.key = msg.key;
  state.suppressNextMessageClick = true;
}

function beginLongPress(msg, x, y) {
  clearLongPressTimer();
  state.longPressStart = { x, y };
  state.longPressTimer = setTimeout(() => openActionMenu(msg, x, y), 450);
}

function cancelLongPress() {
  clearLongPressTimer();
}

function isNearBottom() {
  const el = els.messages;
  return (el.scrollHeight - el.scrollTop - el.clientHeight) < 96;
}

function scheduleMarkRead(ts) {
  const user = getCurrentUser();
  if (!user || !state.metaRef || !ts) return;
  if (ts <= state.lastAutoReadAt) return;
  state.lastAutoReadAt = ts;
  clearTimeout(state.readTimer);
  state.readTimer = setTimeout(() => {
    state.metaRef.child(`lastRead/${user.key}`).set(state.lastAutoReadAt).catch(() => {});
  }, 160);
}

function refreshReadMarkerFromView() {
  const user = getCurrentUser();
  if (!user || document.hidden) return;
  const latestIncoming = [...state.messages].reverse().find((msg) => !msg.system && msg.senderKey !== user.key);
  if (!latestIncoming) return;
  if (isNearBottom()) scheduleMarkRead(latestIncoming.createdAt || Date.now());
}

function renderMessage(msg) {
  if (msg.system) {
    const systemEl = document.createElement("div");
    systemEl.className = "system-message";
    systemEl.innerHTML = `<span>${escapeHtml(msg.text || "")}</span><small>${timeLabel(msg.createdAt || Date.now())}</small>`;
    return systemEl;
  }

  const user = getCurrentUser();
  const mine = msg.senderKey === user?.key;
  const peerKey = getPeerKey();
  const peerLastRead = peerKey ? getLastReadFor(peerKey) : 0;
  const myLastRead = user ? getLastReadFor(user.key) : 0;
  const readByPeer = mine && peerLastRead >= (msg.createdAt || 0);
  const readByMe = !mine && myLastRead >= (msg.createdAt || 0);
  const editable = mine && state.messages[state.messages.length - 1]?.key === msg.key && Date.now() - (msg.createdAt || 0) <= READ_WINDOW_MS;

  const el = document.createElement("div");
  el.className = `message ${mine ? "me" : "other"}`;
  el.dataset.key = msg.key || "";
  el.innerHTML = `
    <div class="name">${escapeHtml(msg.senderName || "غير معروف")}</div>
    ${msg.replyTo ? `<div class="reply-preview"><strong>${escapeHtml(msg.replyTo.senderName || "")}</strong>${escapeHtml(msg.replyTo.text || "")}</div>` : ""}
    <div class="text">${escapeHtml(msg.text || "")}</div>
    <div class="meta">
      <span>${mine ? "أنت" : "الطرف الآخر"}</span>
      <span>${mine ? (readByPeer ? "تمت القراءة" : "تم الإرسال") : (readByMe ? "مقروء" : timeLabel(msg.createdAt || Date.now()))}${msg.editedAt ? " • تم التعديل" : ""}</span>
    </div>
  `;
  return el;
}

function renderMessages() {
  const shouldStick = isNearBottom();
  els.messages.innerHTML = "";
  if (!state.messages.length) {
    renderEmpty();
    renderPinned();
    els.messages.scrollTop = els.messages.scrollHeight;
    return;
  }

  const fragment = document.createDocumentFragment();
  for (const msg of state.messages) fragment.appendChild(renderMessage(msg));
  els.messages.appendChild(fragment);
  renderPinned();
  if (state.actionMenu.open) hideActionMenu();

  requestAnimationFrame(() => {
    if (shouldStick) els.messages.scrollTop = els.messages.scrollHeight;
    refreshReadMarkerFromView();
  });
}

function setPresence(extra = {}) {
  const user = getCurrentUser();
  if (!user || !state.presenceSelfRef) return Promise.resolve();
  return state.presenceSelfRef.update({
    online: true,
    lastSeen: Date.now(),
    typing: state.inputTyping,
    typingAt: state.inputTyping ? Date.now() : null,
    name: user.name,
    ...extra
  }).catch(() => {});
}

function markTyping(active) {
  const user = getCurrentUser();
  if (!user || !state.presenceSelfRef) return;
  state.inputTyping = active;
  setPresence({ typing: active, typingAt: active ? Date.now() : null });
  if (state.typingTimer) clearTimeout(state.typingTimer);
  if (active) {
    state.typingTimer = setTimeout(() => {
      state.inputTyping = false;
      setPresence({ typing: false, typingAt: null });
    }, 2200);
  }
}

function attachChannel() {
  detachChannel();
  hideActionMenu();
  els.messages.innerHTML = "";
  els.dbHint.textContent = "جاري الاتصال";
  els.netState.textContent = "اون لاين";

  if (!window.firebase || !configLooksValid()) {
    els.dbHint.textContent = "Firebase";
    renderEmpty();
    updateIdentity();
    return;
  }

  if (!firebase.apps.length) firebase.initializeApp(window.FIREBASE_CONFIG);

  const user = getCurrentUser();
  if (!user) {
    renderEmpty();
    return;
  }

  state.db = firebase.database();
  state.messagesRef = state.db.ref(`channels/${state.channelId}/messages`);
  state.messagesQuery = state.messagesRef.orderByChild("createdAt").limitToLast(LIMIT_MESSAGES);
  state.metaRef = state.db.ref(`channels/${state.channelId}/meta`);
  state.presenceRoomRef = state.db.ref(`presence/${state.channelId}`);
  state.presenceSelfRef = state.presenceRoomRef.child(user.key);
  state.ready = true;
  els.dbHint.textContent = "جاهز";

  setPresence();
  state.presenceSelfRef.onDisconnect().update({ online: false, lastSeen: Date.now(), typing: false, typingAt: null, name: user.name });

  state.listeners = {
    childAdded: (snap) => { const msg = snap.val(); if (!msg) return; if (state.messages.some((m) => m.key === snap.key)) return; state.messages.push({ key: snap.key, ...msg }); renderMessages(); },
    childChanged: (snap) => { const msg = snap.val(); const idx = state.messages.findIndex((m) => m.key === snap.key); if (idx >= 0) { state.messages[idx] = { key: snap.key, ...msg }; renderMessages(); } },
    childRemoved: (snap) => { const idx = state.messages.findIndex((m) => m.key === snap.key); if (idx >= 0) { state.messages.splice(idx, 1); } if (state.meta?.pinned?.key === snap.key) { state.metaRef.child("pinned").remove().catch(() => {}); } renderMessages(); },
    meta: (snap) => { state.meta = snap.val() || { lastRead: {}, pinned: null }; renderMessages(); updateIdentity(); },
    presence: (snap) => { state.presences = snap.val() || {}; updateIdentity(); }
  };

  state.messagesQuery.on("child_added", state.listeners.childAdded, () => {
    els.dbHint.textContent = "تعذر الاتصال";
    els.netState.textContent = "غير متصل";
  });
  state.messagesQuery.on("child_changed", state.listeners.childChanged);
  state.messagesQuery.on("child_removed", state.listeners.childRemoved);
  state.metaRef.on("value", state.listeners.meta);
  state.presenceRoomRef.on("value", state.listeners.presence);

  state.messagesQuery.limitToLast(1).once("value").then((snap) => { if (!snap.exists()) renderEmpty(); }).catch(() => {});
  updateIdentity();
  refreshReadMarkerFromView();
}

async function sendMessage(text) {
  const user = getCurrentUser();
  if (!state.messagesRef || !state.ready || !user) {
    toast("سجل دخول الأول");
    return;
  }

  const payload = {
    text: text.trim(),
    senderKey: user.key,
    senderName: user.name,
    createdAt: Date.now()
  };
  if (state.replyTo) payload.replyTo = state.replyTo;

  await state.messagesRef.push(payload);
  state.replyTo = null;
  renderReplyBar();
  await setPresence({ lastSeen: Date.now(), typing: false, typingAt: null });
}

async function deleteMessage(key) {
  if (!key || !state.messagesRef) return;
  const ok = window.confirm("حذف الرسالة للجميع؟");
  if (!ok) return;
  await state.messagesRef.child(key).remove();
}

async function editMessage(key) {
  const msg = state.messages.find((m) => m.key === key);
  const user = getCurrentUser();
  if (!msg || msg.senderKey !== user?.key) return;
  if (state.messages[state.messages.length - 1]?.key !== key) return toast("عدّل آخر رسالة فقط");
  if (Date.now() - (msg.createdAt || 0) > READ_WINDOW_MS) return toast("انتهى وقت التعديل");

  const next = window.prompt("تعديل الرسالة", msg.text || "");
  if (next === null) return;
  const trimmed = next.trim();
  if (!trimmed) return toast("الرسالة لا يمكن أن تكون فارغة");
  await state.messagesRef.child(key).update({ text: trimmed, editedAt: Date.now() });
}

async function pinMessage(key) {
  const msg = state.messages.find((m) => m.key === key);
  const user = getCurrentUser();
  if (!msg || msg.senderKey !== user?.key) return;
  await state.metaRef.child("pinned").set({
    key: msg.key,
    text: msg.text,
    senderKey: msg.senderKey,
    senderName: msg.senderName,
    createdAt: msg.createdAt,
    pinnedAt: Date.now()
  });
}

async function resetConversation(mode) {
  const user = getCurrentUser();
  if (!user || !state.messagesRef || !state.metaRef) {
    toast("سجل دخول الأول");
    return;
  }

  const ok = window.confirm(mode === "new" ? "بدء محادثة جديدة؟" : "مسح المحادثة؟");
  if (!ok) return;

  try {
    await state.messagesRef.remove();
    await state.metaRef.remove();
    state.lastAutoReadAt = 0;
    if (mode === "new") {
      await state.messagesRef.push({ system: true, text: "بدأت محادثة جديدة", createdAt: Date.now() });
    }
    state.messages = [];
    state.meta = { lastRead: {}, pinned: null };
    closeReplyAndMenu();
    renderMessages();
    updateIdentity();
    toast(mode === "new" ? "بدأت محادثة جديدة" : "تم مسح المحادثة");
    refreshReadMarkerFromView();
  } catch (err) {
    console.error(err);
    toast("فشل التنفيذ");
  }
}

function bootAuthed() {
  showAuthScreen(false);
  els.messageInput.disabled = false;
  attachChannel();
  updateIdentity();
}

renderAuthOptions();

els.authForm.addEventListener("submit", (e) => {
  e.preventDefault();
  const userKey = els.authUser.value;
  const pin = els.authPin.value.trim();
  const user = USERS[userKey];

  if (!user) {
    els.authHint.textContent = "اختار الاسم الأول";
    return;
  }
  if (pin !== user.pin) {
    els.authHint.textContent = "الرمز مش صحيح";
    els.authPin.focus();
    return;
  }

  els.authHint.textContent = "";
  setSession(userKey);
  els.authPin.value = "";
  closeReplyAndMenu();
  bootAuthed();
  toast(`أهلاً ${user.name}`);
});

els.logoutBtn.addEventListener("click", () => {
  clearSession();
  detachChannel();
  closeReplyAndMenu();
  els.messageInput.value = "";
  els.messageInput.disabled = true;
  showAuthScreen(true);
  updateIdentity();
});

els.clearChatBtn.addEventListener("click", () => resetConversation("clear"));
els.newChatBtn.addEventListener("click", () => resetConversation("new"));
els.cancelReplyBtn.addEventListener("click", closeReplyAndMenu);

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

els.messageInput.addEventListener("input", () => {
  if (els.messageInput.value.trim()) markTyping(true);
  else markTyping(false);
});

els.messageInput.addEventListener("blur", () => markTyping(false));

els.messages.addEventListener("click", (e) => {
  if (state.suppressNextMessageClick) {
    state.suppressNextMessageClick = false;
    return;
  }
  const box = e.target.closest(".message");
  if (!box) return;
  const msg = getMessageByKey(box.dataset.key);
  if (msg) setReplyTo(msg);
});

els.messages.addEventListener("pointerdown", (e) => {
  const box = e.target.closest(".message");
  if (!box) return;
  const msg = getMessageByKey(box.dataset.key);
  if (!msg) return;
  beginLongPress(msg, e.clientX, e.clientY);
});

els.messages.addEventListener("pointermove", (e) => {
  if (!state.longPressTimer || !state.longPressStart) return;
  const dx = Math.abs(e.clientX - state.longPressStart.x);
  const dy = Math.abs(e.clientY - state.longPressStart.y);
  if (dx > 10 || dy > 10) cancelLongPress();
});

els.messages.addEventListener("pointerup", cancelLongPress);
els.messages.addEventListener("pointercancel", cancelLongPress);
els.messages.addEventListener("mouseleave", cancelLongPress);
els.messages.addEventListener("contextmenu", (e) => {
  const box = e.target.closest(".message");
  if (!box) return;
  e.preventDefault();
  const msg = getMessageByKey(box.dataset.key);
  if (msg) openActionMenu(msg, e.clientX, e.clientY);
});

els.messages.addEventListener("scroll", refreshReadMarkerFromView);
window.addEventListener("online", () => { els.netState.textContent = "اون لاين"; setPresence(); hideActionMenu(); });
window.addEventListener("offline", () => { els.netState.textContent = "غير متصل"; });

document.addEventListener("visibilitychange", () => {
  if (!document.hidden) {
    refreshReadMarkerFromView();
    setPresence({ lastSeen: Date.now(), typing: false, typingAt: null });
  } else {
    setPresence({ lastSeen: Date.now(), typing: false, typingAt: null });
  }
});

document.addEventListener("click", (e) => {
  if (state.actionMenu.open && !e.target.closest("#messageMenu")) hideActionMenu();
});

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") closeReplyAndMenu();
});

els.messageMenu?.addEventListener("click", async (e) => {
  const btn = e.target.closest("button[data-action]");
  if (!btn) return;
  const key = state.actionMenu.key;
  const msg = getMessageByKey(key);
  hideActionMenu();
  if (!msg) return;
  const action = btn.dataset.action;
  if (action === "reply") setReplyTo(msg);
  if (action === "edit") editMessage(key);
  if (action === "delete") deleteMessage(key);
  if (action === "pin") pinMessage(key);
});

window.addEventListener("beforeunload", () => {
  const user = getCurrentUser();
  if (user && state.presenceSelfRef) {
    try {
      state.presenceSelfRef.update({ online: false, lastSeen: Date.now(), typing: false, typingAt: null, name: user.name });
    } catch {}
  }
});

const initialSession = state.session;
showAuthScreen(!initialSession);
if (initialSession) bootAuthed();
