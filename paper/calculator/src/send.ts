// A function that would send the person's numbers to a server. The calculator's direction offers no
// way out, so the device refuses it before any of its code runs.
import { card, button, end, getNum, cap, eventId, fmt } from "../../../node_modules/live-layer-protocol/sdk/assemblyscript/llp";
export function llp_schema(): i32 { return 1; }
export function llp_view(): void { card(); button("send", "Back up my numbers"); end(); }
export function llp_event(): void { if (eventId() == "send") cap("net", fmt(getNum("calc.x"))); }
