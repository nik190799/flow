// A person's own function for the "panel" direction of the tasks app: it reads the tasks (which the
// direction offers) and keeps a count of its own under fn/panel/streak/.
import { card, label, button, end, getNum, setNum, eventId } from "../../node_modules/live-layer-protocol/sdk/assemblyscript/llp";

const MINE = "fn/panel/streak/";
export function llp_schema(): i32 { return 1; }

export function llp_view(): void {
  const n = <i32>getNum("tasks.n");
  let done = 0;
  for (let i = 0; i < n; i++) if (getNum("tasks." + i.toString() + ".done") > 0) done++;
  card();
    label("My streak: " + done.toString() + " of " + n.toString() + " done");
    label("Cheers: " + (<i32>getNum(MINE + "count")).toString());
    button("cheer", "Cheer");
  end();
}

export function llp_event(): void {
  if (eventId() == "cheer") setNum(MINE + "count", getNum(MINE + "count") + 1);
}
