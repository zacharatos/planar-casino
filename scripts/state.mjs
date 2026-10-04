// Read/write helpers for the casino's world data. Writes happen on a GM client only.
import { MODULE_ID, DEFAULT_PACK_PATH } from "./constants.mjs";
import { setting, setSetting } from "./settings.mjs";
import { validatePack, packDefaults } from "./util.mjs";

const clone = v => foundry.utils.deepClone(v);
let defaultPack = null;

/** Load the generic pack shipped with the module (once). */
export async function loadDefaultPack() {
  if (defaultPack) return defaultPack;
  try { defaultPack = await (await fetch(DEFAULT_PACK_PATH)).json(); }
  catch (err) { console.error(`${MODULE_ID} | default pack failed to load`, err); defaultPack = null; }
  return defaultPack;
}

/** The active pack: the imported one, or the generic default. */
export const pack = () => setting("pack") ?? defaultPack;
export const numbers = () => packDefaults(pack());
export const casinoName = () => pack()?.casino?.name ?? "Casino";
export const razorName = () => pack()?.casino?.razorName ?? game.i18n.localize("PLANAR_CASINO.Item.Razor");

/** Import a pack (object). Returns the problems found; saves only if there are none. */
export async function importPack(data) {
  const errors = validatePack(data);
  if (errors.length) return errors;
  await setSetting("pack", data);
  // Rivals come with the pack; keep bankrolls of rivals that already exist.
  const old = new Map((setting("rivals")?.list ?? []).map(r => [r.id, r]));
  const list = (data.rivals ?? []).map(r => ({ ...r, bankroll: old.get(r.id)?.bankroll ?? r.bankroll ?? 0 }));
  await setSetting("rivals", { list });
  return [];
}

export async function resetPack() {
  await setSetting("pack", null);
  await setSetting("rivals", { list: clone(defaultPack?.rivals ?? []) });
}

export const rivals = () => setting("rivals")?.list ?? [];
export const rival = id => rivals().find(r => r.id === id) ?? null;
export async function updateRival(id, changes) {
  const list = clone(rivals());
  const r = list.find(x => x.id === id);
  if (!r) return;
  Object.assign(r, changes);
  await setSetting("rivals", { list });
}
export async function saveRivals(list) { await setSetting("rivals", { list }); }

export const progress = () => ({ jackpots: [], claimed: [], fired: [], gifted: [], hour: 0, ...(setting("progress") ?? {}) });
export async function updateProgress(fn) {
  const p = clone(progress());
  fn(p);
  await setSetting("progress", p);
  return p;
}

export const table = () => setting("table") ?? { open: false };
export async function setTable(data) { await setSetting("table", data); }
