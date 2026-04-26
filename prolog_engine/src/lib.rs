use scryer_prolog::machine::parsed_results::{QueryMatch, QueryResolution, Value};
use scryer_prolog::machine::Machine;
use std::collections::HashMap;
use std::panic::{catch_unwind, AssertUnwindSafe};
use std::sync::{Arc, Mutex};

pub mod io;
pub mod rules;
pub mod schema;
pub mod synchronizer;

/// Core Application Service managing the Scryer Prolog Instance
#[derive(Clone)]
pub struct ScryerMachine {
    pub machine: Arc<Mutex<Machine>>,
}

impl ScryerMachine {
    pub fn new() -> Self {
        let mut machine = Machine::new_lib();
        machine.consult_module_string("humanist_runtime", Self::runtime_source());
        tracing::info!("prolog engine ready");
        Self {
            machine: Arc::new(Mutex::new(machine)),
        }
    }

    /// Initial Prolog text consulted into every fresh machine. Declares
    /// every canonical predicate as `dynamic`, pulls in standard libraries
    /// the schema tokenizer relies on, and exposes a `haversine/5` helper
    /// so spatial rules (e.g. `near/2`) don't need to reinvent the math.
    fn runtime_source() -> String {
        r#"
:- use_module(library(charsio)).
:- use_module(library(lists)).
:- dynamic(entity/4).
:- dynamic(label_trait/4).
:- dynamic(spatial_trait/8).
:- dynamic(temporal_trait/6).
:- dynamic(blob_trait/6).
:- dynamic(blob_file/4).
:- dynamic(relationship_type/8).
:- dynamic(edge/3).
:- dynamic(edge_payload/5).

% deg2rad(+Deg, -Rad)
deg2rad(D, R) :- R is D * 0.017453292519943295.

% haversine(+Lat1, +Lon1, +Lat2, +Lon2, -KmDistance)
% Great-circle distance between two WGS84 points in kilometres.
haversine(Lat1, Lon1, Lat2, Lon2, Km) :-
    deg2rad(Lat1, Phi1),
    deg2rad(Lat2, Phi2),
    deg2rad(Lat2 - Lat1, DPhi),
    deg2rad(Lon2 - Lon1, DLam),
    A is sin(DPhi / 2.0) ** 2.0
       + cos(Phi1) * cos(Phi2) * sin(DLam / 2.0) ** 2.0,
    C is 2.0 * atan2(sqrt(A), sqrt(1.0 - A)),
    Km is 6371.0088 * C.
"#
        .to_string()
    }

    /// Asserts a single Prolog clause (fact or rule) into the live machine.
    /// Caller is responsible for trailing-period normalization.
    pub fn ingest(&self, raw_prolog: &str) -> std::result::Result<(), String> {
        let mut m = self.machine.lock().map_err(|_| "Failed to lock machine".to_string())?;
        let body = raw_prolog.trim().trim_end_matches('.').trim();
        let query = format!("assertz(({})).", body);
        let res = m.run_query(query).map_err(|e| e.to_string())?;
        let _ = format!("{:?}", res);
        Ok(())
    }

    /// Retracts every clause matching the given head pattern.
    pub fn retract_all(&self, head_pattern: &str) -> std::result::Result<(), String> {
        let mut m = self.machine.lock().map_err(|_| "Failed to lock machine".to_string())?;
        let query = format!("retractall({}).", head_pattern);
        let res = m.run_query(query).map_err(|e| e.to_string())?;
        let _ = format!("{:?}", res);
        Ok(())
    }

    /// Bulk-ingests a multi-clause text body (used for snapshot loads and
    /// rule consults). Splits on top-level `.` followed by whitespace; safe
    /// for the canonical schema output where every fact ends in `.\n`.
    pub fn ingest_facts(&self, text: &str) -> std::result::Result<(), String> {
        for raw in split_clauses(text) {
            if raw.trim().is_empty() {
                continue;
            }
            self.ingest(&raw)?;
        }
        Ok(())
    }
}

fn split_clauses(text: &str) -> Vec<String> {
    let mut out = Vec::new();
    let mut buf = String::new();
    let mut in_single = false;
    let chars: Vec<char> = text.chars().collect();
    let mut i = 0;
    while i < chars.len() {
        let c = chars[i];
        if c == '%' && !in_single {
            while i < chars.len() && chars[i] != '\n' {
                i += 1;
            }
            continue;
        }
        if c == '\'' {
            // Honor backslash escapes inside quoted atoms.
            in_single = !in_single;
            buf.push(c);
            i += 1;
            continue;
        }
        if c == '\\' && in_single && i + 1 < chars.len() {
            buf.push(c);
            buf.push(chars[i + 1]);
            i += 2;
            continue;
        }
        buf.push(c);
        if c == '.' && !in_single {
            // A clause terminator is a '.' followed by EOF or whitespace.
            let next = chars.get(i + 1).copied();
            if next.map_or(true, |n| n.is_whitespace()) {
                out.push(std::mem::take(&mut buf));
            }
        }
        i += 1;
    }
    if !buf.trim().is_empty() {
        out.push(buf);
    }
    out
}

// ---------------------------------------------------------------------------
// Inference engine + structured bindings
// ---------------------------------------------------------------------------

pub struct InferenceEngine {
    pub machine: ScryerMachine,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(tag = "kind", content = "value", rename_all = "snake_case")]
pub enum PrologValue {
    Atom(String),
    Integer(i64),
    Float(f64),
    String(String),
    EntityId(String),
    List(Vec<PrologValue>),
    Compound { functor: String, args: Vec<PrologValue> },
    Var,
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

    /// Structured binding API for GUI consumers. Returns one map per
    /// solution; atoms shaped like `entity:<ulid>` are decoded as `EntityId`.
    pub fn query_bindings(
        &self,
        query_string: &str,
    ) -> std::result::Result<Vec<HashMap<String, PrologValue>>, String> {
        let mut m = self.machine.machine.lock().map_err(|_| "Failed to lock machine".to_string())?;

        let normalized = normalize_query(query_string);
        let res = catch_unwind(AssertUnwindSafe(|| m.run_query(normalized)))
            .map_err(|_| "Prolog engine panic while parsing query".to_string())?
            .map_err(|e| e.to_string())?;

        Ok(extract_bindings(&res))
    }
}

fn extract_bindings(resolution: &QueryResolution) -> Vec<HashMap<String, PrologValue>> {
    match resolution {
        QueryResolution::True | QueryResolution::False => Vec::new(),
        QueryResolution::Matches(matches) => matches
            .iter()
            .map(|m| {
                m.bindings
                    .iter()
                    .map(|(name, value)| (name.clone(), value_to_prolog(value)))
                    .collect()
            })
            .collect(),
    }
}

fn value_to_prolog(value: &Value) -> PrologValue {
    match value {
        Value::Integer(v) => v
            .to_string()
            .parse::<i64>()
            .map(PrologValue::Integer)
            .unwrap_or_else(|_| PrologValue::Atom(v.to_string())),
        Value::Rational(v) => PrologValue::Atom(v.to_string()),
        Value::Float(v) => PrologValue::Float(v.into_inner()),
        Value::Atom(v) => atom_to_prolog(&v.as_str()),
        Value::String(v) => atom_to_prolog(v),
        Value::List(values) => PrologValue::List(values.iter().map(value_to_prolog).collect()),
        Value::Structure(functor, args) => PrologValue::Compound {
            functor: functor.as_str().to_string(),
            args: args.iter().map(value_to_prolog).collect(),
        },
        Value::Var => PrologValue::Var,
    }
}

fn atom_to_prolog(s: &str) -> PrologValue {
    if s.starts_with("entity:") {
        PrologValue::EntityId(s.to_string())
    } else {
        PrologValue::Atom(s.to_string())
    }
}

// ---------------------------------------------------------------------------
// Query normalization (preserves user-visible variable names in textual mode)
// ---------------------------------------------------------------------------

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
        let _machine = ScryerMachine::new();
    }

    #[test]
    fn test_logical_inference() {
        let machine = ScryerMachine::new();

        machine.ingest("edge('NodeA', 'NodeB', 'contains').").unwrap();
        machine.ingest("edge('NodeB', 'NodeC', 'contains').").unwrap();

        machine.ingest("reachable(X, Y) :- edge(X, Y, _).").unwrap();
        machine.ingest("reachable(X, Y) :- edge(X, Z, _), reachable(Z, Y).").unwrap();

        let ie = InferenceEngine::new(machine);
        let results = ie.query("reachable('NodeA', Destination).").unwrap();
        let results_str = results.join(",");
        assert!(results_str.contains("NodeB"));
        assert!(results_str.contains("NodeC"));
    }

    #[test]
    fn test_split_clauses_handles_quoted_periods() {
        let text = "entity('a.b', physical, 'x', 'en').\nentity('c', digital, 'y', 'en').\n";
        let clauses = split_clauses(text);
        assert_eq!(clauses.len(), 2);
        assert!(clauses[0].contains("'a.b'"));
    }

    #[test]
    fn test_query_bindings_returns_structured_atoms() {
        let machine = ScryerMachine::new();
        machine
            .ingest("edge('entity:01', 'entity:02', 'contains').")
            .unwrap();
        let ie = InferenceEngine::new(machine);
        let bindings = ie.query_bindings("edge(X, Y, 'contains').").unwrap();
        assert_eq!(bindings.len(), 1);
        let row = &bindings[0];
        match row.get("X") {
            Some(PrologValue::EntityId(s)) => assert_eq!(s, "entity:01"),
            other => panic!("expected EntityId, got {:?}", other),
        }
    }

    #[test]
    fn test_user_rule_via_bindings_api() {
        // Mirrors the GUI flow: load ground facts, consult a multi-clause
        // user rule, query its head via the structured bindings API.
        let machine = ScryerMachine::new();
        machine.ingest_facts(
            "edge('entity:a', 'entity:b', 'contains').\nedge('entity:b', 'entity:c', 'contains').\n",
        )
        .unwrap();
        let rule_body = "descendant(X, Y) :- edge(X, Y, contains).\ndescendant(X, Y) :- edge(X, Z, contains), descendant(Z, Y).\n";
        crate::rules::enable(&machine, rule_body).unwrap();

        let ie = InferenceEngine::new(machine);
        let bindings = ie.query_bindings("descendant(X, Y).").unwrap();
        assert!(
            !bindings.is_empty(),
            "expected at least one descendant solution; got {:?}",
            bindings
        );
    }

    #[test]
    fn test_retract_all_removes_facts() {
        let machine = ScryerMachine::new();
        machine
            .ingest("entity('e1', physical, 'A', 'en').")
            .unwrap();
        machine.retract_all("entity(_, _, _, _)").unwrap();
        let ie = InferenceEngine::new(machine);
        let results = ie.query("entity(_, _, _, _).").unwrap();
        assert_eq!(results.first().map(String::as_str), Some("false."));
    }
}
