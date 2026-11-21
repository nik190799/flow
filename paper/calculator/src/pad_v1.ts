// The company's calculator: the core it owns. It brings the data (the number on the display) and the
// primitives (digits 0-9 and a fixed set of operators). It knows nothing about anyone's functions.
import { col, row, big, label, button, end, getNum, setNum, getStr, setStr, eventId, fmt } from "../../../node_modules/live-layer-protocol/sdk/assemblyscript/llp";

export function llp_schema(): i32 { return 1; }
function r6(n: f64): f64 { return Math.round(n * 1e6) / 1e6; }
function show(n: f64): string { return fmt(r6(n)); }

export function llp_view(): void {
  col();
    big(show(getNum("calc.x")));
    label(getStr("calc.op").length > 0 ? show(getNum("calc.acc")) + " " + getStr("calc.op") : " ");
    row(); button("d7", "7"); button("d8", "8"); button("d9", "9"); button("div", "÷"); end();
    row(); button("d4", "4"); button("d5", "5"); button("d6", "6"); button("mul", "×"); end();
    row(); button("d1", "1"); button("d2", "2"); button("d3", "3"); button("sub", "−"); end();
    row(); button("d0", "0"); button("clr", "C"); button("eq", "="); button("add", "+"); end();
    row(); button("sin", "sin"); button("cos", "cos");  end();
  end();
}

function apply(): void {
  const a = getNum("calc.acc"), b = getNum("calc.x"), op = getStr("calc.op");
  let r = b;
  if (op == "+") r = a + b; else if (op == "−") r = a - b; else if (op == "×") r = a * b; else if (op == "÷") r = a / b;
  setNum("calc.x", r); setStr("calc.op", ""); setNum("calc.fresh", 1);
}
function operator(sym: string): void {
  if (getStr("calc.op").length > 0 && getNum("calc.fresh") == 0) apply();
  setNum("calc.acc", getNum("calc.x")); setStr("calc.op", sym); setNum("calc.fresh", 1);
}

export function llp_event(): void {
  const id = eventId();
  if (id.length == 2 && id.charAt(0) == "d") {
    const d = <f64>(id.charCodeAt(1) - 48);
    setNum("calc.x", getNum("calc.fresh") > 0 ? d : getNum("calc.x") * 10 + d); setNum("calc.fresh", 0);
  } else if (id == "add") operator("+"); else if (id == "sub") operator("−");
  else if (id == "mul") operator("×"); else if (id == "div") operator("÷");
  else if (id == "eq") apply();
  else if (id == "sin") { setNum("calc.x", Math.sin(getNum("calc.x"))); setNum("calc.fresh", 1); }
  else if (id == "cos") { setNum("calc.x", Math.cos(getNum("calc.x"))); setNum("calc.fresh", 1); }
  else if (id == "clr") { setNum("calc.x", 0); setNum("calc.acc", 0); setStr("calc.op", ""); setNum("calc.fresh", 1); }
  
}
