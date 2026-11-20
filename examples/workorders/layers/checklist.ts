// "My van checklist": a technician's own function for the "side" direction. It keeps a personal
// list under its own keys and reads the jobs (which the direction offers) to count the open ones.
import { card, row, heading, label, button, input, toggle, end, getNum, setNum, getStr, setStr, eventId } from "../../../node_modules/live-layer-protocol/sdk/assemblyscript/llp";

const MINE = "fn/side/checklist/";
export function llp_schema(): i32 { return 1; }

function openJobs(): i32 {
  const n = <i32>getNum("jobs.n");
  let open = 0;
  for (let i = 0; i < n; i++) if (getNum("jobs." + i.toString() + ".done") == 0) open++;
  return open;
}

export function llp_view(): void {
  const n = <i32>getNum(MINE + "n");
  card();
    heading("My van checklist");
    label("Before leaving for " + openJobs().toString() + " open jobs");
    for (let i = 0; i < n; i++) toggle("item:" + i.toString(), getNum(MINE + i.toString() + ".ok") > 0, getStr(MINE + i.toString() + ".text"));
    row();
      input(MINE + "draft", "Add an item", "add");
      button("add", "Add item");
    end();
  end();
}

export function llp_event(): void {
  const id = eventId();
  if (id == "add") {
    const draft = getStr(MINE + "draft");
    if (draft.length == 0) return;
    const n = <i32>getNum(MINE + "n");
    setStr(MINE + n.toString() + ".text", draft);
    setNum(MINE + n.toString() + ".ok", 0);
    setNum(MINE + "n", n + 1);
    setStr(MINE + "draft", "");
  } else if (id.startsWith("item:")) {
    const k = MINE + id.substr(5) + ".ok";
    setNum(k, getNum(k) > 0 ? 0 : 1);
  }
}
