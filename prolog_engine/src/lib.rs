use scryer_prolog::machine::Machine;
use std::sync::{Arc, Mutex};

/// Core Application Service managing the Scryer Prolog Instance
#[derive(Clone)]
pub struct ScryerMachine {
    pub machine: Arc<Mutex<Machine>>,
}

impl ScryerMachine {
    pub fn new() -> Self {
        let machine = Machine::new_lib();
        Self {
            machine: Arc::new(Mutex::new(machine)),
        }
    }

    /// Evaluates a raw string as Prolog facts/rules to ingest
    pub fn ingest(&self, raw_prolog: &str) -> std::result::Result<(), String> {
        let mut m = self.machine.lock().map_err(|_| "Failed to lock machine".to_string())?;
        // Wrap facts and rules into assertz to populate machine memory state
        let query = format!("assertz(({})).", raw_prolog.trim_end_matches('.'));
        let res = m.run_query(query).map_err(|_| "Syntax error".to_string())?;
        
        // Consume to execute side-effects via format (or loop if matches)
        let _ = format!("{:?}", res);
        Ok(())
    }
}

pub mod synchronizer;

pub struct InferenceEngine {
    pub machine: ScryerMachine,
}

impl InferenceEngine {
    pub fn new(machine: ScryerMachine) -> Self {
        Self { machine }
    }

    pub fn query(&self, query_string: &str) -> std::result::Result<Vec<String>, String> {
        let mut m = self.machine.machine.lock().map_err(|_| "Failed to lock machine".to_string())?;
        
        let res = m.run_query(query_string.to_string()).map_err(|_| "Syntax error".to_string())?;

        // Just capture the Debug output of QueryResolution (True, False, or Matches(bindings))
        let mut results = Vec::new();
        results.push(format!("{:?}", res));
        Ok(results)
    }

    /// Mechanism to materialize resulting deductions back locally or publish to EventBus 
    /// as persistent semantic edges.
    pub async fn materialize_inference(&self, _db: &core_engine::db::SurrealDbAdapter, query: &str) -> std::result::Result<(), String> {
        let _results = self.query(query)?;
        // Here we would parse _results into (NodeA, NodeB), and invoke db.add_edge(...)
        // to persist the deduced semantic edges back to the datastore!
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_scryer_initialization() {
        // Just verify it doesn't panic when initializing memory allocation
        let _machine = ScryerMachine::new();
        assert!(true, "Scryer Machine initialized successfully");
    }

    #[test]
    fn test_logical_inference() {
        let machine = ScryerMachine::new();
        
        // 1. Ingest dynamic predicates
        machine.ingest("edge('id1', 'NodeA', 'NodeB', 'contains').").unwrap();
        machine.ingest("edge('id2', 'NodeB', 'NodeC', 'contains').").unwrap();
        
        // 2. Ingest an inference rule
        machine.ingest("reachable(X, Y) :- edge(_, X, Y, _).").unwrap();
        machine.ingest("reachable(X, Y) :- edge(_, X, Z, _), reachable(Z, Y).").unwrap();
        
        // 3. Ask the engine to deduce information!
        let ie = InferenceEngine::new(machine);
        let results = ie.query("reachable('NodeA', Destination).").unwrap();
        
        println!("Raw inference results: {:#?}", results);
        
        // 4. Verify it correctly inferred NodeB and NodeC
        // Bindings contain destination targets
        let results_str = results.join(",");
        assert!(results_str.contains("NodeB"));
        assert!(results_str.contains("NodeC"));
    }
}
