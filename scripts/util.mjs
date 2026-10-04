// Pure helpers: no Foundry globals here, so every function can be unit-tested in Node.
// The casino's rules live in this file; the Foundry side only rolls dice and moves items.

export const PACK_SCHEMA = 1;
export const RINGS = ["outer", "middle", "inner"];
export const GAMES = ["slots", "wheel", "bones", "board"];

/** Ledger entry kinds and the sign they carry on a PC's razor count. */
export const KINDS = {
  buy: +1, cash: -1, gift: 0, wager: -1, win: +1, stolen: -1, adjust: 0, prize: 0
};

export function escapeHTML(value) {
  return String(value ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}

const int = (v, fallback = 0) => {
  const n = Math.floor(Number(v));
  return Number.isFinite(n) ? n : fallback;
};

/* -------------------------------------------- */
/*  Content packs                               */
/* -------------------------------------------- */

/**
 * Check a content pack. Returns a list of problems (empty = fine).
 * Only the shape the engine relies on is checked; text is free.
 */
export function validatePack(pack) {
  const errors = [];
  if (!pack || typeof pack !== "object") return ["Pack is not a JSON object."];
  if (pack.planarCasinoPack !== PACK_SCHEMA) errors.push(`"planarCasinoPack" must be ${PACK_SCHEMA}.`);
  if (!pack.id || typeof pack.id !== "string") errors.push(`"id" is required.`);
  const slots = pack.slots;
  if (!slots || !Array.isArray(slots.symbols) || slots.symbols.length !== 6) errors.push(`"slots.symbols" needs 6 entries (faces 1-6).`);
  const rings = pack.wheel?.rings;
  if (!rings) errors.push(`"wheel.rings" is required.`);
  else for (const ring of RINGS) {
    const list = rings[ring];
    if (!Array.isArray(list) || list.length !== 10) { errors.push(`"wheel.rings.${ring}" needs 10 entries (d10).`); continue; }
    list.forEach((e, i) => {
      if (e?.goto && !RINGS.includes(e.goto)) errors.push(`wheel.rings.${ring}[${i}].goto must be outer, middle or inner.`);
      if (!e?.label) errors.push(`wheel.rings.${ring}[${i}] has no label.`);
    });
  }
  for (const [i, r] of (pack.rivals ?? []).entries()) if (!r?.id || !r?.name) errors.push(`rivals[${i}] needs id and name.`);
  for (const [i, t] of (pack.triggers ?? []).entries()) {
    if (!t?.actor || !t?.text) errors.push(`triggers[${i}] needs actor and text.`);
    if (t?.game && !GAMES.includes(t.game)) errors.push(`triggers[${i}].game must be one of ${GAMES.join(", ")}.`);
  }
  return errors;
}

/** Fill the numbers a pack may leave out. */
export function packDefaults(pack) {
  return {
    razorValue: int(pack?.casino?.razorValue, 10) || 10,
    welcomeGift: int(pack?.casino?.welcomeGift, 10),
    slotsCost: int(pack?.slots?.cost, 1) || 1,
    wheelCost: int(pack?.wheel?.cost, 5) || 5,
    wheelCooldownHours: Number(pack?.wheel?.cooldownHours ?? 24),
    wheelMaxSteps: int(pack?.wheel?.maxSteps, 10) || 10,
    bonesAnte: int(pack?.bones?.ante, 1) || 1,
    dealerBones: int(pack?.bones?.dealer?.bones, 3) || 3,
    boardMultiplier: int(pack?.board?.multiplier, 5) || 5
  };
}

/* -------------------------------------------- */
/*  Slots (three d6)                            */
/* -------------------------------------------- */

/**
 * Evaluate a pull of three d6.
 * @param {number[]} faces               three numbers 1-6
 * @param {object}   slots               pack.slots
 * @param {number[]} [jackpotsWon]       faces whose jackpot was already paid out
 * @returns {{kind: "none"|"pair"|"jackpot"|"special", face?: number, symbol?: object, prize?: object, downgraded?: boolean}}
 */
export function evaluateSlots(faces, slots, jackpotsWon = []) {
  if (!Array.isArray(faces) || faces.length !== 3) throw new Error("Slots need three dice");
  const counts = new Map();
  for (const f of faces) counts.set(f, (counts.get(f) ?? 0) + 1);
  const special = slots?.special?.faces;
  if (Array.isArray(special) && special.length === 3) {
    const want = [...special].sort().join();
    if ([...faces].sort().join() === want) return { kind: "special" };
  }
  const [face, count] = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
  const symbol = slots?.symbols?.[face - 1] ?? { label: String(face) };
  if (count === 3) {
    if (jackpotsWon.includes(face)) return { kind: "pair", face, symbol, prize: symbol.pair ?? null, downgraded: true };
    return { kind: "jackpot", face, symbol, prize: symbol.jackpot ?? null };
  }
  if (count === 2) return { kind: "pair", face, symbol, prize: symbol.pair ?? null };
  return { kind: "none" };
}

/** Which dice an automatic gambler rerolls: keep the most common face, reroll the rest. Returns indexes. */
export function autoRerolls(faces) {
  const counts = new Map();
  for (const f of faces) counts.set(f, (counts.get(f) ?? 0) + 1);
  const best = Math.max(...counts.values());
  if (best === 1) {
    // Nothing matches: keep the highest-numbered die, reroll the other two.
    const keep = faces.indexOf(Math.max(...faces));
    return faces.map((_, i) => i).filter(i => i !== keep);
  }
  const keepFace = [...counts.entries()].find(([, c]) => c === best)[0];
  return faces.map((f, i) => (f === keepFace ? -1 : i)).filter(i => i >= 0);
}

/* -------------------------------------------- */
/*  Prize wheel (three d10 rings)               */
/* -------------------------------------------- */

/**
 * One step on the wheel: the entry rolled on a ring, and where to go next.
 * @returns {{ring: string, roll: number, index: number, entry: object, next: string|null}}
 */
export function wheelStep(wheel, ring, roll) {
  const list = wheel?.rings?.[ring];
  if (!list) throw new Error(`Unknown ring ${ring}`);
  const index = Math.min(Math.max(int(roll, 1), 1), list.length) - 1;
  const entry = list[index];
  return { ring, roll: index + 1, index, entry, next: entry?.goto ?? null };
}

/**
 * Resolve a whole spin. `nextRoll()` returns the next d10 (sync in tests, the Foundry side
 * pre-checks each step itself). Always starts on the outer ring.
 * Entries marked `once` that were already claimed pay nothing (`claimed: true`).
 * After `maxSteps` steps a "roll again" ends with no prize (`exhausted: true`).
 */
export function resolveWheel(wheel, nextRoll, { claimed = [], maxSteps = 10 } = {}) {
  const steps = [];
  let ring = "outer";
  while (steps.length < maxSteps) {
    const step = wheelStep(wheel, ring, nextRoll());
    steps.push(step);
    if (!step.next) {
      const key = onceKey(step);
      const already = step.entry?.once && claimed.includes(key);
      return { steps, final: step, prize: already ? null : (step.entry?.prize ?? null), claimed: !!already, onceKey: step.entry?.once ? key : null };
    }
    ring = step.next;
  }
  return { steps, final: steps.at(-1), prize: null, exhausted: true, onceKey: null };
}

export const onceKey = step => `${step.ring}:${step.roll}`;

/** Hours left before an actor may spin again (0 = free). Times in seconds of world time. */
export function cooldownRemaining(lastSpin, now, hours) {
  if (lastSpin == null || !(hours > 0)) return 0;
  const left = lastSpin + hours * 3600 - now;
  return left > 0 ? Math.ceil(left / 360) / 10 : 0; // tenths of an hour
}

/* -------------------------------------------- */
/*  Bones table (highest total, a 1 busts)      */
/* -------------------------------------------- */

/**
 * Score a round. Highest total wins; anyone who rolled a 1 loses outright.
 * @param {{id: string, dice: number[]}[]} hands
 * @returns {{scores: {id, total, bust}[], winners: string[]}}
 */
export function scoreBones(hands) {
  const scores = hands.map(h => ({
    id: h.id,
    total: h.dice.reduce((a, b) => a + b, 0),
    bust: h.dice.length === 0 || h.dice.includes(1)
  }));
  const alive = scores.filter(s => !s.bust);
  if (!alive.length) return { scores, winners: [] };
  const best = Math.max(...alive.map(s => s.total));
  return { scores, winners: alive.filter(s => s.total === best).map(s => s.id) };
}

/** Split a pot between winners. Odd chips go to the house. No winners = the house keeps it all. */
export function splitPot(pot, winners) {
  if (!winners.length) return { shares: {}, house: pot };
  const each = Math.floor(pot / winners.length);
  const shares = Object.fromEntries(winners.map(id => [id, each]));
  return { shares, house: pot - each * winners.length };
}

/* -------------------------------------------- */
/*  Number board (bet on 1-20, d20 pays)        */
/* -------------------------------------------- */

/** Keep only whole, positive chip counts on numbers 1-20. */
export function cleanBoard(bets) {
  const out = {};
  for (const [k, v] of Object.entries(bets ?? {})) {
    const n = int(k), c = int(v);
    if (n >= 1 && n <= 20 && c > 0) out[n] = (out[n] ?? 0) + c;
  }
  return out;
}

export const boardStake = bets => Object.values(cleanBoard(bets)).reduce((a, b) => a + b, 0);

/** Pay a board: the chips on the rolled number come back times `multiplier`; the rest are lost. */
export function payBoard(bets, roll, multiplier = 5) {
  const board = cleanBoard(bets);
  const stake = boardStake(board);
  const payout = (board[roll] ?? 0) * multiplier;
  return { stake, payout, net: payout - stake };
}

/* -------------------------------------------- */
/*  Rivals                                      */
/* -------------------------------------------- */

const pick = (rand, min, max) => min + Math.floor(rand() * (max - min + 1));

/** How many bones a rival shakes. `rival.bones` is a number or [min, max]. */
export function rivalBones(rival, rand = Math.random) {
  const b = rival?.bones ?? [2, 4];
  if (Array.isArray(b)) return Math.max(1, pick(rand, int(b[0], 1), int(b[1], int(b[0], 1))));
  return Math.max(1, int(b, 3));
}

/** A rival's stake at a table: at least the ante, more if their style says so. */
export const rivalStake = (rival, ante) => Math.max(int(ante, 1), int(rival?.wager, 0));

/**
 * A rival's board at the number board. Uses `favorites` first, then random numbers.
 * `rival.numbers` = how many numbers, `rival.wager` = chips per number (default 1).
 */
export function rivalBoard(rival, rand = Math.random) {
  const count = Math.min(20, Math.max(1, int(rival?.numbers, 2)));
  const chips = Math.max(1, int(rival?.wager, 1));
  const chosen = [];
  for (const f of rival?.favorites ?? []) if (chosen.length < count && f >= 1 && f <= 20 && !chosen.includes(f)) chosen.push(f);
  let guard = 0;
  while (chosen.length < count && guard++ < 200) {
    const n = pick(rand, 1, 20);
    if (!chosen.includes(n)) chosen.push(n);
  }
  return Object.fromEntries(chosen.map(n => [n, chips]));
}

/* -------------------------------------------- */
/*  Ledger                                      */
/* -------------------------------------------- */

/** Change in razors an entry makes. */
export function entryDelta(entry) {
  const sign = KINDS[entry.kind];
  if (sign === undefined) return 0;
  return sign === 0 ? int(entry.amount) : sign * Math.abs(int(entry.amount));
}

/**
 * Rows for the session log: one per PC who appears in the night.
 * `start` maps actorId -> razors held when the night opened.
 */
export function summarizeNight(night) {
  const rows = new Map();
  const row = (id, name) => {
    if (!rows.has(id)) rows.set(id, { actorId: id, name, start: int(night.start?.[id]), bought: 0, cashed: 0, wagered: 0, won: 0, other: 0, prizes: [] });
    const r = rows.get(id);
    if (name) r.name = name;
    return r;
  };
  for (const [id, n] of Object.entries(night.start ?? {})) row(id, night.names?.[id] ?? id);
  for (const e of night.entries ?? []) {
    if (!e.actorId) continue;
    const r = row(e.actorId, e.actorName);
    const a = Math.abs(int(e.amount));
    switch (e.kind) {
      case "buy": r.bought += a; break;
      case "cash": r.cashed += a; break;
      case "wager": r.wagered += a; break;
      case "win": r.won += a; break;
      case "prize": if (e.note) r.prizes.push(e.note); break;
      default: r.other += entryDelta(e);
    }
  }
  for (const r of rows.values()) {
    r.net = r.won - r.wagered;
    r.end = r.start + r.bought - r.cashed + r.net + r.other;
  }
  return [...rows.values()].sort((a, b) => a.name.localeCompare(b.name));
}

const cell = v => String(v ?? "").replace(/\|/g, "\\|").replace(/\n/g, " ");
const signed = n => (n > 0 ? `+${n}` : String(n));

/**
 * The ledger page as Markdown (Planar Codex reads this; the vault gets it on export).
 * `labels` carries the localized column names and title words.
 */
export function ledgerMarkdown(night, labels, { razorValue = 10 } = {}) {
  const rows = summarizeNight(night);
  const L = labels;
  const out = [
    "---",
    "type: reference",
    `aliases: [${JSON.stringify(night.name)}]`,
    "tags: [casino, ledger]",
    "---",
    `# ${night.name}`,
    "",
    `> ${L.intro} ${L.value.replace("{value}", razorValue)}`,
    "",
    `| ${[L.pc, L.start, L.bought, L.cashed, L.wagered, L.won, L.net, L.other, L.end, L.prizes].join(" | ")} |`,
    `|${" --- |".repeat(10)}`
  ];
  for (const r of rows) {
    out.push(`| ${[cell(r.name), r.start, r.bought, r.cashed, r.wagered, r.won, signed(r.net), signed(r.other), r.end, cell(r.prizes.join("; "))].join(" | ")} |`);
  }
  if (!rows.length) out.push(`| ${L.empty} |${" |".repeat(9)}`);
  const totalNet = rows.reduce((a, r) => a + r.net, 0);
  out.push("", `${L.houseNet}: ${signed(-totalNet)} (${signed(-totalNet * razorValue)} gp)`, "", `## ${L.log}`, "");
  for (const e of night.entries ?? []) {
    const who = e.actorName ?? e.rivalName ?? "—";
    const amt = e.kind === "prize" ? "" : ` ${signed(entryDelta(e) || int(e.amount))}`;
    out.push(`- \`${e.time ?? ""}\` **${cell(who)}** · ${L.kinds?.[e.kind] ?? e.kind}${amt}${e.game ? ` · ${L.games?.[e.game] ?? e.game}` : ""}${e.note ? ` · ${cell(e.note)}` : ""}`);
  }
  return out.join("\n") + "\n";
}

/**
 * Count wins per actor and game in a night (a razor payout or a prize each count once);
 * true when the latest win reaches the heat threshold exactly.
 */
export function heatReached(night, actorId, game, threshold) {
  if (!(threshold > 0) || !night) return false;
  const wins = (night.entries ?? []).filter(e => e.actorId === actorId && e.game === game && (e.kind === "win" || e.kind === "prize")).length;
  return wins === threshold;
}

/* -------------------------------------------- */
/*  Triggers (private whispers)                 */
/* -------------------------------------------- */

const norm = s => String(s ?? "").trim().toLocaleLowerCase();

/** Triggers that fire for this actor and game. `fired` lists ids of once-only triggers already used. */
export function matchTriggers(triggers, { actorName, game }, fired = []) {
  return (triggers ?? []).filter((t, i) => {
    const id = t.id ?? `t${i}`;
    if (t.once !== false && fired.includes(id)) return false;
    if (t.game && t.game !== game) return false;
    const a = norm(t.actor), n = norm(actorName);
    return !!a && (n === a || n.startsWith(`${a} `));
  }).map((t, i) => ({ ...t, id: t.id ?? `t${(triggers ?? []).indexOf(t)}` }));
}

/* -------------------------------------------- */
/*  Chat commands                               */
/* -------------------------------------------- */

/**
 * Parse /chips (or /razors), /slots, /wheel, /cage buy N, /cage cash N, /casino.
 * Returns null for anything else.
 */
export function parseCommand(text) {
  const m = String(text ?? "").trim().match(/^\/(chips|razors|slots|wheel|cage|casino)\b\s*(.*)$/i);
  if (!m) return null;
  const cmd = m[1].toLowerCase() === "razors" ? "chips" : m[1].toLowerCase();
  const args = m[2].trim().split(/\s+/).filter(Boolean);
  if (cmd === "cage") {
    const action = (args[0] ?? "").toLowerCase();
    const amount = int(args[1], 0);
    if (!["buy", "cash"].includes(action) || amount <= 0) return { cmd, error: "usage" };
    return { cmd, action, amount };
  }
  return { cmd };
}

/** Prize text for chat: the label with any rolled amount filled in. */
export function prizeText(prize, rolled) {
  if (!prize) return "";
  const label = prize.label ?? prize.item ?? "";
  return rolled == null ? label : label.replace(/\{n\}/g, rolled);
}

/** A short time stamp "HH:MM" from a Date. */
export const clock = date => `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
