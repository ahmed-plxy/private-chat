const STORAGE_NAME = "betweenus_display_name_v5";
const STORAGE_DEVICE = "betweenus_device_id_v5";
const DEFAULT_CHANNEL = "main";

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
  netState: document.getElementById("netState")
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
  ready: false
};

localStorage.setItem(STORAGE_DEVICE, state.deviceId);
els.roomLabel.textContent = "شات";

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
}

function timeLabel(value) {
  try {
    return new Intl.DateTimeFormat("ar-EG", {
      hour: "2-digit",
      minute: "2-digit"
    }).format(new Date(value));
  } catch {
    return "";
  }
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
  if (state.channelRef && state.childListener) {
    state.channelRef.off("child_added", state.childListener);
  }
  state.channelRef = null;
  state.childListener = null;
  state.ready = false;
  updateIdentity();
}

function configLooksValid() {
  return window.FIREBASE_CONFIG
    && window.FIREBASE_CONFIG.apiKey
    && !String(window.FIREBASE_CONFIG.apiKey).includes("PASTE_YOUR");
}

function attachChannel() {
  detachChannel();
  els.messages.innerHTML = "";
  els.dbHint.textContent = "جاري الاتصال";
  els.netState.textContent = "اون لاين";

  if (!window.firebase || !configLooksValid()) {
    els.dbHint.textContent = "Firebase";
    renderEmpty();
    updateIdentity();
    return;
  }

  if (!firebase.apps.length) {
    firebase.initializeApp(window.FIREBASE_CONFIG);
  }

  state.db = firebase.database();
  state.channelRef = state.db.ref(`channels/${state.channelId}/messages`);
  state.channelQuery = state.channelRef.orderByChild("createdAt");
  state.ready = true;
  els.dbHint.textContent = "عشان لو قفلت سوشيال";

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
    els.netState.textContent = "غير متصل";
  });

  state.channelRef.limitToLast(1).once("value").then((snap) => {
    if (!snap.exists()) {
      els.messages.dataset.empty = "1";
      renderEmpty();
    }
  }).catch(() => {});

  updateIdentity();
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

window.addEventListener("online", () => {
  els.netState.textContent = "اون لاين";
});

window.addEventListener("offline", () => {
  els.netState.textContent = "غير متصل";
});

setName(els.nameInput.value);
attachChannel();
updateIdentity();
