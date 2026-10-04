# Development

## Layout

```
module.json            manifest (id = planar-casino; the id is permanent once published)
scripts/
  main.mjs             hooks: init, ready (api), toolbar button, sheet counter, window refresh
  constants.mjs  settings.mjs  i18n.mjs
  util.mjs             pure rules and helpers (no Foundry globals), all unit-tested:
                       pack validation, slots, wheel, bones, number board, rivals, ledger, triggers, chat parsing
  state.mjs            world data: active pack (or the shipped default), rivals, progress, open table
  razors.mjs           the chip item: count, add/remove, cage buy/cash, platinum chip, logging hand-made changes
  ledger.mjs           casino nights, ledger entries, the journal page (Planar Codex note when available); serial()
  prizes.mjs           applying a prize: gold, chips, temp HP, damage, item by name, spell scroll
  games.mjs            every GM-side action (slots, wheel, tables, cage, gifts, clock, grant); heat; whispers
  rpc.mjs              socket: player -> GM requests, GM -> player prompts, wheel broadcast
  cards.mjs            chat cards and the GM's Grant button
  wheel-fx.mjs         the animated three-ring wheel (SVG + CSS transitions)
  panel.mjs            GM panel (ApplicationV2): Floor, Tables, Rivals, Pack, Ledger
  window.mjs           players' window (ApplicationV2): chips, cage, slots, wheel, table seat
  chat.mjs             /chips /slots /wheel /cage /casino, card buttons
data/default-pack.json the generic pack shipped with the module (no publisher content)
styles/casino.css      scoped to .planar-casino, .planar-casino-card, .planar-casino-wheel
lang/en.json el.json   interface strings (keys under PLANAR_CASINO.*)
tests/                 node:test: rules, manifest + language parity + content guard, link test, release tools
tools/                 stamp-manifest, package, release-api, check-syntax
.github/workflows/     ci.yml, release.yml
docs/images/wheel.png  README screenshot (rendered from wheel-fx.mjs in headless Chromium)
```

There is no build step: Foundry loads `scripts/main.mjs` directly.

## How it fits together

- **Who writes.** Only the active GM's client writes world data, moves chips and posts results. A player's click calls `call(action, payload)` (`rpc.mjs`), which runs the handler locally if you are the active GM or sends it over the module socket otherwise and waits for the answer. With no GM connected the casino is closed.
- **One at a time.** Every handler in `games.mjs` runs inside `serial()` (`ledger.mjs`), a promise queue, so two quick pulls never overwrite each other's ledger write. Never call `serial()` inside a `serial()` block (deadlock). The wheel's prize is applied in a second `serial()` call scheduled after the animation.
- **Data.** Hidden world settings: `pack` (imported pack or null), `ledger` (`{activeNight, nights:[{id, name, start, names, entries, page}]}`), `rivals`, `table`, `progress` (`jackpots`, `claimed`, `fired`, `gifted`, `hour`), `cageOpen`, `floorOpen`. Their `onChange` re-renders open windows on every client. Actor flags: `reroll`, `lastSpin`, `lastSpinNight`. Chip items: `flags.planar-casino.chip = "razor" | "platinum"`.
- **Ledger page.** Rebuilt from the night's entries 1.5 s after the last change (`ledgerMarkdown` in `util.mjs`). With Planar Codex active the page is created with `api.createCodexNote` and rendered with `api.convert`, so it exports to the vault; otherwise a Markdown journal page in a "Planar Casino" folder.
- **Hand-made changes.** The GM client remembers each chip stack's quantity; a create/update/delete it didn't make itself (no `planar-casino` operation option) is logged as an adjustment.

## Run the checks

```
npm test
```

Syntax check on every `.mjs` file, then the tests: the rules in `util.mjs` (slots, wheel chains and once-only prizes, cooldown, bones scoring and pot split, board payouts, rival choices, ledger sums and Markdown, heat, triggers, chat commands), the manifest, language parity (same keys and placeholders; every key used in code exists), a guard that the shipped files carry no publisher names, a link test that imports `main.mjs` against stubbed Foundry globals, and the release tools.

These tests do not start Foundry. Anything touching documents, sockets, dialogs or the canvas has to be tried by hand.

## Try it in Foundry

Symlink the repo into your user data and restart the world:

```
ln -s /path/to/repo /path/to/FoundryData/Data/modules/planar-casino
```

Reload the browser (F5) after each change. Use a second browser logged in as a player for anything that crosses the socket.

### Manual test checklist

**Setup**
- Enable the module: no console errors; the wheel icon is in the GM's Tokens toolbar, not in a player's.
- Pack → Import a broken JSON: error toast, details in the console, nothing saved. Import a valid pack: name shows, rivals appear in Rivals.
- Pack → Back to the generic pack.

**Chips and cages**
- Floor → Welcome gift: every PC gets the chips once; pressing again says everyone has them. A chip item appears in each inventory with the pack's name, price and the module flag; the sheet shows the counter next to the coins.
- Cage buy with enough gold (try a PC with only platinum: dnd5e makes change); with too little gold: refused, nothing changes. Cash out: gold goes up, chips go down.
- Edit the chip quantity on a sheet; drag chips to another PC; delete the stack: each is logged as an adjustment with the right sign.
- Floor → Adjust → Stolen 2: chips go down, the ledger says stolen.
- Untick Cages open: the player's cage controls disappear and `/cage buy 1` is refused.

**Slots**
- Pull until a pair, a jackpot and the special combination appear (or set `CONFIG.debug` and edit the roll). The pair prize lands (gold, chips, temp HP, damage with resistance, note); the jackpot item is in the inventory; the same jackpot again pays the pair prize.
- After the special combination, the next pull asks the **player** (in their browser) which dice to reroll; the card shows the rerolled reels with a dashed border. Close the dialog: no reroll. With the player offline: chosen automatically.
- An item prize that doesn't exist in the world or compendiums: the card shows a Grant button to the GM only; import the item and press it.

**Wheel**
- Spin as a player: the animation plays on both browsers, the ring that is rolling is lit, segments land under the pointer, the result shows, click closes. The card appears after the animation; the prize lands only then.
- Spin again: refused with the hours left. Advance world time 24 h: allowed. Floor → allow-spin icon resets it. Untick *Wheel cooldown uses world time*: once per night instead.
- A once-only segment won twice: second time "already won".
- Turn off *Show the wheel animation* on one client: no overlay there, the card still arrives.

**Tables**
- Open a bones table with two PCs and two rivals. The players see bones + stake controls; place bets; the GM panel shows each seat's status. Roll: Dice So Nice shows all hands; the card lists dice, totals, busts and the split; chips move; a rival's bankroll changes. Everyone busting: the house keeps the pot.
- Stake below the ante or above the chips held: refused.
- Number board: left-click adds, right-click removes chips, Place bet; Roll pays ×N on the hit number. A rival with too small a bankroll sits out.
- Close table: the seat controls disappear from the player window.

**GM tools**
- Heat = 2: the second win at one game in a night whispers the GM.
- A trigger with `to: "player"` whispers the owner (and the GM) the first time that character plays that game, never again; `to: "gm"` whispers the GM only. Pack tab shows ✔ for fired triggers; Reset progress clears them.
- Next hour whispers the hour's event to the GM.
- Soundboard pad names set: the pads play on spin, jackpot, win, loss.

**Ledger**
- Open night, play a bit, Close night: the journal page (Codex note with Planar Codex) shows the table and the log; numbers match the sheets. Copy Markdown pastes the same text. Delete removes the night from the panel but keeps the page.
- With Planar Codex: Export vault includes the ledger note.

**Chat**
- `/chips`, `/slots`, `/wheel`, `/cage buy 2`, `/cage cash 1`, `/casino` as a player with an assigned character, and as the GM with a token selected. `/cage` alone shows the usage.

## Changing things

- **New user-facing text:** add the key to `lang/en.json` and `lang/el.json`. The language test fails if they differ.
- **New pure logic:** put it in `util.mjs` with a test.
- **Pack format:** `validatePack` checks the shape the engine relies on. A breaking change bumps `PACK_SCHEMA` and needs a note in the README and the changelog.
- **Ledger:** entries are append-only; `summarizeNight` derives everything. Add a new `kind` to `KINDS` (with its sign) and to the language files.
- **Socket:** add a GM action with `handle(name, fn)` in `games.mjs` and wrap the body in `serial()`; check ownership with `gambler()` or `gmOnly()`.

## Versions

Follow [SemVer](https://semver.org/). Update `CHANGELOG.md` first, then tag. Compatibility lives in `module.json` (`minimum`, `verified`); raise `verified` only after testing on that Foundry build.
