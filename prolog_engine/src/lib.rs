use scryer_prolog::machine::parsed_results::{QueryMatch, QueryResolution, Value};
use scryer_prolog::machine::Machine;
use std::panic::{catch_unwind, AssertUnwindSafe};
use std::sync::{Arc, Mutex};

/// Core Application Service managing the Scryer Prolog Instance
#[derive(Clone)]
pub struct ScryerMachine {
    pub machine: Arc<Mutex<Machine>>,
}

impl ScryerMachine {
    pub fn new() -> Self {
        let mut machine = Machine::new_lib();
        machine.consult_module_string(
            "spatial_os_runtime",
            ":- use_module(library(charsio)).".to_string(),
        );
        tracing::info!("prolog engine ready");
        Self {
            machine: Arc::new(Mutex::new(machine)),
        }
    }

    /// Evaluates a raw string as Prolog facts/rules to ingest
    pub fn ingest(&self, raw_prolog: &str) -> std::result::Result<(), String> {
        let mut m = self.machine.lock().map_err(|_| "Failed to lock machine".to_string())?;
        // Wrap facts and rules into assertz to populate machine memory state
        let query = format!("assertz(({})).", raw_prolog.trim_end_matches('.'));
        let res = m.run_query(query).map_err(|e| e.to_string())?;
        
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

        let normalized = prepare_query(query_string);
        let res = catch_unwind(AssertUnwindSafe(|| m.run_query(normalized)))
            .map_err(|_| "Prolog engine panic while parsing query".to_string())?
            .map_err(|e| e.to_string())?;

        Ok(format_query_resolution(&res))
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

fn normalize_query(query: &str) -> String {
    let trimmed = query.trim();
    if trimmed.ends_with('.') {
        trimmed.to_string()
    } else {
        format!("{trimmed}.")
    }
}

fn prepare_query(query: &str) -> String {
    let normalized = normalize_query(query);
    let body = normalized.trim().trim_end_matches('.').trim();
    let (rewritten, bindings) = rewrite_visible_variables(body);

    if bindings.is_empty() {
        return normalized;
    }

    let projections = bindings
        .iter()
        .map(|(visible, internal)| {
            format!(
                "write_term_to_chars({internal}, [quoted(true),numbervars(true)], _Chars_{internal}), atom_chars({visible}, _Chars_{internal})"
            )
        })
        .collect::<Vec<_>>()
        .join(", ");

    format!("({rewritten}), {projections}.")
}

fn rewrite_visible_variables(query: &str) -> (String, Vec<(String, String)>) {
    use std::collections::BTreeMap;

    let mut rewritten = String::with_capacity(query.len());
    let mut vars: BTreeMap<String, String> = BTreeMap::new();
    let mut order: Vec<String> = Vec::new();
    let chars: Vec<char> = query.chars().collect();
    let mut i = 0usize;
    let mut in_single = false;
    let mut in_double = false;

    while i < chars.len() {
        let ch = chars[i];

        if ch == '\'' && !in_double {
            in_single = !in_single;
            rewritten.push(ch);
            i += 1;
            continue;
        }

        if ch == '"' && !in_single {
            in_double = !in_double;
            rewritten.push(ch);
            i += 1;
            continue;
        }

        let is_var_start = (ch.is_ascii_uppercase() || ch == '_')
            && !in_single
            && !in_double
            && (i == 0 || (!chars[i - 1].is_ascii_alphanumeric() && chars[i - 1] != '_'));

        if is_var_start {
            let start = i;
            i += 1;
            while i < chars.len() && (chars[i].is_ascii_alphanumeric() || chars[i] == '_') {
                i += 1;
            }
            let token: String = chars[start..i].iter().collect();

            if token.chars().next().is_some_and(|c| c.is_ascii_uppercase()) {
                let internal = vars.entry(token.clone()).or_insert_with(|| {
                    order.push(token.clone());
                    format!("_Q{}", order.len() - 1)
                });
                rewritten.push_str(internal);
            } else {
                rewritten.push_str(&token);
            }
            continue;
        }

        rewritten.push(ch);
        i += 1;
    }

    let bindings = order
        .into_iter()
        .map(|visible| {
            let internal = vars.get(&visible).cloned().unwrap_or_default();
            (visible, internal)
        })
        .collect();

    (rewritten, bindings)
}

fn format_query_resolution(resolution: &QueryResolution) -> Vec<String> {
    match resolution {
        QueryResolution::True => vec!["true.".to_string()],
        QueryResolution::False => vec!["false.".to_string()],
        QueryResolution::Matches(matches) => {
            let mut lines = Vec::with_capacity(matches.len() + 1);
            lines.push(format!("{} solution{}.", matches.len(), if matches.len() == 1 { "" } else { "s" }));
            for (index, query_match) in matches.iter().enumerate() {
                lines.push(format!("{}:", index + 1));
                lines.extend(format_query_match(query_match));
            }
            lines
        }
    }
}

fn format_query_match(query_match: &QueryMatch) -> Vec<String> {
    if query_match.bindings.is_empty() {
        return vec!["  true.".to_string()];
    }

    query_match
        .bindings
        .iter()
        .map(|(name, value)| format!("  {name} = {}", format_value(value)))
        .collect()
}

fn format_value(value: &Value) -> String {
    match value {
        Value::Integer(v) => v.to_string(),
        Value::Rational(v) => v.to_string(),
        Value::Float(v) => v.to_string(),
        Value::Atom(v) => v.as_str().to_string(),
        Value::String(v) => v.clone(),
        Value::List(values) => {
            let rendered = values.iter().map(format_value).collect::<Vec<_>>().join(", ");
            format!("[{rendered}]")
        }
        Value::Structure(functor, args) => {
            let rendered = args.iter().map(format_value).collect::<Vec<_>>().join(", ");
            format!("{}({rendered})", functor.as_str())
        }
        Value::Var => "_".to_string(),
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

    #[test]
    fn test_builtin_functor_query() {
        let machine = ScryerMachine::new();
        let ie = InferenceEngine::new(machine);
        let results = ie.query("functor(X, edge, 2).").unwrap();
        let results_str = results.join("\n");
        assert!(results_str.contains("X ="));
        assert!(results_str.contains("edge"));
    }

    #[test]
    fn test_prepare_query_wraps_visible_vars() {
        let prepared = prepare_query("functor(X, edge, 2).");
        assert!(prepared.contains("functor(_Q0, edge, 2)"));
        assert!(prepared.contains("write_term_to_chars(_Q0"));
        assert!(prepared.contains("atom_chars(X, _Chars__Q0)"));
    }
}
