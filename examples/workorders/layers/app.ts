// Work orders: the company's own app. A technician sees today's jobs, ticks them off and adds one.
import { col, row, heading, label, button, input, toggle, end, getNum, setNum, getStr, setStr, eventId } from "../../../node_modules/live-layer-protocol/sdk/assemblyscript/llp";

export function llp_schema(): i32 { return 1; }
export function llp_migrate(from: i32): void {}

export function llp_view(): void {
  const n = <i32>getNum("jobs.n");
  let done = 0;
  for (let i = 0; i < n; i++) if (getNum("jobs." + i.toString() + ".done") > 0) done++;
  col();
    heading("Work orders");
    label(done.toString() + " of " + n.toString() + " finished");
    for (let i = 0; i < n; i++) {
      const k = "jobs." + i.toString();
      toggle("job:" + i.toString(), getNum(k + ".done") > 0, getStr(k + ".title") + " · " + getStr(k + ".site"));
    }
    row();
      input("draft", "Add a job", "add");
      button("add", "Add");
    end();
  end();
}

export function llp_event(): void {
  const id = eventId();
  if (id == "add") {
    const draft = getStr("draft");
    if (draft.length == 0) return;
    const n = <i32>getNum("jobs.n");
    setStr("jobs." + n.toString() + ".title", draft);
    setStr("jobs." + n.toString() + ".site", "site to be confirmed");
    setNum("jobs." + n.toString() + ".done", 0);
    setNum("jobs.n", n + 1);
    setStr("draft", "");
  } else if (id.startsWith("job:")) {
    const k = "jobs." + id.substr(4) + ".done";
    setNum(k, getNum(k) > 0 ? 0 : 1);
  }
}
