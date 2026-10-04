import { MODULE_ID } from "./constants.mjs";

const hidden = (key, type, def, onChange) => game.settings.register(MODULE_ID, key, {
  scope: "world", config: false, type, default: def, onChange
});

/**
 * World data lives in hidden world settings (every client can read them; only a GM writes).
 * onChange hooks let every client redraw when the GM changes something.
 */
export function registerSettings({ onState } = {}) {
  hidden("pack", Object, null, () => onState?.("pack"));
  hidden("ledger", Object, { activeNight: null, nights: [] }, () => onState?.("ledger"));
  hidden("rivals", Object, { list: [] }, () => onState?.("rivals"));
  hidden("table", Object, { open: false }, () => onState?.("table"));
  hidden("progress", Object, { jackpots: [], claimed: [], fired: [], gifted: [], hour: 0 }, () => onState?.("progress"));
  hidden("cageOpen", Boolean, true, () => onState?.("cage"));
  hidden("floorOpen", Boolean, false, () => onState?.("floor"));

  game.settings.register(MODULE_ID, "autoGrant", {
    name: "PLANAR_CASINO.Settings.AutoGrant.Name", hint: "PLANAR_CASINO.Settings.AutoGrant.Hint",
    scope: "world", config: true, type: Boolean, default: true
  });
  game.settings.register(MODULE_ID, "heat", {
    name: "PLANAR_CASINO.Settings.Heat.Name", hint: "PLANAR_CASINO.Settings.Heat.Hint",
    scope: "world", config: true, type: Number, default: 3, range: { min: 0, max: 10, step: 1 }
  });
  game.settings.register(MODULE_ID, "useWorldTime", {
    name: "PLANAR_CASINO.Settings.WorldTime.Name", hint: "PLANAR_CASINO.Settings.WorldTime.Hint",
    scope: "world", config: true, type: Boolean, default: true
  });
  for (const cue of ["Spin", "Jackpot", "Win", "Bust"]) {
    game.settings.register(MODULE_ID, `pad${cue}`, {
      name: `PLANAR_CASINO.Settings.Pad${cue}.Name`, hint: "PLANAR_CASINO.Settings.Pad.Hint",
      scope: "world", config: true, type: String, default: ""
    });
  }
  game.settings.register(MODULE_ID, "wheelFx", {
    name: "PLANAR_CASINO.Settings.WheelFx.Name", hint: "PLANAR_CASINO.Settings.WheelFx.Hint",
    scope: "client", config: true, type: Boolean, default: true
  });
}

export const setting = key => game.settings.get(MODULE_ID, key);
export const setSetting = (key, value) => game.settings.set(MODULE_ID, key, value);
