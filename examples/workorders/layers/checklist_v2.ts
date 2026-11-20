// The checklist's next version. It stores items in a new form (schema 2: one line of text per item,
// "+" or "-" in front) and clears the old keys, so only a real undo brings the old list back.
import { card, row, heading, label, button, input, toggle, end, getNum, setNum, getStr, setStr, eventId } from "../../../node_modules/live-layer-protocol/sdk/assemblyscript/llp";

const MINE = "fn/side/checklist/";
export function llp_schema(): i32 { return 2; }
export function llp_migrate(from: i32): void {
  if (from != 1) return;
  const n = <i32>getNum(MINE + "n");
  for (let i = 0; i < n; i++) {
    setStr(MINE + "line." + i.toString(), (getNum(MINE + i.toString() + ".ok") > 0 ? "+" : "-") + getStr(MINE + i.toString() + ".text"));
    setStr(MINE + i.toString() + ".text", "");
    setNum(MINE + i.toString() + ".ok", 0);
  }
}

export function llp_view(): void {
  const n = <i32>getNum(MINE + "n");
  let ready = 0;
  for (let i = 0; i < n; i++) if (getStr(MINE + "line." + i.toString()).startsWith("+")) ready++;
  card();
    heading("My van checklist");
    label(ready.toString() + " of " + n.toString() + " packed");
    for (let i = 0; i < n; i++) { const l = getStr(MINE + "line." + i.toString()); toggle("item:" + i.toString(), l.startsWith("+"), l.substr(1)); }
    row();
      input(MINE + "draft", "Add an item", "add");
      button("add", "Add item");
      button("reset", "Untick all");
    end();
  end();
}

export function llp_event(): void {
  const id = eventId();
  const n = <i32>getNum(MINE + "n");
  if (id == "add") {
    const draft = getStr(MINE + "draft");
    if (draft.length == 0) return;
    setStr(MINE + "line." + n.toString(), "-" + draft);
    setNum(MINE + "n", n + 1);
    setStr(MINE + "draft", "");
  } else if (id.startsWith("item:")) {
    const k = MINE + "line." + id.substr(5), l = getStr(k);
    setStr(k, (l.startsWith("+") ? "-" : "+") + l.substr(1));
  } else if (id == "reset") {
    for (let i = 0; i < n; i++) { const k = MINE + "line." + i.toString(); setStr(k, "-" + getStr(k).substr(1)); }
  }
}
