# Changelog

All notable changes to this module are listed here. The release workflow uses the section for the tagged version as the release notes.

## [Unreleased]

### Fixed

- **Pack → Import pack** did nothing after choosing a file: the panel re-rendered right after the click and replaced the hidden file input, so its change event never reached the panel. The file picker now lives outside the panel.

## [0.1.0]

First release.

- Casino chips as a flagged dnd5e loot item, with a counter on the character sheet; hand-made changes (sheet edits, drag between actors) are logged.
- Cages: buy with gold (change made by dnd5e), cash out, welcome gift once per PC, open/close.
- Slots (3d6, pair and jackpot prizes, jackpots once per world, reroll token chosen on the player's screen).
- Three-ring prize wheel with chained "spin again" segments, once-only prizes, cooldown by world time or per night, and an animated wheel on every client.
- Bones table (secret dice count and stake, highest total wins, a 1 busts) and number board (bet on 1–20, d20, ×N), with NPC rivals who bet by style and keep a bankroll.
- Prizes applied to the sheet: gold, chips, temp HP, damage, items by name (world, then compendiums), spell scrolls; a Grant button for anything not found.
- Per-night ledger as a Markdown journal page (a Planar Codex note when the Codex is installed), copy as Markdown.
- GM tools: heat warning, hourly clock with pack events, private whispers per character and game, optional Planar Soundboard pads.
- Chat commands `/chips`, `/slots`, `/wheel`, `/cage buy|cash N`, `/casino`.
- JSON content packs, with a generic pack included.
- English and Greek.
