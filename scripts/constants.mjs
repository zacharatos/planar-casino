export const MODULE_ID = "planar-casino";
export const EVENT = `module.${MODULE_ID}`;

/** Flag on a chip item: "razor" (an ordinary casino chip) or "platinum" (the special one-off chip). */
export const CHIP_FLAG = "chip";

/** Icons from the dnd5e system, so nothing is shipped. */
export const RAZOR_ICON = "systems/dnd5e/icons/currency/gold.webp";
export const PLATINUM_ICON = "systems/dnd5e/icons/currency/platinum.webp";

/** The generic pack shipped with the module. */
export const DEFAULT_PACK_PATH = `modules/${MODULE_ID}/data/default-pack.json`;

/** How long the GM's client waits for a player's answer (reroll choice), and a player for the GM. */
export const PROMPT_TIMEOUT_MS = 60_000;
export const REQUEST_TIMEOUT_MS = 30_000;

/** Wheel animation timings (ms). */
export const WHEEL_SPIN_MS = 3200;
export const WHEEL_HOLD_MS = 4500;

/** Journal folder for the ledger pages when Planar Codex is not installed. */
export const LEDGER_FOLDER = "Planar Casino";
