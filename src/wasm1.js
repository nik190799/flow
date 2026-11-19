// WebAssembly 1.0 check. Layers may use only the original WebAssembly 1.0 (MVP, 2017) feature set,
// so engines from 2017 on can run them: old smart TVs, kiosks and panels with frozen browsers.
//
// This is a whitelist decoder: it walks every section and every instruction and refuses anything it
// doesn't recognise as 1.0. Post-1.0 features it therefore refuses include sign extension, non-trapping
// float-to-int, bulk memory, reference types, multi-value, SIMD, threads, tail calls, exceptions,
// and import or export of mutable globals.
//
// Returns null for a 1.0 module, or a sentence naming the first post-1.0 feature found.

const NAMES = {
  0xc0: "sign extension (i32.extend8_s)", 0xc1: "sign extension (i32.extend16_s)", 0xc2: "sign extension (i64.extend8_s)",
  0xc3: "sign extension (i64.extend16_s)", 0xc4: "sign extension (i64.extend32_s)", 0xfc: "bulk memory or non-trapping float-to-int (0xFC prefix)",
  0xfd: "SIMD (0xFD prefix)", 0xfe: "threads (0xFE prefix)", 0x1c: "reference types (typed select)", 0x25: "reference types (table.get)",
  0x26: "reference types (table.set)", 0xd0: "reference types (ref.null)", 0xd1: "reference types (ref.is_null)", 0xd2: "reference types (ref.func)",
  0x12: "tail calls (return_call)", 0x13: "tail calls (return_call_indirect)", 0x06: "exceptions (try)", 0x08: "exceptions (throw)", 0x1f: "exceptions (try_table)",
};
const VALTYPES = new Set([0x7f, 0x7e, 0x7d, 0x7c]);

class Reader {
  constructor(b, o = 0, end = b.length) { this.b = b; this.o = o; this.end = end; }
  byte() { if (this.o >= this.end) throw new Error("unexpected end"); return this.b[this.o++]; }
  u32() { let r = 0, s = 0, x; do { x = this.byte(); r += (x & 0x7f) * 2 ** s; s += 7; if (s > 35) throw new Error("LEB too long"); } while (x & 0x80); return r; }
  sleb(max) { let s = 0, x; do { x = this.byte(); s += 7; if (s > max + 7) throw new Error("LEB too long"); } while (x & 0x80); }
  skip(n) { if (this.o + n > this.end) throw new Error("unexpected end"); this.o += n; }
  name() { this.skip(this.u32()); }
  vec(fn) { const n = this.u32(); for (let i = 0; i < n; i++) fn(i); return n; }
}

class NotV1 extends Error {}
const no = (what) => { throw new NotV1(what); };

function limits(r) {
  const f = r.byte();
  if (f > 1) no(f & 2 ? "threads (shared memory)" : "memory64 or unknown limits");
  r.u32(); if (f === 1) r.u32();
}
function valtype(r) { const t = r.byte(); if (!VALTYPES.has(t)) no(t === 0x7b ? "SIMD (v128 type)" : "reference types (non-number value type)"); }
function initExpr(r) {
  const op = r.byte();
  if (op === 0x41) r.sleb(32); else if (op === 0x42) r.sleb(64); else if (op === 0x43) r.skip(4); else if (op === 0x44) r.skip(8);
  else if (op === 0x23) r.u32(); else no(NAMES[op] ?? `extended constant expressions (opcode 0x${op.toString(16)})`);
  if (r.byte() !== 0x0b) no("extended constant expressions");
}
function blocktype(r) { const t = r.b[r.o]; if (t === 0x40 || VALTYPES.has(t)) { r.o++; return; } no("multi-value (block with a type index)"); }

function code(r) {
  let depth = 1;
  while (depth > 0) {
    const op = r.byte();
    if (op === 0x02 || op === 0x03 || op === 0x04) { blocktype(r); depth++; }
    else if (op === 0x0b) depth--;
    else if (op === 0x00 || op === 0x01 || op === 0x05 || op === 0x0f || op === 0x1a || op === 0x1b) {}
    else if (op === 0x0c || op === 0x0d || op === 0x10 || (op >= 0x20 && op <= 0x24)) r.u32();
    else if (op === 0x0e) { r.vec(() => r.u32()); r.u32(); }
    else if (op === 0x11) { r.u32(); if (r.byte() !== 0x00) no("reference types (call_indirect on a table other than 0)"); }
    else if (op >= 0x28 && op <= 0x3e) { r.u32(); r.u32(); }
    else if (op === 0x3f || op === 0x40) { if (r.byte() !== 0x00) no("multi-memory"); }
    else if (op === 0x41) r.sleb(32);
    else if (op === 0x42) r.sleb(64);
    else if (op === 0x43) r.skip(4);
    else if (op === 0x44) r.skip(8);
    else if (op >= 0x45 && op <= 0xbf) {}
    else no(NAMES[op] ?? `opcode 0x${op.toString(16)}`);
  }
}

export function wasm1Problem(bytes) {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  try {
    if (!WebAssembly.validate(b)) return "not a valid WebAssembly module";
  } catch { return "not a valid WebAssembly module"; }
  try {
    const r = new Reader(b);
    if (r.byte() !== 0 || r.byte() !== 0x61 || r.byte() !== 0x73 || r.byte() !== 0x6d) no("bad magic");
    if (r.byte() !== 1 || r.byte() || r.byte() || r.byte()) no("a binary version other than 1");
    const mutGlobals = []; // per global index: mutable?
    let tables = 0, mems = 0, last = 0;
    while (r.o < r.end) {
      const id = r.byte(), size = r.u32(), end = r.o + size;
      if (end > r.end) no("truncated section");
      const s = new Reader(b, r.o, end);
      if (id > 11) no(id === 12 ? "bulk memory (data count section)" : id === 13 ? "exceptions (tag section)" : `unknown section ${id}`);
      if (id !== 0) { if (id <= last) no("sections out of order"); last = id; }
      switch (id) {
        case 0: break; // custom sections are allowed and ignored
        case 1: s.vec(() => { if (s.byte() !== 0x60) no("non-function type"); s.vec(() => valtype(s)); if (s.vec(() => valtype(s)) > 1) no("multi-value (function with more than one result)"); }); break;
        case 2: s.vec(() => {
          s.name(); s.name();
          const kind = s.byte();
          if (kind === 0) s.u32();
          else if (kind === 1) { if (s.byte() !== 0x70) no("reference types (non-funcref table)"); limits(s); tables++; }
          else if (kind === 2) { limits(s); mems++; }
          else if (kind === 3) { valtype(s); const m = s.byte(); if (m !== 0) no("mutable global import"); mutGlobals.push(false); }
          else no(kind === 4 ? "exceptions (tag import)" : `import kind ${kind}`);
        }); break;
        case 3: s.vec(() => s.u32()); break;
        case 4: s.vec(() => { if (s.byte() !== 0x70) no("reference types (non-funcref table)"); limits(s); tables++; }); break;
        case 5: s.vec(() => { limits(s); mems++; }); break;
        case 6: s.vec(() => { valtype(s); const m = s.byte(); if (m > 1) no("bad global mutability"); initExpr(s); mutGlobals.push(m === 1); }); break;
        case 7: s.vec(() => { s.name(); const kind = s.byte(), idx = s.u32(); if (kind > 3) no(`export kind ${kind}`); if (kind === 3 && mutGlobals[idx]) no("mutable global export"); }); break;
        case 8: s.u32(); break;
        case 9: s.vec(() => { if (s.u32() !== 0) no("bulk memory or reference types (element segment flags)"); initExpr(s); s.vec(() => s.u32()); }); break;
        case 10: s.vec(() => {
          const len = s.u32(), bodyEnd = s.o + len;
          const c = new Reader(b, s.o, bodyEnd);
          c.vec(() => { c.u32(); valtype(c); });
          code(c);
          if (c.o !== bodyEnd) no("function body has bytes after its end");
          s.o = bodyEnd;
        }); break;
        case 11: s.vec(() => { if (s.u32() !== 0) no("bulk memory (passive or explicit-index data segment)"); initExpr(s); s.skip(s.u32()); }); break;
      }
      if (id !== 0 && s.o !== end) no(`section ${id} has trailing bytes`);
      r.o = end;
    }
    if (tables > 1) no("reference types (more than one table)");
    if (mems > 1) no("multi-memory");
    return null;
  } catch (e) {
    if (e instanceof NotV1) return `uses ${e.message}, which is beyond WebAssembly 1.0`;
    return `could not be read as WebAssembly 1.0: ${e.message}`;
  }
}
