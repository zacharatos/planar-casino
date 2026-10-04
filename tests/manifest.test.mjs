import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { MODULE_ID } from "../scripts/constants.mjs";

const manifest = JSON.parse(readFileSync(new URL("../module.json", import.meta.url), "utf8"));
const file = p => new URL(`../${p}`, import.meta.url);

test("manifest has the fields Foundry requires", () => {
  for (const k of ["id", "title", "description", "version", "compatibility"]) assert.ok(manifest[k], k);
  assert.match(manifest.id, /^[a-z0-9-]+$/);
  assert.equal(manifest.id, MODULE_ID, "constants.mjs and module.json must agree");
  assert.match(manifest.version, /^\d+\.\d+\.\d+$/);
  assert.ok(manifest.compatibility.minimum && manifest.compatibility.verified);
  assert.equal(manifest.relationships.systems[0].id, "dnd5e");
});

test("socket is enabled (players' actions go through the GM)", () => {
  assert.equal(manifest.socket, true);
});

test("every referenced file exists", () => {
  for (const p of [...manifest.esmodules, ...manifest.styles, ...manifest.languages.map(l => l.path), "data/default-pack.json"]) {
    assert.ok(existsSync(file(p)), p);
  }
});

const flatten = (obj, prefix = "") => Object.entries(obj).flatMap(([k, v]) =>
  v && typeof v === "object" ? flatten(v, `${prefix}${k}.`) : [`${prefix}${k}`]);
const langs = Object.fromEntries(manifest.languages.map(l => [l.lang, JSON.parse(readFileSync(file(l.path), "utf8"))]));

test("all languages define exactly the same keys as English", () => {
  const en = flatten(langs.en).sort();
  for (const [code, data] of Object.entries(langs)) assert.deepEqual(flatten(data).sort(), en, `${code} differs from en`);
});

test("placeholders match between languages", () => {
  const get = (o, path) => path.split(".").reduce((x, k) => x[k], o);
  const holders = s => (s.match(/\{\w+\}/g) ?? []).sort().join();
  for (const key of flatten(langs.en)) {
    for (const [code, data] of Object.entries(langs)) {
      assert.equal(holders(get(data, key)), holders(get(langs.en, key)), `${code}: ${key}`);
    }
  }
});

test("every localization key used in the code exists", () => {
  const known = new Set(flatten(langs.en).map(k => k.replace(/^PLANAR_CASINO\./, "")));
  const sources = readdirSync(file("scripts")).filter(n => n.endsWith(".mjs") && n !== "util.mjs")
    .map(n => readFileSync(file(`scripts/${n}`), "utf8")).join("\n");
  const used = [...sources.matchAll(/\b(?:t|warn|info)\(\s*"([\w.]+)"/g)].map(m => m[1]);
  assert.ok(used.length > 50, "found the t() calls");
  for (const key of used) assert.ok(known.has(key), `missing key ${key}`);
  const raw = [...sources.matchAll(/"PLANAR_CASINO\.([\w.]+)"/g)].map(m => m[1]);
  for (const key of raw) assert.ok(known.has(key), `missing key ${key}`);
  // Keys built from a list: check every member.
  for (const g of ["slots", "wheel", "bones", "board"]) assert.ok(known.has(`Game.${g}`), g);
  for (const k of ["buy", "cash", "gift", "wager", "win", "stolen", "adjust", "prize"]) assert.ok(known.has(`Ledger.Kind.${k}`), k);
  for (const r of ["outer", "middle", "inner"]) assert.ok(known.has(`Wheel.Ring.${r}`), r);
  for (const tab of ["floor", "tables", "rivals", "pack", "ledger"]) assert.ok(known.has(`Panel.Tab.${tab}`), tab);
  for (const c of ["PC", "Start", "Bought", "Cashed", "Wagered", "Won", "Net", "Other", "End", "Prizes"]) assert.ok(known.has(`Ledger.Col.${c}`), c);
  for (const c of ["Spin", "Jackpot", "Win", "Bust"]) assert.ok(known.has(`Settings.Pad${c}.Name`), c);
});

test("the repo ships no campaign or publisher content", () => {
  const texts = ["data/default-pack.json", "lang/en.json", "lang/el.json"].map(p => [p, readFileSync(file(p), "utf8")]);
  for (const [p, text] of texts) {
    for (const word of ["Shemeshka", "Sigil", "azorleaf", "Fortune's Wheel", "Olidammara", "Dead Hand", "Rule-of-Three", "modron", "Modron"]) {
      assert.ok(!text.includes(word), `${p} mentions ${word}`);
    }
  }
});
