// Draws the two animated architecture figures in docs/ from a real run of the reference app.
//   npm run figures
// The SVGs animate with SMIL, so they play inside a README <img> with no script.
import { writeFileSync } from "node:fs";
import { trace } from "./trace.mjs";

const run = await trace();
const step = Object.fromEntries(run.steps.map((s) => [s.name, s]));
for (const s of run.steps) if (s.name !== "ana-export" && !s.ok) throw new Error(`${s.name} failed: ${s.code}`);
if (step["ana-export"].code !== "would_leak" || !run.leakCodeNeverFetched || !run.coreUntouchedByFunction || !run.functionKeptAcrossRelease)
  throw new Error("the run did not behave as the figures say");
if (process.argv.includes("--check")) {
  console.log(`figures: the run behaves as drawn (${run.steps.length} steps; export refused with would_leak before its code was fetched)`);
  process.exit(0);
}
const ms = (n) => `${step[n].ms.toFixed(1)} ms`;

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

// ---------- shared look ----------
const STYLE = `
  .bg{fill:#f4f3ef} .sf{fill:#fbfaf7} .ink{fill:#141414} .mu{fill:#6b6a64} .gr{fill:#1f6f4f} .rd{fill:#b3402f} .bl{fill:#2457c5}
  .bgt{fill:#f4f3ef} .blsoft{fill:#e6ecf9} .grsoft{fill:#e3efe8} .rdsoft{fill:#f6e4df}
  .st{stroke:#141414} .stm{stroke:#c9c7bf} .stg{stroke:#1f6f4f} .stb{stroke:#2457c5} .str{stroke:#b3402f}
  .hatch line{stroke:#d6d3ca}
  text{font-family:Inter,"Segoe UI",-apple-system,BlinkMacSystemFont,Helvetica,Arial,sans-serif}
  .mono{font-family:ui-monospace,"SF Mono",SFMono-Regular,Menlo,Consolas,"Liberation Mono",monospace}
  @media (prefers-color-scheme: dark){
    .bg{fill:#111210} .sf{fill:#191a17} .ink{fill:#ecebe6} .mu{fill:#9a998f} .gr{fill:#4cc38a} .rd{fill:#ef6f5a} .bl{fill:#7aa2ff}
    .bgt{fill:#111210} .blsoft{fill:#1b2540} .grsoft{fill:#15291f} .rdsoft{fill:#33201b}
    .st{stroke:#ecebe6} .stm{stroke:#3a3a35} .stg{stroke:#4cc38a} .stb{stroke:#7aa2ff} .str{stroke:#ef6f5a}
    .hatch line{stroke:#2a2a26}
  }`;

const clock = (dur) => `<rect width="0" height="0"><animate id="t" attributeName="x" from="0" to="0" dur="${dur}s" begin="0s;t.end"/></rect>`;
const at = (s) => `t.begin+${(+s).toFixed(2)}s`;
// Visible only from s for d seconds (base opacity 0), with short fades.
const show = (s, d, f = 0.25) => `<animate attributeName="opacity" values="0;1;1;0" keyTimes="0;${(f / d).toFixed(3)};${(1 - f / d).toFixed(3)};1" begin="${at(s)}" dur="${d}s"/>`;
// Dims from s for d seconds (base opacity 1).
const dim = (s, d, to = 0.28) => `<animate attributeName="opacity" values="1;${to};${to};1" keyTimes="0;.08;.92;1" begin="${at(s)}" dur="${d}s"/>`;
const hide = (s, d) => `<animate attributeName="opacity" values="1;0;0;1" keyTimes="0;.06;.94;1" begin="${at(s)}" dur="${d}s"/>`;
const ease = `calcMode="spline" keyTimes="0;1" keyPoints="0;1" keySplines=".45 0 .2 1"`;
const packet = (path, s, d, cls) => `<g opacity="0">${show(s, d + 0.15, 0.08)}<circle r="9" class="${cls}" opacity=".18"/><circle r="5" class="${cls}"/><animateMotion path="${path}" begin="${at(s)}" dur="${d}s" ${ease} fill="freeze"/></g>`;
const pulse = (x, y, s, cls) => `<circle cx="${x}" cy="${y}" r="6" fill="none" class="${cls}" stroke-width="2" opacity="0"><animate attributeName="r" values="6;22" begin="${at(s)}" dur=".9s"/><animate attributeName="opacity" values=".9;0" begin="${at(s)}" dur=".9s"/></circle>`;
const flowEdge = (path, s, d, cls) => `<path d="${path}" fill="none" class="${cls}" stroke-width="2" stroke-dasharray="5 7" opacity="0">${show(s, d)}<animate attributeName="stroke-dashoffset" from="24" to="0" dur=".7s" repeatCount="indefinite"/></path>`;
const txt = (x, y, s, cls, size, more = "") => `<text x="${x}" y="${y}" class="${cls}" font-size="${size}" ${more}>${esc(s)}</text>`;
const mono = (x, y, s, cls, size = 13, more = "") => `<text x="${x}" y="${y}" class="mono ${cls}" font-size="${size}" ${more}>${esc(s)}</text>`;
const label = (x, y, s, cls = "mu") => mono(x, y, s, cls, 11.5, `letter-spacing="2.2"`);
const hatch = (id) => `<pattern id="${id}" width="8" height="8" patternUnits="userSpaceOnUse" patternTransform="rotate(45)" class="hatch"><line x1="0" y1="0" x2="0" y2="8" stroke-width="2"/></pattern>`;
const svg = (w, h, title, desc, body, dur) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" role="img" aria-labelledby="ti de">
<title id="ti">${esc(title)}</title><desc id="de">${esc(desc)}</desc>
<style>${STYLE}</style>
<defs>${hatch("h1")}<marker id="ar" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0 L10 5 L0 10 z" class="mu"/></marker></defs>
<rect width="${w}" height="${h}" class="bg"/>
${clock(dur)}
${body}
</svg>
`;

// =====================================================================
// Figure 1: who may change a running app (the five change paths)
// =====================================================================
function changePaths() {
  const P = 5.2, N = 5, DUR = P * N;
  const o = (i) => i * P;
  const out = [];
  const W = 1200, H = 790;

  out.push(label(60, 62, "FLOW · CHANGE PATHS"));
  out.push(txt(60, 110, "Who may change a running app", "ink", 40, `font-weight="700" letter-spacing="-1"`));
  out.push(txt(60, 146, "Every change is signed. The backend carries it but can't sign it. The device checks it before it runs.", "mu", 18));

  // nodes
  const box = (x, y, w, h, lab, title, l1, l2, id = "") => `<g ${id}><rect x="${x}" y="${y}" width="${w}" height="${h}" rx="4" class="sf st" stroke-width="1.5"/>
    ${label(x + 18, y + 28, lab)}${txt(x + 18, y + 58, title, "ink", 21, `font-weight="650"`)}${txt(x + 18, y + 84, l1, "mu", 14.5)}${l2 ? txt(x + 18, y + 104, l2, "mu", 14.5) : ""}`;
  const devices = [
    { key: "ben", name: "Ben · phone", y: 188 },
    { key: "tab", name: "Ana · tablet", y: 318 },
    { key: "pho", name: "Ana · phone", y: 448 },
  ].map((d) => ({ ...d, cy: d.y + 48 }));
  const DX = 850, DW = 290, DH = 96;

  // edges (drawn first, under nodes)
  const E = {
    ob: "M290 280 H468",
    bo: "M570 218 C570 168 175 168 175 218",
    pb: "M290 500 C470 500 570 450 570 342",
    pd: "M290 535 C560 535 700 520 848 520",
    E: `M1140 ${devices[2].cy} C1188 ${devices[2].cy} 1188 ${devices[0].cy} 1140 ${devices[0].cy}`,
  };
  for (const d of devices) E["b_" + d.key] = `M670 280 C760 280 760 ${d.cy} 848 ${d.cy}`;
  const base = (p, dash = "") => `<path d="${p}" fill="none" class="stm" stroke-width="1.6" ${dash} marker-end="url(#ar)"/>`;
  out.push(`<g id="edges">${base(E.ob)}${base(E.bo, `stroke-dasharray="4 5"`)}${base(E.pb)}${base(E.pd)}${base(E.E, `stroke-dasharray="4 5"`)}${devices.map((d) => base(E["b_" + d.key])).join("")}</g>`);
  out.push(mono(379, 270, "signed release", "mu", 12, `text-anchor="middle"`));
  out.push(mono(372, 168, "owner signs to share", "mu", 12, `text-anchor="middle"`));
  out.push(mono(412, 487, "signed by Ana", "mu", 12, `text-anchor="middle"`));
  out.push(mono(600, 552, "no backend", "mu", 12, `text-anchor="middle"`));
  out.push(mono(1192, devices[1].cy, "QR · light · local", "mu", 12, `text-anchor="middle" transform="rotate(90 1192 ${devices[1].cy})"`));

  // nodes, each with its own dim schedule
  const dims = { owner: [], backend: [], person: [], ben: [], tab: [], pho: [] };
  // B: owner co-sign stamp; C: Ben untouched; D: backend & others idle; E: backend, owner idle
  dims.person.push(o(0));
  dims.ben.push(o(2)); dims.backend.push(o(3)); dims.owner.push(o(2), o(3), o(4)); dims.ben.push(o(3)); dims.tab.push(o(3));
  dims.backend.push(o(4)); dims.tab.push(o(4)); dims.person.push(o(4));
  const dimAll = (k) => dims[k].map((s) => dim(s + 0.1, P - 0.2)).join("");

  out.push(`<g>${dimAll("owner")}${box(60, 220, 230, 120, "OWNER", "Company", "holds the release key", "opens directions")}</g></g>`);
  out.push(`<g>${dimAll("backend")}${box(470, 220, 200, 120, "BACKEND", "Relay", "carries and stores", "can't sign")}</g></g>`);
  out.push(`<g>${dimAll("person")}${box(60, 450, 230, 120, "PERSON", "Ana", "signs on her device", "or grants her AI agent")}</g></g>`);

  const status = {}; // device -> [{s, d, text, cls}]
  const setStatus = (k, s, text, cls) => (status[k] ??= []).push({ s, d: P - (s % P) - 0.1, text, cls });
  for (const d of devices) {
    out.push(`<g>${dimAll(d.key)}<rect x="${DX}" y="${d.y}" width="${DW}" height="${DH}" rx="4" class="sf st" stroke-width="1.5"/>
      ${label(DX + 18, d.y + 26, "DEVICE · HOST")}${txt(DX + 18, d.y + 54, d.name, "ink", 19, `font-weight="650"`)}
      <circle cx="${DX}" cy="${d.cy}" r="5" class="sf st" stroke-width="1.5"/></g>`);
  }

  // ---------- A: owner to every device ----------
  let s = o(0);
  out.push(flowEdge(E.ob, s + 0.2, 2.2, "stg"));
  out.push(packet(E.ob, s + 0.3, 0.9, "gr"));
  for (const d of devices) { out.push(flowEdge(E["b_" + d.key], s + 1.0, 1.6, "stg"), packet(E["b_" + d.key], s + 1.2, 0.9, "gr"), pulse(DX, d.cy, s + 2.1, "stg")); setStatus(d.key, s + 2.1, `release 2 · verified · swapped`, "gr"); }

  // ---------- B: person to everyone, only if the owner signs ----------
  s = o(1);
  out.push(flowEdge(E.pb, s + 0.2, 1.2, "stb"), packet(E.pb, s + 0.3, 0.9, "bl"));
  out.push(flowEdge(E.bo, s + 1.1, 1.2, "stb"), packet(E.bo, s + 1.2, 0.9, "bl"));
  out.push(pulse(175, 218, s + 2.1, "stg"));
  out.push(`<g opacity="0">${show(s + 2.1, P - 2.2)}<rect x="196" y="232" width="84" height="22" rx="11" class="grsoft"/>${mono(238, 247, "co-signed", "gr", 11.5, `text-anchor="middle"`)}</g>`);
  out.push(flowEdge(E.ob, s + 2.3, 1.0, "stg"), packet(E.ob, s + 2.4, 0.7, "gr"));
  for (const d of devices) { out.push(flowEdge(E["b_" + d.key], s + 3.0, 1.0, "stg"), packet(E["b_" + d.key], s + 3.1, 0.8, "gr"), pulse(DX, d.cy, s + 3.9, "stg")); setStatus(d.key, s + 3.9, `Ana's function · owner-signed`, "gr"); }

  // ---------- C: person to their own devices ----------
  s = o(2);
  out.push(flowEdge(E.pb, s + 0.2, 1.2, "stb"), packet(E.pb, s + 0.3, 0.9, "bl"));
  for (const d of devices.slice(1)) { out.push(flowEdge(E["b_" + d.key], s + 1.1, 1.3, "stb"), packet(E["b_" + d.key], s + 1.2, 0.9, "bl"), pulse(DX, d.cy, s + 2.1, "stb")); setStatus(d.key, s + 2.1, `Ana's function · her key`, "bl"); }
  setStatus("ben", s + 0.6, `company app only`, "mu");

  // ---------- D: person to one device, no backend ----------
  s = o(3);
  out.push(flowEdge(E.pd, s + 0.2, 1.6, "stb"), packet(E.pd, s + 0.3, 1.2, "bl"), pulse(DX, 520, s + 1.5, "stb"));
  setStatus("pho", s + 1.5, `checklist · Ana · ${ms("ana-checklist")}`, "bl");

  // ---------- E: device to device ----------
  s = o(4);
  out.push(flowEdge(E.E, s + 0.2, 1.6, "stb"), packet(E.E, s + 0.3, 1.2, "bl"), pulse(1140, devices[0].cy, s + 1.5, "stb"));
  setStatus("pho", s + 0.2, `checklist · Ana`, "bl");
  setStatus("ben", s + 1.5, `bundle verified · offline`, "bl");

  // device status lines
  for (const d of devices) {
    const list = status[d.key] ?? [];
    out.push(`<g>${list.map((x) => hide(x.s, x.d)).join("")}${mono(DX + 18, d.y + 78, "company app · running", "mu", 13)}</g>`);
    for (const x of list) out.push(`<g opacity="0">${show(x.s, x.d)}${mono(DX + 18, d.y + 78, x.text, x.cls, 13)}</g>`);
  }

  // captions
  out.push(`<line x1="60" y1="618" x2="1140" y2="618" class="stm" stroke-width="1"/>`);
  const caps = [
    ["A", "Owner to every device", "The company signs a release under its keyring. Each host checks the signatures and swaps the code in place, state kept.", "BUILT · A1", "gr"],
    ["B", "A person to everyone, only if the owner signs", "Ana's function reaches every device once the company signs it. The backend can carry it but can't approve it.", "DESIGNED", "mu"],
    ["C", "A person to their own devices", "Ana's function follows her to her phone and tablet through the backend. Ben still has the company's app.", "DESIGNED", "mu"],
    ["D", "A person to one device, no backend", `Ana signs a function on her phone. The host checks it against the open directions and runs it in ${ms("ana-checklist")}. The company's code doesn't restart.`, "BUILT · B1", "bl"],
    ["E", "Device to device, no backend", "A signed bundle passes between devices by QR code, light or local network and is checked exactly as if it came online.", "PARTLY BUILT", "mu"],
  ];
  caps.forEach(([k, head, body, tag, cls], i) => {
    const x = 60 + i * 52;
    out.push(`<rect x="${x}" y="642" width="40" height="40" rx="20" fill="none" class="stm" stroke-width="1.5"/>${mono(x + 20, 668, k, "mu", 16, `text-anchor="middle" font-weight="600"`)}`);
    out.push(`<g opacity="0">${show(o(i), P, 0.2)}<rect x="${x}" y="642" width="40" height="40" rx="20" class="ink"/>${mono(x + 20, 668, k, "bgt", 16, `text-anchor="middle" font-weight="700"`)}</g>`);
    // progress bar under the active pill
    out.push(`<rect x="${x + 4}" y="690" width="0" height="2" class="ink"><animate attributeName="width" values="0;32" begin="${at(o(i))}" dur="${P}s"/></rect>`);
    out.push(`<g opacity="0">${show(o(i), P, 0.3)}
      ${txt(340, 660, head, "ink", 22, `font-weight="650"`)}
      ${wrap(body, 92).map((l, j) => txt(340, 690 + j * 24, l, "mu", 16)).join("")}
      <rect x="${1140 - tag.length * 8.6 - 26}" y="642" width="${tag.length * 8.6 + 26}" height="26" rx="13" fill="none" class="${cls === "mu" ? "stm" : cls === "gr" ? "stg" : "stb"}" stroke-width="1.5" ${cls === "mu" ? `stroke-dasharray="3 3"` : ""}/>
      ${mono(1140 - 13, 660, tag, cls, 12, `text-anchor="end" letter-spacing="1"`)}</g>`);
  });
  out.push(mono(60, 765, "Built paths are measured in a run of the reference app on the real host (npm run figures). Designed paths are specified, not built.", "mu", 12));

  return svg(W, H, "FLOW change paths", "How a change reaches a running FLOW app: A, the owner to every device; B, a person to everyone only if the owner signs; C, a person to their own devices; D, a person to one device with no backend; E, device to device with no backend. A and D are built; B and C are designed; E is partly built.", out.join("\n"), DUR);
}

function wrap(s, n) {
  const words = s.split(" "), lines = [""];
  for (const w of words) { if ((lines.at(-1) + " " + w).trim().length > n) lines.push(w); else lines[lines.length - 1] = (lines.at(-1) + " " + w).trim(); }
  return lines;
}

// =====================================================================
// Figure 2: inside the device (directions, checks, swap, undo)
// =====================================================================
function insideDevice() {
  const P = 4.6, N = 5, DUR = P * N;
  const o = (i) => i * P;
  const out = [];
  const W = 1200, H = 900;

  out.push(label(60, 62, "FLOW · INSIDE THE DEVICE"));
  out.push(txt(60, 110, "The company's app, with people's functions in it", "ink", 40, `font-weight="700" letter-spacing="-1"`));
  out.push(txt(60, 146, "The release opens directions. A function runs there only if it fits, and the company's code never restarts.", "mu", 18));

  // ---- release card (left) ----
  const RX = 40, RY = 190, RW = 280;
  out.push(`<rect x="${RX}" y="${RY}" width="${RW}" height="404" rx="4" class="sf st" stroke-width="1.5"/>`);
  out.push(label(RX + 18, RY + 30, "RELEASE"));
  out.push(`<rect x="${RX + 18}" y="${RY + 44}" width="186" height="24" rx="12" class="grsoft"/>${mono(RX + 30, RY + 61, "signed · company key", "gr", 12)}`);
  const rl = [
    ["app", "example.workorders", "ink"], ["core", "main", "ink"], ["", "", ""],
    ["data", "jobs.|personal", "ink"], ["", "draft|personal", "ink"], ["", "", ""],
    ["caps", "upload|leaves", "ink"], ["", "haptic|stays", "ink"], ["", "", ""],
    ["open", "side", "bl"], ["  read", "jobs.", "ink"], ["  caps", "upload haptic", "ink"], ["  egress", "public only", "ink"], ["  max", "4", "ink"],
  ];
  rl.forEach(([k, v, c], i) => { const y = RY + 100 + i * 21; if (k) out.push(mono(RX + 18, y, k, "mu", 13)); if (v) { const [a, b] = v.split("|"); out.push(mono(RX + 96, y, a, c, 13)); if (b) out.push(mono(RX + 166, y, b, b === "personal" || b === "leaves" ? "rd" : "mu", 13)); } });

  // ---- device (center) ----
  const DX = 350, DY = 180, DW = 512, DH = 430;
  out.push(`<rect x="${DX}" y="${DY}" width="${DW}" height="${DH}" rx="6" fill="none" class="st" stroke-width="1.4" stroke-dasharray="6 5"/>`);
  out.push(`<rect x="${DX + 16}" y="${DY - 9}" width="220" height="18" class="bg"/>${label(DX + 24, DY + 4, "DEVICE · FLOW HOST", "ink")}`);

  // core slot with a little screen
  const CX = DX + 24, CY = DY + 30, CW = DW - 48, CH = 150;
  out.push(`<rect x="${CX}" y="${CY}" width="${CW}" height="${CH}" rx="6" class="sf st" stroke-width="1.5"/>`);
  out.push(label(CX + 16, CY + 24, "CORE · main · company"));
  const ver = (v, cls) => `<rect x="${CX + CW - 56}" y="${CY + 10}" width="40" height="22" rx="11" class="${cls === "gr" ? "grsoft" : "sf"}"/>${mono(CX + CW - 36, CY + 25, v, cls, 12, `text-anchor="middle" font-weight="600"`)}`;
  const tRel = o(3) + 1.2; // release 2 lands
  out.push(`<g>${hide(tRel, DUR - tRel)}${ver("v1", "mu")}</g><g opacity="0">${show(tRel, DUR - tRel, 0.05)}${ver("v2", "gr")}</g>`);
  out.push(txt(CX + 16, CY + 54, "Work orders", "ink", 18, `font-weight="650"`));
  out.push(`<g>${hide(tRel, DUR - tRel)}${txt(CX + 16, CY + 74, "0 of 3 finished today", "mu", 13)}</g>`);
  out.push(`<g opacity="0">${show(tRel, DUR - tRel, 0.05)}${txt(CX + 16, CY + 74, "Updated layout: open jobs first", "gr", 13)}</g>`);
  const jobs = [["Replace intake filter", "Unit 4"], ["Boiler service", "12 Mill Lane"], ["Check pressure valve", "Dock 2"]];
  jobs.forEach(([j, site], i) => { const y = CY + 96 + i * 18; out.push(`<rect x="${CX + 16}" y="${y - 10}" width="11" height="11" rx="2" fill="none" class="stm" stroke-width="1.4"/>${txt(CX + 34, y, j, "ink", 13)}${txt(CX + 200, y, site, "mu", 13)}`); });
  // swap flash on the core
  out.push(`<rect x="${CX}" y="${CY}" width="${CW}" height="${CH}" rx="6" fill="none" class="stg" stroke-width="3" opacity="0"><animate attributeName="opacity" values="0;1;0" begin="${at(tRel)}" dur="1.2s"/></rect>`);

  // direction lane
  const LY = CY + CH + 40;
  out.push(label(CX, LY - 12, "DIRECTION · side · opened by the release", "bl"));
  const SW = (CW - 3 * 12) / 4, SH = 92;
  const sockets = [0, 1, 2, 3].map((i) => ({ x: CX + i * (SW + 12), y: LY }));
  for (const k of sockets) out.push(`<rect x="${k.x}" y="${k.y}" width="${SW}" height="${SH}" rx="6" fill="none" class="stb" stroke-width="1.3" stroke-dasharray="4 4" opacity=".55"/>`);
  const fnCard = (k, title, who, v, extra = "") => `<rect x="${k.x}" y="${k.y}" width="${SW}" height="${SH}" rx="6" class="blsoft stb" stroke-width="1.5"/>
    ${txt(k.x + 12, k.y + 26, title, "ink", 15, `font-weight="650"`)}${mono(k.x + 12, k.y + 48, who, "bl", 11.5)}${extra}${v}`;
  const vchip = (k, v) => mono(k.x + SW - 12, k.y + 26, v, "mu", 12, `text-anchor="end"`);
  const t1 = o(0) + 2.7, t2 = o(1) + 2.9;
  // socket 1: checklist (v1, then v2 in step 5, then undo back to v1)
  const tV2 = o(4) + 0.4, tUndo = o(4) + 2.2;
  out.push(`<g opacity="0">${show(t1, tV2 - t1, 0.08)}${fnCard(sockets[0], "checklist", "Ana", vchip(sockets[0], "v1"), mono(sockets[0].x + 12, sockets[0].y + 72, "running", "mu", 11.5))}</g>`);
  out.push(`<g opacity="0">${show(tV2, tUndo - tV2, 0.05)}${fnCard(sockets[0], "checklist", "Ana", vchip(sockets[0], "v2"), mono(sockets[0].x + 12, sockets[0].y + 72, "new format", "mu", 11.5))}</g>`);
  out.push(`<g opacity="0">${show(tUndo, DUR - tUndo, 0.05)}${fnCard(sockets[0], "checklist", "Ana", vchip(sockets[0], "v1"), mono(sockets[0].x + 12, sockets[0].y + 72, "data back", "gr", 11.5))}</g>`);
  out.push(`<g opacity="0">${show(t2, DUR - t2, 0.08)}${fnCard(sockets[1], "next-up", "agent · Ana", vchip(sockets[1], "v1"), mono(sockets[1].x + 12, sockets[1].y + 72, "grant", "mu", 11.5))}</g>`);
  out.push(mono(sockets[2].x + SW / 2, LY + 52, "open", "mu", 12, `text-anchor="middle" opacity=".7"`), mono(sockets[3].x + SW / 2, LY + 52, "open", "mu", 12, `text-anchor="middle" opacity=".7"`));
  // kept-running pulse on both functions when release 2 lands
  for (const k of sockets.slice(0, 2)) out.push(`<rect x="${k.x}" y="${k.y}" width="${SW}" height="${SH}" rx="6" fill="none" class="stb" stroke-width="3" opacity="0"><animate attributeName="opacity" values="0;.9;0" begin="${at(tRel + 0.3)}" dur="1.2s"/></rect>`);
  // undo button press
  out.push(`<g opacity="0">${show(tV2 + 0.6, tUndo - tV2 - 0.4, 0.1)}<rect x="${sockets[0].x + 12}" y="${sockets[0].y + SH + 8}" width="64" height="24" rx="12" class="ink"/>${mono(sockets[0].x + 44, sockets[0].y + SH + 24, "Undo", "bgt", 12, `text-anchor="middle" font-weight="600"`)}</g>`);

  // state store
  const SY = LY + SH + 44;
  out.push(`<rect x="${CX}" y="${SY}" width="${CW}" height="38" rx="4" fill="url(#h1)" class="stm" stroke-width="1.2"/>`);
  out.push(`<rect x="${CX + 10}" y="${SY + 8}" width="${CW - 20}" height="22" class="sf" opacity=".92"/>`);
  out.push(mono(CX + 18, SY + 24, "state outlives every swap · jobs.* · fn/side/checklist/*", "mu", 11.5));

  // gate on the right edge of the device
  const GX = DX + DW, GY = LY + SH / 2;
  out.push(`<line x1="${GX}" y1="${LY - 6}" x2="${GX}" y2="${LY + SH + 6}" class="st" stroke-width="4"/>`);

  // ---- incoming + checks (right) ----
  const IX = 890, IW = 270;
  out.push(label(IX, 202, "ARRIVING"));
  const doc = (title, signer, reads, caps, cls) => `<rect x="${IX}" y="214" width="${IW}" height="96" rx="4" class="sf st" stroke-width="1.5"/>
    ${mono(IX + 16, 238, "flow/function", "mu", 11.5)}${txt(IX + 16, 262, title, "ink", 18, `font-weight="650"`)}
    ${mono(IX + 16, 284, signer, cls, 12)}${mono(IX + 16, 301, `reads ${reads} · caps ${caps}`, "mu", 12)}`;
  const docs = [
    [o(0), doc("checklist", "signed by Ana", "jobs.", "none", "bl")],
    [o(1), doc("next-up", "agent key + Ana's grant", "jobs.", "none", "bl")],
    [o(2), doc("export", "signed by Ana", "jobs.", "upload", "bl")],
    [o(3), `<rect x="${IX}" y="214" width="${IW}" height="96" rx="4" class="sf st" stroke-width="1.5"/>${mono(IX + 16, 238, "flow/release", "mu", 11.5)}${txt(IX + 16, 262, "Release 2", "ink", 18, `font-weight="650"`)}${mono(IX + 16, 284, "signed · company key", "gr", 12)}${mono(IX + 16, 301, "swaps main · same directions", "mu", 12)}`],
    [o(4), `<rect x="${IX}" y="214" width="${IW}" height="96" rx="4" class="sf st" stroke-width="1.5"/>${mono(IX + 16, 238, "on the device", "mu", 11.5)}${txt(IX + 16, 262, "Ana: v2, then Undo", "ink", 18, `font-weight="650"`)}${mono(IX + 16, 284, "no signature, no network", "bl", 12)}${mono(IX + 16, 301, "a local act by the person", "mu", 12)}`],
  ];
  for (const [s, d] of docs) out.push(`<g opacity="0">${show(s, P, 0.2)}${d}</g>`);

  const checks = [["signer", "person or grant"], ["app", "example.workorders"], ["direction", "side is open"], ["within", "inside direction"], ["leak", "egress ≤ public"], ["consent", "not needed"], ["seq", "higher than before"], ["room", "fewer than 4"]];
  const KY = 350;
  out.push(label(IX, KY - 14, "CHECKED BEFORE ANY CODE RUNS"));
  checks.forEach(([k, v], i) => { const y = KY + 10 + i * 26; out.push(mono(IX, y, k, "mu", 13), mono(IX + 88, y, v, "ink", 12.5, `opacity=".9"`)); });
  const tick = (i, s, d, ok) => { const y = KY + 10 + i * 26; const x = IX + IW - 6; return `<g opacity="0">${show(s, d, 0.06)}${ok ? `<path d="M${x - 12} ${y - 5} l4 4 l8 -9" fill="none" class="stg" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>` : `<path d="M${x - 11} ${y - 10} l9 9 M${x - 2} ${y - 10} l-9 9" fill="none" class="str" stroke-width="2.2" stroke-linecap="round"/>`}</g>`; };
  const runChecks = (s, failAt = -1) => { const r = []; for (let i = 0; i < checks.length; i++) { const ts = s + i * 0.17; if (failAt >= 0 && i > failAt) break; r.push(tick(i, ts, P - (ts - Math.floor(ts / P) * P) - 0.1, i !== failAt)); } return r.join(""); };
  out.push(runChecks(o(0) + 0.7), runChecks(o(1) + 0.7), runChecks(o(2) + 0.7, 4));
  // refusal note
  const leak = step["ana-export"];
  out.push(`<g opacity="0">${show(o(2) + 1.6, P - 1.7)}    <rect x="${IX - 10}" y="${KY + 222}" width="${IW + 20}" height="64" rx="4" class="rdsoft"/>
    ${mono(IX + 4, KY + 244, `refused: ${leak.code}`, "rd", 13, `font-weight="600"`)}
    ${wrap("personal data could leave through upload; side lets only public data out. Its code was never fetched.", 40).map((l, j) => mono(IX + 4, KY + 262 + j * 16, l, "rd", 11)).join("")}</g>`);
  // accept notes
  out.push(`<g opacity="0">${show(o(0) + 2.3, P - 2.4)}${mono(IX, KY + 236, `installed in ${ms("ana-checklist")}`, "gr", 13, `font-weight="600"`)}${mono(IX, KY + 256, "company code not restarted", "mu", 12)}</g>`);
  out.push(`<g opacity="0">${show(o(1) + 2.3, P - 2.4)}${mono(IX, KY + 236, `installed in ${ms("agent-next-up")}`, "gr", 13, `font-weight="600"`)}${mono(IX, KY + 256, "Ana is on record as answering for it", "mu", 12)}</g>`);
  out.push(`<g opacity="0">${show(tRel, P - 1.3)}${mono(IX, KY + 236, `swapped main in ${ms("release-2")}`, "gr", 13, `font-weight="600"`)}${mono(IX, KY + 256, "both functions kept running", "mu", 12)}</g>`);
  out.push(`<g opacity="0">${show(tUndo, P - 2.3)}${mono(IX, KY + 236, `undone in ${ms("ana-undo")}`, "gr", 13, `font-weight="600"`)}${mono(IX, KY + 256, "old code and old data back", "mu", 12)}</g>`);
  // cover the checks list during steps 4 and 5 (they don't apply)
  out.push(`<g opacity="0">${show(o(3), 2 * P, 0.15)}<rect x="${IX - 4}" y="${KY - 30}" width="${IW + 10}" height="236" class="bg"/>${label(IX, KY - 14, "NO PERSON CHECKS NEEDED")}${wrap("Releases are checked against the keyring. Undo is the person's own act on their device. Each installed function is checked again against the new release; one that no longer fits is paused with its data kept.", 38).map((l, j) => txt(IX, KY + 14 + j * 21, l, "mu", 14)).join("")}</g>`);

  // movement: docs into the gate / sockets; release into the core
  const toGate = `M${IX} 262 C${IX - 20} 262 ${GX + 30} ${GY} ${GX} ${GY}`;
  out.push(packet(toGate, o(0) + 2.0, 0.6, "bl"), packet(toGate, o(1) + 2.2, 0.6, "bl"));
  out.push(pulse(GX, GY, o(0) + 2.6, "stb"), pulse(GX, GY, o(1) + 2.8, "stb"));
  // refused: bounce back
  out.push(`<g opacity="0">${show(o(2) + 1.7, 1.1, 0.1)}<circle r="5" class="rd"/><animateMotion path="M${GX + 6} ${GY} C${GX + 20} ${GY} ${IX - 20} 262 ${IX} 262" keyPoints="0;.5;0" keyTimes="0;.5;1" calcMode="linear" begin="${at(o(2) + 1.7)}" dur="1s" fill="freeze"/></g>`);
  out.push(pulse(GX, GY, o(2) + 2.0, "str"));
  const relPath = `M${RX + RW} ${RY + 60} C${RX + RW + 40} ${RY + 60} ${CX - 40} ${CY + 60} ${CX} ${CY + 60}`;
  out.push(flowEdge(relPath, o(3) + 0.2, 1.4, "stg"), packet(relPath, o(3) + 0.3, 0.9, "gr"));

  // ---- step caption under the device ----
  const steps = [
    "1  Ana adds her own function to the open direction",
    "2  Her AI agent adds one under a 10-minute grant from her",
    "3  A function that could carry personal data out is refused",
    "4  The company ships release 2 while the app is open",
    "5  Ana updates her function, then undoes it on the device",
  ];
  steps.forEach((s, i) => out.push(`<g opacity="0">${show(o(i), P, 0.25)}${txt(DX, 642, s, "ink", 17, `font-weight="600"`)}</g>`));
  for (let i = 0; i < N; i++) out.push(`<rect x="${DX + i * 22}" y="654" width="16" height="3" rx="1.5" class="stm" fill="currentColor" opacity=".35"/><rect x="${DX + i * 22}" y="654" width="16" height="3" rx="1.5" class="ink" opacity="0">${show(o(i), P, 0.1)}</rect>`);

  // ---- one function, four surfaces (static, from the presenters' real output) ----
  const sf = run.surfaces["fn.side.checklist"];
  const BY = 700;
  out.push(`<line x1="40" y1="${BY - 14}" x2="1160" y2="${BY - 14}" class="stm" stroke-width="1"/>`);
  out.push(label(40, BY + 12, "ONE FUNCTION, FOUR SURFACES · real presenter output for Ana's checklist"));
  const cw = 266, gap = 18, cy = BY + 28, ch = 160;
  const card = (i, head) => `<rect x="${40 + i * (cw + gap)}" y="${cy}" width="${cw}" height="${ch}" rx="4" class="sf stm" stroke-width="1.2"/>${label(40 + i * (cw + gap) + 14, cy + 24, head)}`;
  // screen
  let x = 40;
  out.push(card(0, "SCREEN"), txt(x + 14, cy + 54, "My van checklist", "ink", 16, `font-weight="650"`), txt(x + 14, cy + 76, "Before leaving for 3 open jobs", "mu", 13),
    `<rect x="${x + 14}" y="${cy + 92}" width="160" height="30" rx="6" fill="none" class="stm" stroke-width="1.3"/>`, txt(x + 24, cy + 112, "Add an item", "mu", 13),
    `<rect x="${x + 182}" y="${cy + 92}" width="70" height="30" rx="6" class="ink"/>`, txt(x + 217, cy + 112, "Add item", "bgt", 12.5, `text-anchor="middle" font-weight="600"`));
  // text
  x = 40 + (cw + gap);
  out.push(card(1, "TERMINAL"), ...sf.text.split("\n").map((l, j) => mono(x + 14, cy + 54 + j * 20, l, "ink", 12.5)));
  // speech
  x = 40 + 2 * (cw + gap);
  out.push(card(2, "SPEECH"), ...wrap(`“${sf.speech}”`, 34).map((l, j) => txt(x + 14, cy + 54 + j * 20, l, "ink", 13.5, `font-style="italic"`)));
  // tools
  x = 40 + 3 * (cw + gap);
  const tl = sf.tools[0];
  out.push(card(3, "AI AGENT TOOLS"), mono(x + 14, cy + 54, `${tl.action}(`, "ink", 12.5), mono(x + 28, cy + 74, `${tl.fields[0].field.split("/").pop()}: "${tl.fields[0].hint}"`, "bl", 12.5), mono(x + 14, cy + 94, ")", "ink", 12.5),
    txt(x + 14, cy + 124, "The agent can do what the", "mu", 13), txt(x + 14, cy + 142, "person can by hand. No more.", "mu", 13));

  return svg(W, H, "Inside a FLOW device", "A FLOW host runs the company's core and people's functions in the directions the release opened. Ana's function and her agent's function pass every check and install without restarting the company's code; a function that could leak personal data is refused before its code is fetched; a company release swaps the core while the functions keep running; Ana undoes her own update on the device and gets her old data back. Below, the same function drawn on a screen, as terminal text, as speech and as AI agent tools.", out.join("\n"), DUR);
}

writeFileSync(new URL("../flow-change-paths.svg", import.meta.url), changePaths());
writeFileSync(new URL("../flow-inside-device.svg", import.meta.url), insideDevice());
writeFileSync(new URL("./run.json", import.meta.url), JSON.stringify({ steps: run.steps, coreUntouchedByFunction: run.coreUntouchedByFunction, leakCodeNeverFetched: run.leakCodeNeverFetched, functionKeptAcrossRelease: run.functionKeptAcrossRelease }, null, 2) + "\n");
console.log("wrote docs/flow-change-paths.svg, docs/flow-inside-device.svg, docs/figures/run.json");
for (const s of run.steps) console.log(`  ${s.name.padEnd(18)} ${s.ok ? "ok" : s.code}  ${s.ms} ms`);
