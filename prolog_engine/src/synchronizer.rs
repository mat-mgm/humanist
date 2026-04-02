use std::sync::Arc;
use core_engine::bus::events::EventResponse;
use core_engine::db::SurrealDbAdapter;
use core_engine::ports::GraphDatabase;

use crate::ScryerMachine;

/// Maps EventBus SurrealDB signals back into dynamically registered Prolog predicates
pub struct StateSynchronizerTask {
    machine: Arc<ScryerMachine>,
    db: SurrealDbAdapter,
}

impl StateSynchronizerTask {
    pub fn new(machine: Arc<ScryerMachine>, db: SurrealDbAdapter) -> Self {
        Self { machine, db }
    }

    /// Pulls the entire state from GraphDatabase and maps it into Prolog memory layout.
    pub async fn load_all_facts(machine: &ScryerMachine, db: &SurrealDbAdapter) -> Result<(), String> {
        let entities = db.list_entities().await?;
        for e in entities {
            let label_safe = e.label.replace('\'', "\\'");
            let fact = format!("entity('{}', '{}').", e.id, label_safe);
            let _ = machine.ingest(&fact);
        }

        let edges = db.get_edges().await?;
        for (from, to, label) in edges {
            let label_safe = label.replace('\'', "\\'");
            let fact = format!("edge('{}', '{}', '{}').", from, to, label_safe);
            let _ = machine.ingest(&fact);
        }
        
        Ok(())
    }

    /// Long running async loop to map incoming bus signals to the local Scryer context
    pub async fn run(&self, mut rx: tokio::sync::broadcast::Receiver<EventResponse>) {
        while let Ok(event) = rx.recv().await {
            match event.topic.as_str() {
                "entity.created" | "entity.updated" => {
                    if let Ok(entity) = self.db.get_entity(&event.ulid).await {
                        // Register dynamically via label unification wrapper
                        let fact = format!("entity('{}').", entity.id);
                        let _ = self.machine.ingest(&fact);
                        
                        // We can also extend this to loop over entity.tags or metadata
                        // and assert trait(...) predicates!
                    }
                }
                "edge.created" => {
                    // Logic to retrieve edge and format into `edge('In', 'Out', 'Label').`
                    // or dynamic predicate `label('In', 'Out').`
                }
                _ => {}
            }
        }
    }
}
