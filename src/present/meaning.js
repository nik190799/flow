// What each element of a view MEANS, fixed by the spec (SPEC-B1.md, "Elements"), so that every
// presenter (a screen, a terminal, a voice, an AI agent) agrees on it without knowing the app.
//
// A layer's view is a tree of nodes { k: kind, a: attributes, c: children } and text nodes
// { k: "text", t }. A kind has one role; a role has a name, sometimes a state and an action.
//
//   kind             role      name                 state / action
//   col, row, card   group     (none)               children, in order
//   heading          heading   its text             level: attribute "level" 1-6, default 1
//   label, big       text      its text             big is emphasised
//   input            textbox   attribute placeholder  value: the state key in "bind"; "submit" names the action Enter performs
//   button           button    its text             action: attribute "id"
//   toggle           switch    its text             on: attribute "on" is "1"; action: attribute "id"
//   anything else    group     (none)               children, in order (a newer kind still shows its contents)
const ROLE = { col: "group", row: "group", card: "group", heading: "heading", label: "text", big: "text", input: "textbox", button: "button", toggle: "switch" };

export const textOf = (n) => !n ? "" : n.k === "text" ? n.t : (n.c || []).map(textOf).join(" ");

export function meaning(n) {
  const a = n.a ?? {}, role = ROLE[n.k] ?? "group";
  if (role === "heading") { const l = Number(a.level); return { role, name: textOf(n), level: Number.isInteger(l) && l >= 1 && l <= 6 ? l : 1 }; }
  if (role === "text") return { role, name: textOf(n), strong: n.k === "big" };
  if (role === "textbox") return { role, name: a.placeholder ?? "", field: a.bind ?? "", submit: a.submit || null };
  if (role === "button") return { role, name: textOf(n), action: a.id ?? "" };
  if (role === "switch") return { role, name: textOf(n), on: a.on === "1", action: a.id ?? "" };
  return { role: "group", layout: ROLE[n.k] ? n.k : "col" };
}

// Every meaningful element of a tree, in reading order, as { ...meaning, depth }.
export function items(tree, out = [], depth = 0) {
  if (!tree || tree.k === "text") return out;
  const m = meaning(tree);
  if (m.role === "group") for (const c of tree.c || []) items(c, out, depth + 1);
  else out.push({ ...m, depth });
  return out;
}
