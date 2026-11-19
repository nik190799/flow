// Strict JSON for signed payloads. JSON.parse silently keeps the last of two equal keys, and other
// parsers keep the first; a document that reads differently on two hosts must not verify on either.
// So payloads are parsed by JSON.parse only after this scan proves no object repeats a key.
import { refuse } from "./errors.js";
import { td } from "./bytes.js";

export function parseStrict(bytes, what = "payload") {
  let text;
  try { text = td.decode(bytes); } catch { refuse("malformed", `${what} is not valid UTF-8`); }
  let value;
  try { value = JSON.parse(text); } catch (e) { refuse("malformed", `${what} is not JSON: ${e.message}`); }
  const dup = findDuplicateKey(text);
  if (dup !== null) refuse("malformed", `${what} repeats the key ${JSON.stringify(dup)} in one object`);
  if (!value || typeof value !== "object" || Array.isArray(value)) refuse("malformed", `${what} must be a JSON object`);
  return value;
}

// Walks already-valid JSON text and returns the first key repeated within one object, or null.
function findDuplicateKey(s) {
  const stack = []; // per open container: a Set of keys for objects, null for arrays
  let i = 0, expectKey = false;
  while (i < s.length) {
    const c = s[i];
    if (c === '"') {
      let j = i + 1;
      while (s[j] !== '"') j += s[j] === "\\" ? 2 : 1;
      if (expectKey) {
        const key = JSON.parse(s.slice(i, j + 1));
        const keys = stack[stack.length - 1];
        if (keys.has(key)) return key;
        keys.add(key);
        expectKey = false;
      }
      i = j + 1;
      continue;
    }
    if (c === "{") { stack.push(new Set()); expectKey = true; }
    else if (c === "[") stack.push(null);
    else if (c === "}" || c === "]") stack.pop();
    else if (c === ",") expectKey = stack[stack.length - 1] instanceof Set;
    i++;
  }
  return null;
}
