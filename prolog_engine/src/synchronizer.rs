use core_engine::bus::events::EventResponse;
use core_engine::db::SurrealDbAdapter;
use core_engine::models::DomainSnapshot;
use core_engine::ports::GraphDatabase;
use std::sync::Arc;

use crate::schema;
use crate::ScryerMachine;

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
                let entity = self.db.get_entity(&event.ulid).await?;
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
                let id = format!("entity:{}", event.ulid);
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

async fn build_snapshot(db: &SurrealDbAdapter) -> Result<DomainSnapshot, String> {
    Ok(DomainSnapshot {
        entities: db.list_entities().await?,
        label_traits: db.get_all_label_traits().await?,
        spatial_traits: db.get_spatial_traits().await?,
        temporal_traits: db.get_temporal_traits().await?,
        blob_traits: db.get_blob_traits().await?,
        relationship_types: db.list_relationship_types().await?,
        edges: db.get_edges().await?,
        blob_files: Vec::new(),
    })
}
