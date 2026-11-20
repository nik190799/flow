// The next version of the streak function. It changes how its own data is stored (schema 2: points
// instead of a count) and overwrites the old form, so only a real undo can bring the old data back.
import { card, label, button, end, getNum, setNum, eventId } from "../../node_modules/live-layer-protocol/sdk/assemblyscript/llp";

const MINE = "fn/panel/streak/";
export function llp_schema(): i32 { return 2; }
export function llp_migrate(from: i32): void {
  if (from == 1) { setNum(MINE + "points", getNum(MINE + "count") * 10); setNum(MINE + "count", -1); }
}

export function llp_view(): void {
  card();
    label("My streak v2");
    label("Points: " + (<i32>getNum(MINE + "points")).toString());
    button("cheer", "Cheer");
  end();
}

export function llp_event(): void {
  if (eventId() == "cheer") setNum(MINE + "points", getNum(MINE + "points") + 10);
}
