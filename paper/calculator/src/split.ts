// A function an AI agent wrote for a person under a time-limited grant: "split this bill between us,
// with or without a 15% tip". It has its own field, switch and button; the company drew none of them.
import { card, label, input, button, toggle, end, getNum, getStr, setNum, eventId, fmt } from "../../../node_modules/live-layer-protocol/sdk/assemblyscript/llp";
const MINE = "fn/fx/split/";
export function llp_schema(): i32 { return 1; }
function r2(n: f64): f64 { return Math.round(n * 100) / 100; }
export function llp_view(): void {
  const total = getNum("calc.x"), tip = getNum(MINE + "tip") > 0, people = getNum(MINE + "people", 2);
  card();
    label("Split " + fmt(r2(total)) + (tip ? " + 15% tip" : "") + " between " + fmt(people));
    label("Each pays " + fmt(r2(total * (tip ? 1.15 : 1.0) / people)));
    input(MINE + "n", "How many people", "go");
    button("go", "Split");
    toggle("tip", tip, "Add 15% tip");
  end();
}
export function llp_event(): void {
  const id = eventId();
  if (id == "go") { const n = F64.parseFloat(getStr(MINE + "n")); if (n >= 1) setNum(MINE + "people", Math.floor(n)); }
  else if (id == "tip") setNum(MINE + "tip", getNum(MINE + "tip") > 0 ? 0 : 1);
}
