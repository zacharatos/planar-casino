// The GM panel: Floor (night, clock, PCs), Tables, Rivals, Pack, Ledger.
import { MODULE_ID } from "./constants.mjs";
import { t, warn, info } from "./i18n.mjs";
import { setting, setSetting } from "./settings.mjs";
import { escapeHTML as esc, summarizeNight } from "./util.mjs";
import { pack, numbers, rivals, saveRivals, updateRival, progress, table, importPack, resetPack, casinoName, razorName } from "./state.mjs";
import { razorCount, playerCharacters } from "./razors.mjs";
import { ledger, activeNight, nightMarkdown, deleteNight } from "./ledger.mjs";
import { spinWait } from "./games.mjs";
import { call } from "./rpc.mjs";
import { CasinoWindow } from "./window.mjs";

const { ApplicationV2, DialogV2 } = foundry.applications.api;
const TABS = ["floor", "tables", "rivals", "pack", "ledger"];
const TAB_ICONS = { floor: "fa-coins", tables: "fa-dice", rivals: "fa-user-secret", pack: "fa-box-open", ledger: "fa-book" };

const btn = (act, icon, label, data = "", cls = "") =>
  `<button type="button" class="${cls}" data-act="${act}" ${data}><i class="fa-solid ${icon}"></i>${label ? ` ${esc(label)}` : ""}</button>`;

export class CasinoPanel extends ApplicationV2 {
  static DEFAULT_OPTIONS = {
    id: "planar-casino-panel",
    classes: ["planar-casino"],
    window: { title: "PLANAR_CASINO.Panel.Title", icon: "fa-solid fa-dharmachakra", resizable: true },
    position: { width: 760, height: 680 }
  };

  static #instance = null;
  static get instance() { return this.#instance; }

  static open() {
    if (!game.user.isGM) return warn("Notify.OnlyGM");
    this.#instance ??= new CasinoPanel();
    this.#instance.render({ force: true });
    this.#instance.bringToFront?.();
    return this.#instance;
  }

  #tab = "floor";
  #boundTo = null;
  #timer = null;

  get title() { return `${t("Panel.Title")} · ${casinoName()}`; }

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
    this.element.addEventListener("change", ev => this.#onChange(ev));
  }

  /* ---------------- markup ---------------- */

  #html() {
    const tabs = TABS.map(k => `<a class="pc-tab ${k === this.#tab ? "active" : ""}" data-tab="${k}"><i class="fa-solid ${TAB_ICONS[k]}"></i> ${esc(t(`Panel.Tab.${k}`))}</a>`).join("");
    const body = { floor: () => this.#floor(), tables: () => this.#tables(), rivals: () => this.#rivals(), pack: () => this.#pack(), ledger: () => this.#ledger() }[this.#tab]();
    return `<nav class="pc-tabs">${tabs}</nav><section class="pc-body">${body}</section>`;
  }

  #floor() {
    const night = activeNight();
    const p = progress();
    const events = pack()?.timedEvents ?? [];
    const hours = Math.max(events.length, 3);
    const n = numbers();
    const nightRow = night
      ? `<div class="pc-row"><span class="pc-chip on"><i class="fa-solid fa-moon"></i> ${esc(night.name)}</span>
           <span class="pc-clock">${esc(t("Clock.Now", { hour: p.hour ?? 0, of: hours }))}</span>
           ${btn("next-hour", "fa-hourglass-half", t("Clock.Next"))}
           ${btn("night-page", "fa-book-open", t("Panel.LedgerPage"), `data-id="${night.id}"`)}
           ${btn("night-close", "fa-door-closed", t("Panel.CloseNight"))}</div>`
      : `<div class="pc-row"><span class="pc-chip">${esc(t("Panel.NoNight"))}</span>${btn("night-open", "fa-door-open", t("Panel.OpenNight"))}</div>`;
    const toggles = `<div class="pc-row">
      <label><input type="checkbox" name="floorOpen" ${setting("floorOpen") ? "checked" : ""}> ${esc(t("Panel.FloorOpen"))}</label>
      <label><input type="checkbox" name="cageOpen" ${setting("cageOpen") ? "checked" : ""}> ${esc(t("Panel.CageOpen"))}</label>
      ${btn("welcome", "fa-gift", t("Panel.Welcome", { n: n.welcomeGift }))}
      ${btn("player-view", "fa-eye", t("Panel.PlayerView"))}
    </div>`;
    const pcs = playerCharacters();
    const rows = pcs.map(a => {
      const wait = spinWait({ actor: a });
      const gifted = p.gifted.includes(a.id);
      const reroll = a.getFlag(MODULE_ID, "reroll");
      const data = `data-actor="${a.id}"`;
      return `<tr>
        <td class="pc-name"><img src="${esc(a.img)}" alt=""> ${esc(a.name)} ${gifted ? `<i class="fa-solid fa-gift" data-tooltip="${esc(t("Panel.Gifted"))}"></i>` : ""}${reroll ? ` <i class="fa-solid fa-gears" data-tooltip="${esc(t("Panel.Reroll"))}"></i>` : ""}</td>
        <td class="pc-num">${razorCount(a)}</td>
        <td class="pc-num">${Number(a.system.currency?.gp) || 0}</td>
        <td>${wait > 0 ? `<span class="pc-wait">${esc(t("Panel.Wait", { hours: wait }))}</span> ${btn("allow-spin", "fa-rotate-left", "", data, "icon")}` : `<span class="pc-ok">${esc(t("Panel.Ready"))}</span>`}</td>
        <td class="pc-acts">
          ${btn("slots", "fa-clover", "", `${data} data-tooltip="${esc(t("Game.slots"))}"`, "icon")}
          ${btn("wheel", "fa-dharmachakra", "", `${data} data-tooltip="${esc(t("Game.wheel"))}"`, "icon")}
          ${btn("cage", "fa-cash-register", "", `${data} data-tooltip="${esc(t("Panel.Cage"))}"`, "icon")}
          ${btn("adjust", "fa-scale-unbalanced", "", `${data} data-tooltip="${esc(t("Panel.Adjust"))}"`, "icon")}
          ${btn("platinum", "fa-ticket", "", `${data} data-tooltip="${esc(t("Panel.Platinum"))}"`, "icon")}
        </td></tr>`;
    }).join("");
    return `${nightRow}${toggles}
      <table class="pc-grid"><thead><tr><th>${esc(t("Ui.PC"))}</th><th>${esc(razorName())}</th><th>gp</th><th>${esc(t("Game.wheel"))}</th><th></th></tr></thead>
      <tbody>${rows || `<tr><td colspan="5">${esc(t("Panel.NoPCs"))}</td></tr>`}</tbody></table>`;
  }

  #tables() {
    const tb = table();
    const p = pack();
    if (!tb.open) {
      const n = numbers();
      const pcs = playerCharacters().map(a => `<label><input type="checkbox" name="seat" value="a:${a.id}" checked> ${esc(a.name)}</label>`).join("");
      const rv = rivals().map(r => `<label><input type="checkbox" name="seat" value="r:${r.id}"> ${esc(r.name)} <small>(${r.bankroll ?? 0})</small></label>`).join("");
      return `<div class="pc-form">
        <label>${esc(t("Table.Game"))} <select name="tgame">
          <option value="bones">${esc(p?.bones?.name ?? t("Game.bones"))}</option>
          <option value="board">${esc(p?.board?.name ?? t("Game.board"))}</option></select></label>
        <label>${esc(t("Table.Ante"))} <input type="number" name="ante" min="1" value="${n.bonesAnte}"></label>
        <label>${esc(t("Table.DealerBones"))} <input type="number" name="dealerBones" min="1" max="20" value="${n.dealerBones}"></label>
        <fieldset><legend>${esc(t("Table.PCs"))}</legend>${pcs || esc(t("Panel.NoPCs"))}</fieldset>
        <fieldset><legend>${esc(t("Table.Rivals"))}</legend>${rv || esc(t("Rivals.None"))}</fieldset>
        ${btn("table-open", "fa-chair", t("Table.Open"))}
      </div>`;
    }
    const name = tb.game === "bones" ? (p?.bones?.name ?? t("Game.bones")) : (p?.board?.name ?? t("Game.board"));
    const seats = tb.seats.map(s => {
      let status;
      if (s.kind === "rival") status = `<span class="pc-ok">${esc(t("Table.Auto"))}</span>`;
      else if (!s.bet) status = `<span class="pc-wait">${esc(t("Table.Waiting"))}</span>`;
      else if (tb.game === "bones") status = `<span class="pc-ok">${esc(t("Table.BetBones", { bones: s.bet.bones, stake: s.bet.stake }))}</span>`;
      else status = `<span class="pc-ok">${esc(Object.entries(s.bet.board).map(([k, v]) => `${k}×${v}`).join(" "))}</span>`;
      return `<tr><td>${esc(s.name)}</td><td>${status}</td></tr>`;
    }).join("");
    return `<div class="pc-row"><span class="pc-chip on"><i class="fa-solid fa-dice"></i> ${esc(name)}</span>
        <span>${esc(t("Table.Round", { n: tb.round }))} · ${esc(t("Table.AnteIs", { ante: tb.ante }))}${tb.game === "bones" ? ` · ${esc(t("Table.DealerBonesIs", { n: tb.dealerBones }))}` : ""}</span></div>
      <table class="pc-grid"><tbody>${seats}</tbody></table>
      <div class="pc-row">${btn("table-resolve", "fa-dice-d20", t("Table.Resolve"), "", "primary")}${btn("player-view", "fa-eye", t("Table.BetFor"))}${btn("table-close", "fa-xmark", t("Table.Close"))}</div>`;
  }

  #rivals() {
    const pcs = playerCharacters();
    const options = pcs.map(a => `<option value="${a.id}">${esc(a.name)}</option>`).join("");
    const rows = rivals().map(r => {
      const data = `data-rival="${esc(r.id)}"`;
      return `<tr>
        <td class="pc-name">${r.img ? `<img src="${esc(r.img)}" alt="">` : ""} <strong>${esc(r.name)}</strong>${r.reroll ? ` <i class="fa-solid fa-gears"></i>` : ""}<br><small>${esc(r.notes ?? "")}</small></td>
        <td><input type="number" class="pc-bankroll" ${data} value="${r.bankroll ?? 0}" min="0"></td>
        <td class="pc-acts">
          ${btn("slots", "fa-clover", "", `${data} data-tooltip="${esc(t("Game.slots"))}"`, "icon")}
          ${btn("wheel", "fa-dharmachakra", "", `${data} data-tooltip="${esc(t("Game.wheel"))}"`, "icon")}
          ${spinWait({ rival: r }) > 0 ? btn("allow-spin", "fa-rotate-left", "", data, "icon") : ""}
          <select class="pc-gift-to" ${data}>${options}</select>${btn("rival-gift", "fa-hand-holding-dollar", "", `${data} data-tooltip="${esc(t("Rivals.Gift"))}"`, "icon")}
          ${btn("rival-remove", "fa-trash", "", data, "icon")}
        </td></tr>`;
    }).join("");
    return `<p class="pc-hint">${esc(t("Rivals.Hint"))}</p>
      <table class="pc-grid"><thead><tr><th>${esc(t("Rivals.Name"))}</th><th>${esc(t("Rivals.Bankroll"))}</th><th></th></tr></thead>
      <tbody>${rows || `<tr><td colspan="3">${esc(t("Rivals.None"))}</td></tr>`}</tbody></table>
      <div class="pc-form inline">
        <input type="text" name="rname" placeholder="${esc(t("Rivals.Name"))}">
        <input type="number" name="rbank" min="0" value="20" data-tooltip="${esc(t("Rivals.Bankroll"))}">
        <input type="text" name="rbones" value="2-4" data-tooltip="${esc(t("Rivals.Bones"))}">
        <input type="number" name="rnumbers" min="1" max="20" value="2" data-tooltip="${esc(t("Rivals.Numbers"))}">
        <input type="number" name="rwager" min="1" value="1" data-tooltip="${esc(t("Rivals.Wager"))}">
        ${btn("rival-add", "fa-plus", t("Rivals.Add"))}
      </div>`;
  }

  #pack() {
    const p = pack();
    const pr = progress();
    const imported = !!setting("pack");
    const triggers = (p?.triggers ?? []).map((tr, i) => {
      const id = tr.id ?? `t${i}`;
      return `<li>${pr.fired.includes(id) ? "✔" : "○"} <strong>${esc(tr.actor)}</strong> · ${esc(tr.game ? t(`Game.${tr.game}`) : t("Pack.AnyGame"))} · ${esc(tr.to === "gm" ? t("Pack.ToGM") : t("Pack.ToPlayer"))}</li>`;
    }).join("");
    const jackpots = (pr.jackpots ?? []).map(f => esc(p?.slots?.symbols?.[f - 1]?.label ?? f)).join(", ") || "—";
    return `<div class="pc-card">
        <h3>${esc(p?.name ?? "—")} <small>(${esc(p?.id ?? "")})</small></h3>
        <p>${esc(p?.description ?? "")}</p>
        <p class="pc-hint">${esc(imported ? t("Pack.Imported") : t("Pack.Default"))}</p>
        <div class="pc-row">
          ${btn("pack-pick", "fa-file-import", t("Pack.Import"))}
          ${imported ? btn("pack-reset", "fa-rotate", t("Pack.Reset")) : ""}
        </div>
      </div>
      <div class="pc-card">
        <h3>${esc(t("Pack.Progress"))}</h3>
        <p>${esc(t("Pack.Jackpots"))}: ${jackpots}</p>
        <p>${esc(t("Pack.Claimed"))}: ${esc((pr.claimed ?? []).join(", ") || "—")}</p>
        <p>${esc(t("Pack.Gifted"))}: ${esc((pr.gifted ?? []).map(id => game.actors.get(id)?.name ?? id).join(", ") || "—")}</p>
        <h4>${esc(t("Pack.Triggers"))}</h4><ul class="pc-list">${triggers || "<li>—</li>"}</ul>
        ${btn("progress-reset", "fa-broom", t("Pack.ResetProgress"))}
      </div>`;
  }

  #ledger() {
    const l = ledger();
    const nights = [...l.nights].reverse();
    if (!nights.length) return `<p class="pc-hint">${esc(t("Ledger.None"))}</p>`;
    return nights.map(n => {
      const rows = summarizeNight(n).map(r => `<tr><td>${esc(r.name)}</td><td>${r.start}</td><td>${r.bought}</td><td>${r.cashed}</td><td>${r.wagered}</td><td>${r.won}</td><td>${r.net > 0 ? "+" : ""}${r.net}</td><td>${r.end}</td></tr>`).join("");
      const d = `data-id="${n.id}"`;
      return `<div class="pc-card"><h3>${esc(n.name)} ${n.id === l.activeNight ? `<span class="pc-chip on">${esc(t("Ledger.Open"))}</span>` : ""}</h3>
        <table class="pc-grid small"><thead><tr><th>${esc(t("Ledger.Col.PC"))}</th><th>${esc(t("Ledger.Col.Start"))}</th><th>${esc(t("Ledger.Col.Bought"))}</th><th>${esc(t("Ledger.Col.Cashed"))}</th><th>${esc(t("Ledger.Col.Wagered"))}</th><th>${esc(t("Ledger.Col.Won"))}</th><th>${esc(t("Ledger.Col.Net"))}</th><th>${esc(t("Ledger.Col.End"))}</th></tr></thead><tbody>${rows}</tbody></table>
        <div class="pc-row">${btn("night-page", "fa-book-open", t("Panel.LedgerPage"), d)}${btn("night-copy", "fa-copy", t("Ledger.Copy"), d)}${btn("night-sync", "fa-arrows-rotate", t("Ledger.Sync"), d)}${btn("night-delete", "fa-trash", "", d, "icon")}</div></div>`;
    }).join("");
  }

  /* ---------------- events ---------------- */

  async #onChange(ev) {
    const el = ev.target;
    if (el.name === "floorOpen" || el.name === "cageOpen") return setSetting(el.name, el.checked);
    if (el.classList.contains("pc-bankroll")) return updateRival(el.dataset.rival, { bankroll: Math.max(0, Math.trunc(Number(el.value) || 0)) });
  }

  async #onClick(ev) {
    const tab = ev.target.closest("[data-tab]");
    if (tab) { this.#tab = tab.dataset.tab; return this.render(); }
    const el = ev.target.closest("[data-act]");
    if (!el) return;
    ev.preventDefault();
    const { act } = el.dataset;
    const who = { actorId: el.dataset.actor, rivalId: el.dataset.rival };
    try {
      switch (act) {
        case "slots": await call("slots", who); break;
        case "wheel": await call("wheel", who); break;
        case "allow-spin": await call("allow-spin", who); break;
        case "welcome": { const r = await call("welcome"); info(r.given.length ? "Notify.Welcomed" : "Notify.AllWelcomed", { names: r.given.join(", "), n: r.gift }); break; }
        case "cage": await this.#cageDialog(game.actors.get(who.actorId)); break;
        case "adjust": await this.#adjustDialog(game.actors.get(who.actorId)); break;
        case "platinum": if (await DialogV2.confirm({ window: { title: t("Panel.Platinum") }, content: `<p>${esc(t("Panel.PlatinumConfirm", { name: game.actors.get(who.actorId)?.name ?? "" }))}</p>` })) await call("platinum", who); break;
        case "player-view": CasinoWindow.open({ all: true }); break;
        case "night-open": {
          const name = await DialogV2.prompt({ window: { title: t("Panel.OpenNight") }, content: `<input type="text" name="name" placeholder="${esc(t("Panel.NightName"))}" autofocus>`, ok: { callback: (e, b) => b.form.elements.name.value } });
          if (name !== null && name !== undefined) await call("night-open", { name: name.trim() });
          break;
        }
        case "night-close": await call("night-close"); break;
        case "next-hour": await call("next-hour"); break;
        case "night-page": { const n = ledger().nights.find(x => x.id === el.dataset.id); const page = n?.page ? await fromUuid(n.page) : null; if (page) page.parent.sheet.render(true, { pageId: page.id }); else warn("Notify.NoPage"); break; }
        case "night-sync": await call("night-sync", { id: el.dataset.id }); info("Notify.Synced"); break;
        case "night-copy": { const n = ledger().nights.find(x => x.id === el.dataset.id); if (n) { const md = nightMarkdown(n); if (game.clipboard?.copyPlainText) await game.clipboard.copyPlainText(md); else await navigator.clipboard.writeText(md); info("Notify.Copied"); } break; }
        case "night-delete": if (await DialogV2.confirm({ window: { title: t("Ledger.Delete") }, content: `<p>${esc(t("Ledger.DeleteConfirm"))}</p>` })) await deleteNight(el.dataset.id); break;
        case "table-open": {
          const root = this.element;
          const seats = [...root.querySelectorAll("input[name=seat]:checked")].map(i => {
            const [k, id] = i.value.split(":");
            return k === "a" ? { actorId: id } : { rivalId: id };
          });
          await call("table-open", { game: root.querySelector("[name=tgame]").value, seats, ante: Number(root.querySelector("[name=ante]").value), dealerBones: Number(root.querySelector("[name=dealerBones]").value) });
          break;
        }
        case "table-resolve": await call("table-resolve"); break;
        case "table-close": await call("table-close"); break;
        case "rival-gift": { const to = this.element.querySelector(`select.pc-gift-to[data-rival="${CSS.escape(who.rivalId)}"]`)?.value; if (to) await call("rival-gift", { rivalId: who.rivalId, actorId: to, amount: 1 }); break; }
        case "rival-remove": await saveRivals(rivals().filter(r => r.id !== who.rivalId)); break;
        case "rival-add": await this.#addRival(); break;
        case "pack-pick": this.#pickPack(); break;
        case "pack-reset": if (await DialogV2.confirm({ window: { title: t("Pack.Reset") }, content: `<p>${esc(t("Pack.ResetConfirm"))}</p>` })) await resetPack(); break;
        case "progress-reset": if (await DialogV2.confirm({ window: { title: t("Pack.ResetProgress") }, content: `<p>${esc(t("Pack.ResetProgressConfirm"))}</p>` })) await setSetting("progress", { jackpots: [], claimed: [], fired: [], gifted: [], hour: 0 }); break;
      }
    } catch (err) {
      ui.notifications.warn(err.message);
    }
    this.refreshSoon();
  }

  /**
   * Ask for a pack file. The file input lives outside the panel on purpose: the panel re-renders
   * right after the click, which would replace an input inside it before the user picks a file,
   * and the browser's change event would then reach a detached element nobody listens to.
   */
  #pickPack() {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".json,application/json";
    input.style.display = "none";
    input.addEventListener("change", async () => {
      const file = input.files?.[0];
      input.remove();
      if (file) await this.#importPackFile(file);
    }, { once: true });
    document.body.append(input);
    input.click();
  }

  async #importPackFile(file) {
    try {
      const data = JSON.parse(await file.text());
      const errors = await importPack(data);
      if (errors.length) {
        ui.notifications.error(t("Pack.Invalid", { n: errors.length }));
        console.warn(`${MODULE_ID} | pack problems:\n- ${errors.join("\n- ")}`);
      } else info("Pack.Loaded", { name: data.name ?? data.id });
    } catch (err) {
      ui.notifications.error(t("Pack.BadJSON"));
      console.warn(`${MODULE_ID} | pack import failed`, err);
    }
    this.refreshSoon();
  }

  async #addRival() {
    const root = this.element;
    const name = root.querySelector("[name=rname]").value.trim();
    if (!name) return;
    const range = root.querySelector("[name=rbones]").value.split(/[-–,\s]+/).map(Number).filter(n => n > 0);
    const list = [...rivals(), {
      id: foundry.utils.randomID(), name,
      bankroll: Math.max(0, Number(root.querySelector("[name=rbank]").value) || 0),
      bones: range.length > 1 ? [range[0], range[1]] : (range[0] ?? 3),
      numbers: Number(root.querySelector("[name=rnumbers]").value) || 2,
      wager: Number(root.querySelector("[name=rwager]").value) || 1
    }];
    await saveRivals(list);
  }

  async #cageDialog(actor) {
    if (!actor) return;
    const res = await DialogV2.wait({
      window: { title: `${t("Panel.Cage")} · ${actor.name}` },
      content: `<p>${esc(t("Cage.Holds", { name: actor.name, razors: razorCount(actor), gp: Number(actor.system.currency?.gp) || 0, value: numbers().razorValue }))}</p>
        <input type="number" name="amount" min="1" value="10" autofocus>`,
      buttons: [
        { action: "buy", label: t("Cage.Buy"), icon: "fa-solid fa-arrow-down", callback: (e, b) => ({ action: "buy", amount: Number(b.form.elements.amount.value) }) },
        { action: "cash", label: t("Cage.Cash"), icon: "fa-solid fa-arrow-up", callback: (e, b) => ({ action: "cash", amount: Number(b.form.elements.amount.value) }) }
      ],
      rejectClose: false
    });
    if (res?.amount > 0) await call("cage", { actorId: actor.id, ...res });
  }

  async #adjustDialog(actor) {
    if (!actor) return;
    const kinds = ["adjust", "stolen", "gift"].map(k => `<option value="${k}">${esc(t(`Ledger.Kind.${k}`))}</option>`).join("");
    const res = await DialogV2.prompt({
      window: { title: `${t("Panel.Adjust")} · ${actor.name}` },
      content: `<p>${esc(t("Adjust.Hint"))}</p>
        <label>${esc(t("Adjust.Amount"))} <input type="number" name="amount" value="-1"></label>
        <label>${esc(t("Adjust.Kind"))} <select name="kind">${kinds}</select></label>
        <label>${esc(t("Adjust.Note"))} <input type="text" name="note"></label>`,
      ok: { callback: (e, b) => ({ amount: Number(b.form.elements.amount.value), kind: b.form.elements.kind.value, note: b.form.elements.note.value }) },
      rejectClose: false
    });
    if (res?.amount) await call("adjust", { actorId: actor.id, ...res });
  }
}

