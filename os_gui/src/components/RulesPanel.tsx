import { useState, useEffect, useMemo } from 'react';
import { invoke } from '@tauri-apps/api/core';
import {
  Brain, Plus, Pencil, Play, X, Save,
  AlertCircle, CheckCircle2, Loader2,
} from 'lucide-react';
import { useOsStore } from '../store';
import type { Entity } from '../models';
import { logFrontend } from '../lib/log';

const RULE_TAG_LABEL = 'rule';

// Edge endpoints come back from get_edges with the `entity:` prefix stripped
// (see core_engine/src/db.rs::get_edges). Entity ids keep the prefix. Normalize
// to bare ULIDs on both sides before comparing.
function bareId(id: string): string {
  return id.replace(/^entity:/, '');
}

function isRuleEntity(e: Entity, ruleTagId: string | null, tagEdges: { from: string; to: string }[]): boolean {
  if (!ruleTagId) return false;
  if (e.category !== 'digital') return false;
  const ownerBare = bareId(e.id);
  const tagBare = bareId(ruleTagId);
  return tagEdges.some(t => bareId(t.from) === ownerBare && bareId(t.to) === tagBare);
}

interface PrologValue {
  kind: string;
  value?: unknown;
  functor?: string;
  args?: PrologValue[];
}

interface OverlayEdge {
  from: string;
  to: string;
}

function asEntityId(v: PrologValue | undefined): string | null {
  if (!v) return null;
  if (v.kind === 'entity_id' && typeof v.value === 'string') return v.value;
  if (v.kind === 'atom' && typeof v.value === 'string' && v.value.startsWith('entity:')) return v.value;
  return null;
}

function ruleTemplate(label: string): string {
  const functor = label
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, '_')
    .replace(/^[^a-z]/, m => `r${m}`)
    || 'rule';
  return `% Humanist rule: ${label}
% Authored as a digital entity tagged 'rule'.
%
% Phase 58 supports only 2-arity heads where both arguments unify
% to entity ids (e.g. entity:01...). Override the auto-detected head
% functor by uncommenting the next line:
%
% @head ${functor}/2

${functor}(X, Y) :-
    edge(X, Y, _),
    X \\= Y.
`;
}

interface SeedRule {
  label: string;
  filename: string;
  body: string;
}

const SEED_RULES: SeedRule[] = [
  {
    label: 'descendant',
    filename: 'descendant.pl',
    body: `% descendant: transitive closure of contains/3 (Class A — reachability).
% True when X reaches Y by any number of 'contains' edges.

descendant(X, Y) :- edge(X, Y, contains).
descendant(X, Y) :- edge(X, Z, contains), descendant(Z, Y).
`,
  },
  {
    label: 'co_tagged',
    filename: 'co_tagged.pl',
    body: `% co_tagged: pairs of entities sharing two or more 'tagged_as' tags
% (Class E — similarity). Use this to surface candidate merges or
% loosely-related groups in the graph.
%
% Note: A and B must be ground (bound to specific entities) before
% findall — otherwise findall iterates over all possible (A, B, T)
% triples and returns aggregate counts, not per-pair counts.

co_tagged(A, B) :-
    entity(A, _, _, _),
    entity(B, _, _, _),
    A @< B,
    findall(T, (edge(A, T, tagged_as), edge(B, T, tagged_as)), Ts),
    length(Ts, N),
    N >= 2.
`,
  },
  {
    label: 'near',
    filename: 'near.pl',
    body: `% near: pairs of entities whose spatial traits are within 50 km
% of each other (Class B — geographic coincidence). Uses the
% haversine/5 helper baked into the humanist_runtime module.

near(A, B) :-
    spatial_trait(_, A, La1, Lo1, _, _, _, _),
    spatial_trait(_, B, La2, Lo2, _, _, _, _),
    A @< B,
    haversine(La1, Lo1, La2, Lo2, D),
    D < 50.0.
`,
  },
];

export function RulesPanel() {
  const allEntities = useOsStore(s => s.allEntities);
  const allTagEdges = useOsStore(s => s.allTagEdges);
  const fetchAllEntities = useOsStore(s => s.fetchAllEntities);
  const setActiveActivity = useOsStore(s => s.setActiveActivity);
  const setSidePanelOpen = useOsStore(s => s.setSidePanelOpen);
  const setEditionEntity = useOsStore(s => s.setEditionEntity);
  const setEditionDoc = useOsStore(s => s.setEditionDoc);

  const [busyRuleId, setBusyRuleId] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [statusKind, setStatusKind] = useState<'info' | 'error'>('info');
  const [newRuleOpen, setNewRuleOpen] = useState(false);
  const [newRuleLabel, setNewRuleLabel] = useState('');
  // Per-rule inline run state. Null = not run yet (or cleared).
  const [runState, setRunState] = useState<Record<string, {
    overlay: OverlayEdge[] | null;
    headFunctor: string;
    headArity: number;
    error: string | null;
    persisted: number | null;
    confirmingPersist: boolean;
  }>>({});

  const setOverlayEdgesGlobal = useOsStore(s => s.setOverlayEdges);
  const fetchEdges = useOsStore(s => s.fetchEdges);

  // Clear overlay when this panel unmounts so derived strokes don't linger.
  useEffect(() => {
    return () => setOverlayEdgesGlobal([]);
  }, [setOverlayEdgesGlobal]);

  const ruleTagId = useMemo(() => {
    return allEntities.find(e => e.category === 'abstract' && e.label === RULE_TAG_LABEL)?.id ?? null;
  }, [allEntities]);

  const rules = useMemo(() => {
    if (!ruleTagId) return [];
    return allEntities.filter(e => isRuleEntity(e, ruleTagId, allTagEdges));
  }, [allEntities, allTagEdges, ruleTagId]);

  // On first mount, ensure the rule tag entity exists.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (ruleTagId) return;
      try {
        await invoke<string>('create_entity', { category: 'abstract', label: RULE_TAG_LABEL });
        if (!cancelled) await fetchAllEntities();
      } catch (e) {
        // Likely a unique-label collision; refetch and continue.
        if (!cancelled) await fetchAllEntities();
        logFrontend('warn', `bootstrap rule tag: ${e}`);
      }
    })();
    return () => { cancelled = true; };
  }, [ruleTagId, fetchAllEntities]);

  // Idempotent seeding: if no rule entities exist *in the database*, ship
  // the three example rules. The check is by-rule-name so individual
  // failures don't block the rest, and a half-seeded state self-heals on
  // next mount.
  const seedAttemptedRef = useState({ value: false })[0];
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!ruleTagId) return;
      if (rules.length > 0) return;
      if (seedAttemptedRef.value) return;
      seedAttemptedRef.value = true;
      try {
        for (const seed of SEED_RULES) {
          // Skip if a rule with this label already exists.
          const existing = allEntities.find(
            e => e.category === 'digital' && e.label === seed.label,
          );
          if (existing) continue;
          try {
            const ruleId = await invoke<string>('create_entity', {
              category: 'digital',
              label: seed.label,
            });
            await invoke('tag_entity', { targetId: ruleId, tagLabel: RULE_TAG_LABEL });
            await invoke('create_rule_blob', {
              entityId: ruleId,
              filename: seed.filename,
              content: seed.body,
            });
          } catch (e) {
            logFrontend('warn', `seed rule '${seed.label}' failed: ${e}`);
          }
        }
        if (!cancelled) await fetchAllEntities();
      } catch (e) {
        logFrontend('warn', `seed rules failed: ${e}`);
      }
    })();
    return () => { cancelled = true; };
  }, [ruleTagId, rules.length, fetchAllEntities, allEntities, seedAttemptedRef]);

  function showStatus(msg: string, kind: 'info' | 'error' = 'info') {
    setStatusMessage(msg);
    setStatusKind(kind);
    if (kind === 'info') {
      setTimeout(() => setStatusMessage(s => (s === msg ? null : s)), 3500);
    }
  }

  async function handleNewRule(rawLabel: string) {
    const label = rawLabel.trim();
    if (!label) return;
    setBusyRuleId('__new__');
    try {
      const ruleId = await invoke<string>('create_entity', { category: 'digital', label });
      // Tag with rule abstract entity. ruleTagId may still be null; create_entity flow
      // handles that via tag_entity (which auto-creates the tag if missing).
      await invoke('tag_entity', { targetId: ruleId, tagLabel: RULE_TAG_LABEL });
      // Create a .pl notes blob via the existing notes path. We bypass create_entity_notes
      // because that defaults to .md; instead we create_blob_content via write_blob_content_by_id
      // after allocating an empty .pl blob.
      const filename = `${label.toLowerCase().replace(/[^a-z0-9_]+/g, '_').replace(/^_+|_+$/g, '') || 'rule'}.pl`;
      const blobTrait = await invoke<{ id: string }>('create_rule_blob', {
        entityId: ruleId,
        filename,
        content: ruleTemplate(label),
      });
      await fetchAllEntities();
      // Open in Edition panel pointing at the new .pl blob
      setActiveActivity('edition');
      setSidePanelOpen(true);
      setEditionEntity(ruleId);
      setEditionDoc(blobTrait.id);
      showStatus(`Created rule '${label}'.`);
      setNewRuleLabel('');
      setNewRuleOpen(false);
    } catch (e) {
      showStatus(`Failed to create rule: ${e}`, 'error');
    } finally {
      setBusyRuleId(null);
    }
  }

  function handleEdit(rule: Entity) {
    setActiveActivity('edition');
    setSidePanelOpen(true);
    setEditionEntity(rule.id);
    setEditionDoc(null);
  }

  // Run is the only user-facing action: it (re)loads the rule body into the
  // live machine and queries its head. This is idempotent — re-running a
  // rule retracts its old clauses (the loader does retractall before assertz)
  // and re-asserts from the .pl on disk, so editor saves are picked up
  // automatically.
  async function handleRun(rule: Entity) {
    setBusyRuleId(rule.id);
    setRunState(s => ({
      ...s,
      [rule.id]: { ...(s[rule.id] ?? { overlay: null, headFunctor: '', headArity: 0, error: null, persisted: null, confirmingPersist: false }) },
    }));
    try {
      const head = await invoke<{ functor: string; arity: number }>('enable_rule', { ruleId: rule.id });
      if (head.arity !== 2) {
        setRunState(s => ({
          ...s,
          [rule.id]: {
            overlay: null,
            headFunctor: head.functor,
            headArity: head.arity,
            error: `Phase 58 supports only 2-arity heads. This rule's head is ${head.functor}/${head.arity}.`,
            persisted: null,
            confirmingPersist: false,
          },
        }));
        return;
      }
      const queryStr = `${head.functor}(X, Y).`;
      const rows = await invoke<Array<Record<string, PrologValue>>>('prolog_query_bindings', {
        query: queryStr,
      });
      const seen = new Set<string>();
      const edges: OverlayEdge[] = [];
      for (const row of rows) {
        const from = asEntityId(row['X']);
        const to = asEntityId(row['Y']);
        if (!from || !to) continue;
        const key = `${from}|${to}`;
        if (seen.has(key)) continue;
        seen.add(key);
        edges.push({ from, to });
      }
      setRunState(s => ({
        ...s,
        [rule.id]: {
          overlay: edges,
          headFunctor: head.functor,
          headArity: head.arity,
          error: null,
          persisted: null,
          confirmingPersist: false,
        },
      }));
      // Push to graph overlay (replace any prior overlay).
      setOverlayEdgesGlobal(
        edges.map(e => ({ ...e, ruleId: rule.id, ruleLabel: head.functor })),
      );
    } catch (e) {
      setRunState(s => ({
        ...s,
        [rule.id]: {
          overlay: null,
          headFunctor: '',
          headArity: 0,
          error: String(e),
          persisted: null,
          confirmingPersist: false,
        },
      }));
    } finally {
      setBusyRuleId(null);
    }
  }

  function handleRequestPersist(rule: Entity) {
    setRunState(s => {
      const cur = s[rule.id];
      if (!cur) return s;
      return { ...s, [rule.id]: { ...cur, confirmingPersist: true } };
    });
  }

  function handleCancelPersist(rule: Entity) {
    setRunState(s => {
      const cur = s[rule.id];
      if (!cur) return s;
      return { ...s, [rule.id]: { ...cur, confirmingPersist: false } };
    });
  }

  async function handleConfirmPersist(rule: Entity) {
    const state = runState[rule.id];
    if (!state || !state.overlay || state.overlay.length === 0) return;
    setBusyRuleId(rule.id);
    try {
      const written = await invoke<number>('persist_rule_overlay', {
        ruleId: rule.id,
        headFunctor: state.headFunctor,
        edges: state.overlay,
      });
      setRunState(s => ({
        ...s,
        [rule.id]: { ...state, overlay: null, persisted: written, confirmingPersist: false },
      }));
      setOverlayEdgesGlobal([]);
      await fetchEdges();
      await fetchAllEntities();
    } catch (e) {
      setRunState(s => ({
        ...s,
        [rule.id]: { ...state, error: String(e), confirmingPersist: false },
      }));
    } finally {
      setBusyRuleId(null);
    }
  }

  function handleClearOverlay(rule: Entity) {
    setRunState(s => {
      const next = { ...s };
      delete next[rule.id];
      return next;
    });
    setOverlayEdgesGlobal([]);
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      <div style={{ padding: '8px 10px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 8 }}>
        <Brain size={14} />
        <span style={{ fontSize: 12, fontWeight: 600 }}>Prolog rules</span>
        <button
          onClick={() => {
            setNewRuleOpen(o => !o);
            if (!newRuleOpen) setNewRuleLabel('');
          }}
          disabled={busyRuleId === '__new__'}
          title={newRuleOpen ? 'Cancel' : 'Create a new rule'}
          style={{
            marginLeft: 'auto',
            background: newRuleOpen ? 'var(--bg-secondary)' : 'var(--accent)',
            color: newRuleOpen ? 'var(--text-primary)' : '#fff',
            border: newRuleOpen ? '1px solid var(--border)' : 'none',
            borderRadius: 4,
            padding: '4px 8px',
            fontSize: 11,
            display: 'flex',
            alignItems: 'center',
            gap: 4,
            cursor: 'pointer',
          }}
        >
          <Plus size={12} /> {newRuleOpen ? 'Cancel' : 'New'}
        </button>
      </div>

      {newRuleOpen && (
        <form
          onSubmit={e => {
            e.preventDefault();
            void handleNewRule(newRuleLabel);
          }}
          style={{
            padding: '8px 10px',
            borderBottom: '1px solid var(--border)',
            display: 'flex',
            flexDirection: 'column',
            gap: 6,
          }}
        >
          <label style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-hint)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            New rule name
          </label>
          <input
            type="text"
            autoFocus
            value={newRuleLabel}
            onChange={e => setNewRuleLabel(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Escape') {
                setNewRuleOpen(false);
                setNewRuleLabel('');
              }
            }}
            placeholder="e.g. near, descendant, co_tagged"
            style={{
              background: 'var(--bg-secondary)',
              color: 'var(--text-primary)',
              border: '1px solid var(--border)',
              borderRadius: 4,
              padding: '6px 8px',
              fontSize: 12,
              fontFamily: 'monospace',
            }}
          />
          <div style={{ display: 'flex', gap: 6 }}>
            <button
              type="submit"
              disabled={!newRuleLabel.trim() || busyRuleId === '__new__'}
              style={{
                flex: 1,
                background: !newRuleLabel.trim() ? 'var(--bg-secondary)' : 'var(--accent)',
                color: !newRuleLabel.trim() ? 'var(--text-hint)' : '#fff',
                border: 'none',
                borderRadius: 4,
                padding: '6px 8px',
                fontSize: 11,
                fontWeight: 600,
                cursor: !newRuleLabel.trim() ? 'not-allowed' : 'pointer',
              }}
            >
              {busyRuleId === '__new__' ? 'Creating…' : 'Create rule'}
            </button>
            <button
              type="button"
              onClick={() => { setNewRuleOpen(false); setNewRuleLabel(''); }}
              style={{
                background: 'none',
                color: 'var(--text-primary)',
                border: '1px solid var(--border)',
                borderRadius: 4,
                padding: '6px 8px',
                fontSize: 11,
                cursor: 'pointer',
              }}
            >
              Cancel
            </button>
          </div>
        </form>
      )}

      {statusMessage && (
        <div
          style={{
            padding: '6px 10px',
            fontSize: 11,
            borderBottom: '1px solid var(--border)',
            color: statusKind === 'error' ? '#ff6b6b' : 'var(--text-hint)',
            background: statusKind === 'error' ? 'rgba(255,107,107,0.08)' : 'transparent',
            display: 'flex',
            alignItems: 'flex-start',
            gap: 6,
          }}
        >
          {statusKind === 'error' ? <AlertCircle size={12} style={{ marginTop: 1 }} /> : <CheckCircle2 size={12} style={{ marginTop: 1, color: '#5dc97e' }} />}
          <span>{statusMessage}</span>
        </div>
      )}

      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto' }}>
        {rules.length === 0 ? (
          <div style={{ padding: 12, fontSize: 11, color: 'var(--text-hint)', lineHeight: 1.5 }}>
            No rules yet. Click <strong>New</strong> to author your first one.
            Rules are <code>digital</code> entities tagged <code>rule</code> with a <code>.pl</code> body.
          </div>
        ) : (
          rules.map(rule => {
            const busy = busyRuleId === rule.id;
            const state = runState[rule.id];
            const hasResult = !!state && (state.overlay !== null || state.error !== null || state.persisted !== null);
            const labelById = new Map(allEntities.map(e => [e.id, e.label] as const));

            return (
              <div
                key={rule.id}
                style={{
                  padding: '8px 10px',
                  borderBottom: '1px solid var(--border)',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 6,
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ flex: 1, fontSize: 12, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {rule.label}
                  </span>
                  <button
                    onClick={() => handleEdit(rule)}
                    title="Edit rule body"
                    style={{ background: 'none', border: 'none', color: 'var(--text-hint)', cursor: 'pointer', padding: 2 }}
                  >
                    <Pencil size={12} />
                  </button>
                  <button
                    onClick={() => void handleRun(rule)}
                    disabled={busy}
                    title="Load rule body and run inference"
                    style={{
                      background: 'var(--accent)',
                      color: '#fff',
                      border: 'none',
                      borderRadius: 4,
                      padding: '3px 8px',
                      fontSize: 11,
                      fontWeight: 600,
                      cursor: busy ? 'wait' : 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 4,
                    }}
                  >
                    {busy ? <Loader2 size={11} className="cm-spin" /> : <Play size={11} />}
                    Run
                  </button>
                </div>

                {hasResult && state && (
                  <div
                    style={{
                      border: '1px solid var(--border)',
                      borderRadius: 4,
                      background: 'var(--bg-secondary)',
                      padding: 8,
                      fontSize: 11,
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 6,
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span style={{ fontFamily: 'monospace', color: 'var(--text-hint)' }}>
                        {state.headFunctor && state.headArity ? `${state.headFunctor}/${state.headArity}` : ''}
                      </span>
                      <span style={{ flex: 1 }} />
                      <button
                        onClick={() => handleClearOverlay(rule)}
                        title="Clear result and overlay"
                        style={{ background: 'none', border: 'none', color: 'var(--text-hint)', cursor: 'pointer', padding: 2 }}
                      >
                        <X size={11} />
                      </button>
                    </div>

                    {state.error && (
                      <div style={{ display: 'flex', gap: 4, color: '#ff6b6b', alignItems: 'flex-start' }}>
                        <AlertCircle size={11} style={{ flexShrink: 0, marginTop: 1 }} />
                        <span style={{ wordBreak: 'break-word' }}>{state.error}</span>
                      </div>
                    )}

                    {state.persisted !== null && (
                      <div style={{ display: 'flex', gap: 4, color: '#5dc97e', alignItems: 'center' }}>
                        <CheckCircle2 size={11} />
                        <span>Persisted {state.persisted} edges (metadata.derived = true).</span>
                      </div>
                    )}

                    {state.overlay !== null && (
                      <>
                        <div style={{ color: 'var(--text-hint)' }}>
                          {state.overlay.length} overlay edge{state.overlay.length === 1 ? '' : 's'}
                        </div>
                        {state.overlay.length === 0 ? (
                          <div style={{ fontStyle: 'italic', color: 'var(--text-hint)' }}>
                            No bindings — the rule's head produces no entity-id pairs against the current data.
                          </div>
                        ) : (
                          <>
                            <div style={{
                              maxHeight: 140,
                              overflowY: 'auto',
                              fontFamily: 'monospace',
                              lineHeight: 1.5,
                              border: '1px solid var(--border)',
                              borderRadius: 3,
                              padding: 4,
                              background: 'var(--bg-panel)',
                            }}>
                              {state.overlay.slice(0, 80).map((e, i) => (
                                <div key={`${e.from}-${e.to}-${i}`} style={{ display: 'flex', gap: 4, color: 'var(--text-hint)' }}>
                                  <span style={{ color: 'var(--text-primary)' }}>{labelById.get(e.from) ?? e.from}</span>
                                  <span>→</span>
                                  <span style={{ color: 'var(--text-primary)' }}>{labelById.get(e.to) ?? e.to}</span>
                                </div>
                              ))}
                              {state.overlay.length > 80 && (
                                <div style={{ fontStyle: 'italic', marginTop: 2 }}>
                                  … and {state.overlay.length - 80} more.
                                </div>
                              )}
                            </div>
                            {state.confirmingPersist ? (
                              <div style={{
                                display: 'flex',
                                flexDirection: 'column',
                                gap: 4,
                                padding: 6,
                                background: 'var(--bg-panel)',
                                border: '1px solid var(--border)',
                                borderRadius: 4,
                              }}>
                                <div style={{ fontSize: 10, color: 'var(--text-hint)', lineHeight: 1.4 }}>
                                  Replace prior <code>{state.headFunctor}</code> derivations and write {state.overlay?.length ?? 0} edges with <code>metadata.derived = true</code>?
                                </div>
                                <div style={{ display: 'flex', gap: 4 }}>
                                  <button
                                    onClick={() => void handleConfirmPersist(rule)}
                                    disabled={busy}
                                    style={{
                                      flex: 1,
                                      background: 'var(--accent)',
                                      color: '#fff',
                                      border: 'none',
                                      borderRadius: 4,
                                      padding: '4px 8px',
                                      fontSize: 10,
                                      fontWeight: 600,
                                      cursor: busy ? 'wait' : 'pointer',
                                    }}
                                  >
                                    {busy ? 'Persisting…' : 'Confirm'}
                                  </button>
                                  <button
                                    onClick={() => handleCancelPersist(rule)}
                                    disabled={busy}
                                    style={{
                                      flex: 1,
                                      background: 'none',
                                      color: 'var(--text-primary)',
                                      border: '1px solid var(--border)',
                                      borderRadius: 4,
                                      padding: '4px 8px',
                                      fontSize: 10,
                                      cursor: busy ? 'wait' : 'pointer',
                                    }}
                                  >
                                    Cancel
                                  </button>
                                </div>
                              </div>
                            ) : (
                              <button
                                onClick={() => handleRequestPersist(rule)}
                                disabled={busy}
                                title="Replace prior derivations from this rule with the current overlay"
                                style={{
                                  background: 'var(--bg-panel)',
                                  color: 'var(--text-primary)',
                                  border: '1px solid var(--border)',
                                  borderRadius: 4,
                                  padding: '4px 8px',
                                  fontSize: 11,
                                  cursor: busy ? 'wait' : 'pointer',
                                  display: 'flex',
                                  alignItems: 'center',
                                  justifyContent: 'center',
                                  gap: 4,
                                }}
                              >
                                <Save size={11} />
                                Persist as edges
                              </button>
                            )}
                          </>
                        )}
                      </>
                    )}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
