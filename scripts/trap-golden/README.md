# Fig. 1 against the paper's Python engine

`scripts/verify-trap.mjs` holds the Python engine's counts for the display run
in `GOLDEN`. These two scripts regenerate them from the paper's repository
([surviving-llm-stampede](https://github.com/AkshatValse/surviving-llm-stampede),
which the 2026-11-08 run used at commit 65c862d) and check every completion time,
not only the last one:

```bash
node scripts/trap-golden/export-plans.mjs
python -I scripts/trap-golden/python_engine.py /path/to/surviving-llm-stampede
```

The first writes the display plans and the JS results to `<tmpdir>/trap-golden`;
the second runs the same plans through `src/prefixmeta` with
`configs/r6_predict.yaml` and `engine.batch_decode_iterations=false`, the
iteration-by-iteration path the JS port follows, and prints the counts in the
form of `GOLDEN`. Under the paper's default (`true`), which advances runs of
pure-decode iterations in closed form, the counts and the order of turns are the
same and completion times agree to about 2e-10 s.

If a change to `src/sim/trap.js` or to the display seed changes the counts, take
`GOLDEN` from this Python output, never from the JS engine's own output.
