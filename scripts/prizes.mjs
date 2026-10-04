// Turning a prize from the pack into something on the character sheet.
// Prize types: none, gp, razors, tempHp, damage, item, scroll, platinum, note.
import { MODULE_ID } from "./constants.mjs";
import { setting } from "./settings.mjs";
import { prizeText } from "./util.mjs";
import { changeRazors, grantPlatinum } from "./razors.mjs";
import { record } from "./ledger.mjs";
import { updateRival, rival as getRival } from "./state.mjs";
import { t } from "./i18n.mjs";

const norm = s => String(s ?? "").trim().toLocaleLowerCase();

/** Find an Item by uuid, then by name in the world, then in Item compendiums (Plutonium imports included). */
export async function findItem({ uuid, name, type } = {}) {
  if (uuid) { const doc = await fromUuid(uuid); if (doc) return doc; }
  if (!name) return null;
  const wanted = norm(name);
  const fits = i => norm(i.name) === wanted && (!type || i.type === type);
  const world = game.items.find(fits);
  if (world) return world;
  for (const pack of game.packs.filter(p => p.documentName === "Item")) {
    const index = await pack.getIndex({ fields: ["type"] });
    const hit = index.find(fits);
    if (hit) return pack.getDocument(hit._id);
  }
  return null;
}

async function rollFormula(formula) {
  const roll = await new Roll(String(formula)).evaluate();
  await game.dice3d?.showForRoll?.(roll, game.user, true);
  return roll.total;
}

/** Give an item (or a spell scroll) to an actor. Returns the created item or null. */
export async function grantItem(actor, prize) {
  if (prize.type === "scroll") {
    const spell = await findItem({ uuid: prize.uuid, name: prize.spell, type: "spell" });
    if (!spell) return null;
    const Item5e = CONFIG.Item.documentClass;
    const scroll = await Item5e.createScrollFromSpell(spell);
    if (!scroll) return null;
    const [created] = await actor.createEmbeddedDocuments("Item", [scroll.toObject?.() ?? scroll]);
    return created;
  }
  const doc = await findItem({ uuid: prize.uuid, name: prize.item });
  if (!doc) return null;
  const data = doc.pack ? game.items.fromCompendium(doc) : doc.toObject();
  delete data._id;
  if (prize.quantity) foundry.utils.setProperty(data, "system.quantity", prize.quantity);
  const [created] = await actor.createEmbeddedDocuments("Item", [data]);
  return created;
}

/**
 * Apply a prize to a PC (actor) or a rival (rivalId). GM only.
 * Returns {text, pending} — pending is an item prize the GM still has to grant by hand.
 */
export async function applyPrize(prize, { actor = null, rivalId = null, game: gameId } = {}) {
  if (!prize || prize.type === "none") return { text: "" };
  let n = null;
  if (prize.formula) n = await rollFormula(prize.formula);
  else if (prize.amount != null) n = Number(prize.amount);
  const text = prizeText(prize, n);
  const log = note => actor && record({ actorId: actor.id, actorName: actor.name, kind: "prize", game: gameId, note });

  // Rivals only hold razors: everything else is just told.
  if (!actor) {
    if (prize.type === "razors" && rivalId) {
      const r = getRival(rivalId);
      if (r) await updateRival(rivalId, { bankroll: (r.bankroll ?? 0) + n });
    }
    return { text };
  }

  switch (prize.type) {
    case "gp": {
      const gp = Number(actor.system.currency?.gp) || 0;
      await actor.update({ "system.currency.gp": gp + n });
      await log(text);
      return { text };
    }
    case "razors":
      await changeRazors(actor, n, { kind: "win", game: gameId, note: text });
      return { text };
    case "tempHp":
      await actor.applyTempHP?.(n);
      await log(text);
      return { text };
    case "damage":
      await actor.applyDamage?.([{ value: n, type: prize.damageType ?? null }]);
      await log(text);
      return { text };
    case "platinum": {
      const item = await grantPlatinum(actor);
      return { text: text || item.name };
    }
    case "item":
    case "scroll": {
      if (setting("autoGrant")) {
        const created = await grantItem(actor, prize).catch(err => { console.warn(`${MODULE_ID} | grant`, err); return null; });
        if (created) { await log(created.name); return { text, granted: created.name }; }
      }
      return { text, pending: prize };
    }
    default:
      await log(text);
      return { text };
  }
}

/** The GM's "Grant" button on a chat card, for prizes that could not be granted automatically. */
export async function grantPending(actor, prize, gameId) {
  const created = await grantItem(actor, prize);
  if (!created) throw new Error(t("Notify.ItemMissing", { name: prize.item ?? prize.spell ?? "?" }));
  await record({ actorId: actor.id, actorName: actor.name, kind: "prize", game: gameId, note: created.name });
  return created;
}
