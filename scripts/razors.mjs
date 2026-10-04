// Razorleaves are a stackable dnd5e "loot" item, recognised by a module flag (not by name),
// so they can be renamed, pickpocketed, handed over and shown in the inventory.
import { MODULE_ID, CHIP_FLAG, RAZOR_ICON, PLATINUM_ICON } from "./constants.mjs";
import { pack, numbers, razorName } from "./state.mjs";
import { record, serial } from "./ledger.mjs";
import { t } from "./i18n.mjs";

export const chipItems = (actor, kind = "razor") =>
  actor?.items?.filter(i => i.getFlag(MODULE_ID, CHIP_FLAG) === kind) ?? [];

export const isChip = item => !!item?.getFlag?.(MODULE_ID, CHIP_FLAG);

export function razorCount(actor) {
  return chipItems(actor).reduce((n, i) => n + (Number(i.system?.quantity) || 0), 0);
}

/** Operation option that marks a change as made by this module. */
const OURS = { [MODULE_ID]: true };

/** Quantities the GM client has already accounted for, by item uuid (see watchManualChanges). */
const known = new Map();
export const rememberQuantity = item => known.set(item.uuid, Number(item.system?.quantity) || 0);

function chipData(kind, quantity) {
  const p = pack();
  const platinum = kind === "platinum";
  const name = platinum ? (p?.casino?.platinumName ?? t("Item.Platinum")) : razorName();
  const value = numbers().razorValue;
  return {
    name, type: "loot", img: platinum ? PLATINUM_ICON : RAZOR_ICON,
    system: {
      quantity,
      price: { value: platinum ? 0 : value, denomination: "gp" },
      weight: { value: 0, units: "lb" },
      description: { value: `<p>${t(platinum ? "Item.PlatinumDescription" : "Item.Description", { casino: p?.casino?.name ?? "", value })}</p>` }
    },
    flags: { [MODULE_ID]: { [CHIP_FLAG]: kind } }
  };
}

/**
 * Add or remove razors on a PC and log it. GM only. Throws if the PC lacks the razors.
 * @param {Actor} actor
 * @param {number} delta   positive adds, negative removes
 * @param {{kind: string, game?: string, note?: string}} entry  ledger kind (buy, cash, wager, win, gift, stolen, adjust)
 */
export async function changeRazors(actor, delta, entry) {
  delta = Math.trunc(delta);
  const items = chipItems(actor);
  const have = razorCount(actor);
  if (have + delta < 0) throw new Error(t("Notify.NotEnough", { name: actor.name, have, need: -delta }));
  if (delta !== 0) {
    if (!items.length) {
      const [created] = await actor.createEmbeddedDocuments("Item", [chipData("razor", delta)], OURS);
      rememberQuantity(created);
    } else {
      // Put everything on the first stack; remove extra stacks (e.g. after a hand-over).
      const [first, ...rest] = items;
      const total = have + delta;
      known.set(first.uuid, total);
      await first.update({ "system.quantity": total }, OURS);
      if (rest.length) await actor.deleteEmbeddedDocuments("Item", rest.map(i => i.id), OURS);
    }
  }
  await record({ actorId: actor.id, actorName: actor.name, amount: Math.abs(delta), ...entry });
  return have + delta;
}

/** Cage: buy razors with gold (dnd5e makes change from other coins). */
export async function buyRazors(actor, n) {
  const cost = n * numbers().razorValue;
  const CM = dnd5e?.applications?.CurrencyManager;
  try {
    if (CM?.deductActorCurrency) await CM.deductActorCurrency(actor, cost, "gp");
    else {
      const gp = Number(actor.system.currency?.gp) || 0;
      if (gp < cost) throw new Error("funds");
      await actor.update({ "system.currency.gp": gp - cost });
    }
  } catch (err) {
    throw new Error(t("Notify.NoGold", { name: actor.name, cost }));
  }
  return changeRazors(actor, n, { kind: "buy", note: `−${cost} gp` });
}

/** Cage: cash razors for gold. */
export async function cashRazors(actor, n) {
  const value = n * numbers().razorValue;
  const left = await changeRazors(actor, -n, { kind: "cash", note: `+${value} gp` });
  const gp = Number(actor.system.currency?.gp) || 0;
  await actor.update({ "system.currency.gp": gp + value });
  return left;
}

/** The one-off platinum chip (a key, not money): not counted as razors. */
export async function grantPlatinum(actor) {
  const [item] = await actor.createEmbeddedDocuments("Item", [chipData("platinum", 1)]);
  await record({ actorId: actor.id, actorName: actor.name, kind: "prize", note: item.name });
  return item;
}

/**
 * Log razor changes made by hand (sheet edits, drag between actors, a pickpocket handled by the GM).
 * Runs on the active GM only; changes this module makes are already known and log nothing twice.
 */
export function watchManualChanges() {
  const active = () => game.users.activeGM?.isSelf;
  const log = (item, delta) => {
    if (!delta || !item.parent || item.parent.documentName !== "Actor") return;
    serial(() => record({ actorId: item.parent.id, actorName: item.parent.name, kind: "adjust", amount: delta, note: t("Ledger.ByHand") }))
      .catch(err => console.warn(`${MODULE_ID} |`, err));
  };
  Hooks.on("createItem", (item, options) => {
    if (!active() || item.getFlag(MODULE_ID, CHIP_FLAG) !== "razor") return;
    rememberQuantity(item);
    if (options?.[MODULE_ID]) return;
    log(item, Number(item.system?.quantity) || 0);
  });
  Hooks.on("updateItem", (item, changes, options) => {
    if (!active() || item.getFlag(MODULE_ID, CHIP_FLAG) !== "razor") return;
    if (!foundry.utils.hasProperty(changes, "system.quantity")) return;
    const now = Number(item.system?.quantity) || 0;
    const before = known.has(item.uuid) ? known.get(item.uuid) : now;
    known.set(item.uuid, now);
    if (!options?.[MODULE_ID]) log(item, now - before);
  });
  Hooks.on("deleteItem", (item, options) => {
    if (!active() || item.getFlag(MODULE_ID, CHIP_FLAG) !== "razor") return;
    const before = known.get(item.uuid) ?? (Number(item.system?.quantity) || 0);
    known.delete(item.uuid);
    if (!options?.[MODULE_ID]) log(item, -before);
  });
  // Seed what is already in the world.
  for (const actor of game.actors) for (const item of chipItems(actor)) rememberQuantity(item);
}

/** Player characters at the table: characters owned by at least one player. */
export const playerCharacters = () =>
  game.actors.filter(a => a.type === "character" && a.hasPlayerOwner).sort((a, b) => a.name.localeCompare(b.name));
