// The wheel animation: three concentric rings drawn in SVG, spun with CSS transitions.
// Shown on every client when someone spins (rpc.mjs broadcasts it).
import { MODULE_ID, WHEEL_SPIN_MS, WHEEL_HOLD_MS } from "./constants.mjs";
import { setting } from "./settings.mjs";
import { escapeHTML as esc, RINGS } from "./util.mjs";
import { t } from "./i18n.mjs";

const SIZE = 640, C = SIZE / 2;
const RADII = { outer: [214, 300], middle: [132, 210], inner: [52, 128] };
const FONT = { outer: 15, middle: 13, inner: 11 };
const PALETTE = {
  outer: ["#6b1d1d", "#1c1414"],
  middle: ["#2a2340", "#14101f"],
  inner: ["#1d3b2f", "#0f1f18"]
};
const SEG = 36; // 10 segments

const polar = (r, deg) => {
  const a = (deg - 90) * Math.PI / 180;
  return [C + r * Math.cos(a), C + r * Math.sin(a)];
};

function sector(r0, r1, a0, a1) {
  const [x0, y0] = polar(r1, a0), [x1, y1] = polar(r1, a1);
  const [x2, y2] = polar(r0, a1), [x3, y3] = polar(r0, a0);
  return `M${x0},${y0} A${r1},${r1} 0 0 1 ${x1},${y1} L${x2},${y2} A${r0},${r0} 0 0 0 ${x3},${y3} Z`;
}

const short = (s, n) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

function ringSVG(ring, labels) {
  const [r0, r1] = RADII[ring];
  const mid = (r0 + r1) / 2;
  const max = ring === "inner" ? 10 : ring === "middle" ? 13 : 16;
  const parts = labels.map((label, i) => {
    const a0 = i * SEG, a1 = (i + 1) * SEG, am = a0 + SEG / 2;
    const [tx, ty] = polar(mid, am);
    // Text reads outward along the radius.
    const rot = am - 90;
    return `<g class="seg" data-i="${i}">
      <path d="${sector(r0, r1, a0, a1)}" fill="${PALETTE[ring][i % 2]}" stroke="#c9a14e" stroke-width="1.5"/>
      <text x="${tx}" y="${ty}" transform="rotate(${rot} ${tx} ${ty})" font-size="${FONT[ring]}" text-anchor="middle" dominant-baseline="middle">${esc(short(String(label ?? ""), max))}</text>
    </g>`;
  }).join("");
  return `<g class="ring ${ring}" data-ring="${ring}" style="transform-origin:${C}px ${C}px">${parts}</g>`;
}

function overlayHTML(data) {
  const rings = RINGS.map(r => ringSVG(r, data.rings[r] ?? [])).join("");
  return `<div class="pc-wheel-box">
    <header><h2>${esc(data.title)}</h2><p>${esc(data.gambler)}</p></header>
    <svg viewBox="0 0 ${SIZE} ${SIZE}" class="pc-wheel">
      <circle cx="${C}" cy="${C}" r="306" fill="none" stroke="#c9a14e" stroke-width="6"/>
      ${rings}
      <circle cx="${C}" cy="${C}" r="46" fill="#120d08" stroke="#c9a14e" stroke-width="3"/>
      <path d="M${C - 16},4 L${C + 16},4 L${C},38 Z" fill="#f2d98a" stroke="#5a3d10" stroke-width="2" class="pointer"/>
    </svg>
    <p class="pc-wheel-result"></p>
    <p class="pc-wheel-hint">${esc(t("Wheel.ClickToClose"))}</p>
  </div>`;
}

const sleep = ms => new Promise(r => setTimeout(r, ms));
let current = null;

/** Play a spin. data: {title, gambler, rings: {outer: [labels]…}, steps: [{ring, index}], result} */
export async function playWheel(data) {
  if (!setting("wheelFx")) return;
  current?.remove();
  const el = document.createElement("div");
  el.id = `${MODULE_ID}-wheel`;
  el.className = "planar-casino-wheel";
  el.innerHTML = overlayHTML(data);
  document.body.append(el);
  current = el;
  let closed = false;
  const close = () => { if (closed) return; closed = true; el.classList.add("closing"); setTimeout(() => el.remove(), 400); if (current === el) current = null; };
  el.addEventListener("click", close);
  requestAnimationFrame(() => el.classList.add("open"));

  const angle = Object.fromEntries(RINGS.map(r => [r, 0]));
  await sleep(350);
  for (const step of data.steps) {
    if (closed) return;
    const g = el.querySelector(`.ring.${step.ring}`);
    if (!g) continue;
    el.querySelectorAll(".seg.hit").forEach(s => s.classList.remove("hit"));
    el.querySelectorAll(".ring.active").forEach(s => s.classList.remove("active"));
    g.classList.add("active");
    // Land the segment's centre under the pointer at the top, after a few full turns.
    const target = 360 - (step.index * SEG + SEG / 2);
    const base = Math.ceil(angle[step.ring] / 360) * 360 + 360 * 4;
    angle[step.ring] = base + target;
    g.style.transition = `transform ${WHEEL_SPIN_MS}ms cubic-bezier(.12,.72,.18,1)`;
    g.style.transform = `rotate(${angle[step.ring]}deg)`;
    await sleep(WHEEL_SPIN_MS + 80);
    g.querySelector(`.seg[data-i="${step.index}"]`)?.classList.add("hit");
    await sleep(520);
  }
  if (closed) return;
  const res = el.querySelector(".pc-wheel-result");
  res.textContent = data.result ?? "";
  res.classList.add("shown");
  await sleep(WHEEL_HOLD_MS);
  close();
}
