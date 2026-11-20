// "Next up": a function an AI agent wrote for the technician, under a ten-minute grant. It reads
// the jobs and shows the first one still open. It stores nothing and uses no capability.
import { card, heading, label, end, getNum, getStr } from "../../../node_modules/live-layer-protocol/sdk/assemblyscript/llp";

export function llp_schema(): i32 { return 1; }
export function llp_view(): void {
  const n = <i32>getNum("jobs.n");
  let open = 0, first = -1;
  for (let i = 0; i < n; i++) if (getNum("jobs." + i.toString() + ".done") == 0) { open++; if (first < 0) first = i; }
  card();
    heading("Next up");
    if (first < 0) label("Everything is finished.");
    else { label(getStr("jobs." + first.toString() + ".title")); label(getStr("jobs." + first.toString() + ".site") + " · " + (open - 1).toString() + " more after this"); }
  end();
}
export function llp_event(): void {}
