# Changelog

All notable changes to this module are listed here. The release workflow uses the section for the tagged version as the release notes.

## [1.1.1]

### Fixed
- **Casino windows no longer redraw for every actor change.** NPC hit points changing in combat redrew the GM panel and every open player window. Only player characters (and ownership or casino flags) refresh them now.

### Changed
- The manifest recommends Planar Codex (the night's ledger note) and Planar Soundboard (pads), so Foundry points them out when they're missing.
- CI and release workflows use `actions/checkout@v5` and `actions/setup-node@v5`; CI runs with read-only repository permissions.

## [1.1.0]

### Changed

- **Closed casino nights keep only their totals in the world data.** Every chip movement rewrites the ledger and sends it to every connected player; with every night's full log inside, that grew with each casino night. When a night is closed (and its journal page is written) its entry-by-entry log is dropped from the setting: the panel still shows its totals, **Copy** copies the full page, and the page itself is untouched. Existing closed nights are compacted once on the GM's next login. **Sync** is hidden for archived nights (their page is final).

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
