"""Run the display plans through the paper's Python engine and compare with the JS port.

Reads the plans and JS results written by export-plans.mjs, runs the four arms
through src/prefixmeta of the paper's repository (Inside the Trap,
https://github.com/AkshatValse/surviving-llm-stampede) with
configs/r6_predict.yaml and engine.batch_decode_iterations=false, and checks that
the turn, hit, iteration and eviction counts, the release time and every
completion time are identical. Prints the counts in the form of GOLDEN in
scripts/verify-trap.mjs. Exits non-zero on any difference.

Run: python -I scripts/trap-golden/python_engine.py <paper checkout> [outDir]
     (needs numpy, as the paper's environment does; outDir as for export-plans.mjs)
"""
import json
import os
import sys
import tempfile
from pathlib import Path

repo = Path(sys.argv[1]).resolve()
out = Path(sys.argv[2] if len(sys.argv) > 2 else os.path.join(tempfile.gettempdir(), "trap-golden"))
sys.path[:0] = [str(repo), str(repo / "src")]

import numpy as np  # noqa: E402
from prefixmeta import probe  # noqa: E402
from prefixmeta.sim import RunSpec  # noqa: E402
from prefixmeta.workload import ArrivalPlan, SessionSpecs  # noqa: E402
from prefixmeta.gate_control import GateControl, simulate_gate  # noqa: E402

js = json.loads((out / "js.json").read_text())
cfg = probe.load_probe_config(str(repo / "configs/r6_predict.yaml"), repo, ["engine.batch_decode_iterations=false"])
gates = {
    # noburst and burst run with an inert rescue gate, so every arm goes through simulate_gate
    "noburst": GateControl(mode="rescue", cap=20, t_on_s=1e18),
    "burst": GateControl(mode="rescue", cap=20, t_on_s=1e18),
    "capped": GateControl(mode="static", cap=20),
    "rescue": GateControl(mode="rescue", cap=20, t_on_s=1800.0, pause=True, release_hold_s=300.0, min_on_s=600.0),
}
ok = True
golden = {}
for arm, ctl in gates.items():
    j = json.loads((out / f"plan_{'noburst' if arm == 'noburst' else 'b'}.json").read_text())
    specs = SessionSpecs(arrival=np.array(j["arrival"], float), n_turns=np.array(j["n_turns"], np.int64),
                         tool_off=np.array(j["tool_off"], np.int64), tool_flat=np.array(j["tool_flat"], float))
    plan = ArrivalPlan(kind="constant", horizon_s=8700, rate=0.1)  # unused when specs are given
    r = simulate_gate(cfg, RunSpec(exp="trap-golden", policy="fcfs_lru", seed=0, horizon_s=8700, plan=plan), ctl, specs=specs)
    s, done = r["summary"], r["gate"]["done"]
    py = dict(n_turns_done=int(s["n_turns_done"]), n_hits=int(s["n_hits"]), n_iterations=int(s["n_iterations"]),
              n_evictions=int(s["n_evictions"]), t_release=r["gate"]["stats"]["t_release"], last_done_t=float(done[-1][0]))
    mine = {k: v for k, v in js[arm].items() if k != "done_t"}
    times_same = [float(d[0]) for d in done] == js[arm]["done_t"]
    same = py == mine and times_same
    ok &= same
    golden[arm] = py
    print(f"{arm:8s} {'IDENTICAL' if same else 'DIFFERENT'}  {py}  every completion time {'equal' if times_same else 'NOT equal'}")
print(json.dumps(golden, indent=1))
print("all identical:", ok)
sys.exit(0 if ok else 1)
