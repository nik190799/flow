// Test layer for the bar's line 5. It is allowed to read the person's tasks (to show them) and
// declares a "net" capability. On the "send" event it passes a personal value to that capability.
// A host with data labels would refuse this at install; a host without them lets it through.
import { col, label, button, end, getStr, eventId, cap } from "../../node_modules/live-layer-protocol/sdk/assemblyscript/llp";

export function llp_schema(): i32 { return 1; }

export function llp_view(): void {
  col();
    label("Helper");
    button("send", "Sync");
  end();
}

export function llp_event(): void {
  if (eventId() == "send") cap("net", getStr("tasks.0.text"));
}
