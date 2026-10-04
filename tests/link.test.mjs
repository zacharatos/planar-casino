// Loads the real entry point against stubbed Foundry globals. This catches broken
// imports, missing exports and hook wiring mistakes; it does not replace testing in Foundry.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const hooks = { once: {}, on: {} };
globalThis.Hooks = {
  once: (name, fn) => { hooks.once[name] = fn; },
  on: (name, fn) => { (hooks.on[name] ??= []).push(fn); }
};
class FakeApp { static DEFAULT_OPTIONS = {}; }
globalThis.foundry = {
  applications: { api: { ApplicationV2: FakeApp, DialogV2: class {} } },
  utils: { randomID: () => "abc123", deepClone: v => structuredClone(v), hasProperty: () => false, debounce: fn => fn }
};
const settings = new Map();
const registered = { settings: [], keys: [], sockets: [] };
globalThis.game = {
  user: { isGM: true, id: "gm" },
  users: { activeGM: { isSelf: true }, filter: () => [] },
  actors: [],
  modules: new Map([["planar-casino", {}]]),
  settings: {
    register: (mod, key, cfg) => { registered.settings.push(`${mod}.${key}`); settings.set(key, cfg.default); },
    get: (mod, key) => settings.get(key),
    set: async (mod, key, v) => settings.set(key, v)
  },
  keybindings: { register: (mod, key) => registered.keys.push(`${mod}.${key}`) },
  socket: { on: event => registered.sockets.push(event), emit() {} },
  i18n: { localize: k => k, format: k => k, lang: "en" }
};
const pack = JSON.parse(readFileSync(new URL("../data/default-pack.json", import.meta.url), "utf8"));
globalThis.fetch = async () => ({ json: async () => pack });
globalThis.ui = { notifications: { warn() {}, info() {}, error() {} }, controls: { render() {} } };

await import("../scripts/main.mjs");

test("registers settings and a keybinding on init", () => {
  hooks.once.init();
  for (const k of ["pack", "ledger", "rivals", "table", "progress", "cageOpen", "floorOpen", "autoGrant", "heat", "useWorldTime", "padSpin", "padJackpot", "padWin", "padBust", "wheelFx"]) {
    assert.ok(registered.settings.includes(`planar-casino.${k}`), k);
  }
  assert.deepEqual(registered.keys, ["planar-casino.open"]);
});

test("exposes an api on ready and listens on the module socket", async () => {
  await hooks.once.ready();
  const api = game.modules.get("planar-casino").api;
  assert.deepEqual(registered.sockets, ["module.planar-casino"]);
  for (const fn of ["open", "openPlayer", "razors", "pack", "slots", "wheel", "cage", "adjust"]) assert.equal(typeof api[fn], "function", fn);
  assert.equal(api.pack().id, "default", "falls back to the shipped pack");
});

test("toolbar button: always for the GM, for players only when the floor is open", () => {
  const gmControls = { tokens: { tools: {} } };
  hooks.on.getSceneControlButtons[0](gmControls);
  assert.ok(gmControls.tokens.tools["planar-casino"]);

  game.user.isGM = false;
  const closed = { tokens: { tools: {} } };
  hooks.on.getSceneControlButtons[0](closed);
  assert.deepEqual(closed.tokens.tools, {});
  settings.set("floorOpen", true);
  const open = { tokens: { tools: {} } };
  hooks.on.getSceneControlButtons[0](open);
  assert.ok(open.tokens.tools["planar-casino"]);
  game.user.isGM = true;
  settings.set("floorOpen", false);
  assert.doesNotThrow(() => hooks.on.getSceneControlButtons[0]({}));
});

test("chat hook ignores ordinary messages and swallows casino commands", () => {
  const chat = hooks.on.chatMessage[0];
  assert.equal(chat(null, "hello there"), true);
  assert.equal(chat(null, "/cage"), false);
});

test("item hooks ignore items that are not chips", () => {
  for (const name of ["createItem", "updateItem", "deleteItem"]) {
    for (const fn of hooks.on[name]) assert.doesNotThrow(() => fn({ getFlag: () => undefined }, {}, {}));
  }
});
