// The players' casino window: razors, the cage, slots, the wheel and their seat at a table.
// The GM can open it too ("Player view") to play or bet for any PC.
import { MODULE_ID } from "./constants.mjs";
import { t, warn } from "./i18n.mjs";
import { setting } from "./settings.mjs";
import { escapeHTML as esc, boardStake, cleanBoard } from "./util.mjs";
import { pack, numbers, table, casinoName, razorName } from "./state.mjs";
import { razorCount, playerCharacters } from "./razors.mjs";
import { spinWait } from "./games.mjs";
import { call } from "./rpc.mjs";

const { ApplicationV2 } = foundry.applications.api;

/** Characters this user plays (the GM, in player view: every PC). */
export function myCharacters(all = false) {
  if (all && game.user.isGM) return playerCharacters();
  const own = game.actors.filter(a => a.type === "character" && a.isOwner && !game.user.isGM);
  const main = game.user.character;
  return main ? [main, ...own.filter(a => a !== main)] : own;
}

export class CasinoWindow extends ApplicationV2 {
  static DEFAULT_OPTIONS = {
    id: "planar-casino-window",
    classes: ["planar-casino", "player"],
    window: { title: "PLANAR_CASINO.Window.Title", icon: "fa-solid fa-coins", resizable: true },
    position: { width: 520, height: "auto" }
  };

  static #instance = null;
  static get instance() { return this.#instance; }

  static open({ all = false } = {}) {
    if (!game.user.isGM && !setting("floorOpen")) return warn("Notify.FloorClosed");
    this.#instance ??= new CasinoWindow();
    this.#instance.all = all;
    this.#instance.render({ force: true });
    this.#instance.bringToFront?.();
    return this.#instance;
  }

  all = false;
  /** Number boards being built, by seat key (kept across re-renders). */
  boards = {};
  #boundTo = null;
  #timer = null;

  get title() { return `${casinoName()}`; }

  refreshSoon() {
    clearTimeout(this.#timer);
    this.#timer = setTimeout(() => { if (this.rendered) this.render(); }, 150);
  }

  async _prepareContext() { return {}; }
  async _renderHTML() { return this.#html(); }
  _replaceHTML(result, content) { content.innerHTML = result; }

  _onRender() {
    if (this.#boundTo === this.element) return;
    this.#boundTo = this.element;
    this.element.addEventListener("click", ev => this.#onClick(ev));
    this.element.addEventListener("contextmenu", ev => this.#onClick(ev, true));
  }

  #html() {
    const actors = myCharacters(this.all);
    if (!actors.length) return `<p class="pc-hint">${esc(t("Window.NoCharacter"))}</p>`;
    const n = numbers();
    const p = pack();
    const tb = table();
    const cage = setting("cageOpen") || game.user.isGM;
    return actors.map(a => {
      const data = `data-actor="${a.id}"`;
      const wait = spinWait({ actor: a });
      const seat = tb.open ? tb.seats.find(s => s.actorId === a.id) : null;
      return `<section class="pc-player">
        <header class="pc-row"><img src="${esc(a.img)}" alt=""><h3>${esc(a.name)}</h3>
          <span class="pc-chip on" data-tooltip="${esc(razorName())}"><i class="fa-solid fa-coins"></i> ${razorCount(a)}</span>
          <span class="pc-chip">${Number(a.system.currency?.gp) || 0} gp</span>
          ${a.getFlag(MODULE_ID, "reroll") ? `<span class="pc-chip on"><i class="fa-solid fa-gears"></i> ${esc(t("Window.Reroll"))}</span>` : ""}</header>
        ${cage ? `<div class="pc-row pc-cage"><i class="fa-solid fa-cash-register"></i>
          <input type="number" min="1" value="10" class="pc-amount" ${data}>
          <button type="button" data-act="buy" ${data}>${esc(t("Cage.Buy"))}</button>
          <button type="button" data-act="cash" ${data}>${esc(t("Cage.Cash"))}</button>
          <small>${esc(t("Cage.Rate", { value: n.razorValue }))}</small></div>` : `<p class="pc-hint">${esc(t("Notify.CageClosed"))}</p>`}
        <div class="pc-row pc-games">
          <button type="button" class="big" data-act="slots" ${data}><i class="fa-solid fa-clover"></i> ${esc(p?.slots?.machine ?? t("Game.slots"))} <small>(${n.slotsCost})</small></button>
          <button type="button" class="big" data-act="wheel" ${data} ${wait > 0 ? "disabled" : ""}><i class="fa-solid fa-dharmachakra"></i> ${esc(p?.wheel?.name ?? t("Game.wheel"))} <small>(${n.wheelCost})</small>${wait > 0 ? `<br><small>${esc(t("Panel.Wait", { hours: wait }))}</small>` : ""}</button>
        </div>
        ${seat ? this.#seat(tb, seat, a) : ""}
      </section>`;
    }).join("");
  }

  #seat(tb, seat, actor) {
    const p = pack();
    const k = `data-seat="${esc(seat.key)}"`;
    if (tb.game === "bones") {
      const bet = seat.bet;
      return `<div class="pc-table-seat"><h4><i class="fa-solid fa-skull"></i> ${esc(p?.bones?.name ?? t("Game.bones"))} · ${esc(t("Table.Round", { n: tb.round }))}</h4>
        <p class="pc-hint">${esc(t("Bones.Rules", { ante: tb.ante }))}</p>
        <div class="pc-row">
          <label>${esc(t("Bones.Bones"))} <input type="number" class="pc-bones" min="1" max="20" value="${bet?.bones ?? 3}" ${k}></label>
          <label>${esc(t("Bones.Stake"))} <input type="number" class="pc-stake" min="${tb.ante}" value="${bet?.stake ?? tb.ante}" ${k}></label>
          <button type="button" data-act="bet-dh" ${k}>${esc(bet ? t("Table.Change") : t("Table.Place"))}</button>
          ${bet ? `<button type="button" data-act="bet-clear" ${k}>${esc(t("Table.Withdraw"))}</button><span class="pc-ok">✔</span>` : ""}
        </div></div>`;
    }
    const board = this.boards[seat.key] ?? { ...(seat.bet?.board ?? {}) };
    this.boards[seat.key] = board;
    const cells = Array.from({ length: 20 }, (_, i) => {
      const n = i + 1, c = board[n] ?? 0;
      return `<button type="button" class="pc-cell ${c ? "on" : ""}" data-act="cell" data-n="${n}" ${k}><span>${n}</span>${c ? `<b>${c}</b>` : ""}</button>`;
    }).join("");
    return `<div class="pc-table-seat"><h4><i class="fa-solid fa-dice-d20"></i> ${esc(p?.board?.name ?? t("Game.board"))} · ${esc(t("Table.Round", { n: tb.round }))}</h4>
      <p class="pc-hint">${esc(t("Board.Rules", { mult: numbers().boardMultiplier }))}</p>
      <div class="pc-board">${cells}</div>
      <div class="pc-row"><span>${esc(t("Board.Stake", { n: boardStake(board), have: razorCount(actor) }))}</span>
        <button type="button" data-act="bet-ol" ${k}>${esc(seat.bet ? t("Table.Change") : t("Table.Place"))}</button>
        <button type="button" data-act="board-clear" ${k}>${esc(t("Board.Clear"))}</button>
        ${seat.bet ? `<span class="pc-ok">✔</span>` : ""}</div></div>`;
  }

  async #onClick(ev, right = false) {
    const el = ev.target.closest("[data-act]");
    if (!el) return;
    ev.preventDefault();
    const { act, actor: actorId, seat } = el.dataset;
    const val = sel => Number(this.element.querySelector(`${sel}[data-${seat ? "seat" : "actor"}="${CSS.escape(seat ?? actorId)}"]`)?.value);
    try {
      switch (act) {
        case "buy": case "cash": await call("cage", { actorId, action: act, amount: val(".pc-amount") }); break;
        case "slots": await call("slots", { actorId }); break;
        case "wheel": await call("wheel", { actorId }); break;
        case "bet-dh": await call("table-bet", { key: seat, bet: { bones: val(".pc-bones"), stake: val(".pc-stake") } }); break;
        case "bet-clear": await call("table-bet", { key: seat, bet: null }); break;
        case "cell": {
          const b = this.boards[seat] ??= {};
          const n = Number(el.dataset.n);
          b[n] = Math.max(0, (b[n] ?? 0) + (right ? -1 : 1));
          if (!b[n]) delete b[n];
          return this.render();
        }
        case "board-clear": this.boards[seat] = {}; return this.render();
        case "bet-ol": await call("table-bet", { key: seat, bet: { board: cleanBoard(this.boards[seat]) } }); break;
      }
    } catch (err) {
      ui.notifications.warn(err.message);
    }
    this.refreshSoon();
  }

  /** A new round or table: forget the boards being built. */
  resetBoards() { this.boards = {}; }
}
