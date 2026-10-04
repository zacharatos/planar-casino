// The session ledger: every razor movement, grouped by casino night, mirrored into a journal page
// (a Planar Codex note when the Codex is installed, so it reaches the vault on export).
import { MODULE_ID, LEDGER_FOLDER } from "./constants.mjs";
import { setting, setSetting } from "./settings.mjs";
import { ledgerMarkdown, summarizeNight, clock } from "./util.mjs";
import { numbers, casinoName } from "./state.mjs";
import { t } from "./i18n.mjs";

const clone = v => foundry.utils.deepClone(v);

/** GM writes go through one queue so quick events never overwrite each other. */
let queue = Promise.resolve();
export function serial(fn) {
  const run = queue.then(fn, fn);
  queue = run.catch(() => {});
  return run;
}

export const ledger = () => ({ activeNight: null, nights: [], ...(setting("ledger") ?? {}) });
export const activeNight = () => { const l = ledger(); return l.nights.find(n => n.id === l.activeNight) ?? null; };
export const nightById = id => ledger().nights.find(n => n.id === id) ?? null;

/** Start a casino night: remembers what each PC holds now. */
export async function openNight(name, holdings) {
  const l = clone(ledger());
  if (l.activeNight) await closeNight();
  const fresh = clone(ledger());
  const night = {
    id: foundry.utils.randomID(),
    name: name || t("Ledger.DefaultName", { casino: casinoName(), date: new Date().toLocaleDateString(game.i18n.lang) }),
    openedAt: Date.now(), closedAt: null,
    start: Object.fromEntries(holdings.map(h => [h.id, h.count])),
    names: Object.fromEntries(holdings.map(h => [h.id, h.name])),
    entries: [], page: null
  };
  fresh.nights.push(night);
  fresh.activeNight = night.id;
  await setSetting("ledger", fresh);
  await syncJournal(night.id);
  return night;
}

export async function closeNight() {
  const l = clone(ledger());
  const night = l.nights.find(n => n.id === l.activeNight);
  if (!night) return null;
  night.closedAt = Date.now();
  l.activeNight = null;
  await setSetting("ledger", l);
  await syncJournal(night.id);
  return night;
}

/** Holdings provider set by main.mjs (avoids an import cycle with razors.mjs). */
let holdingsProvider = () => [];
export const setHoldingsProvider = fn => { holdingsProvider = fn; };

/** Add a ledger entry (GM only). Opens a night automatically if none is open. */
export async function record(entry) {
  if (!activeNight()) await openNight(null, holdingsProvider());
  const l = clone(ledger());
  const night = l.nights.find(n => n.id === l.activeNight);
  night.entries.push({ ...entry, time: clock(new Date()) });
  if (entry.actorId && !(entry.actorId in night.names)) {
    night.names[entry.actorId] = entry.actorName;
    // A PC first seen mid-night started with what they had before this entry.
    if (!(entry.actorId in night.start)) night.start[entry.actorId] = 0;
  }
  await setSetting("ledger", l);
  scheduleSync(night.id);
  return night;
}

/** Labels for the ledger page, in the world's language. */
export function ledgerLabels() {
  const k = key => t(`Ledger.Col.${key}`);
  return {
    intro: t("Ledger.Intro"), value: t("Ledger.Value"),
    pc: k("PC"), start: k("Start"), bought: k("Bought"), cashed: k("Cashed"), wagered: k("Wagered"),
    won: k("Won"), net: k("Net"), other: k("Other"), end: k("End"), prizes: k("Prizes"),
    empty: t("Ledger.Empty"), houseNet: t("Ledger.HouseNet"), log: t("Ledger.Log"),
    kinds: Object.fromEntries(["buy", "cash", "gift", "wager", "win", "stolen", "adjust", "prize"].map(x => [x, t(`Ledger.Kind.${x}`)])),
    games: Object.fromEntries(["slots", "wheel", "bones", "board"].map(x => [x, t(`Game.${x}`)]))
  };
}

export const nightMarkdown = night => ledgerMarkdown(night, ledgerLabels(), { razorValue: numbers().razorValue });
export const nightRows = night => summarizeNight(night);

const timers = new Map();
function scheduleSync(id) {
  clearTimeout(timers.get(id));
  timers.set(id, setTimeout(() => { timers.delete(id); serial(() => syncJournal(id)).catch(err => console.warn(`${MODULE_ID} | ledger page`, err)); }, 1500));
}

function toHTML(markdown) {
  const body = markdown.replace(/^---\n[\s\S]*?\n---\n/, "");
  const conv = globalThis.showdown ? new globalThis.showdown.Converter({ tables: true, strikethrough: true }) : null;
  return conv ? conv.makeHtml(body) : `<pre>${foundry.utils.escapeHTML?.(body) ?? body}</pre>`;
}

/** Write the night's page: create it the first time, update it after that. */
export async function syncJournal(nightId) {
  const night = nightById(nightId);
  if (!night) return;
  const markdown = nightMarkdown(night);
  const codex = game.modules.get("planar-codex");
  const codexApi = codex?.active ? codex.api : null;
  const html = codexApi?.convert ? codexApi.convert(markdown, { gm: true }).html : toHTML(markdown);
  let page = night.page ? await fromUuid(night.page) : null;
  if (!page) {
    if (codexApi?.createCodexNote) {
      page = await codexApi.createCodexNote({ name: night.name, markdown });
    } else {
      let folder = game.folders.find(f => f.type === "JournalEntry" && f.name === LEDGER_FOLDER);
      folder ??= await Folder.create({ name: LEDGER_FOLDER, type: "JournalEntry" });
      const entry = await JournalEntry.create({
        name: night.name, folder: folder.id,
        ownership: { default: CONST.DOCUMENT_OWNERSHIP_LEVELS.NONE },
        pages: [{ name: night.name, type: "text", text: { format: CONST.JOURNAL_ENTRY_PAGE_FORMATS.MARKDOWN, markdown, content: html } }]
      });
      page = entry.pages.contents[0];
    }
    const l = clone(ledger());
    const n = l.nights.find(x => x.id === nightId);
    if (n) { n.page = page.uuid; await setSetting("ledger", l); }
    return page;
  }
  await page.update({ "text.markdown": markdown, "text.content": html });
  return page;
}

/** Remove a night from the ledger (its journal page stays). */
export async function deleteNight(id) {
  const l = clone(ledger());
  l.nights = l.nights.filter(n => n.id !== id);
  if (l.activeNight === id) l.activeNight = null;
  await setSetting("ledger", l);
}
