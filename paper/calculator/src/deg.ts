// A person's function, asked for in words: "show me sin and cos in degrees, not radians".
// It reads the calculator's number (the direction offers calc.) and draws its own small panel.
import { card, label, button, end, getNum, setNum, eventId, fmt } from "../../../node_modules/live-layer-protocol/sdk/assemblyscript/llp";
const MINE = "fn/fx/deg/";
export function llp_schema(): i32 { return 1; }
function r6(n: f64): f64 { return Math.round(n * 1e6) / 1e6; }
export function llp_view(): void {
  const x = getNum("calc.x"), rad = x * Math.PI / 180;
  card();
    label("In degrees: x = " + fmt(r6(x)) + "°");
    label("sin " + fmt(r6(x)) + "° = " + fmt(r6(Math.sin(rad))));
    label("cos " + fmt(r6(x)) + "° = " + fmt(r6(Math.cos(rad))));
    label("Kept: " + fmt(getNum(MINE + "kept")));
    button("keep", "Keep this");
  end();
}
export function llp_event(): void { if (eventId() == "keep") setNum(MINE + "kept", getNum(MINE + "kept") + 1); }
