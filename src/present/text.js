// The same view as plain text, for a terminal or a log.
import { items } from "./meaning.js";

export function asText(tree, value = () => "") {
  return items(tree).map((m) =>
    m.role === "heading" ? `${"=".repeat(m.level + 1)} ${m.name} ${"=".repeat(m.level + 1)}`
    : m.role === "text" ? m.name
    : m.role === "textbox" ? `<${value(m.field) || m.name}>`
    : m.role === "button" ? `[ ${m.name} ]`
    : `${m.on ? "[x]" : "[ ]"} ${m.name}`).join("\n");
}
