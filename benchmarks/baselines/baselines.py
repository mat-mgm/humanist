#!/usr/bin/env python3
"""Baselines for the ICDE paper. Rebuilds the benchmark graph with the same
construction as benchmarks/src/dataset.rs (own seeded RNG, so the random edges
are not byte-identical to the Rust generator) and measures:
  A. data model: ECS trait tables vs one wide SQL table (SQLite)
  B. inference: SQLite recursive CTE vs standalone Scryer Prolog
Usage: nix shell nixpkgs#scryer-prolog -c python3 baselines.py
"""
import random, sqlite3, statistics as st, subprocess, time, os, json, tempfile

LABELS = ["contains", "depends_on", "references", "authored_by", "located_at"]
MIMES = ["image/png", "application/pdf", "model/gltf+json"]
# Trait fields, as in core_engine/src/models.rs (excluding id/owner)
SP = ["lat", "lng", "alt", "heading", "bbox", "projection"]
TP = ["event_at", "starts_at", "ends_at", "recurrence"]
BL = ["storage_id", "bucket", "mime", "hash", "size", "filename"]
KV = ["namespace", "vals"]

def gen(k, seed=42):
    """Same construction as benchmarks/src/dataset.rs (commit 85e0008): entity
    order physical, digital, abstract, persona; tagged_as edges round-robin;
    custom edges = half a shuffled chain + random cross-links (self-loops
    skipped). Only the RNG differs (Rust StdRng vs Python), so the random edges
    and trait values are not byte-identical."""
    r = random.Random(seed)
    n = lambda c: c * k
    ent, spatial, temporal, blob, kv = [], {}, {}, {}, {}
    def sp(e, alt):
        spatial[e] = (r.uniform(-60, 70), r.uniform(-180, 180), alt, r.uniform(0, 360), None, "EPSG:4326")
    phys, dig, abst, per = [], [], [], []
    for _ in range(n(350)):
        e = len(ent); ent.append((e, "physical")); phys.append(e); sp(e, r.uniform(0, 5000))
    for j in range(n(170)):
        e = len(ent); ent.append((e, "digital")); dig.append(e)
        blob[e] = ("%d/file" % e, "local", MIMES[j % 3], "sha256:%016x" % r.getrandbits(64), r.randint(1, 10**6), "digital_%04d" % j)
    for _ in range(n(50)):
        e = len(ent); ent.append((e, "abstract")); abst.append(e); kv[e] = ("entity", '{"entity.is_tag":true}')
    for _ in range(n(30)):
        e = len(ent); ent.append((e, "persona")); per.append(e); sp(e, 0.0)
    for i, e in enumerate(phys[:n(80)]):  # multi-trait: temporal trait on physical entities
        temporal[e] = ("2025-%02d-%02dT08:00:00Z" % (i % 12 + 1, i % 28 + 1), None, None, None)
    ids = [e for e, _ in ent]
    nonabs = [e for e in ids if e not in set(abst)]
    edges = [(nonabs[j % len(nonabs)], abst[j % len(abst)], "tagged_as") for j in range(n(400))]
    custom = n(300)
    chain = min(min(len(ids), custom) - 1, custom // 2)
    sh = ids[:]; r.shuffle(sh)
    edges += [(sh[j], sh[j + 1], LABELS[j % 5]) for j in range(chain)]
    for _ in range(custom - chain):
        a_, b_ = r.randrange(len(ids)), r.randrange(len(ids))
        if a_ != b_: edges.append((ids[a_], ids[b_], r.choice(LABELS)))
    return (ent, [(e,) + v for e, v in spatial.items()], [(e,) + v for e, v in temporal.items()],
            [(e,) + v for e, v in blob.items()], [(e,) + v for e, v in kv.items()], edges)

def bench(f, reps):
    xs = []
    for _ in range(reps):
        t = time.perf_counter_ns(); f(); xs.append((time.perf_counter_ns() - t) / 1e3)
    xs.sort()
    return st.median(xs), xs[int(0.95 * (len(xs) - 1))]

def model_baseline(k, d):
    ent, sp, tp, bl, kv, _ = gen(k)
    # ECS: one table per trait
    a = sqlite3.connect(":memory:")
    a.executescript("""
      CREATE TABLE entity(id INTEGER PRIMARY KEY, category TEXT);
      CREATE TABLE spatial_trait(id INTEGER PRIMARY KEY, lat REAL, lng REAL, alt REAL, heading REAL, bbox TEXT, projection TEXT);
      CREATE TABLE temporal_trait(id INTEGER PRIMARY KEY, event_at TEXT, starts_at TEXT, ends_at TEXT, recurrence TEXT);
      CREATE TABLE blob_trait(id INTEGER PRIMARY KEY, storage_id TEXT, bucket TEXT, mime TEXT, hash TEXT, size INTEGER, filename TEXT);
      CREATE TABLE kv_trait(id INTEGER PRIMARY KEY, namespace TEXT, vals TEXT);""")
    a.executemany("INSERT INTO entity VALUES(?,?)", ent)
    a.executemany("INSERT INTO spatial_trait VALUES(?,?,?,?,?,?,?)", sp)
    a.executemany("INSERT INTO temporal_trait VALUES(?,?,?,?,?)", tp)
    a.executemany("INSERT INTO blob_trait VALUES(?,?,?,?,?,?,?)", bl)
    a.executemany("INSERT INTO kv_trait VALUES(?,?,?)", kv)
    # wide: one table, every trait field an optional column (18 columns)
    cols = SP + TP + BL + KV; NC = len(cols)
    w = sqlite3.connect(":memory:")
    w.execute("CREATE TABLE entity(id INTEGER PRIMARY KEY, category TEXT, " + ", ".join(cols) + ")")
    rows = {e: [e, c] + [None] * NC for e, c in ent}
    off = {"sp": 2, "tp": 2 + len(SP), "bl": 2 + len(SP) + len(TP), "kv": 2 + len(SP) + len(TP) + len(BL)}
    for name, tab in (("sp", sp), ("tp", tp), ("bl", bl), ("kv", kv)):
        for e, *v in tab: rows[e][off[name]:off[name] + len(v)] = v
    w.executemany("INSERT INTO entity VALUES(" + ",".join("?" * (NC + 2)) + ")", list(rows.values()))
    cells = len(rows) * NC
    nulls = sum(1 for r in rows.values() for x in r[2:] if x is None)
    trait_fields = len(sp) * len(SP) + len(tp) * len(TP) + len(bl) * len(BL) + len(kv) * len(KV)
    q_ecs = "SELECT COUNT(*) FROM spatial_trait s JOIN temporal_trait t ON s.id=t.id"
    q_wide = "SELECT COUNT(*) FROM entity WHERE lat IS NOT NULL AND event_at IS NOT NULL"
    assert a.execute(q_ecs).fetchone() == w.execute(q_wide).fetchone()
    m_ecs = bench(lambda: a.execute(q_ecs).fetchall(), 200)
    m_wide = bench(lambda: w.execute(q_wide).fetchall(), 200)
    # fetch every trait of one entity
    ids = [e for e, _ in ent][:: max(1, len(ent) // 50)]
    def full_ecs():
        for i in ids:
            for t in ("entity", "spatial_trait", "temporal_trait", "blob_trait", "kv_trait"):
                a.execute(f"SELECT * FROM {t} WHERE id=?", (i,)).fetchall()
    def full_wide():
        for i in ids: w.execute("SELECT * FROM entity WHERE id=?", (i,)).fetchall()
    f_ecs = bench(full_ecs, 50); f_wide = bench(full_wide, 50)
    # adding a modality
    t0 = time.perf_counter_ns(); a.execute("CREATE TABLE graph_trait(id INTEGER PRIMARY KEY, members TEXT)"); t_ecs = (time.perf_counter_ns() - t0) / 1e3
    t0 = time.perf_counter_ns(); w.execute("ALTER TABLE entity ADD COLUMN members TEXT"); t_wide = (time.perf_counter_ns() - t0) / 1e3
    d[k] = dict(entities=len(ent), wide_cells=cells, wide_nulls=nulls, wide_null_rate=nulls / cells,
                trait_rows=len(sp) + len(tp) + len(bl) + len(kv), trait_fields=trait_fields,
                q_both_ecs_us=m_ecs, q_both_wide_us=m_wide,
                fetch50_ecs_us=f_ecs, fetch50_wide_us=f_wide,
                add_modality_ecs_us=t_ecs, add_modality_wide_us=t_wide,
                add_modality_rows_touched_ecs=0, add_modality_rows_touched_wide=len(ent))

CTE = """WITH RECURSIVE r(n,d) AS (SELECT dst,1 FROM edge WHERE src=:s
  UNION SELECT e.dst,r.d+1 FROM r JOIN edge e ON e.src=r.n WHERE r.d<:d)
  SELECT {sel} FROM r"""

def prolog_prog(edges, srcs, cls, reps):
    lines = [":- use_module(library(lists)).", ":- use_module(library(between)).", ":- initialization(main)."]
    lines += [f"edge({s},{t},{l})." for s, t, l in edges]
    lines += ["step(X,Y) :- edge(X,Y,_).",
              "reach(X,Y,D) :- D>0, step(X,Y).",
              "reach(X,Y,D) :- D>1, step(X,Z), D1 is D-1, reach(Z,Y,D1).",
              "q(direct,S) :- findall(T-L, edge(S,T,L), R), R=[_|_].",
              "q(direct,_).",
              "q(closure,S) :- findall(Y, reach(S,Y,6), L), sort(L,_).",
              "q(agg,S) :- findall(Y, reach(S,Y,4), L), sort(L,U), length(U,_)."]
    sl = "[" + ",".join(map(str, srcs)) + "]"
    lines.append(f"run :- member(S,{sl}), between(1,{reps},_), q({cls},S), fail.\nrun.")
    lines.append("main :- " + ("run, " if reps else "") + "halt.")
    return "\n".join(lines)

def run_prolog(edges, srcs, cls, reps):
    with tempfile.NamedTemporaryFile("w", suffix=".pl", delete=False) as f:
        f.write(prolog_prog(edges, srcs, cls, reps)); p = f.name
    best = 1e9
    for _ in range(3):
        t = time.perf_counter(); subprocess.run(["scryer-prolog", p], check=True, capture_output=True); best = min(best, time.perf_counter() - t)
    os.unlink(p); return best

def inference_baseline(k, d):
    ent, *_, edges = gen(k)
    c = sqlite3.connect(":memory:")
    c.execute("CREATE TABLE edge(src INTEGER, dst INTEGER, label TEXT)")
    c.execute("CREATE INDEX e_src ON edge(src)")
    c.executemany("INSERT INTO edge VALUES(?,?,?)", edges)
    ids = [e for e, _ in ent]
    adj = {}
    for s_, t_, _ in edges: adj.setdefault(s_, set()).add(t_)
    def reach(s_, D):
        seen, fr = set(), {s_}
        for _ in range(D):
            fr = {y for x in fr for y in adj.get(x, ())}; seen |= fr
        return len(seen)
    rich = [e for e in ids if reach(e, 6) >= 10]  # sources with non-trivial closure
    srcs = [rich[i * len(rich) // 5] for i in range(5)]
    out = {}
    out["direct"] = bench(lambda: [c.execute("SELECT dst,label FROM edge WHERE src=?", (s,)).fetchall() for s in srcs], 200)
    out["closure"] = bench(lambda: [c.execute(CTE.format(sel="DISTINCT n"), dict(s=s, d=6)).fetchall() for s in srcs], 50)
    out["agg"] = bench(lambda: [c.execute(CTE.format(sel="COUNT(DISTINCT n)"), dict(s=s, d=4)).fetchall() for s in srcs], 50)
    out = {q: (v[0] / 5, v[1] / 5) for q, v in out.items()}  # per query
    reps = dict(direct=20000, closure=3000, agg=3000)
    pl = {}
    for cls, n in reps.items():
        t0 = run_prolog(edges, srcs, cls, 0)
        t1 = run_prolog(edges, srcs, cls, n)
        pl[cls] = (t1 - t0) / (5 * n) * 1e6
    d[k] = dict(entities=len(ent), sources=len(rich), mean_reach_d6=sum(reach(x, 6) for x in srcs) / 5, mean_reach_d4=sum(reach(x, 4) for x in srcs) / 5, sqlite_cte_us=out, scryer_standalone_mean_us=pl)

if __name__ == "__main__":
    res = {"model": {}, "inference": {}}
    for k in (1, 4, 16):
        model_baseline(k, res["model"]); inference_baseline(k, res["inference"]); print("scale", k, "done", flush=True)
    json.dump(res, open("baselines_results.json", "w"), indent=1)
    print(json.dumps(res, indent=1))
