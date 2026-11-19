// The WebAssembly 1.0 check, compared against an independent oracle: wabt with every post-1.0
// feature switched off. Both must agree on every module.
import { readFileSync, readdirSync } from "node:fs";
import wabtInit from "wabt";
import { check, done } from "./lib.mjs";
import { wasm1Problem } from "../src/index.js";

const wabt = await wabtInit();
const ALL = { sign_extension: true, mutable_globals: true, sat_float_to_int: true, bulk_memory: true, reference_types: true, multi_value: true, simd: true, threads: true, tail_call: true, exceptions: true, multi_memory: true };
const OFF = Object.fromEntries(Object.keys(ALL).map((k) => [k, false]));
const wat = (src) => new Uint8Array(wabt.parseWat("t.wat", src, ALL).toBinary({}).buffer);
const oracle = (bytes) => { try { const m = wabt.readWasm(bytes, OFF); m.validate(); m.destroy(); return true; } catch { return false; } };

const cases = {
  "plain 1.0 module": [true, `(module (type $t (func (param i32) (result i32))) (memory (export "memory") 1) (global $g (mut i32) (i32.const 0))
     (table 2 funcref) (elem (i32.const 0) $f $f) (data (i32.const 8) "hi")
     (func $f (export "f") (param i32) (result i32) (local i64 f32 f64)
       (block $out (result i32)
         (loop $l (br_if $l (i32.eqz (i32.const 1))))
         (block $b (br_table $b $b (local.get 0)))
         (local.set 1 (i64.const -99)) (local.set 2 (f32.const 1.5)) (local.set 3 (f64.const 2.5))
         (global.set $g (i32.add (i32.load offset=4 (i32.const 0)) (i32.const -5)))
         (drop (call_indirect (type $t) (i32.const 1) (i32.const 0)))
         (drop (memory.grow (i32.const 0))) (drop (memory.size))
         (select (i32.const 1) (i32.const 2) (if (result i32) (local.get 0) (then (i32.const 2)) (else (i32.const 3)))))))`],
  "sign extension": [false, `(module (func (param i32) (result i32) local.get 0 i32.extend8_s))`],
  "non-trapping float-to-int": [false, `(module (func (param f32) (result i32) local.get 0 i32.trunc_sat_f32_s))`],
  "bulk memory": [false, `(module (memory 1) (func i32.const 0 i32.const 0 i32.const 0 memory.copy))`],
  "passive data segment": [false, `(module (memory 1) (data "x"))`],
  "mutable global export": [false, `(module (global (export "g") (mut i32) (i32.const 0)))`, "wabt 1.0.37 does not enforce this feature switch"],
  "mutable global import": [false, `(module (import "e" "g" (global (mut i32))))`, "wabt 1.0.37 does not enforce this feature switch"],
  "multi-value result": [false, `(module (func (result i32 i32) i32.const 1 i32.const 2))`, "wabt 1.0.37 does not enforce this feature switch"],
  "multi-value block": [false, `(module (type $t (func (param i32) (result i32))) (func (result i32) i32.const 1 (block (type $t))))`],
  "reference types (externref param)": [false, `(module (func (param externref)))`],
  "reference types (two tables)": [false, `(module (table 1 funcref) (table 1 funcref))`, "wabt 1.0.37 does not enforce this feature switch"],
  "SIMD": [false, `(module (func (result v128) v128.const i32x4 0 0 0 0))`],
  "threads (shared memory)": [false, `(module (memory 1 1 shared))`],
  "tail call": [false, `(module (func $f return_call $f))`],
  "immutable global export (allowed)": [true, `(module (global (export "g") i32 (i32.const 7)))`],
};
// For a few features wabt ignores its own switch; there the expected verdict comes from the
// WebAssembly 1.0 specification alone, and the check says so.
for (const [name, [want, src, noOracle]] of Object.entries(cases)) {
  const b = wat(src);
  const mine = wasm1Problem(b) === null;
  if (noOracle) check(`W ${name}: ${want ? "accepted" : "refused"} (${noOracle})`, mine === want, wasm1Problem(b) ?? "");
  else check(`W ${name}: ${want ? "accepted" : "refused"}, and wabt agrees`, mine === want && oracle(b) === want, wasm1Problem(b) ?? "");
}

const files = [
  ...readdirSync(new URL("../layers/", import.meta.url)).filter((f) => f.endsWith(".wasm")).map((f) => new URL(`../layers/${f}`, import.meta.url)),
  ...readdirSync(new URL("../node_modules/live-layer-protocol/build/", import.meta.url)).map((f) => new URL(`../node_modules/live-layer-protocol/build/${f}`, import.meta.url)),
];
const disagree = files.filter((u) => { const b = new Uint8Array(readFileSync(u)); return (wasm1Problem(b) === null) !== oracle(b); });
check(`W every LLP and FLOW layer (${files.length}) gets the same verdict as wabt`, disagree.length === 0, disagree.map((u) => u.pathname.split("/").pop()).join(", "));
check("W FLOW's own test layers are WebAssembly 1.0", files.filter((u) => u.pathname.includes("/layers/")).every((u) => wasm1Problem(readFileSync(u)) === null));
check("W junk bytes are refused", wasm1Problem(new Uint8Array([1, 2, 3])) !== null);
done("wasm1");
