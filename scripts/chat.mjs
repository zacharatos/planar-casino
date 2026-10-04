// Chat commands (/chips or /razors, /slots, /wheel, /cage buy N, /cage cash N, /casino) and card buttons.
import { MODULE_ID } from "./constants.mjs";
import { parseCommand, escapeHTML as esc } from "./util.mjs";
import { razorCount } from "./razors.mjs";
import { razorName, casinoName } from "./state.mjs";
import { decorateCard } from "./cards.mjs";
import { call } from "./rpc.mjs";
import { t, warn } from "./i18n.mjs";

/** The character a command is for: the controlled token's actor if you own it, else your assigned character. */
function commandActor() {
  const token = canvas?.tokens?.controlled?.find(tk => tk.actor?.isOwner && tk.actor.type === "character");
  return token?.actor ?? game.user.character ?? null;
}

async function run(cmd) {
  if (cmd.error) return warn("Chat.Usage");
  if (cmd.cmd === "casino") {
    const { CasinoPanel } = await import("./panel.mjs");
    const { CasinoWindow } = await import("./window.mjs");
    return game.user.isGM ? CasinoPanel.open() : CasinoWindow.open();
  }
  const actor = commandActor();
  if (!actor) return warn("Chat.NoActor");
  try {
    if (cmd.cmd === "chips") {
      return ChatMessage.create({
        content: `<div class="planar-casino-card"><header>${esc(casinoName())}</header><p>${esc(t("Chat.Razors", { name: actor.name, n: razorCount(actor), razor: razorName() }))}</p></div>`,
        whisper: [game.user.id], speaker: ChatMessage.getSpeaker({ actor })
      });
    }
    if (cmd.cmd === "slots") return await call("slots", { actorId: actor.id });
    if (cmd.cmd === "wheel") return await call("wheel", { actorId: actor.id });
    if (cmd.cmd === "cage") return await call("cage", { actorId: actor.id, action: cmd.action, amount: cmd.amount });
  } catch (err) {
    ui.notifications.warn(err.message);
  }
}

export function registerChat() {
  Hooks.on("chatMessage", (log, text) => {
    const cmd = parseCommand(text);
    if (!cmd) return true;
    run(cmd);
    return false;
  });
  Hooks.on("renderChatMessageHTML", (message, html) => {
    if (!message.getFlag(MODULE_ID, "card")) return;
    decorateCard(message, html);
    html.querySelector?.("[data-pc-grant]")?.addEventListener("click", async ev => {
      ev.preventDefault();
      ev.currentTarget.disabled = true;
      try { const name = await call("grant", { messageId: message.id }); if (name) ui.notifications.info(t("Notify.Granted", { name })); }
      catch (err) { ui.notifications.warn(err.message); ev.currentTarget.disabled = false; }
    });
  });
}
