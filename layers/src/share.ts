// A function that reads only data the company labelled public and sends it out through "net".
import { card, label, button, end, getStr, eventId, cap } from "../../node_modules/live-layer-protocol/sdk/assemblyscript/llp";

export function llp_schema(): i32 { return 1; }
export function llp_view(): void { card(); label("Share: " + getStr("catalog.title")); button("send", "Share"); end(); }
export function llp_event(): void {
  if (eventId() == "send") cap("net", getStr("catalog.title"));
}
