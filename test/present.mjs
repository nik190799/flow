// The element meanings of SPEC-B1 section 6, and the presenters that read them.
import { check, done } from "./lib.mjs";
import { meaning, items, asText, asSpeech, asTools } from "../src/index.js";

const t = (s) => ({ k: "text", t: s });
const tree = { k: "col", a: {}, c: [
  { k: "heading", a: {}, c: [t("Jobs")] },
  { k: "card", a: {}, c: [{ k: "heading", a: { level: "2" }, c: [t("Today")] }, { k: "label", a: {}, c: [t("2 open")] }, { k: "big", a: {}, c: [t("7")] }] },
  { k: "row", a: {}, c: [{ k: "input", a: { bind: "draft", placeholder: "Add a job", submit: "add" }, c: [] }, { k: "button", a: { id: "add", style: "primary" }, c: [t("Add")] }] },
  { k: "toggle", a: { id: "job:0", on: "1" }, c: [t("Boiler")] },
  { k: "hologram", a: { depth: "3" }, c: [{ k: "label", a: {}, c: [t("inside a kind from the future")] }] },
] };

const roles = items(tree).map((m) => m.role).join();
check("E1 every kind has the role the spec gives it", roles === "heading,heading,text,text,textbox,button,switch,text", roles);
check("E2 heading level comes from the level attribute and defaults to 1; a bad level is 1", meaning(tree.c[0]).level === 1 && meaning(tree.c[1].c[0]).level === 2 && meaning({ k: "heading", a: { level: "9" }, c: [] }).level === 1);
check("E3 a text field's name is its placeholder, its value key is bind, and submit names an action", JSON.stringify(meaning(tree.c[2].c[0])) === '{"role":"textbox","name":"Add a job","field":"draft","submit":"add"}');
check("E4 a switch is on only when on is \"1\"", meaning(tree.c[3]).on === true && meaning({ k: "toggle", a: { id: "x", on: "true" }, c: [] }).on === false);
check("E5 a kind this host doesn't know is a group: its contents still show", asText(tree).includes("inside a kind from the future") && asSpeech(tree).includes("inside a kind from the future."));
const text = asText(tree, (k) => (k === "draft" ? "Roof fan" : ""));
check("E6 terminal text", text === "== Jobs ==\n=== Today ===\n2 open\n7\n<Roof fan>\n[ Add ]\n[x] Boiler\ninside a kind from the future", JSON.stringify(text));
check("E7 speech", asSpeech(tree) === "Heading: Jobs. Heading level 2: Today. 2 open. 7. Text field: Add a job. Button: Add. Switch, on: Boiler. inside a kind from the future.", asSpeech(tree));
const tools = asTools("main", tree);
check("E8 agent tools are the buttons and switches; a field that submits to a button is its input", tools.length === 2 && tools[0].action === "add" && tools[0].fields[0].field === "draft" && tools[1].description === 'Turn "Boiler" off' && tools[1].fields.length === 0);
done("present");
