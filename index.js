(function (exports) {
"use strict";
const APP_IDS = ["1554084772618182746", "1554104747273748550"];
const COMMAND_NAME = "Decode";
const ONLY_AUTHOR_ID = "";
const HIDE_SHEET = true;
const MODE = "both";
const DEBUG = true;
const LOCAL_LINK = true;
const LOCAL_URL = "http://127.0.0.1:8787";
const LOCAL_KEY = "qd";
const AUTO_SEND = true;
const FILL_DEBUG = true;
const FILL_BOX = true;
const PREFETCH = true;
const CMD_ID = "";
const CMD_VERSION = "";
const { findByProps, findByStoreName } = vendetta.metro;
const { before, instead, after } = vendetta.patcher;
const React = vendetta.metro.common.React;
const findInReactTree = (vendetta.utils && vendetta.utils.findInReactTree) || function () { return null; };
const alerts = vendetta.ui.alerts;
let lastAlert = 0;
function say(msg) { try { console.log("[QuickDecode] " + msg); } catch (e) {} }
function alertMsg(msg) {
say(msg);
const now = Date.now();
if (now - lastAlert < 15000) return;
lastAlert = now;
setTimeout(function () {
try { alerts.showConfirmationAlert({ title: "Quick Decode", content: msg, confirmText: "OK" }); } catch (e) {}
}, 400);
}
const ActionSheet = findByProps("openLazy", "hideActionSheet");
const RestAPI = findByProps("getAPIBaseURL", "get");
const SessionStore = findByProps("getSessionId");
const Snowflake = findByProps("fromTimestamp");
const ChannelStore = findByStoreName("ChannelStore");
const MessageStore = findByStoreName("MessageStore");
const ReactionActions = findByProps("addReaction", "removeReaction");
const PermissionStore = findByStoreName("PermissionStore");
const SelectedChannelStore = findByStoreName("SelectedChannelStore");
const UserStore = findByStoreName("UserStore");
const MessageActions = findByProps("sendMessage", "receiveMessage");
const DraftStore = findByStoreName("DraftStore");
const DraftActions = findByProps("changeDraft");
const Flux = (vendetta.metro.common && vendetta.metro.common.FluxDispatcher) || findByProps("dispatch", "subscribe");
const PermConsts = (vendetta.metro.common.constants && vendetta.metro.common.constants.Permissions) ||
(findByProps("Permissions") || {}).Permissions || {};
const ADD_REACT = PermConsts.ADD_REACTIONS;
const unpatches = [];
const lastFired = {};
let store = {};
try { store = vendetta.plugin.storage || {}; } catch (e) {}
function isDecode(c) {
return !!c && c.name === COMMAND_NAME && c.type === 3 && APP_IDS.indexOf(c.application_id) !== -1;
}
let cmdCache = null;
try { if (CMD_ID) cmdCache = { id: CMD_ID, version: CMD_VERSION || CMD_ID, name: COMMAND_NAME, type: 3, application_id: APP_IDS[0] };
else if (isDecode(store.cmd)) cmdCache = store.cmd; } catch (e) {}
let inflight = null;
function remember(c) {
cmdCache = c;
try { store.cmd = c; } catch (e) {}
}
function forget() {
if (CMD_ID) return;
cmdCache = null;
try { store.cmd = null; } catch (e) {}
}
function describe(e) {
const status = e && e.status;
const msg = (e && e.body && e.body.message) || (e && e.message) || "";
return (status ? status + " " : "") + msg;
}
function lookup(channelId, guildId) {
const urls = ["/users/@me/application-command-index"];
if (channelId) urls.unshift("/channels/" + channelId + "/application-command-index");
if (guildId) urls.push("/guilds/" + guildId + "/application-command-index");
return new Promise(function (resolve, reject) {
let left = urls.length, done = false, lastErr = null;
function settle() { if (--left === 0 && !done) reject(lastErr || new Error("not in command list")); }
  urls.forEach(function (u) {
let p;
try { p = RestAPI.get({ url: u }); } catch (e) { lastErr = e; settle(); return; }
Promise.resolve(p).then(function (res) {
const list = (res && res.body && res.body.application_commands) || [];
const found = list.find(isDecode);
if (found && !done) { done = true; resolve(found); }
settle();
}, function (e) { lastErr = e; settle(); });
});
});
}
function getCommand(channelId, guildId) {
if (cmdCache) return Promise.resolve(cmdCache);
if (!inflight) {
inflight = lookup(channelId, guildId).then(function (c) { remember(c); inflight = null; return c; },
function (e) { inflight = null; const err = new Error(describe(e) || "not in command list"); err.step = "find"; throw err; });
}
return inflight;
}
function nonce() {
try { return String(Snowflake.fromTimestamp(Date.now())); }
catch (e) { return String(Date.now() - 1420070400000) + String(Math.floor(Math.random() * 1e7)); }
}
function isPuzzle(message) {
if (!message || !message.author || !message.author.bot) return false;
if (ONLY_AUTHOR_ID && message.author.id !== ONLY_AUTHOR_ID) return false;
return ((message.embeds || []).length > 0) ||
((message.attachments || []).length > 0) ||
((message.components || []).length > 0);
}
function post(cmd, message, channelId, guildId) {
const body = {
type: 2,
application_id: cmd.application_id || APP_IDS[0],
channel_id: channelId,
session_id: SessionStore.getSessionId(),
nonce: nonce(),
data: {
version: cmd.version,
id: cmd.id,
name: cmd.name,
type: 3,
target_id: message.id,
application_command: cmd,
},
analytics_location: "context_menu",
};
if (guildId) body.guild_id = guildId;
return RestAPI.post({ url: "/interactions", body: body });
}
async function runDecode(message) {
const t0 = Date.now();
const channelId = message.channel_id;
const channel = ChannelStore.getChannel(channelId);
const guildId = channel && channel.guild_id;
let step = "find";
try {
let cmd = await getCommand(channelId, guildId);
step = "send";
try {
await post(cmd, message, channelId, guildId);
} catch (e1) {
forget();
step = "find";
cmd = await getCommand(channelId, guildId);
step = "send";
await post(cmd, message, channelId, guildId);
}
say("decode sent in " + (Date.now() - t0) + " ms");
} catch (e) {
forget();
alertMsg("Quick Decode " + (e && e.step || step) + " failed: " + describe(e));
}
}
let localDownUntil = 0;
let localState = "not tested yet";
function img(p) { return p ? { url: p.url || "", proxy_url: p.proxyURL || p.proxy_url || "" } : null; }
function payload(m) {
return {
k: LOCAL_KEY,
id: m.id,
content: m.content || "",
embeds: (m.embeds || []).map(function (e) {
return {
title: e.rawTitle || e.title || "",
description: e.rawDescription || e.description || "",
author: e.author ? { name: e.author.name || "" } : null,
footer: e.footer ? { text: e.footer.text || "" } : null,
fields: (e.fields || []).map(function (f) { return { name: f.rawName || f.name || "", value: f.rawValue || f.value || "" }; }),
image: img(e.image),
thumbnail: img(e.thumbnail),
};
}),
attachments: (m.attachments || []).map(function (a) {
return { url: a.url, proxy_url: a.proxyURL || a.proxy_url, content_type: a.content_type || a.contentType };
}),
};
}
function localCall(path, body, ms) {
return new Promise(function (resolve, reject) {
const t = setTimeout(function () { reject(new Error("timeout")); }, ms);
let p;
try {
p = body ? fetch(LOCAL_URL + path, { method: "POST", headers: { "Content-Type": "text/plain" }, body: JSON.stringify(body) })
: fetch(LOCAL_URL + path);
} catch (e) { clearTimeout(t); reject(e); return; }
p.then(function (r) { return r.json(); }).then(function (j) { clearTimeout(t); resolve(j); },
function (e) { clearTimeout(t); reject(e); });
});
}
function linkDown(e) { if (!e || e.message !== "timeout") localDownUntil = Date.now() + 20000; }
let rawDraftNote = "";
let lastFill = null;
function currentDraft(channelId) {
try {
if (DraftStore && DraftStore.getDraft) {
let v = DraftStore.getDraft(channelId, 0);
rawDraftNote = typeof v + (v && typeof v === "object" ? " " + JSON.stringify(v).slice(0, 80) : ":" + JSON.stringify(v));
if (v && typeof v === "object") v = v.draft !== undefined ? v.draft : (v.text !== undefined ? v.text : (v.content !== undefined ? v.content : ""));
return String(v || "");
}
} catch (e) { rawDraftNote = "error " + (e && e.message); }
return null;
}
function setBox(channelId, text) {
const used = [];
try { if (DraftActions && DraftActions.changeDraft) { DraftActions.changeDraft(channelId, text, 0); used.push("changeDraft"); } } catch (e) { say("changeDraft failed: " + (e && e.message)); }
try { if (Flux && Flux.dispatch) { Flux.dispatch({ type: "DRAFT_CHANGE", channelId: channelId, draft: text, draftType: 0 }); used.push("flux"); } } catch (e) { say("flux draft failed: " + (e && e.message)); }
return used;
}
function probeInput() {
const names = ["insertText", "setText", "setChatInputText", "updateText", "appendText", "setInputText"];
const hit = [];
names.forEach(function (n) { try { if (findByProps(n)) hit.push(n); } catch (e) {} });
return hit.length ? hit.join(",") : "none";
}
const InputCmds = findByProps("setText", "getText");
const setTextArity = InputCmds && InputCmds.setText ? InputCmds.setText.length : 0;
let inputRef = null, refVia = "", seenSig = "", inCall = false;
if (InputCmds) {
["focus", "blur", "getText", "flushText", "setText", "setSelectedRange", "backspace"].forEach(function (name) {
if (typeof InputCmds[name] !== "function") return;
try {
unpatches.push(before(name, InputCmds, function (args) {
if (inCall) return;
const a = args && args[0];
if (a && (typeof a === "object" || typeof a === "number")) { inputRef = a; refVia = name; }
if (name === "setText" && !seenSig) seenSig = Array.prototype.map.call(args, function (x) { return typeof x; }).join(",");
}));
} catch (e) {}
});
}
  // ===== PART 2 =====
function pushToInput(text) {
try {
if (!InputCmds || typeof InputCmds.setText !== "function") return "no setText helper";
const sig = seenSig ? " Discord's own setText calls look like (" + seenSig + ")." : "";
const arity = setTextArity;
  if (arity <= 1) { inCall = true; try { InputCmds.setText(text); } finally { inCall = false; } return "called setText(text)." + sig; }
if (!inputRef) return "no handle to the box yet - tap the message box once, then double-tap the puzzle again." + sig;
inCall = true;
try {
InputCmds.setText(inputRef, text);
if (typeof InputCmds.flushText === "function") InputCmds.flushText(inputRef);
} finally { inCall = false; }
  return "called setText(handle, text)+flushText; handle is a " + typeof inputRef + " taken from " + refVia + "." + sig;
} catch (e) { inCall = false; return "setText failed: " + (e && e.message); }
}
function fillReport(msg) {
say("box fill: " + msg);
if (!FILL_DEBUG) return;
setTimeout(function () {
try { alerts.showConfirmationAlert({ title: "Quick Decode box fill", content: msg, confirmText: "OK" }); } catch (e) {}
}, 300);
}
function fillBox(message, answer) {
if (!FILL_BOX) return;
try {
const text = String(answer || "").replace(/\s+/g, " ").trim();
if (!text || text.length > 200) { fillReport("skipped: empty or too long answer"); return; }
const ch = message.channel_id;
const viewing = SelectedChannelStore && SelectedChannelStore.getChannelId();
if (!SelectedChannelStore || viewing !== ch) { fillReport("skipped: not looking at that channel (viewing " + viewing + ", puzzle in " + ch + ")"); return; }
const draft = currentDraft(ch);
if (draft === null) { fillReport("skipped: cannot read the box (DraftStore missing)"); return; }
if (draft.trim() !== "" && !(lastFill && lastFill.ch === ch && lastFill.text === draft)) { fillReport("skipped: the box already has text. getDraft gave " + rawDraftNote); return; }
const used = setBox(ch, text);
if (!used.length) { fillReport("no way to set the draft found (changeDraft/flux missing). input helpers: " + probeInput()); return; }
lastFill = { ch: ch, text: text };
const inputNote = pushToInput(text);
const after = currentDraft(ch);
fillReport("set the draft via " + used.join("+") + " to \"" + text + "\". Store now reads: " + JSON.stringify(after) +
(after === text ? " (store took it)" : " (store did NOT take it)") + ". Input: " + inputNote);
} catch (e) { fillReport("failed: " + (e && e.message)); }
}
const sentFor = {};
function sendAnswer(message, answer) {
try {
const text = String(answer || "").replace(/\s+/g, " ").trim();
if (!text || text.length > 80) { say("not sent: empty or too long answer"); return false; }
if (sentFor[message.id]) { say("not sent: already answered this puzzle"); return false; }
const ch = message.channel_id;
if (!SelectedChannelStore || SelectedChannelStore.getChannelId() !== ch) { say("not sent: not looking at the puzzle channel"); return false; }
let how = "";
try {
if (MessageActions && MessageActions.sendMessage) {
MessageActions.sendMessage(ch, { content: text, tts: false, invalidEmojis: [], validNonShortcutEmojis: [] }, undefined, {});
how = "sendMessage";
}
} catch (e) { how = ""; say("sendMessage failed: " + (e && e.message)); }
if (!how) {
RestAPI.post({ url: "/channels/" + ch + "/messages", body: { content: text, nonce: nonce(), tts: false } });
how = "REST";
}
sentFor[message.id] = 1;
say("answer sent via " + how + ": " + text);
return true;
} catch (e) { say("send failed: " + (e && e.message)); return false; }
}
async function decodeNow(message) {
if (LOCAL_LINK && Date.now() >= localDownUntil) {
const t0 = Date.now();
try {
const r = await localCall("/decode", payload(message), 1500);
if (r && r.ok) { localState = "ok"; say("local decode ok in " + (Date.now() - t0) + " ms: " + r.answer); if (AUTO_SEND) sendAnswer(message, r.answer); else fillBox(message, r.answer); return; }
say("local decode gave no answer (" + (r && r.answer) + ") -> using Discord");
  if (FILL_BOX) fillReport("not filled: the bot gave no answer over the local link (" + (r && r.answer) + "), so Discord was used instead");
} catch (e) {
linkDown(e);
say("local link failed (" + (e && e.message) + ") -> using Discord");
if (FILL_BOX) fillReport("not filled: local link failed (" + (e && e.message) + "), so Discord was used instead");
}
} else if (LOCAL_LINK && FILL_BOX) {
fillReport("not filled: local link is marked down for another " + Math.ceil((localDownUntil - Date.now()) / 1000) + " s, so Discord was used instead");
}
runDecode(message);
}
function askChoice(title, labels) {
return new Promise(function (resolve) {
let done = false;
function finish(v) { if (done) return; done = true; resolve(v); }
setTimeout(function () { finish(null); }, 180000);
function show(i) {
try {
if (labels.length === 1) {
alerts.showConfirmationAlert({ title: "Flee: stairs", content: title, confirmText: labels[0], cancelText: "Cancel",
onConfirm: function () { finish(0); }, onCancel: function () { finish(null); } });
} else if (labels.length === 2) {
alerts.showConfirmationAlert({ title: "Flee: which stairs?", content: title, confirmText: labels[0], cancelText: labels[1],
onConfirm: function () { finish(0); }, onCancel: function () { finish(1); } });
} else {
const last = i >= labels.length - 1;
alerts.showConfirmationAlert({ title: "Flee: which stairs? (" + (i + 1) + "/" + labels.length + ")", content: title, confirmText: labels[i],
cancelText: last ? "Cancel" : "Next",
onConfirm: function () { finish(i); }, onCancel: function () { if (last) finish(null); else show(i + 1); } });
}
} catch (e) { finish(null); }
}
setTimeout(function () { show(0); }, 300);
});
  }
  // part 2
const FLEE_CHUNK = 5;
const FLEE_ROUNDS = 25;
const FLEE_WAIT = 9000;
const G = (typeof globalThis !== "undefined") ? globalThis : {};
const fleeBusy = {};
const mapWaiters = [];
function isHeistMap(m) {
try {
const t = (m.content || "") + " " + (m.embeds || []).map(function (e) { return (e.rawTitle || e.title || "") + " " + (e.rawDescription || e.description || ""); }).join(" ");
return /heist\s*map/i.test(t);
} catch (e) { return false; }
}
function mentionsMe(m) {
try {
const me = UserStore && UserStore.getCurrentUser && UserStore.getCurrentUser();
if (!me) return true;
const txt = (m.content || "") + " " + (m.embeds || []).map(function (e) { return (e.rawDescription || e.description || "") + " " + (e.rawTitle || e.title || ""); }).join(" ");
return txt.indexOf("<@" + me.id + ">") >= 0 || txt.indexOf("<@!" + me.id + ">") >= 0;
} catch (e) { return true; }
}
function sendText(ch, text) {
try {
if (MessageActions && MessageActions.sendMessage) {
MessageActions.sendMessage(ch, { content: text, tts: false, invalidEmojis: [], validNonShortcutEmojis: [] }, undefined, {});
return true;
}
} catch (e) { say("flee sendMessage failed: " + (e && e.message)); }
try { RestAPI.post({ url: "/channels/" + ch + "/messages", body: { content: text, nonce: nonce(), tts: false } }); return true; } catch (e) { say("flee REST failed: " + (e && e.message)); }
return false;
}
const AUTO_TYPE_FLEE = false;   // a64: true = plugin types "flee" itself when the game asks "Do you want to flee?"
const FAST_ACK = 700;           // a64: after each message wait (max ms) for the game's answer so the "Do you want to flee?" prompt can stop us
const promptAt = {};
const stopAt = {};              // a69: guard / sensor / lost-life message -> STOP everything until Fast flee is tapped again
const eventAt = {};             // a67: "Spotted by Guard" / "Sensor Triggered" / lost-a-life messages -> drop the old route, plan a new one
function evText(m) { return (m.content || "") + " " + (m.embeds || []).map(function (e) { return (e.rawTitle || e.title || "") + " " + (e.rawDescription || e.description || ""); }).join(" "); }
function isStopEvent(m) { try { return /spotted by guard|sensor triggered|lost a life|lives? left/i.test(evText(m)) && !isHeistMap(m); } catch (e) { return false; } }
function isEvent(m) { try { return /needs a keycard/i.test(evText(m)) && !isHeistMap(m); } catch (e) { return false; } }
// a69: the mobile app freezes Discord's "Police arrives in 23 seconds" text -> read the real time stamp <t:UNIX:R> and show it ourselves
function policeLine(m) {
try {
const t = (m.embeds || []).map(function (e) { return (e.rawDescription || e.description || ""); }).join(" ") + " " + (m.content || "");
const x = /<t:(\d+)(?::[a-zA-Z])?>/.exec(t);
if (!x) return null;
const s = Math.round(+x[1] - Date.now() / 1000);
const a = Math.abs(s), txt = a >= 60 ? Math.floor(a / 60) + "m " + (a % 60) + "s" : a + "s";
return s >= 0 ? "Police arrive in " + txt : "Police arrived " + txt + " ago";
} catch (e) { return null; }
}
function toast(msg) {
say(msg);                          // a70: no pop-ups / toasts - console only
}
function isPrompt(m) {
try {
const t = (m.content || "") + " " + (m.embeds || []).map(function (e) { return (e.rawDescription || e.description || "") + " " + (e.rawTitle || e.title || ""); }).join(" ");
return /do you want to flee/i.test(t);
} catch (e) { return false; }
}
function onMapEvent(ev) {
try {
const m = ev && ev.message;
const pr = !!(m && m.id && m.author && m.author.bot && isPrompt(m));
if (pr) promptAt[m.channel_id] = Date.now();
const stp = !!(m && m.id && m.author && m.author.bot && !pr && isStopEvent(m));
if (stp) stopAt[m.channel_id] = Date.now();
const evn = stp || !!(m && m.id && m.author && m.author.bot && !pr && isEvent(m));
if (evn && !stp) eventAt[m.channel_id] = Date.now();
if (!mapWaiters.length || !m || !m.id || !m.author || !m.author.bot) return;
if (!pr && !evn && (!isHeistMap(m) || !mentionsMe(m))) return;
for (let i = mapWaiters.length - 1; i >= 0; i--) {
  
  const w = mapWaiters[i];
if (w.ch === m.channel_id && !w.seen[m.id]) { mapWaiters.splice(i, 1); clearTimeout(w.t); w.done(m); }
}
} catch (e) {}
}
function waitForMap(ch, seen, ms) {
return new Promise(function (resolve) {
const w = { ch: ch, seen: seen, done: resolve, t: null };
w.t = setTimeout(function () { const i = mapWaiters.indexOf(w); if (i >= 0) mapWaiters.splice(i, 1); resolve(null); }, ms);
mapWaiters.push(w);
});
}
function latestMap(ch, fallback) {
try {
const msgs = MessageStore.getMessages(ch);
const arr = (msgs && (msgs.toArray ? msgs.toArray() : msgs._array)) || [];
for (let i = arr.length - 1; i >= 0; i--) {
const m = arr[i];
if (m && m.author && m.author.bot && (m.embeds || []).length && isHeistMap(m) && mentionsMe(m)) return m;
}
} catch (e) {}
return fallback;
}
async function fleeNow(message) {
const ch = message.channel_id;
const now = Date.now();
if (fleeBusy[ch] || (G.__qdFleeUntil && now < G.__qdFleeUntil)) { say("flee already running"); return; }
fleeBusy[ch] = true;
G.__qdFleeUntil = now + 120000;
try {
if (!SelectedChannelStore || SelectedChannelStore.getChannelId() !== ch) { alertMsg("Flee: open the heist channel first"); return; }
let cur = latestMap(ch, message);
const seen = {};
seen[cur.id] = 1; seen[message.id] = 1;
let prevLen = 1e9, stuck = 0, choice = null, asks = 0;
for (let round = 0; round < FLEE_ROUNDS; round++) {
if (SelectedChannelStore.getChannelId() !== ch) { say("flee stopped: left the channel"); return; }
let r;
try { r = await localCall("/flee", Object.assign(payload(cur), { buttons: true, choice: choice }), 5000); }
catch (e) { linkDown(e); alertMsg("Flee: bot not reachable (" + (e && e.message) + ")"); return; }
choice = null;
if (r && !r.ok && r.ask && r.ask.length && asks < 4) {
asks++;
const idx = await askChoice(r.answer || "Which stairs go DOWN?", r.ask);
if (idx === null || idx === undefined) { say("flee: stairs question not answered"); return; }
choice = idx;
round--;
continue;
}
if (!r || !r.ok) { alertMsg("Flee: " + ((r && r.answer) || "no answer")); return; }
const steps = String(r.steps || "").toLowerCase().replace(/[^wasd]/g, "");
const stairs = /STAIRS/.test(String(r.answer || ""));
if (!steps) { say("flee: nothing to move"); if (round === 0 && stairs) alertMsg("Flee: " + r.answer); return; }
if (steps.length >= prevLen) {
stuck++;
if (stuck >= 2) { alertMsg("Flee: stuck - the moves are not changing your position (wall or locked door?)"); return; }
} else stuck = 0;
prevLen = steps.length;
say("flee route (" + steps.length + "): " + steps);
const last = steps.length <= FLEE_CHUNK;
const wait = (!last || stairs) ? waitForMap(ch, seen, FLEE_WAIT) : null;
if (!sendText(ch, steps.slice(0, FLEE_CHUNK))) { alertMsg("Flee: could not send"); return; }
if (last && !stairs) return;
const nm = await wait;
if (!nm) { alertMsg("Flee: the bot did not answer with a new map"); return; }
seen[nm.id] = 1;
cur = nm;
if (last && stairs) { prevLen = 1e9; stuck = 0; }
}
alertMsg("Flee: stopped after " + FLEE_ROUNDS + " rounds");
} finally { fleeBusy[ch] = false; G.__qdFleeUntil = 0; }
}
if (Flux && Flux.subscribe) {
try {
Flux.subscribe("MESSAGE_CREATE", onMapEvent);
Flux.subscribe("MESSAGE_UPDATE", onMapEvent);
  
  unpatches.push(function () { try { Flux.unsubscribe("MESSAGE_CREATE", onMapEvent); Flux.unsubscribe("MESSAGE_UPDATE", onMapEvent); } catch (e) {} });
} catch (e) {}
}
function fire(message) {
const now = Date.now();
if (lastFired[message.id] && now - lastFired[message.id] < 3000) return;
lastFired[message.id] = now;
say("decoding...");
decodeNow(message);
}
const preSeen = {};
function onNewMessage(ev) {
try {
const m = ev && ev.message;
if (!m || !m.id || preSeen[m.id] || !m.author || !m.author.bot) return;
if (ONLY_AUTHOR_ID && m.author.id !== ONLY_AUTHOR_ID) return;
if (!((m.embeds || []).length || (m.attachments || []).length)) return;
if (SelectedChannelStore && m.channel_id !== SelectedChannelStore.getChannelId()) return;
const me = UserStore && UserStore.getCurrentUser && UserStore.getCurrentUser();
if (me) {
const txt = (m.content || "") + " " + (m.embeds || []).map(function (e) { return (e.rawDescription || e.description || "") + " " + (e.rawTitle || e.title || ""); }).join(" ");
if (txt.indexOf("<@" + me.id + ">") < 0 && txt.indexOf("<@!" + me.id + ">") < 0) return;
}
if (Date.now() < localDownUntil) return;
preSeen[m.id] = 1;
localCall("/pre", payload(m), 1500).then(function () { localState = "ok"; }, linkDown);
} catch (e) {}
}
if (LOCAL_LINK && PREFETCH && Flux && Flux.subscribe) {
try {
Flux.subscribe("MESSAGE_CREATE", onNewMessage);
Flux.subscribe("MESSAGE_UPDATE", onNewMessage);
unpatches.push(function () { try { Flux.unsubscribe("MESSAGE_CREATE", onNewMessage); Flux.unsubscribe("MESSAGE_UPDATE", onNewMessage); } catch (e) {} });
} catch (e) {}
}
if (LOCAL_LINK) setTimeout(function () {
localCall("/ping", null, 2000).then(function (j) { localState = j && j.ok ? "ok" : "no answer"; },
function (e) { localState = "unreachable (" + (e && e.message) + ")"; linkDown(e); });
}, 2000);
if (!cmdCache) setTimeout(function () { getCommand(null, null).then(function () { say("Decode command ready"); }, function () {}); }, 2500);

  // ===================== a60: MENU (Flee / Fast flee / Auto loot / Auto heist) + helpers =====================
const FAST_GAP = 120;            // ms between the messages of Fast flee (0 = back to back, no waiting)
const AUTO_ROUNDS = 60;        // max rounds of Auto loot / Auto heist
function cleanSteps(x) { return String(x || "").toLowerCase().replace(/[^wasd]/g, ""); }
function chunkSteps(steps) { const out = []; for (let i = 0; i < steps.length; i += FLEE_CHUNK) out.push(steps.slice(i, i + FLEE_CHUNK)); return out; }
function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
function claim(ch) {
if (fleeBusy[ch] || (G.__qdFleeUntil && Date.now() < G.__qdFleeUntil)) { alertMsg("Already running - wait for it to finish"); return false; }
fleeBusy[ch] = true; G.__qdFleeUntil = Date.now() + 300000; return true;
}
function release(ch) { fleeBusy[ch] = false; G.__qdFleeUntil = 0; }
function inChannel(ch) { return SelectedChannelStore && SelectedChannelStore.getChannelId() === ch; }

// FAST FLEE: ask the bot for the WHOLE route, send ALL the 5-letter messages back to back,
// wait for the new map, plan again - and keep going until you are standing on the exit.
const FAST_ROUNDS = 15;        // max plan -> send rounds (floors, stairs, blind spots)
const FAST_SETTLE = 800;       // ms of silence after the last bot map before planning again
// returns: "sent" (messages sent) | "exit" (you are on the exit) | "wait" (on a ladder, wait for next floor) | "cancel" | "error"
async function fastFleeCore(ch, cur) {
let choice = null, asks = 0;
const t0 = Date.now();
for (let k = 0; k < 6; k++) {
let r;
try { r = await localCall("/fastflee", Object.assign(payload(cur), { buttons: true, choice: choice }), 8000); }
catch (e) { linkDown(e); alertMsg("Fast flee: bot not reachable (" + (e && e.message) + ")"); return "error"; }
choice = null;
if (r && !r.ok && r.ask && r.ask.length && asks < 4) {
asks++;
const idx = await askChoice(r.answer || "Which stairs go DOWN?", r.ask);
if (idx === null || idx === undefined) return "cancel";
choice = idx; continue;
}
if (!r || !r.ok) { alertMsg("Fast flee: " + ((r && r.answer) || "no answer")); return "error"; }
let chunks = (r.chunks && r.chunks.length) ? r.chunks.map(cleanSteps).filter(Boolean) : chunkSteps(cleanSteps(r.steps));
if (!chunks.length) {
const a = String(r.answer || "");
if (/ladder|stairs/i.test(a)) { say("fast flee: on the ladder - waiting for the next floor"); return "wait"; }
say("fast flee: at the door - done (silent)"); return "exit";      // a63: at the green door -> no alert, no message
}
say("fast flee " + chunks.length + " messages: " + chunks.join(" "));
for (let i = 0; i < chunks.length; i++) {
if (promptAt[ch] > t0) { say("fast flee: game asked 'Do you want to flee?' - stopped"); return "exit"; }   // a64
if (stopAt[ch] > t0) { say("fast flee: guard / sensor event - STOPPED"); return "stop"; }   // a69
if (eventAt[ch] > t0) { say("fast flee: keycard door - old route dropped, replanning"); return "replan"; }   // a67
if (!sendText(ch, chunks[i])) { alertMsg("Fast flee: could not send"); return "error"; }
if (FAST_ACK && i < chunks.length - 1) await waitForMap(ch, {}, FAST_ACK); else if (FAST_GAP) await sleep(FAST_GAP);
}
if (promptAt[ch] > t0) return "exit";
if (stopAt[ch] > t0) return "stop";
if (eventAt[ch] > t0) return "replan";
return "sent";
}
return "error";
}
async function fastFleeLoop(ch, cur) {
const seen = {}; seen[cur.id] = 1;
for (let round = 0; round < FAST_ROUNDS; round++) {
if (!inChannel(ch)) { say("fast flee stopped: left the channel"); return "left"; }
const tStart = Date.now();
seedPolice(cur);
const wait = waitForMap(ch, seen, FLEE_WAIT);          // listen BEFORE sending so no map is missed
const st = await fastFleeCore(ch, cur);
if (st === "stop" || stopAt[ch] > tStart) { toast("Fast flee stopped (guard / sensor / life lost) - tap Fast flee to start again"); return "stop"; }
if (st === "exit") { if (AUTO_TYPE_FLEE && promptAt[ch] > tStart) sendText(ch, "flee"); return "exit"; }
if (st === "replan") {                                 // a67: let the game's last map arrive, then plan again from it
let nm0 = null;
for (let g = 0; g < 12; g++) { const n2 = await waitForMap(ch, seen, FAST_SETTLE); if (!n2) break; seen[n2.id] = 1; nm0 = n2; if (promptAt[ch] > tStart) return "exit"; }
cur = latestMap(ch, nm0 || cur); seen[cur.id] = 1;
continue;
}
if (st !== "sent" && st !== "wait") return st;
let nm = await wait;
if (stopAt[ch] > tStart) { toast("Fast flee stopped (guard / sensor / life lost) - tap Fast flee to start again"); return "stop"; }
if (promptAt[ch] > tStart) { if (AUTO_TYPE_FLEE) sendText(ch, "flee"); return "exit"; }      // a64: at the door
if (!nm) { say("fast flee: no new map (door reached?) - stopped silently"); return "exit"; }      // a63: no alert
seen[nm.id] = 1;
for (let g = 0; g < 12; g++) {                         // the bot answers every message: wait until the last map is in
const n2 = await waitForMap(ch, seen, FAST_SETTLE);
if (!n2) break;
seen[n2.id] = 1; nm = n2;
}
if (promptAt[ch] > tStart) { if (AUTO_TYPE_FLEE) sendText(ch, "flee"); return "exit"; }
cur = latestMap(ch, nm);
seen[cur.id] = 1;
}
say("fast flee: stopped after " + FAST_ROUNDS + " rounds");
return "limit";
}
async function fastFleeNow(message) {
const ch = message.channel_id;
if (!inChannel(ch)) { alertMsg("Fast flee: open the heist channel first"); return; }
if (!claim(ch)) return;
try { await fastFleeLoop(ch, latestMap(ch, message)); } finally { release(ch); }
}

// AUTO LOOT / AUTO HEIST: bot says the next moves, plugin sends them, waits for the new map, repeats
async function autoLoop(ch, cur, path, label, extra) {
const seen = {}; seen[cur.id] = 1;
for (let round = 0; round < AUTO_ROUNDS; round++) {
if (!inChannel(ch)) { say(label + " stopped: left the channel"); return "left"; }
let r;
try { r = await localCall(path, Object.assign(payload(cur), { n: FLEE_CHUNK, reset: round === 0 }, extra || {}), 8000); }
catch (e) { linkDown(e); alertMsg(label + ": bot not reachable (" + (e && e.message) + ")"); return "error"; }
if (r && r.done) { say(label + " done: " + (r.answer || "")); return "done"; }
const steps = cleanSteps(r && r.steps);
if (!r || !r.ok || !steps) { alertMsg(label + ": " + ((r && r.answer) || "no answer")); return "error"; }
const wait = waitForMap(ch, seen, FLEE_WAIT);
if (!sendText(ch, steps.slice(0, FLEE_CHUNK))) { alertMsg(label + ": could not send"); return "error"; }
const nm = await wait;
if (!nm) { alertMsg(label + ": the bot did not answer with a new map"); return "error"; }
seen[nm.id] = 1; cur = nm;
}
alertMsg(label + ": stopped after " + AUTO_ROUNDS + " rounds");
return "limit";
}
async function autoLootNow(message) {
const ch = message.channel_id;
if (!inChannel(ch)) { alertMsg("Auto loot: open the heist channel first"); return; }
if (!claim(ch)) return;
try { await autoLoop(ch, latestMap(ch, message), "/loot", "Auto loot"); } finally { release(ch); }
}
// Auto heist = scout the whole floor (Scout), then Fast flee out
async function autoHeistNow(message) {
const ch = message.channel_id;
if (!inChannel(ch)) { alertMsg("Auto heist: open the heist channel first"); return; }
if (!claim(ch)) return;
try {
const res = await autoLoop(ch, latestMap(ch, message), "/scout", "Auto heist");
if (res === "done") await fastFleeLoop(ch, latestMap(ch, message));
} finally { release(ch); }
}
const MENU = [
{ label: "Flee", run: function (m) { fleeNow(m); } },
{ label: "Fast flee", run: function (m) { fastFleeNow(m); } },
{ label: "Auto loot", run: function (m) { autoLootNow(m); } },
{ label: "Auto heist", run: function (m) { autoHeistNow(m); } },
];
function hideSheet() { try { ActionSheet.hideActionSheet(); } catch (e) {} }
// fallback menu (only used if the rows can't be added to Discord's own sheet)
function altMenu(message, i) {
i = i || 0;
const it = MENU[i], last = i >= MENU.length - 1;
try {
alerts.showConfirmationAlert({ title: "Heist", content: it.label + "?", confirmText: it.label, cancelText: last ? "Close" : "Next",
onConfirm: function () { it.run(message); }, onCancel: function () { if (!last) altMenu(message, i + 1); } });
} catch (e) {}
}
let sheetFailed = false;
function addRows(message, tree) {
const rows = findInReactTree(tree, function (x) { return Array.isArray(x) && x.length > 1 && x[0] && x[0].props && typeof x[0].props.label === "string" && x[0].type; });
if (!rows) return false;
const base = rows[0];
const made = MENU.map(function (it, k) {
return React.createElement(base.type, Object.assign({}, base.props, { key: "qd-" + k, label: it.label, onPress: function () { hideSheet(); setTimeout(function () { it.run(message); }, 150); } }));
});
rows.splice.apply(rows, [1, 0].concat(made));
return true;
}
function patchSheet(args) {
const key = args[1], ctx = args[2] || {}, message = ctx.message;
if (key !== "MessageLongPressActionSheet" || !message || !message.author || !message.author.bot || !isHeistMap(message)) return;
if (sheetFailed) { setTimeout(function () { altMenu(message, 0); }, 350); return; }
Promise.resolve(args[0]).then(function (instance) {
if (!instance || typeof instance.default !== "function") { sheetFailed = true; altMenu(message, 0); return; }
const un = after("default", instance, function (_a, comp) {
try { React.useEffect(function () { return function () { un(); }; }, []); } catch (e) {}
let ok = false;
try { ok = addRows(message, comp); } catch (e) { say("add rows failed: " + (e && e.message)); }
if (!ok) { sheetFailed = true; say("could not add rows to the sheet - using the pop-up menu from now on"); setTimeout(function () { altMenu(message, 0); }, 350); }
return comp;
});
}, function () {});
}

// DOUBLE TAP on a puzzle (Discord's quick-react gesture) = decode + send the answer, no reaction
const lastTap = {};
function tapPuzzle(channelId, messageId) {
try {
const m = MessageStore && MessageStore.getMessage && MessageStore.getMessage(channelId, messageId);
if (!m || !isPuzzle(m) || !(MODE === "both" || MODE === "decode")) return false;
const now = Date.now();
if (lastTap[messageId] && now - lastTap[messageId] < 1500) return true;
lastTap[messageId] = now;
fire(m);
return true;
} catch (e) { return false; }
}
const reactionMods = (function () {
try { const all = vendetta.metro.findByPropsAll("addReaction"); if (all && all.length) return all; } catch (e) {}
return ReactionActions ? [ReactionActions] : [];
})();
reactionMods.forEach(function (RA) {
["addReaction", "toggleReaction", "addReactionWithBurst"].forEach(function (name) {
if (!RA || typeof RA[name] !== "function") return;
try {
unpatches.push(instead(name, RA, function (args, orig) {
let ch = args[0], id = args[1];
if (ch && typeof ch === "object") { id = ch.messageId || ch.id; ch = ch.channelId || ch.channel_id; }
if (tapPuzzle(ch, id) || tapPuzzle(id, ch)) return;
return orig.apply(this, args);
}));
} catch (e) { say("could not patch " + name + ": " + (e && e.message)); }
});
});
// ---- from the old plugin: P = let Discord allow the double-tap reaction in puzzle channels (otherwise the tap is blocked before any hook runs)
const puzzleChan = {};
function channelHasPuzzle(channelId) {
const now = Date.now(), c = puzzleChan[channelId];
if (c && now - c.t < 8000) return c.v;
let v = false;
try {
const msgs = MessageStore.getMessages(channelId);
const arr = (msgs && (msgs.toArray ? msgs.toArray() : msgs._array)) || [];
v = arr.slice(-40).some(isPuzzle);
} catch (e) {}
puzzleChan[channelId] = { t: now, v: v };
return v;
}
let hookP = false, hookB = false, hookM = false;
function isAddReact(p) { try { return (ADD_REACT !== undefined && p === ADD_REACT) || String(p) === "64"; } catch (e) { return false; } }
function chanIdOf(x) { if (!x) return null; if (typeof x === "string") return x; return x.id || x.channelId || x.channel_id || null; }
if ((MODE === "both" || MODE === "decode") && PermissionStore) {
["can", "canBasicChannel", "canWithPartialContext"].forEach(function (name) {
if (typeof PermissionStore[name] !== "function") return;
try {
unpatches.push(instead(name, PermissionStore, function (args, orig) {
const res = orig.apply(this, args);
if (res) return res;
try {
if (isAddReact(args[0])) {
for (let i = 1; i < args.length && i < 4; i++) { const id = chanIdOf(args[i]); if (id && channelHasPuzzle(id)) return true; }
}
} catch (e) {}
return res;
}));
hookP = true;
} catch (e) { say("permission spoof " + name + " failed: " + (e && e.message)); }
});
}
// ---- B = catch the REST call that adds the reaction, solve the puzzle instead, and fake a success answer
const REACT_URL = /\/channels\/(\d+)\/messages\/(\d+)\/reactions\//;
if ((MODE === "both" || MODE === "decode") && RestAPI && MessageStore && RestAPI.put) {
try {
unpatches.push(instead("put", RestAPI, function (args, orig) {
try {
const url = args[0] && args[0].url;
const hit = typeof url === "string" && REACT_URL.exec(url);
if (hit && tapPuzzle(hit[1], hit[2])) return Promise.resolve({ ok: true, status: 204, body: {}, headers: {} });
} catch (e) {}
return orig.apply(this, args);
}));
hookB = true;
} catch (e) { say("REST hook failed: " + (e && e.message)); }
}
say("double-tap hooks: A " + (reactionMods.length ? "ok" : "-") + ", B " + (hookB ? "ok" : "-") + ", P " + (hookP ? "ok" : "-"));

// ---- M = double tap straight on the puzzle image: 1st tap waits a moment (then opens the image as usual), 2nd tap = solve
function urlsOf(o, out, d) {
if (!o || d > 5 || out.length > 60) return;
if (typeof o === "string") { if (/^https?:/.test(o)) out.push(o); return; }
if (typeof o !== "object") return;
let keys; try { keys = Object.keys(o); } catch (e) { return; }
for (let k = 0; k < keys.length && k < 40; k++) { let v; try { v = o[keys[k]]; } catch (e) { continue; } urlsOf(v, out, d + 1); }
}
function fileKey(u) { try { return u.split("?")[0].split("/").slice(-2).join("/"); } catch (e) { return u; } }
function puzzleByUrls(ch, urls) {
const want = {}; urls.forEach(function (u) { want[fileKey(u)] = 1; });
const msgs = MessageStore.getMessages(ch);
const arr = (msgs && (msgs.toArray ? msgs.toArray() : msgs._array)) || [];
for (let i = arr.length - 1; i >= 0 && i >= arr.length - 60; i--) {
const m = arr[i];
if (!m || !isPuzzle(m)) continue;
const mine = []; urlsOf(m.embeds, mine, 0); urlsOf(m.attachments, mine, 0);
if (mine.some(function (u) { return want[fileKey(u)]; })) return m;
}
return null;
}
  // part 3
const mediaTap = {};
["openMediaModal", "openMediaViewer", "openLightbox"].forEach(function (name) {
let mod = null;
try { mod = findByProps(name); } catch (e) {}
if (!mod || typeof mod[name] !== "function") return;
try {
unpatches.push(instead(name, mod, function (args, orig) {
const self = this;
try {
if (MODE === "both" || MODE === "decode") {
const ch = SelectedChannelStore.getChannelId();
const urls = []; urlsOf(args, urls, 0);
const m = urls.length ? puzzleByUrls(ch, urls) : null;
if (m) {
const t = mediaTap[m.id];
if (t && Date.now() - t.at < 800) { clearTimeout(t.timer); delete mediaTap[m.id]; say("image double-tap"); fire(m); return; }
const rec = { at: Date.now() };
rec.timer = setTimeout(function () { delete mediaTap[m.id]; try { orig.apply(self, args); } catch (e) {} }, 650);
mediaTap[m.id] = rec;
return;
}
}
} catch (e) {}
return orig.apply(self, args);
}));
hookM = true;
} catch (e) { say("media hook " + name + " failed: " + (e && e.message)); }
});
function hookStatus() { return "double-tap hooks: reaction " + (reactionMods.length ? "ok" : "-") + ", REST " + (hookB ? "ok" : "-") + ", permission " + (hookP ? "ok" : "-") + ", image " + (hookM ? "ok" : "-"); }
say(hookStatus());
if (DEBUG) setTimeout(function () { alertMsg(hookStatus()); }, 6500);

// catch-all: if Discord's double-tap still adds a reaction by another route, the reaction event solves the puzzle
function onMyReaction(ev) {
try {
const me = UserStore && UserStore.getCurrentUser && UserStore.getCurrentUser();
if (!ev || !me || ev.userId !== me.id) return;
const ch = ev.channelId, id = ev.messageId;
if (!tapPuzzle(ch, id)) return;
setTimeout(function () {
try { ReactionActions.removeReaction(ch, id, ev.emoji, undefined, me.id); } catch (e) {}
}, 500);
} catch (e) {}
}
if (Flux && Flux.subscribe) {
try {
Flux.subscribe("MESSAGE_REACTION_ADD", onMyReaction);
unpatches.push(function () { try { Flux.unsubscribe("MESSAGE_REACTION_ADD", onMyReaction); } catch (e) {} });
} catch (e) {}
}

const spoofCache = {};
function handleMessage(message) {
if (!message || !message.id) return false;
if (message.author && message.author.bot && isHeistMap(message) && mentionsMe(message)) {
fleeNow(message);
return true;
}
if (isPuzzle(message) && (MODE === "both" || MODE === "decode")) {
fire(message);
return true;
}
return false;
}
try {
unpatches.push(before("openLazy", ActionSheet, function (args) {
try { patchSheet(args); } catch (e) { say("sheet patch error: " + (e && e.message)); }
}));
} catch (e) { say("could not patch ActionSheet: " + (e && e.message)); }

// ===== a71: POLICE TIMER - alerts at 9,8,7,6,5,4,3,2 min, 1:30, 60 s, 50 s, 30 s, 20 s, 10 s and when the police arrive =====
const TIME_ALERT = "toast";      // "toast" = small message that disappears, "alert" = pop-up with an OK button
const TIME_MARKS = [540, 480, 420, 360, 300, 240, 180, 120, 90, 60, 50, 30, 20, 10];
let policeTs = 0, policeFired = {};
function policeStamp(m) {
try {
const t = (m.embeds || []).map(function (e) { return (e.rawDescription || e.description || ""); }).join(" ") + " " + (m.content || "");
const x = /<t:(\d+)(?::[a-zA-Z])?>/.exec(t);
return x ? +x[1] : 0;
} catch (e) { return 0; }
}
function seedPolice(m) {
const ts = policeStamp(m);
if (!ts || ts === policeTs) return;
policeTs = ts; policeFired = {};
const s = ts - Date.now() / 1000;
TIME_MARKS.forEach(function (k) { if (s <= k) policeFired[k] = 1; });      // only the marks still ahead will ring
if (s <= 0) policeFired.arrived = 1;
say("police timer set: " + Math.round(s) + " s left");
}
function timeText(s) {
if (s >= 60) { const mm = Math.floor(s / 60), ss = s % 60; return mm + (ss ? ":" + (ss < 10 ? "0" : "") + ss : "") + " min left"; }
return s + " s left";
}
function timeNotify(msg) {
if (TIME_ALERT === "alert") { try { alerts.showConfirmationAlert({ title: "Police", content: msg, confirmText: "OK" }); return; } catch (e) {} }
try { vendetta.ui.toasts.showToast(msg); } catch (e) { say(msg); }
}
function onPoliceMsg(ev) {
try {
const m = ev && ev.message;
if (!m || !m.author || !m.author.bot || !isHeistMap(m) || !mentionsMe(m)) return;
seedPolice(m);
} catch (e) {}
}
function policeTick() {
if (!policeTs) return;
const s = Math.round(policeTs - Date.now() / 1000);
if (s > 0) {
let hit = null;
TIME_MARKS.forEach(function (k) { if (s <= k && !policeFired[k]) { policeFired[k] = 1; hit = k; } });
if (hit !== null) timeNotify(timeText(s));
} else if (!policeFired.arrived) {
policeFired.arrived = 1;
timeNotify("POLICE ARRIVED!");
} else if (s < -300) { policeTs = 0; }
}
if (Flux && Flux.subscribe) {
try {
Flux.subscribe("MESSAGE_CREATE", onPoliceMsg);
Flux.subscribe("MESSAGE_UPDATE", onPoliceMsg);
unpatches.push(function () { try { Flux.unsubscribe("MESSAGE_CREATE", onPoliceMsg); Flux.unsubscribe("MESSAGE_UPDATE", onPoliceMsg); } catch (e) {} });
} catch (e) {}
}
try { const pid = setInterval(policeTick, 1000); unpatches.push(function () { clearInterval(pid); }); } catch (e) {}
exports.onLoad = function () { say("loaded"); };
exports.onUnload = function () {
unpatches.forEach(function (u) { try { u(); } catch (e) {} });
unpatches.length = 0;
};
Object.defineProperty(exports, "__esModule", { value: true });
return exports;
})({});
 
