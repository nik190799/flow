// The same view as a web page. present(host, root) keeps `root` showing what the host renders.
//
// The page is patched in place, never rebuilt: an element that is still wanted is kept as the same
// DOM node. So a swap of the running code doesn't disturb the field the person is typing in: its
// text, focus, caret, selection and any half-composed character stay exactly as they were.
// What the person typed is read from host.bound(), which is ahead of stored state while a swap is in flight.
import { meaning } from "./meaning.js";

const TAG = { heading: (m) => "h" + m.level, text: () => "p", textbox: () => "input", button: () => "button", switch: () => "button", group: () => "div" };

function want(slot, n) {
  if (n.k === "text") return { key: "#text", text: n.t };
  const m = meaning(n);
  const key = m.role === "textbox" ? `textbox:${m.field}` : m.role === "button" || m.role === "switch" ? `${m.role}:${m.action}` : m.role === "group" ? `group:${m.layout}` : m.role;
  return { key, tag: TAG[m.role](m), m, slot, kids: m.role === "group" ? (n.c || []).map((c) => want(slot, c)) : null };
}

function make(doc, host, w) {
  if (w.key === "#text") return doc.createTextNode(w.text);
  const el = doc.createElement(w.tag);
  if (w.m.role === "textbox") {
    el.type = "text";
    el.addEventListener("input", () => host.setBound(el.__w.slot, el.__w.m.field, el.value));
    el.addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.isComposing && el.__w.m.submit) host.dispatch(el.__w.slot, el.__w.m.submit); });
  } else if (w.m.role === "button" || w.m.role === "switch") {
    el.type = "button";
    el.addEventListener("click", () => host.dispatch(el.__w.slot, el.__w.m.action));
  }
  return el;
}

function update(doc, host, el, w) {
  if (w.key === "#text") { if (el.data !== w.text) el.data = w.text; return; }
  el.__w = w; el.__key = w.key;
  const m = w.m, set = (k, v) => { if (v === null) el.removeAttribute(k); else if (el.getAttribute(k) !== v) el.setAttribute(k, v); };
  if (m.role === "group") { set("role", "group"); set("data-layout", m.layout); patch(doc, host, el, w.kids); return; }
  if (m.role === "textbox") {
    set("aria-label", m.name); set("placeholder", m.name); set("data-bind", m.field);
    const v = host.bound(w.slot, m.field);
    if (el.value !== v) el.value = v;
    return;
  }
  if (m.role === "switch") { set("role", "switch"); set("aria-checked", m.on ? "true" : "false"); }
  if (m.role === "button" || m.role === "switch") set("data-act", m.action);
  if (m.role === "text") set("data-strong", m.strong ? "1" : null);
  if (el.textContent !== m.name) el.textContent = m.name;
}

const same = (el, w) => !!el && (w.key === "#text" ? el.nodeType === 3 : el.__key === w.key && el.localName === w.tag);

// Makes parent's children match `wants`. Existing nodes are updated where they are and never moved;
// nodes that are no longer wanted are removed, new ones are inserted.
function patch(doc, host, parent, wants) {
  let i = 0;
  for (const w of wants) {
    let cur = parent.childNodes[i];
    if (!same(cur, w)) {
      let j = i + 1;
      while (j < parent.childNodes.length && !same(parent.childNodes[j], w)) j++;
      if (j < parent.childNodes.length) { for (let k = i; k < j; k++) parent.childNodes[i].remove(); cur = parent.childNodes[i]; }
      else { cur = parent.insertBefore(make(doc, host, w), cur ?? null); if (w.key !== "#text") cur.__key = w.key; }
    }
    update(doc, host, cur, w);
    i++;
  }
  while (parent.childNodes.length > i) parent.lastChild.remove();
}

export function present(host, root) {
  const doc = root.ownerDocument;
  const render = (slots) => patch(doc, host, root, slots.filter((s) => s.tree).map((s) => ({ key: `slot:${s.slot}`, tag: "section", slot: s.slot, m: { role: "group", layout: "slot" }, kids: [want(s.slot, s.tree)] })));
  host.onRender = render;
  render(host.tree ?? []);
  return render;
}
