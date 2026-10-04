// The casino's actions, run on the active GM's client (see rpc.mjs). Players reach them with call().
import { MODULE_ID, WHEEL_SPIN_MS } from "./constants.mjs";
import { setting, setSetting } from "./settings.mjs";
import {
  evaluateSlots, autoRerolls, resolveWheel, cooldownRemaining, scoreBones, splitPot,
  cleanBoard, boardStake, payBoard, rivalBones, rivalStake, rivalBoard, heatReached, matchTriggers, RINGS
} from "./util.mjs";
import { pack, numbers, rival as getRival, updateRival, progress, updateProgress, table, setTable, casinoName } from "./state.mjs";
import { changeRazors, razorCount, buyRazors, cashRazors, grantPlatinum, playerCharacters } from "./razors.mjs";
import { record, serial, activeNight, openNight, closeNight, syncJournal } from "./ledger.mjs";
import { applyPrize, grantPending } from "./prizes.mjs";
import { handle, ask, broadcastWheel } from "./rpc.mjs";
import { postCard, slotsBody, wheelBody, bonesBody, boardBody } from "./cards.mjs";
import { t } from "./i18n.mjs";

/* -------------------------------------------- */
/*  Helpers                                     */
/* -------------------------------------------- */

const gmOnly = user => { if (!user?.isGM) throw new Error(t("Notify.OnlyGM")); };

const owners = actor => game.users.filter(u => !u.isGM && actor.testUserPermission(u, "OWNER"));

/** Who is playing: a PC (actorId) the user owns, or a rival (GM only). */
function gambler({ actorId, rivalId }, user) {
  if (actorId) {
    const actor = game.actors.get(actorId);
    if (!actor) throw new Error(t("Notify.NoActor"));
    if (!user.isGM && !actor.testUserPermission(user, "OWNER")) throw new Error(t("Notify.NotOwner", { name: actor.name }));
    return { actor, name: actor.name, img: actor.img, key: `a.${actor.id}` };
  }
  gmOnly(user);
  const r = getRival(rivalId);
  if (!r) throw new Error(t("Notify.NoRival"));
  return { rival: r, name: r.name, img: r.img, key: `r.${r.id}` };
}

/** Take a stake from a PC (razors) or a rival (bankroll). */
async function stake(g, amount, gameId) {
  if (g.actor) return changeRazors(g.actor, -amount, { kind: "wager", game: gameId });
  const r = getRival(g.rival.id);
  if ((r.bankroll ?? 0) < amount) throw new Error(t("Notify.RivalBroke", { name: r.name }));
  await updateRival(r.id, { bankroll: r.bankroll - amount });
  await record({ rivalId: r.id, rivalName: r.name, kind: "wager", amount, game: gameId });
}

async function payout(g, amount, gameId, note) {
  if (!amount) return;
  if (g.actor) return changeRazors(g.actor, amount, { kind: "win", game: gameId, note });
  const r = getRival(g.rival.id);
  await updateRival(r.id, { bankroll: (r.bankroll ?? 0) + amount });
  await record({ rivalId: r.id, rivalName: r.name, kind: "win", amount, game: gameId, note });
}

async function roll(formula, { show = true } = {}) {
  const r = await new Roll(formula).evaluate();
  if (show) await game.dice3d?.showForRoll?.(r, game.user, true);
  return r;
}
const faces = r => r.dice.flatMap(d => d.results.map(x => x.result));

/** Optional Planar Soundboard pad (by name, from the settings). */
export function pad(which) {
  const name = setting(`pad${which}`);
  if (!name) return;
  try { globalThis.PlanarSoundboard?.playPad?.(name); }
  catch (err) { console.warn(`${MODULE_ID} | soundboard pad`, err); }
}

const gmIds = () => game.users.filter(u => u.isGM).map(u => u.id);

/** After a game: Heat warning and private whispers. */
async function afterGame(g, gameId, won) {
  if (g.actor && won && heatReached(activeNight(), g.actor.id, gameId, setting("heat"))) {
    await postCard({ title: t("Heat.Title"), body: `<p>${t("Heat.Message", { name: g.name, game: t(`Game.${gameId}`), n: setting("heat") })}</p>`, whisper: gmIds() });
  }
  const fired = matchTriggers(pack()?.triggers, { actorName: g.name, game: gameId }, progress().fired);
  for (const trig of fired) {
    const toGM = trig.to === "gm" || !g.actor;
    const whisper = toGM ? gmIds() : [...owners(g.actor).map(u => u.id), ...gmIds()];
    await ChatMessage.create({
      content: `<div class="planar-casino-card whisper">${toGM ? `<header><i class="fa-solid fa-eye"></i> ${t("Trigger.ForGM", { name: g.name })}</header>` : ""}<p>${trig.text}</p></div>`,
      speaker: { alias: trig.speaker ?? casinoName() },
      whisper
    });
    if (trig.once !== false) await updateProgress(p => { p.fired.push(trig.id); });
  }
}

/* -------------------------------------------- */
/*  Cages, gifts, adjustments                   */
/* -------------------------------------------- */

handle("cage", (payload, user) => serial(async () => {
  const g = gambler(payload, user);
  if (!g.actor) throw new Error(t("Notify.NoActor"));
  if (!user.isGM && !setting("cageOpen")) throw new Error(t("Notify.CageClosed"));
  const n = Math.trunc(Number(payload.amount));
  if (!(n > 0)) throw new Error(t("Notify.BadAmount"));
  const left = payload.action === "cash" ? await cashRazors(g.actor, n) : await buyRazors(g.actor, n);
  return { count: left };
}));

handle("welcome", (payload, user) => serial(async () => {
  gmOnly(user);
  const gift = numbers().welcomeGift;
  const given = [];
  for (const actor of playerCharacters()) {
    if (progress().gifted.includes(actor.id)) continue;
    await changeRazors(actor, gift, { kind: "gift", note: t("Ledger.Welcome") });
    await updateProgress(p => { p.gifted.push(actor.id); });
    given.push(actor.name);
  }
  return { given, gift };
}));

handle("adjust", ({ actorId, amount, kind = "adjust", note }, user) => serial(async () => {
  gmOnly(user);
  const actor = game.actors.get(actorId);
  const n = Math.trunc(Number(amount));
  if (!actor || !n) return null;
  const k = kind === "stolen" ? "stolen" : kind === "gift" ? "gift" : "adjust";
  return changeRazors(actor, k === "stolen" ? -Math.abs(n) : n, { kind: k, note });
}));

handle("rival-gift", ({ rivalId, actorId, amount = 1 }, user) => serial(async () => {
  gmOnly(user);
  const r = getRival(rivalId), actor = game.actors.get(actorId);
  if (!r || !actor) return null;
  const n = Math.min(Math.trunc(amount), r.bankroll ?? 0);
  if (n <= 0) throw new Error(t("Notify.RivalBroke", { name: r.name }));
  await updateRival(r.id, { bankroll: r.bankroll - n });
  return changeRazors(actor, n, { kind: "gift", note: r.name });
}));

handle("platinum", ({ actorId }, user) => serial(async () => {
  gmOnly(user);
  const actor = game.actors.get(actorId);
  if (actor) await grantPlatinum(actor);
}));

handle("allow-spin", ({ actorId, rivalId }, user) => serial(async () => {
  gmOnly(user);
  if (actorId) await game.actors.get(actorId)?.unsetFlag(MODULE_ID, "lastSpin");
  if (rivalId) await updateRival(rivalId, { lastSpin: null });
}));

handle("night-open", ({ name }, user) => serial(async () => {
  gmOnly(user);
  const holdings = playerCharacters().map(a => ({ id: a.id, name: a.name, count: razorCount(a) }));
  await updateProgress(p => { p.hour = 0; });
  return openNight(name, holdings);
}));

handle("night-close", (payload, user) => serial(async () => { gmOnly(user); return closeNight(); }));
handle("night-sync", ({ id }, user) => serial(async () => { gmOnly(user); return syncJournal(id); }));

handle("next-hour", (payload, user) => serial(async () => {
  gmOnly(user);
  const p = await updateProgress(x => { x.hour = (x.hour ?? 0) + 1; });
  const ev = (pack()?.timedEvents ?? []).find(e => Number(e.hour) === p.hour);
  await postCard({
    title: t("Clock.Hour", { hour: p.hour }),
    body: ev ? `<p><strong>${ev.title ?? ""}</strong></p><p>${ev.text ?? ""}</p>` : `<p>${t("Clock.Nothing")}</p>`,
    whisper: gmIds()
  });
  return p.hour;
}));

handle("grant", ({ messageId }, user) => serial(async () => {
  gmOnly(user);
  const message = game.messages.get(messageId);
  const prize = message?.getFlag(MODULE_ID, "pending");
  const actor = game.actors.get(message?.getFlag(MODULE_ID, "actorId"));
  if (!prize || !actor) return null;
  const item = await grantPending(actor, prize, message.getFlag(MODULE_ID, "game"));
  await message.setFlag(MODULE_ID, "granted", item.name);
  return item.name;
}));

/* -------------------------------------------- */
/*  Slots (three d6)                            */
/* -------------------------------------------- */

const rerollFlag = g => (g.actor ? g.actor.getFlag(MODULE_ID, "reroll") : getRival(g.rival.id)?.reroll);
const setReroll = (g, on) => (g.actor
  ? (on ? g.actor.setFlag(MODULE_ID, "reroll", true) : g.actor.unsetFlag(MODULE_ID, "reroll"))
  : updateRival(g.rival.id, { reroll: on }));

handle("slots", (payload, user) => serial(async () => {
  const g = gambler(payload, user);
  const slots = pack().slots;
  await stake(g, numbers().slotsCost, "slots");
  const first = await roll("3d6");
  let dice = faces(first);
  let rerolled = [];
  if (rerollFlag(g)) {
    // Reroll token: the player picks dice to reroll on their own screen; rivals and absent players pick automatically.
    const player = g.actor ? owners(g.actor).find(u => u.active) : null;
    const auto = autoRerolls(dice);
    const chosen = player
      ? await ask(player.id, "reroll", { name: g.name, faces: dice, symbols: slots.symbols }, auto)
      : auto;
    rerolled = (Array.isArray(chosen) ? chosen : auto).filter(i => i >= 0 && i < 3);
    if (rerolled.length) {
      const again = faces(await roll(`${rerolled.length}d6`));
      rerolled.forEach((i, k) => { dice[i] = again[k]; });
    }
    await setReroll(g, false);
  }
  const result = evaluateSlots(dice, slots, progress().jackpots);
  let prize = { text: "" };
  if (result.kind === "special") await setReroll(g, true);
  if (result.kind === "jackpot") await updateProgress(p => { p.jackpots.push(result.face); });
  if (result.prize) prize = await applyPrize(result.prize, { actor: g.actor, rivalId: g.rival?.id, game: "slots" });
  const won = ["pair", "jackpot", "special"].includes(result.kind);
  pad(result.kind === "jackpot" ? "Jackpot" : result.kind === "none" ? "Bust" : "Win");
  await postCard({
    gambler: g, title: slots.machine ?? t("Game.slots"),
    body: slotsBody({ gambler: g, faces: dice, symbols: slots.symbols, result, prizeText: result.kind === "special" ? (slots.special?.text ?? "") : (prize.granted ?? prize.text), rerolled }),
    flags: { card: "slots", actorId: g.actor?.id, game: "slots", pending: prize.pending ?? null }
  });
  await afterGame(g, "slots", won && result.kind !== "special");
  return { dice, kind: result.kind };
}));

/* -------------------------------------------- */
/*  Prize wheel (three d10 rings)               */
/* -------------------------------------------- */

const ringNames = () => Object.fromEntries(RINGS.map(r => [r, t(`Wheel.Ring.${r}`)]));
const worldNow = () => game.time.worldTime;

export function spinWait(g) {
  const n = numbers();
  if (setting("useWorldTime")) {
    const last = g.actor ? g.actor.getFlag(MODULE_ID, "lastSpin") : getRival(g.rival.id)?.lastSpin;
    return cooldownRemaining(last ?? null, worldNow(), n.wheelCooldownHours);
  }
  const night = activeNight()?.id ?? null;
  const last = g.actor ? g.actor.getFlag(MODULE_ID, "lastSpinNight") : getRival(g.rival.id)?.lastSpinNight;
  return night && last === night ? n.wheelCooldownHours : 0;
}

async function markSpin(g) {
  const night = activeNight()?.id ?? null;
  if (g.actor) await g.actor.update({ [`flags.${MODULE_ID}.lastSpin`]: worldNow(), [`flags.${MODULE_ID}.lastSpinNight`]: night });
  else await updateRival(g.rival.id, { lastSpin: worldNow(), lastSpinNight: night });
}

handle("wheel", (payload, user) => serial(async () => {
  const g = gambler(payload, user);
  const wheel = pack().wheel;
  const n = numbers();
  const wait = spinWait(g);
  if (wait > 0) throw new Error(t("Notify.WheelCooldown", { name: g.name, hours: wait }));
  await stake(g, n.wheelCost, "wheel");
  await markSpin(g);
  const pool = faces(await roll(`${n.wheelMaxSteps}d10`, { show: false }));
  const spin = resolveWheel(wheel, () => pool.shift() ?? 1, { claimed: progress().claimed, maxSteps: n.wheelMaxSteps });
  // A once-only prize is reserved now, so two quick spins can't both win it.
  if (spin.onceKey && spin.prize) await updateProgress(p => { p.claimed.push(spin.onceKey); });
  const shown = spin.prize ? String(spin.prize.label ?? spin.final.entry?.label ?? "").replace(/\{n\}/g, spin.prize.formula ?? spin.prize.amount ?? "") : "";

  pad("Spin");
  const labels = Object.fromEntries(RINGS.map(r => [r, wheel.rings[r].map(e => e.label)]));
  broadcastWheel({
    title: wheel.name ?? t("Game.wheel"), gambler: g.name, img: g.img ?? null,
    rings: labels, steps: spin.steps.map(s => ({ ring: s.ring, index: s.index })),
    result: spin.claimed ? t("Wheel.Claimed") : spin.exhausted ? t("Wheel.Exhausted") : (shown || t("Wheel.NoPrize"))
  });
  // The prize lands when the wheel stops: queued again after the animation, so nothing else waits for it.
  const delay = spin.steps.length * (WHEEL_SPIN_MS + 600) + 400;
  setTimeout(() => serial(async () => {
    const prize = spin.prize ? await applyPrize(spin.prize, { actor: g.actor, rivalId: g.rival?.id, game: "wheel" }) : { text: "" };
    pad(spin.prize ? (spin.final.entry?.once ? "Jackpot" : "Win") : "Bust");
    await postCard({
      gambler: g, title: wheel.name ?? t("Game.wheel"),
      body: wheelBody({ gambler: g, steps: spin.steps, prizeText: prize.granted ?? prize.text, claimed: spin.claimed, exhausted: spin.exhausted, ringNames: ringNames() }),
      flags: { card: "wheel", actorId: g.actor?.id, game: "wheel", pending: prize.pending ?? null }
    });
    await afterGame(g, "wheel", !!spin.prize);
  }).catch(err => console.error(`${MODULE_ID} | wheel prize`, err)), delay);
  return { steps: spin.steps.length, prize: shown };
}));

/* -------------------------------------------- */
/*  Table games                                 */
/* -------------------------------------------- */

const seatGambler = seat => seat.kind === "rival"
  ? { rival: getRival(seat.rivalId), name: seat.name, key: seat.key }
  : { actor: game.actors.get(seat.actorId), name: seat.name, key: seat.key };

handle("table-open", ({ game: gameId, seats = [], ante, dealerBones }, user) => serial(async () => {
  gmOnly(user);
  if (!["bones", "board"].includes(gameId)) throw new Error("Unknown table game");
  const n = numbers();
  const list = seats.map(s => {
    if (s.actorId) { const a = game.actors.get(s.actorId); return a && { key: `a.${a.id}`, kind: "pc", actorId: a.id, name: a.name, img: a.img, bet: null }; }
    const r = getRival(s.rivalId);
    return r && { key: `r.${r.id}`, kind: "rival", rivalId: r.id, name: r.name, img: r.img ?? null, bet: null };
  }).filter(Boolean);
  await setTable({
    open: true, id: foundry.utils.randomID(), game: gameId, round: 1,
    ante: Math.max(1, Math.trunc(Number(ante) || n.bonesAnte)),
    dealerBones: Math.min(20, Math.max(1, Math.trunc(Number(dealerBones) || n.dealerBones))),
    seats: list
  });
}));

handle("table-close", (payload, user) => serial(async () => { gmOnly(user); await setTable({ open: false }); }));

handle("table-bet", ({ key, bet }, user) => serial(async () => {
  const tb = foundry.utils.deepClone(table());
  if (!tb.open) throw new Error(t("Notify.NoTable"));
  const seat = tb.seats.find(s => s.key === key);
  if (!seat || seat.kind !== "pc") throw new Error(t("Notify.NotSeated"));
  const actor = game.actors.get(seat.actorId);
  if (!user.isGM && !actor?.testUserPermission(user, "OWNER")) throw new Error(t("Notify.NotOwner", { name: seat.name }));
  const have = razorCount(actor);
  if (bet === null) seat.bet = null;
  else if (tb.game === "bones") {
    const bones = Math.trunc(Number(bet.bones)), st = Math.trunc(Number(bet.stake ?? tb.ante));
    if (!(bones >= 1 && bones <= 20)) throw new Error(t("Notify.BadAmount"));
    if (st < tb.ante) throw new Error(t("Notify.BelowAnte", { ante: tb.ante }));
    if (st > have) throw new Error(t("Notify.NotEnough", { name: seat.name, have, need: st }));
    seat.bet = { bones, stake: st };
  } else {
    const board = cleanBoard(bet.board);
    const st = boardStake(board);
    if (!st) throw new Error(t("Notify.BadAmount"));
    if (st > have) throw new Error(t("Notify.NotEnough", { name: seat.name, have, need: st }));
    seat.bet = { board, stake: st };
  }
  await setTable(tb);
  return seat.bet;
}));

handle("table-resolve", (payload, user) => serial(async () => {
  gmOnly(user);
  const tb = foundry.utils.deepClone(table());
  if (!tb.open) throw new Error(t("Notify.NoTable"));
  const p = pack();
  if (tb.game === "bones") await resolveBones(tb, p);
  else await resolveBoard(tb, p);
  for (const s of tb.seats) s.bet = null;
  tb.round = (tb.round ?? 1) + 1;
  await setTable(tb);
}));

async function resolveBones(tb, p) {
  const hands = [];
  for (const seat of tb.seats) {
    const g = seatGambler(seat);
    if (seat.kind === "pc") {
      if (!seat.bet || !g.actor) continue;
      hands.push({ ...g, seat, bones: seat.bet.bones, stake: seat.bet.stake });
    } else {
      if (!g.rival) continue;
      const st = rivalStake(g.rival, tb.ante);
      if ((g.rival.bankroll ?? 0) < st) continue;
      hands.push({ ...g, seat, bones: rivalBones(g.rival), stake: st });
    }
  }
  if (!hands.length) throw new Error(t("Notify.NoBets"));
  for (const h of hands) await stake(h, h.stake, "bones");
  const dealer = { key: "dealer", name: p.bones?.dealer?.name ?? t("Bones.Dealer"), bones: tb.dealerBones, stake: tb.ante };
  const all = [...hands, dealer];
  const rolls = await Promise.all(all.map(h => roll(`${h.bones}d6`, { show: false })));
  await Promise.all(rolls.map(r => game.dice3d?.showForRoll?.(r, game.user, true)));
  all.forEach((h, i) => { h.dice = faces(rolls[i]); });
  const { scores, winners } = scoreBones(all.map(h => ({ id: h.key, dice: h.dice })));
  const pot = all.reduce((a, h) => a + h.stake, 0);
  const { shares, house } = splitPot(pot, winners);
  for (const h of all) {
    const s = scores.find(x => x.id === h.key);
    Object.assign(h, { total: s.total, bust: s.bust, share: shares[h.key] ?? 0 });
  }
  for (const h of hands) await payout(h, h.share, "bones");
  const houseTotal = house + (shares.dealer ?? 0);
  pad(winners.some(w => w !== "dealer") ? "Win" : "Bust");
  await postCard({ title: `${p.bones?.name ?? t("Game.bones")} · ${t("Table.Round", { n: tb.round })}`, body: bonesBody({ hands: all, pot, winners, house: houseTotal }) });
  for (const h of hands) await afterGame(h, "bones", h.share > 0);
}

async function resolveBoard(tb, p) {
  const boards = [];
  for (const seat of tb.seats) {
    const g = seatGambler(seat);
    if (seat.kind === "pc") {
      if (!seat.bet || !g.actor) continue;
      boards.push({ ...g, board: seat.bet.board });
    } else {
      if (!g.rival) continue;
      const board = rivalBoard(g.rival);
      if ((g.rival.bankroll ?? 0) < boardStake(board)) continue;
      boards.push({ ...g, board });
    }
  }
  if (!boards.length) throw new Error(t("Notify.NoBets"));
  for (const b of boards) await stake(b, boardStake(b.board), "board");
  const d20 = faces(await roll("1d20"))[0];
  const mult = numbers().boardMultiplier;
  for (const b of boards) {
    Object.assign(b, payBoard(b.board, d20, mult));
    await payout(b, b.payout, "board", `${d20}`);
  }
  pad(boards.some(b => b.payout) ? "Win" : "Bust");
  await postCard({ title: `${p.board?.name ?? t("Game.board")} · ${t("Table.Round", { n: tb.round })}`, body: boardBody({ roll: d20, boards }) });
  for (const b of boards) await afterGame(b, "board", b.payout > 0);
}

/* -------------------------------------------- */
/*  Player-side helpers (no GM rights needed)   */
/* -------------------------------------------- */

export function spinWaitFor(actor) { return spinWait({ actor }); }
export const toggleSetting = (key, value) => setSetting(key, value);
