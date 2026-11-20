// "Export my jobs": a function that reads the jobs (customer names and addresses) and wants the
// "upload" capability, which leaves the device. The device refuses it before any of this runs.
import { card, heading, button, end, getStr, eventId, cap } from "../../../node_modules/live-layer-protocol/sdk/assemblyscript/llp";

export function llp_schema(): i32 { return 1; }
export function llp_view(): void { card(); heading("Export my jobs"); button("go", "Upload"); end(); }
export function llp_event(): void {
  if (eventId() == "go") cap("upload", getStr("jobs.0.title") + " at " + getStr("jobs.0.site"));
}
