use core_engine::bus::events::EventResponse;
use core_engine::db::SurrealDbAdapter;
use core_engine::models::DomainSnapshot;
use core_engine::ports::GraphDatabase;
use core_engine::snapshot::build_snapshot;
use std::sync::Arc;

use crate::schema;
use crate::ScryerMachine;

/// Canonical predicate patterns that get cleared then re-asserted by
/// `reload_facts`. Kept in lockstep with the runtime declarations in
/// `ScryerMachine::new`.
const GROUND_PATTERNS: &[&str] = &[
    "entity(_, _, _, _)",
    "label_trait(_, _, _, _)",
    "spatial_trait(_, _, _, _, _, _, _, _)",
    "temporal_trait(_, _, _, _, _, _)",
    "blob_trait(_, _, _, _, _, _)",
    "blob_file(_, _, _, _)",
    "relationship_type(_, _, _, _, _, _, _, _)",
    "edge(_, _, _)",
    "edge_payload(_, _, _, _, _)",
];

/// Replaces every canonical ground fact in the live machine with a fresh
/// snapshot built from the database. Necessary before user-rule inference
/// because the synchronizer only mirrors EventBus traffic; out-of-band
/// writes (CLI seed scripts, raw SurrealQL via the SQL terminal,
/// imported snapshots) bypass it entirely.
///
/// Bridging rules are also regenerated so any newly-added relationship
/// types are reflected in the Model 2 view.
pub async fn reload_facts(
    machine: &ScryerMachine,
    db: &SurrealDbAdapter,
) -> Result<(), String> {
    for pattern in GROUND_PATTERNS {
        machine.retract_all(pattern)?;
    }
    let snapshot = build_snapshot(db).await?;
    let text = schema::to_facts(&snapshot);
    machine.ingest_facts(&text)?;
    let bridging = schema::bridging_rules(&snapshot.relationship_types);
    if !bridging.is_empty() {
        machine.ingest_facts(&bridging)?;
    }
    Ok(())
}

/// Maps EventBus signals into the live Prolog machine via the canonical
/// schema layer. Owns no fact-string formatting of its own — every clause
/// is produced by `prolog_engine::schema`.
pub struct StateSynchronizerTask {
    machine: Arc<ScryerMachine>,
    db: SurrealDbAdapter,
}

impl StateSynchronizerTask {
    pub fn new(machine: Arc<ScryerMachine>, db: SurrealDbAdapter) -> Self {
        Self { machine, db }
    }

    /// Builds a full `DomainSnapshot` from the database and loads it into
    /// the machine. Used at startup and after wholesale reloads.
    pub async fn load_all_facts(
        machine: &ScryerMachine,
        db: &SurrealDbAdapter,
    ) -> Result<(), String> {
        let snapshot = build_snapshot(db).await?;
        let text = schema::to_facts(&snapshot);
        machine.ingest_facts(&text)?;
        let bridging = schema::bridging_rules(&snapshot.relationship_types);
        if !bridging.is_empty() {
            machine.ingest_facts(&bridging)?;
        }
        Ok(())
    }

    /// Long-running async loop. Translates DB events into retract/assert
    /// pairs against the canonical predicates so the machine state stays
    /// in sync with the database without ever growing duplicate facts.
    pub async fn run(&self, mut rx: tokio::sync::broadcast::Receiver<EventResponse>) {
        while let Ok(event) = rx.recv().await {
            if let Err(err) = self.dispatch(&event).await {
                tracing::warn!(topic = %event.topic, ulid = %event.ulid, error = %err, "synchronizer dispatch failed");
            }
        }
    }

    async fn dispatch(&self, event: &EventResponse) -> Result<(), String> {
        match event.topic.as_str() {
            "entity.created" | "entity.updated" => {
                let id = canonical_entity_id(&event.ulid);
                let entity = self.db.get_entity(&id).await?;
                let id_atom = single_quote(&entity.id);
                self.machine
                    .retract_all(&format!("entity({}, _, _, _)", id_atom))?;
                if entity.deleted_at.is_none() {
                    let snap = DomainSnapshot {
                        entities: vec![entity],
                        ..Default::default()
                    };
                    self.machine.ingest_facts(&schema::to_facts(&snap))?;
                }
            }
            "entity.deleted" => {
                let id = canonical_entity_id(&event.ulid);
                let id_atom = single_quote(&id);
                self.machine
                    .retract_all(&format!("entity({}, _, _, _)", id_atom))?;
                self.machine
                    .retract_all(&format!("edge({}, _, _)", id_atom))?;
                self.machine
                    .retract_all(&format!("edge(_, {}, _)", id_atom))?;
            }
            "edge.created" | "edge.updated" | "edge.deleted" => {
                // Cheap path: rebuild edge facts from DB. Edges have no
                // unique key in the broadcast payload.
                let edges = self.db.get_edges().await?;
                self.machine.retract_all("edge(_, _, _)")?;
                self.machine.retract_all("edge_payload(_, _, _, _, _)")?;
                let snap = DomainSnapshot {
                    edges,
                    ..Default::default()
                };
                self.machine.ingest_facts(&schema::to_facts(&snap))?;
            }
            "relationship_type.created"
            | "relationship_type.updated"
            | "relationship_type.deleted" => {
                let types = self.db.list_relationship_types().await?;
                self.machine
                    .retract_all("relationship_type(_, _, _, _, _, _, _, _)")?;
                let snap = DomainSnapshot {
                    relationship_types: types.clone(),
                    ..Default::default()
                };
                self.machine.ingest_facts(&schema::to_facts(&snap))?;
                let bridging = schema::bridging_rules(&types);
                if !bridging.is_empty() {
                    self.machine.ingest_facts(&bridging)?;
                }
            }
            _ => {}
        }
        Ok(())
    }
}

/// Ensures the event ulid carries the `entity:` table prefix expected by
/// `GraphDatabase::get_entity`. Event payloads carry only the bare ULID.
fn canonical_entity_id(ulid_or_full: &str) -> String {
    if ulid_or_full.starts_with("entity:") {
        ulid_or_full.to_string()
    } else {
        format!("entity:{}", ulid_or_full)
    }
}

/// Quotes a string as a Prolog atom for use in a retract pattern. Mirrors
/// the schema module's quoting (kept private there since the schema module
/// is the only normal-path producer of atoms).
fn single_quote(s: &str) -> String {
    let mut out = String::with_capacity(s.len() + 2);
    out.push('\'');
    for ch in s.chars() {
        match ch {
            '\'' => out.push_str("\\'"),
            '\\' => out.push_str("\\\\"),
            c => out.push(c),
        }
    }
    out.push('\'');
    out
}

