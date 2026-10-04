// Chat cards for results. Plain HTML; styles in styles/casino.css (scoped to .planar-casino-card).
import { MODULE_ID } from "./constants.mjs";
import { escapeHTML as esc } from "./util.mjs";
import { casinoName } from "./state.mjs";
import { t } from "./i18n.mjs";

const die = (face, extra = "") => `<span class="pc-die ${extra}">${esc(face)}</span>`;

export function speakerFor(gambler) {
  if (gambler.actor) return ChatMessage.getSpeaker({ actor: gambler.actor });
  return { alias: gambler.name };
}

/** Post a result card. `flags` go under flags.planar-casino. */
export async function postCard({ gambler, title, body, flags = {}, whisper = null }) {
  const content = `<div class="planar-casino-card">
    <header><i class="fa-solid fa-dharmachakra"></i> <span>${esc(casinoName())}</span> · <strong>${esc(title)}</strong></header>
    ${body}
  </div>`;
  const data = { content, speaker: gambler ? speakerFor(gambler) : { alias: casinoName() }, flags: { [MODULE_ID]: flags } };
  if (whisper) data.whisper = whisper;
  return ChatMessage.create(data);
}

export function slotsBody({ gambler, faces, symbols, result, prizeText, rerolled = [] }) {
  const reels = faces.map((f, i) => {
    const s = symbols?.[f - 1] ?? {};
    return `<div class="pc-reel ${rerolled.includes(i) ? "rerolled" : ""}"><span class="pc-sym">${esc(s.icon ?? "")}</span><span>${esc(s.label ?? f)}</span>${die(f)}</div>`;
  }).join("");
  const line = {
    none: t("Slots.None"),
    pair: t("Slots.Pair", { symbol: result.symbol?.label ?? "" }),
    jackpot: t("Slots.Jackpot", { symbol: result.symbol?.label ?? "" }),
    special: t("Slots.Special")
  }[result.kind];
  return `<p class="pc-who">${esc(gambler.name)}</p>
    <div class="pc-reels">${reels}</div>
    <p class="pc-result ${result.kind}">${esc(line)}${result.downgraded ? ` <em>(${esc(t("Slots.JackpotGone"))})</em>` : ""}</p>
    ${prizeText ? `<p class="pc-prize"><i class="fa-solid fa-gift"></i> ${esc(prizeText)}</p>` : ""}`;
}

export function wheelBody({ gambler, steps, prizeText, claimed, exhausted, ringNames }) {
  const path = steps.map(s => `<li><span class="pc-ring">${esc(ringNames[s.ring])}</span> ${die(s.roll)} ${esc(s.entry?.label ?? "")}</li>`).join("");
  let line = prizeText ? `<i class="fa-solid fa-gift"></i> ${esc(prizeText)}` : esc(t("Wheel.NoPrize"));
  if (claimed) line = esc(t("Wheel.Claimed"));
  if (exhausted) line = esc(t("Wheel.Exhausted"));
  return `<p class="pc-who">${esc(gambler.name)}</p><ol class="pc-path">${path}</ol><p class="pc-prize">${line}</p>`;
}

export function bonesBody({ hands, pot, winners, house }) {
  const rows = hands.map(h => {
    const won = winners.includes(h.key);
    const dice = h.dice.map(d => die(d, d === 1 ? "bust" : "")).join("");
    return `<tr class="${won ? "won" : ""} ${h.bust ? "bust" : ""}"><td>${esc(h.name)}</td><td>${dice}</td><td>${h.bust ? esc(t("Bones.Bust")) : h.total}</td><td>${won ? `+${h.share}` : `−${h.stake}`}</td></tr>`;
  }).join("");
  const outcome = winners.length ? "" : `<p class="pc-result none">${esc(t("Bones.AllBust"))}</p>`;
  return `<table class="pc-table"><thead><tr><th></th><th>${esc(t("Bones.Bones"))}</th><th>${esc(t("Bones.Total"))}</th><th>${esc(t("Ui.Razors"))}</th></tr></thead><tbody>${rows}</tbody></table>
    ${outcome}<p class="pc-pot">${esc(t("Bones.Pot", { pot, house }))}</p>`;
}

export function boardBody({ roll, boards }) {
  const rows = boards.map(b => {
    const nums = Object.entries(b.board).map(([n, c]) => `<span class="pc-bet ${Number(n) === roll ? "hit" : ""}">${n}×${c}</span>`).join(" ");
    return `<tr class="${b.payout ? "won" : ""}"><td>${esc(b.name)}</td><td>${nums}</td><td>${b.net >= 0 ? `+${b.net}` : b.net}</td></tr>`;
  }).join("");
  return `<p class="pc-d20">${die(roll, "d20")}</p>
    <table class="pc-table"><thead><tr><th></th><th>${esc(t("Board.Bets"))}</th><th>${esc(t("Board.Net"))}</th></tr></thead><tbody>${rows}</tbody></table>`;
}

/** GM-only controls on cards (Grant buttons) are added at render time. */
export function decorateCard(message, html) {
  const flags = message.getFlag(MODULE_ID, "pending");
  if (!flags || message.getFlag(MODULE_ID, "granted")) return;
  if (!game.user.isGM) return;
  const card = html.querySelector?.(".planar-casino-card");
  if (!card) return;
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "pc-grant";
  btn.dataset.pcGrant = "1";
  btn.innerHTML = `<i class="fa-solid fa-hand-holding-heart"></i> ${esc(t("Ui.Grant", { item: flags.item ?? flags.spell ?? flags.label ?? "" }))}`;
  card.append(btn);
}
