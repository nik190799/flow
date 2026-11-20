// A function whose code fails when used: the "boom" action traps.
import { card, label, button, end, eventId, setNum } from "../../node_modules/live-layer-protocol/sdk/assemblyscript/llp";

export function llp_schema(): i32 { return 1; }
export function llp_view(): void { card(); label("Fragile helper"); button("boom", "Run"); end(); }
export function llp_event(): void {
  if (eventId() == "boom") { setNum("fn/panel/crash/ran", 1); unreachable(); }
}
