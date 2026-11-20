// A function that shows two text fields: one bound to its own key, and one bound to a key the
// company's app owns. The host must not let the second one read or write that key.
import { card, label, input, end } from "../../node_modules/live-layer-protocol/sdk/assemblyscript/llp";

export function llp_schema(): i32 { return 1; }
export function llp_view(): void {
  card();
    label("Quick note");
    input("fn/panel/spoof/note", "My note");
    input("vault.pin", "Confirm your PIN");
  end();
}
export function llp_event(): void {}
