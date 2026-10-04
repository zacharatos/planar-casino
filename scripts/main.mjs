import { MODULE_ID } from "./constants.mjs";
import { registerSettings, setting } from "./settings.mjs";
import { loadDefaultPack, pack } from "./state.mjs";
import { razorCount, watchManualChanges, playerCharacters, isChip } from "./razors.mjs";
import { setHoldingsProvider } from "./ledger.mjs";
import { registerSocket, onPrompt, setWheelPlayer, call } from "./rpc.mjs";
import { playWheel } from "./wheel-fx.mjs";
import { CasinoPanel } from "./panel.mjs";
import { CasinoWindow } from "./window.mjs";
import { registerChat } from "./chat.mjs";
import { escapeHTML as esc } from "./util.mjs";
import { t } from "./i18n.mjs";
import "./games.mjs"; // registers the GM-side actions

const refresh = () => {
  CasinoPanel.instance?.refreshSoon();
  CasinoWindow.instance?.refreshSoon();
};

function onState(what) {
  if (what === "floor") ui.controls?.render?.();
  if (what === "table") CasinoWindow.instance?.resetBoards();
  refresh();
}

Hooks.once("init", () => {
  registerSettings({ onState });
  game.keybindings.register(MODULE_ID, "open", {
    name: "PLANAR_CASINO.Keybinding.Open",
    editable: [],
    onDown: () => { game.user.isGM ? CasinoPanel.open() : CasinoWindow.open(); return true; }
  });
});

Hooks.once("ready", async () => {
  await loadDefaultPack();
  registerSocket();
  registerChat();
  setWheelPlayer(playWheel);
  setHoldingsProvider(() => playerCharacters().map(a => ({ id: a.id, name: a.name, count: razorCount(a) })));
  onPrompt("reroll", rerollPrompt);
  if (game.user.isGM) watchManualChanges();
  const module = game.modules.get(MODULE_ID);
  if (module) module.api = {
    open: () => CasinoPanel.open(),
    openPlayer: () => CasinoWindow.open(),
    razors: actor => razorCount(actor),
    pack: () => pack(),
    slots: actorId => call("slots", { actorId }),
    wheel: actorId => call("wheel", { actorId }),
    cage: (actorId, action, amount) => call("cage", { actorId, action, amount }),
    adjust: (actorId, amount, kind = "adjust", note = "") => call("adjust", { actorId, amount, kind, note })
  };
});

/** Reroll token: the player picks which dice to reroll. Resolves to a list of indexes. */
async function rerollPrompt({ name, faces, symbols }) {
  const { DialogV2 } = foundry.applications.api;
  const boxes = faces.map((f, i) => `<label class="pc-reroll"><input type="checkbox" name="d${i}"> <span class="pc-sym">${esc(symbols?.[f - 1]?.icon ?? "")}</span> ${esc(symbols?.[f - 1]?.label ?? f)} <span class="pc-die">${f}</span></label>`).join("");
  const res = await DialogV2.prompt({
    window: { title: t("Slots.RerollTitle", { name }) },
    content: `<p>${esc(t("Slots.RerollHint"))}</p><div class="planar-casino">${boxes}</div>`,
    ok: { label: t("Slots.Reroll"), callback: (e, b) => faces.map((_, i) => (b.form.elements[`d${i}`].checked ? i : -1)).filter(i => i >= 0) },
    rejectClose: false
  }).catch(() => null);
  return Array.isArray(res) ? res : [];
}

// Toolbar button: always for the GM; for players while the floor is open.
Hooks.on("getSceneControlButtons", controls => {
  if (!controls?.tokens?.tools) return;
  const gm = game.user.isGM;
  if (!gm && !setting("floorOpen")) return;
  controls.tokens.tools[MODULE_ID] = {
    name: MODULE_ID,
    title: gm ? "PLANAR_CASINO.ToolTitle" : "PLANAR_CASINO.Window.Title",
    icon: "fa-solid fa-dharmachakra",
    order: 60,
    button: true,
    visible: true,
    onChange: () => (gm ? CasinoPanel.open() : CasinoWindow.open())
  };
});

// Keep windows current when razors or gold change.
for (const hook of ["createItem", "updateItem", "deleteItem"]) Hooks.on(hook, item => { if (isChip(item)) refresh(); });
Hooks.on("updateActor", refresh);
Hooks.on("updateWorldTime", refresh);

// A razor counter next to the coins on dnd5e character sheets.
Hooks.on("renderActorSheetV2", (app, element) => {
  const actor = app.document;
  if (actor?.type !== "character") return;
  const root = element instanceof HTMLElement ? element : element?.[0];
  const currency = root?.querySelector?.("section.currency");
  if (!currency || currency.querySelector(".pc-sheet-razors")) return;
  const label = document.createElement("label");
  label.className = "pc-sheet-razors";
  label.dataset.tooltip = pack()?.casino?.razorName ?? t("Item.Razor");
  label.innerHTML = `<i class="fa-solid fa-coins"></i><span>${razorCount(actor)}</span>`;
  currency.append(label);
});
