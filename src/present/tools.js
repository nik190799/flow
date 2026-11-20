// The same view as a list of actions an AI agent may call. An agent gets exactly the actions a person
// has on screen, no more: each button and switch is one tool, and a text field that submits to a
// button becomes that tool's input.
import { items } from "./meaning.js";

export function asTools(slot, tree) {
  const all = items(tree), fields = all.filter((m) => m.role === "textbox");
  return all.filter((m) => m.role === "button" || m.role === "switch").map((m) => ({
    slot, action: m.action,
    description: m.role === "button" ? m.name : `Turn "${m.name}" ${m.on ? "off" : "on"}`,
    fields: fields.filter((f) => f.submit === m.action).map((f) => ({ field: f.field, hint: f.name })),
  }));
}
