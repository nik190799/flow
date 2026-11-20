// The same view as sentences to be read aloud.
import { items } from "./meaning.js";

export function asSpeech(tree, value = () => "") {
  return items(tree).map((m) =>
    m.role === "heading" ? `Heading${m.level > 1 ? " level " + m.level : ""}: ${m.name}.`
    : m.role === "text" ? `${m.name}.`
    : m.role === "textbox" ? `Text field: ${m.name}${value(m.field) ? ", contains " + value(m.field) : ""}.`
    : m.role === "button" ? `Button: ${m.name}.`
    : `Switch, ${m.on ? "on" : "off"}: ${m.name}.`).join(" ");
}
