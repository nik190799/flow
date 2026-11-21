# FLOW research paper

`flow.tex` is the paper on FLOW (Functions as Live Overlays, Without restart); `flow.pdf` is the built copy.
Published on Zenodo: [doi:10.5281/zenodo.24411135](https://doi.org/10.5281/zenodo.24411135).

## Build

```sh
cd paper && make        # pdflatex + bibtex; needs TeX Live with pgfplots, booktabs, listings, adjustbox
make clean              # remove the intermediate files
```

On Debian or Ubuntu: `apt-get install texlive-latex-recommended texlive-latex-extra texlive-pictures texlive-fonts-recommended lmodern`.

## Where the numbers come from

Every number was produced by a script in this repo and re-run on 2026-11-21 on one 4-vCPU cloud VM.
The raw output is in `results/`.

| File | Command (from the repo root) | Used in |
|---|---|---|
| `results/npm-test.txt` | `npm test` | Tests and conformance (185 checks), Table 2 |
| `results/test-go.txt` | `npm run test:go` | Go verifier, 40/40 vectors |
| `results/bar.txt`, `results/bar.json` | `npm run bar` | Table 3 and the bar discussion |
| `results/example.txt` | `npm run example:test` | Reference application (10/10) |
| `results/timing-15-runs.txt` | 15 runs of `test/functions.mjs` and `test/host.mjs` | Swap, install, undo medians |
| `results/crypto.txt` | `node paper/bench-crypto.mjs` | Table 4 |
| `results/scale*.jsonl` | `node paper/bench-scale.mjs 1 10 50 200` (and 50, 200 alone) | Table 5 |
| `results/calculator.txt` | `node paper/calculator/run.mjs` | Section 8.3 (12/12) |
| `figures/calc-*.png` | `node paper/calculator/figure.mjs` | Figure 4 |

The calculator's layers are rebuilt with `paper/calculator/build.sh` (AssemblyScript, WebAssembly 1.0 flags).
