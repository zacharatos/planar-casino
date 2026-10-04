import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as U from "../scripts/util.mjs";

const defaultPack = JSON.parse(readFileSync(new URL("../data/default-pack.json", import.meta.url), "utf8"));
const seq = values => { let i = 0; return () => values[i++]; };

test("the shipped default pack is valid", () => {
  assert.deepEqual(U.validatePack(defaultPack), []);
});

test("validatePack reports missing pieces", () => {
  const errors = U.validatePack({ planarCasinoPack: 1, id: "x", slots: { symbols: [] }, wheel: { rings: { outer: [] } } });
  assert.ok(errors.some(e => e.includes("slots.symbols")));
  assert.ok(errors.some(e => e.includes("wheel.rings.outer")));
  assert.ok(errors.some(e => e.includes("wheel.rings.middle")));
  assert.deepEqual(U.validatePack(null), ["Pack is not a JSON object."]);
  const bad = structuredClone(defaultPack);
  bad.wheel.rings.outer[9].goto = "center";
  bad.triggers = [{ actor: "A", text: "x", game: "poker" }];
  const e2 = U.validatePack(bad);
  assert.ok(e2.some(e => e.includes("goto")));
  assert.ok(e2.some(e => e.includes("triggers[0].game")));
});

test("packDefaults fills numbers", () => {
  const d = U.packDefaults({});
  assert.equal(d.razorValue, 10);
  assert.equal(d.wheelCost, 5);
  assert.equal(d.wheelCooldownHours, 24);
  assert.equal(d.boardMultiplier, 5);
});

/* Slots ------------------------------------------------------------ */

const slots = {
  symbols: [1, 2, 3, 4, 5, 6].map(f => ({ label: `S${f}`, pair: { label: `pair${f}` }, jackpot: { label: `jack${f}` } })),
  special: { faces: [2, 4, 6] }
};

test("slots: three different symbols pay nothing", () => {
  assert.deepEqual(U.evaluateSlots([1, 3, 5], slots), { kind: "none" });
});

test("slots: a pair pays the pair prize of that symbol", () => {
  const r = U.evaluateSlots([4, 1, 4], slots);
  assert.equal(r.kind, "pair");
  assert.equal(r.face, 4);
  assert.equal(r.prize.label, "pair4");
});

test("slots: three of a kind is the jackpot, once per symbol", () => {
  assert.equal(U.evaluateSlots([3, 3, 3], slots).prize.label, "jack3");
  const again = U.evaluateSlots([3, 3, 3], slots, [3]);
  assert.equal(again.kind, "pair");
  assert.equal(again.prize.label, "pair3");
  assert.equal(again.downgraded, true);
});

test("slots: 2-4-6 in any order is the special result", () => {
  assert.equal(U.evaluateSlots([6, 2, 4], slots).kind, "special");
  assert.equal(U.evaluateSlots([4, 6, 2], slots).kind, "special");
  assert.throws(() => U.evaluateSlots([1, 2], slots));
});

test("autoRerolls keeps the best match", () => {
  assert.deepEqual(U.autoRerolls([5, 5, 2]), [2]);
  assert.deepEqual(U.autoRerolls([1, 3, 6]), [0, 1]);
  assert.deepEqual(U.autoRerolls([4, 4, 4]), []);
});

/* Wheel ------------------------------------------------------------ */

const ring = (name, overrides = {}) => Array.from({ length: 10 }, (_, i) => overrides[i + 1] ?? { label: `${name}${i + 1}`, prize: { label: `${name}${i + 1}` } });
const wheel = {
  rings: {
    outer: ring("o", { 10: { label: "→ middle", goto: "middle" } }),
    middle: ring("m", { 1: { label: "→ outer", goto: "outer" }, 10: { label: "→ inner", goto: "inner" } }),
    inner: ring("i", { 1: { label: "→ middle", goto: "middle" }, 7: { label: "big", once: true, prize: { label: "big" } } })
  }
};

test("wheel: a plain outer result ends the spin", () => {
  const r = U.resolveWheel(wheel, seq([4]));
  assert.equal(r.steps.length, 1);
  assert.equal(r.prize.label, "o4");
});

test("wheel: roll-again entries chain outer → middle → inner", () => {
  const r = U.resolveWheel(wheel, seq([10, 10, 5]));
  assert.deepEqual(r.steps.map(s => s.ring), ["outer", "middle", "inner"]);
  assert.equal(r.prize.label, "i5");
});

test("wheel: once-only prizes pay nothing the second time", () => {
  const first = U.resolveWheel(wheel, seq([10, 10, 7]));
  assert.equal(first.prize.label, "big");
  assert.equal(first.onceKey, "inner:7");
  const second = U.resolveWheel(wheel, seq([10, 10, 7]), { claimed: ["inner:7"] });
  assert.equal(second.prize, null);
  assert.equal(second.claimed, true);
});

test("wheel: endless bouncing stops after maxSteps with no prize", () => {
    const loop = U.resolveWheel(wheel, seq([10, 1, 10, 1, 10, 1]), { maxSteps: 5 });
  assert.equal(loop.exhausted, true);
  assert.equal(loop.prize, null);
  assert.equal(loop.steps.length, 5);
});

test("wheel cooldown in hours", () => {
  assert.equal(U.cooldownRemaining(null, 1000, 24), 0);
  assert.equal(U.cooldownRemaining(0, 3600 * 23, 24), 1);
  assert.equal(U.cooldownRemaining(0, 3600 * 25, 24), 0);
  assert.equal(U.cooldownRemaining(0, 10, 0), 0);
});

/* Bones table ------------------------------------------------- */

test("bones: highest total wins, any 1 busts", () => {
  const r = U.scoreBones([
    { id: "a", dice: [6, 6, 1] },
    { id: "b", dice: [5, 5] },
    { id: "c", dice: [3, 3, 2] }
  ]);
  assert.deepEqual(r.winners, ["b"]);
  assert.equal(r.scores.find(s => s.id === "a").bust, true);
});

test("bones: ties share, everyone bust means no winner", () => {
  assert.deepEqual(U.scoreBones([{ id: "a", dice: [4, 4] }, { id: "b", dice: [6, 2] }]).winners, ["a", "b"]);
  assert.deepEqual(U.scoreBones([{ id: "a", dice: [1] }, { id: "b", dice: [] }]).winners, []);
});

test("splitPot: odd chips and empty winners go to the house", () => {
  assert.deepEqual(U.splitPot(7, ["a", "b"]), { shares: { a: 3, b: 3 }, house: 1 });
  assert.deepEqual(U.splitPot(5, []), { shares: {}, house: 5 });
});

/* Number board ---------------------------------------------- */

test("board: winning number pays 5x its chips, the rest are lost", () => {
  assert.deepEqual(U.payBoard({ 7: 2, 13: 1 }, 7), { stake: 3, payout: 10, net: 7 });
  assert.deepEqual(U.payBoard({ 7: 2, 13: 1 }, 8), { stake: 3, payout: 0, net: -3 });
  assert.deepEqual(U.payBoard({ 7: 1 }, 7, 3), { stake: 1, payout: 3, net: 2 });
});

test("cleanBoard drops junk", () => {
  assert.deepEqual(U.cleanBoard({ 0: 1, 21: 2, 5: -1, 6: "2", x: 1 }), { 6: 2 });
  assert.equal(U.boardStake({ 1: 1, 2: 3 }), 4);
});

/* Rivals ----------------------------------------------------------- */

test("rival bones respect fixed and ranged styles", () => {
  assert.equal(U.rivalBones({ bones: 3 }), 3);
  assert.equal(U.rivalBones({ bones: [2, 4] }, () => 0), 2);
  assert.equal(U.rivalBones({ bones: [2, 4] }, () => 0.999), 4);
  assert.equal(U.rivalStake({ wager: 3 }, 1), 3);
  assert.equal(U.rivalStake({}, 2), 2);
});

test("rival boards use favourites first", () => {
  const b = U.rivalBoard({ numbers: 3, wager: 1, favorites: [3, 13] }, seq([0.5, 0.5, 0.95]));
  assert.deepEqual(Object.keys(b).map(Number).sort((a, c) => a - c), [3, 11, 13]);
  assert.ok(Object.values(b).every(v => v === 1));
});

/* Ledger ----------------------------------------------------------- */

const night = {
  name: "Session 03 — Casino",
  start: { a: 0 },
  names: { a: "Nanouk" },
  entries: [
    { actorId: "a", actorName: "Nanouk", kind: "gift", amount: 10, note: "Welcome gift" },
    { actorId: "a", actorName: "Nanouk", kind: "buy", amount: 5 },
    { actorId: "a", actorName: "Nanouk", kind: "wager", amount: 1, game: "slots" },
    { actorId: "a", actorName: "Nanouk", kind: "win", amount: 0, game: "slots" },
    { actorId: "a", actorName: "Nanouk", kind: "wager", amount: 5, game: "wheel" },
    { actorId: "a", actorName: "Nanouk", kind: "prize", note: "Bag of Holding", game: "wheel" },
    { actorId: "a", actorName: "Nanouk", kind: "stolen", amount: 2, note: "Vecna impersonator" },
    { actorId: "a", actorName: "Nanouk", kind: "cash", amount: 3 },
    { actorId: "b", actorName: "Dumien", kind: "win", amount: 5, game: "board" },
    { actorId: "b", actorName: "Dumien", kind: "wager", amount: 1, game: "board" }
  ]
};

test("summarizeNight adds everything up per PC", () => {
  const rows = U.summarizeNight(night);
  const n = rows.find(r => r.name === "Nanouk");
  assert.deepEqual({ bought: n.bought, cashed: n.cashed, wagered: n.wagered, won: n.won, net: n.net, other: n.other, end: n.end },
    { bought: 5, cashed: 3, wagered: 6, won: 0, net: -6, other: 8, end: 4 });
  assert.deepEqual(n.prizes, ["Bag of Holding"]);
  const d = rows.find(r => r.name === "Dumien");
  assert.equal(d.net, 4);
  assert.equal(d.end, 4);
});

test("entryDelta signs", () => {
  assert.equal(U.entryDelta({ kind: "stolen", amount: 2 }), -2);
  assert.equal(U.entryDelta({ kind: "adjust", amount: -3 }), -3);
  assert.equal(U.entryDelta({ kind: "gift", amount: 4 }), 4);
  assert.equal(U.entryDelta({ kind: "nope", amount: 4 }), 0);
});

const labels = {
  intro: "Razor ledger.", value: "1 razor = {value} gp.", pc: "PC", start: "Start", bought: "Bought", cashed: "Cashed",
  wagered: "Wagered", won: "Won", net: "Net", other: "Other", end: "End", prizes: "Prizes", empty: "Nobody played.",
  houseNet: "House", log: "Log", kinds: { buy: "bought" }, games: { slots: "Slots" }
};

test("ledgerMarkdown renders a Codex-friendly table", () => {
  const md = U.ledgerMarkdown(night, labels);
  assert.match(md, /^---\ntype: reference\n/);
  assert.match(md, /\| Nanouk \| 0 \| 5 \| 3 \| 6 \| 0 \| -6 \| \+8 \| 4 \| Bag of Holding \|/);
  assert.match(md, /House: \+2 \(\+20 gp\)/);
  assert.match(md, /· bought \+5/);
  const empty = U.ledgerMarkdown({ name: "x", entries: [] }, labels);
  assert.match(empty, /Nobody played/);
});

test("ledger cells escape pipes", () => {
  const md = U.ledgerMarkdown({ name: "x", entries: [{ actorId: "a", actorName: "A|B", kind: "buy", amount: 1 }] }, labels);
  assert.ok(md.includes("A\\|B"));
});

test("heat triggers exactly at the threshold", () => {
  const n = { entries: [{ actorId: "a", game: "slots", kind: "win" }, { actorId: "a", game: "slots", kind: "prize" }, { actorId: "a", game: "slots", kind: "wager" }] };
  assert.equal(U.heatReached(n, "a", "slots", 2), true);
  assert.equal(U.heatReached(n, "a", "slots", 3), false);
  assert.equal(U.heatReached(n, "a", "wheel", 2), false);
  assert.equal(U.heatReached(n, "a", "slots", 0), false);
  assert.equal(U.heatReached(null, "a", "slots", 2), false);
});

/* Triggers & commands ---------------------------------------------- */

test("triggers match by actor name, game and once", () => {
  const triggers = [
    { id: "m", actor: "Marigia", game: "wheel", text: "Τροχός" },
    { id: "n", actor: "Nanouk Wiedzmin", game: "wheel", to: "gm", text: "look", once: false },
    { actor: "Dumien", text: "any game" }
  ];
  assert.deepEqual(U.matchTriggers(triggers, { actorName: "Marigia Cucumber", game: "wheel" }).map(t => t.id), ["m"]);
  assert.deepEqual(U.matchTriggers(triggers, { actorName: "Marigia Cucumber", game: "wheel" }, ["m"]), []);
  assert.deepEqual(U.matchTriggers(triggers, { actorName: "Nanouk Wiedzmin", game: "wheel" }, ["n"]).map(t => t.id), ["n"]);
  assert.deepEqual(U.matchTriggers(triggers, { actorName: "Marigiana", game: "wheel" }), []);
  assert.deepEqual(U.matchTriggers(triggers, { actorName: "Dumien", game: "slots" }).map(t => t.id), ["t2"]);
});

test("parseCommand", () => {
  assert.deepEqual(U.parseCommand("/slots"), { cmd: "slots" });
  assert.deepEqual(U.parseCommand("/razors"), { cmd: "chips" });
  assert.deepEqual(U.parseCommand("/chips"), { cmd: "chips" });
  assert.deepEqual(U.parseCommand("/WHEEL"), { cmd: "wheel" });
  assert.deepEqual(U.parseCommand("/cage buy 5"), { cmd: "cage", action: "buy", amount: 5 });
  assert.deepEqual(U.parseCommand("/cage cash"), { cmd: "cage", error: "usage" });
  assert.equal(U.parseCommand("hello"), null);
  assert.equal(U.parseCommand("/slotsy"), null);
});

test("prizeText and escapeHTML", () => {
  assert.equal(U.prizeText({ label: "{n} larvae" }, 2), "2 larvae");
  assert.equal(U.prizeText(null), "");
  assert.equal(U.escapeHTML(`<a href="x">'&`), "&lt;a href=&quot;x&quot;&gt;&#39;&amp;");
});
