// Three ways to present the same view tree a layer produced, besides the browser's DOM. None of them
// knows anything about the app: they only read node kinds, text and ids.
const text = (n) => n.k === "text" ? n.t : (n.c || []).map(text).join(" ");
const walk = (n, f) => { f(n); for (const c of n.c || []) walk(c, f); };

export function asTerminal(tree) {
  const out = [];
  walk(tree, (n) => {
    if (n.k === "heading") out.push(`== ${text(n)} ==`);
    else if (n.k === "label") out.push(text(n));
    else if (n.k === "input") out.push(`<${n.a.placeholder}>`);
    else if (n.k === "button") out.push(`[ ${text(n)} ]`);
    else if (n.k === "toggle") out.push(`${n.a.on === "1" ? "[x]" : "[ ]"} ${text(n)}`);
  });
  return out.join("\n");
}

export function asSpeech(tree) {
  const out = [];
  walk(tree, (n) => {
    if (n.k === "heading") out.push(`Heading: ${text(n)}.`);
    else if (n.k === "label") out.push(`${text(n)}.`);
    else if (n.k === "input") out.push(`Text field: ${n.a.placeholder}.`);
    else if (n.k === "button") out.push(`Button: ${text(n)}.`);
    else if (n.k === "toggle") out.push(`Checkbox, ${n.a.on === "1" ? "checked" : "not checked"}: ${text(n)}.`);
  });
  return out.join(" ");
}

// What an AI agent sees: a list of actions it may call, each with a name and what it needs.
export function asAgentTools(slot, tree) {
  const tools = [];
  let pendingInput = null;
  walk(tree, (n) => {
    if (n.k === "input") pendingInput = n.a;
    else if (n.k === "button") tools.push({ slot, action: n.a.id, description: text(n), ...(pendingInput?.submit === n.a.id ? { needs: { field: pendingInput.bind, hint: pendingInput.placeholder } } : {}) });
    else if (n.k === "toggle") tools.push({ slot, action: n.a.id, description: `Toggle "${text(n)}" (now ${n.a.on === "1" ? "on" : "off"})` });
  });
  return tools;
}
