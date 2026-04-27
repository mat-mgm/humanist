//! Canonical Prolog fact schema.
//!
//! This module is the single owner of the translation between Rust domain
//! types and Prolog ground facts. Every other component that emits or parses
//! Prolog text — synchronizer, snapshot import/export, query result decoder —
//! goes through this module. There is one declared arity per predicate.
//!
//! # Vocabulary (Model 1, fixed arity)
//!
//! ```prolog
//! entity(Id, Category, Label, LangCanonical).
//! label_trait(Id, Owner, Lang, Text).
//! spatial_trait(Id, Owner, Lat, Lon, Alt, Heading, Bbox, Projection).
//! temporal_trait(Id, Owner, EventAt, StartsAt, EndsAt, Recurrence).
//! blob_trait(Id, Owner, Filename, StorageId, Mime, Hash).
//! key_value_trait(Id, Owner, Namespace, Json).
//! table_trait(Id, Owner, Namespace, ColumnsJson, RowsJson).
//! blob_file(BlobId, RelativePath, Hash, Mime).
//! relationship_type(Id, Label, Transitive, Symmetric, InheritsTraits, Visible, Flow, Routing).
//! edge(From, To, Label).
//! edge_payload(From, To, Label, Strength, Latency).
//! ```
//!
//! `none` is used for `Option::None`. Atoms are single-quoted with embedded
//! quotes escaped. Lists serialize as `[a, b, c]`. Booleans serialize as
//! `true` / `false`. Numbers serialize with their `Display` representation.

use core_engine::models::{
    BlobFile, BlobTrait, DomainPatch, DomainSnapshot, Entity, EntityKind, EdgeRecord,
    KeyValueTrait, LabelTrait, RelationshipType, SpatialTrait, TableColumn, TableTrait,
    TemporalTrait,
};
use serde::Serialize;
use std::collections::{BTreeMap, HashMap};

// ---------------------------------------------------------------------------
// Atom quoting
// ---------------------------------------------------------------------------

fn quote_atom(s: &str) -> String {
    let mut out = String::with_capacity(s.len() + 2);
    out.push('\'');
    for ch in s.chars() {
        match ch {
            '\'' => out.push_str("\\'"),
            '\\' => out.push_str("\\\\"),
            '\n' => out.push_str("\\n"),
            '\r' => out.push_str("\\r"),
            '\t' => out.push_str("\\t"),
            c => out.push(c),
        }
    }
    out.push('\'');
    out
}

fn quote_opt_string(value: &Option<String>) -> String {
    match value {
        Some(s) => quote_atom(s),
        None => "none".to_string(),
    }
}

fn quote_opt_f64(value: Option<f64>) -> String {
    match value {
        Some(v) => format_f64(v),
        None => "none".to_string(),
    }
}

fn quote_opt_i64(value: Option<i64>) -> String {
    match value {
        Some(v) => v.to_string(),
        None => "none".to_string(),
    }
}

fn format_f64(v: f64) -> String {
    if v.is_finite() && v.fract() == 0.0 {
        format!("{:.1}", v)
    } else {
        v.to_string()
    }
}

fn format_bbox(bbox: &Option<Vec<f64>>) -> String {
    match bbox {
        Some(values) if !values.is_empty() => {
            let parts: Vec<String> = values.iter().copied().map(format_f64).collect();
            format!("[{}]", parts.join(","))
        }
        _ => "none".to_string(),
    }
}

fn category_atom(c: &EntityKind) -> &'static str {
    match c {
        EntityKind::Physical => "physical",
        EntityKind::Digital => "digital",
        EntityKind::Abstract => "abstract",
        EntityKind::Persona => "persona",
    }
}

fn parse_category(atom: &str) -> Result<EntityKind, String> {
    match atom {
        "physical" => Ok(EntityKind::Physical),
        "digital" => Ok(EntityKind::Digital),
        "abstract" => Ok(EntityKind::Abstract),
        "persona" => Ok(EntityKind::Persona),
        other => Err(format!("unknown category atom '{}'", other)),
    }
}

fn canonical_json(value: &serde_json::Value) -> serde_json::Value {
    match value {
        serde_json::Value::Object(map) => {
            let sorted: BTreeMap<String, serde_json::Value> = map
                .iter()
                .map(|(k, v)| (k.clone(), canonical_json(v)))
                .collect();
            serde_json::Value::Object(sorted.into_iter().collect())
        }
        serde_json::Value::Array(values) => {
            serde_json::Value::Array(values.iter().map(canonical_json).collect())
        }
        other => other.clone(),
    }
}

fn to_canonical_json_string<T: Serialize>(value: &T) -> String {
    let raw = serde_json::to_value(value).expect("canonical JSON conversion should not fail");
    serde_json::to_string(&canonical_json(&raw))
        .expect("canonical JSON serialization should not fail")
}

// ---------------------------------------------------------------------------
// Serializer
// ---------------------------------------------------------------------------

/// Serializes a `DomainSnapshot` into canonical Prolog fact text.
///
/// Output is sorted by id within each predicate group for byte-deterministic
/// exports.
pub fn to_facts(snapshot: &DomainSnapshot) -> String {
    let mut out = String::new();
    out.push_str("% Humanist domain snapshot — canonical Prolog fact schema\n");
    out.push_str("% Generated by prolog_engine::schema\n\n");

    let mut entities = snapshot.entities.clone();
    entities.sort_by(|a, b| a.id.cmp(&b.id));
    for e in &entities {
        out.push_str(&entity_fact(e));
        out.push('\n');
    }
    if !entities.is_empty() {
        out.push('\n');
    }

    let mut labels = snapshot.label_traits.clone();
    labels.sort_by(|a, b| a.id.cmp(&b.id));
    for t in &labels {
        out.push_str(&label_trait_fact(t));
        out.push('\n');
    }
    if !labels.is_empty() {
        out.push('\n');
    }

    let mut spatial = snapshot.spatial_traits.clone();
    spatial.sort_by(|a, b| a.id.cmp(&b.id));
    for t in &spatial {
        out.push_str(&spatial_trait_fact(t));
        out.push('\n');
    }
    if !spatial.is_empty() {
        out.push('\n');
    }

    let mut temporal = snapshot.temporal_traits.clone();
    temporal.sort_by(|a, b| a.id.cmp(&b.id));
    for t in &temporal {
        out.push_str(&temporal_trait_fact(t));
        out.push('\n');
    }
    if !temporal.is_empty() {
        out.push('\n');
    }

    let mut blobs = snapshot.blob_traits.clone();
    blobs.sort_by(|a, b| a.id.cmp(&b.id));
    for t in &blobs {
        out.push_str(&blob_trait_fact(t));
        out.push('\n');
    }
    if !blobs.is_empty() {
        out.push('\n');
    }

    let mut key_values = snapshot.key_value_traits.clone();
    key_values.sort_by(|a, b| a.id.cmp(&b.id));
    for t in &key_values {
        out.push_str(&key_value_trait_fact(t));
        out.push('\n');
    }
    if !key_values.is_empty() {
        out.push('\n');
    }

    let mut tables = snapshot.table_traits.clone();
    tables.sort_by(|a, b| a.id.cmp(&b.id));
    for t in &tables {
        out.push_str(&table_trait_fact(t));
        out.push('\n');
    }
    if !tables.is_empty() {
        out.push('\n');
    }

    let mut blob_files = snapshot.blob_files.clone();
    blob_files.sort_by(|a, b| a.blob_id.cmp(&b.blob_id));
    for f in &blob_files {
        out.push_str(&blob_file_fact(f));
        out.push('\n');
    }
    if !blob_files.is_empty() {
        out.push('\n');
    }

    let mut rels = snapshot.relationship_types.clone();
    rels.sort_by(|a, b| a.label.cmp(&b.label));
    for rt in &rels {
        out.push_str(&relationship_type_fact(rt));
        out.push('\n');
    }
    if !rels.is_empty() {
        out.push('\n');
    }

    let mut edges = snapshot.edges.clone();
    edges.sort_by(|a, b| (&a.from, &a.to, &a.label).cmp(&(&b.from, &b.to, &b.label)));
    for e in &edges {
        out.push_str(&edge_fact(e));
        out.push('\n');
        if e.strength.is_some() || e.latency.is_some() {
            out.push_str(&edge_payload_fact(e));
            out.push('\n');
        }
    }

    out
}

fn entity_fact(e: &Entity) -> String {
    format!(
        "entity({}, {}, {}, {}).",
        quote_atom(&e.id),
        category_atom(&e.category),
        quote_atom(&e.label),
        quote_atom(&e.lang_canonical),
    )
}

fn label_trait_fact(t: &LabelTrait) -> String {
    format!(
        "label_trait({}, {}, {}, {}).",
        quote_atom(&t.id),
        quote_atom(&t.owner),
        quote_atom(&t.lang),
        quote_atom(&t.text),
    )
}

fn spatial_trait_fact(t: &SpatialTrait) -> String {
    format!(
        "spatial_trait({}, {}, {}, {}, {}, {}, {}, {}).",
        quote_atom(&t.id),
        quote_atom(&t.owner),
        format_f64(t.lat),
        format_f64(t.lng),
        format_f64(t.alt),
        format_f64(t.heading),
        format_bbox(&t.bbox),
        quote_atom(&t.projection),
    )
}

fn temporal_trait_fact(t: &TemporalTrait) -> String {
    format!(
        "temporal_trait({}, {}, {}, {}, {}, {}).",
        quote_atom(&t.id),
        quote_atom(&t.owner),
        quote_opt_string(&t.event_at),
        quote_opt_string(&t.starts_at),
        quote_opt_string(&t.ends_at),
        quote_opt_string(&t.recurrence),
    )
}

fn blob_trait_fact(t: &BlobTrait) -> String {
    format!(
        "blob_trait({}, {}, {}, {}, {}, {}).",
        quote_atom(&t.id),
        quote_atom(&t.owner),
        quote_atom(&t.filename),
        quote_atom(&t.storage_id),
        quote_atom(&t.mime),
        quote_atom(&t.hash),
    )
}

fn key_value_trait_fact(t: &KeyValueTrait) -> String {
    format!(
        "key_value_trait({}, {}, {}, {}).",
        quote_atom(&t.id),
        quote_atom(&t.owner),
        quote_atom(&t.namespace),
        quote_atom(&to_canonical_json_string(&t.values)),
    )
}

fn table_trait_fact(t: &TableTrait) -> String {
    format!(
        "table_trait({}, {}, {}, {}, {}).",
        quote_atom(&t.id),
        quote_atom(&t.owner),
        quote_atom(&t.namespace),
        quote_atom(&to_canonical_json_string(&t.columns)),
        quote_atom(&to_canonical_json_string(&t.rows)),
    )
}

fn blob_file_fact(f: &BlobFile) -> String {
    format!(
        "blob_file({}, {}, {}, {}).",
        quote_atom(&f.blob_id),
        quote_atom(&f.relative_path),
        quote_atom(&f.hash),
        quote_atom(&f.mime),
    )
}

fn relationship_type_fact(rt: &RelationshipType) -> String {
    format!(
        "relationship_type({}, {}, {}, {}, {}, {}, {}, {}).",
        quote_atom(&rt.id),
        quote_atom(&rt.label),
        rt.transitive,
        rt.symmetric,
        rt.inherits_traits,
        rt.visible,
        quote_opt_string(&rt.flow),
        quote_opt_string(&rt.routing),
    )
}

fn edge_fact(e: &EdgeRecord) -> String {
    format!(
        "edge({}, {}, {}).",
        quote_atom(&e.from),
        quote_atom(&e.to),
        quote_atom(&e.label),
    )
}

fn edge_payload_fact(e: &EdgeRecord) -> String {
    format!(
        "edge_payload({}, {}, {}, {}, {}).",
        quote_atom(&e.from),
        quote_atom(&e.to),
        quote_atom(&e.label),
        quote_opt_f64(e.strength),
        quote_opt_i64(e.latency),
    )
}

// ---------------------------------------------------------------------------
// Parser
// ---------------------------------------------------------------------------

/// Parses canonical Prolog fact text into a `DomainPatch`.
///
/// The parser is tolerant of comments (lines starting with `%`) and blank
/// lines. Unknown predicates are reported as errors rather than silently
/// dropped — callers should preprocess interchange files if forward
/// compatibility is required.
pub fn from_facts(text: &str) -> Result<DomainPatch, String> {
    let mut patch = DomainPatch::default();
    let mut tokens = Tokenizer::new(text);

    while let Some(fact) = tokens.next_fact()? {
        let line = fact.line;
        let Fact { functor, args, .. } = fact;
        match (functor.as_str(), args.len()) {
            ("entity", 4) => {
                let id = args[0].as_atom("entity.id")?;
                let cat = parse_category(&args[1].as_atom("entity.category")?)?;
                let label = args[2].as_atom("entity.label")?;
                let lang = args[3].as_atom("entity.lang_canonical")?;
                patch.entities.push(Entity {
                    id,
                    category: cat,
                    label,
                    lang_canonical: lang,
                    deleted_at: None,
                });
            }
            ("label_trait", 4) => {
                patch.label_traits.push(LabelTrait {
                    id: args[0].as_atom("label_trait.id")?,
                    owner: args[1].as_atom("label_trait.owner")?,
                    lang: args[2].as_atom("label_trait.lang")?,
                    text: args[3].as_atom("label_trait.text")?,
                });
            }
            ("spatial_trait", 8) => {
                patch.spatial_traits.push(SpatialTrait {
                    id: args[0].as_atom("spatial_trait.id")?,
                    owner: args[1].as_atom("spatial_trait.owner")?,
                    lat: args[2].as_number("spatial_trait.lat")?,
                    lng: args[3].as_number("spatial_trait.lng")?,
                    alt: args[4].as_number("spatial_trait.alt")?,
                    heading: args[5].as_number("spatial_trait.heading")?,
                    bbox: args[6].as_opt_number_list("spatial_trait.bbox")?,
                    projection: args[7].as_atom("spatial_trait.projection")?,
                });
            }
            ("temporal_trait", 6) => {
                patch.temporal_traits.push(TemporalTrait {
                    id: args[0].as_atom("temporal_trait.id")?,
                    owner: args[1].as_atom("temporal_trait.owner")?,
                    event_at: args[2].as_opt_atom("temporal_trait.event_at")?,
                    starts_at: args[3].as_opt_atom("temporal_trait.starts_at")?,
                    ends_at: args[4].as_opt_atom("temporal_trait.ends_at")?,
                    recurrence: args[5].as_opt_atom("temporal_trait.recurrence")?,
                });
            }
            ("blob_trait", 6) => {
                let id = args[0].as_atom("blob_trait.id")?;
                let owner = args[1].as_atom("blob_trait.owner")?;
                let filename = args[2].as_atom("blob_trait.filename")?;
                let storage_id = args[3].as_atom("blob_trait.storage_id")?;
                let mime = args[4].as_atom("blob_trait.mime")?;
                let hash = args[5].as_atom("blob_trait.hash")?;
                patch.blob_traits.push(BlobTrait {
                    id,
                    owner,
                    filename,
                    storage_id,
                    bucket: "local".to_string(),
                    mime,
                    hash,
                    size: 0,
                });
            }
            ("key_value_trait", 4) => {
                let values = args[3].as_atom("key_value_trait.values")?;
                let values: HashMap<String, serde_json::Value> =
                    serde_json::from_str(&values).map_err(|e| {
                        format!("key_value_trait.values: invalid JSON payload: {}", e)
                    })?;
                patch.key_value_traits.push(KeyValueTrait {
                    id: args[0].as_atom("key_value_trait.id")?,
                    owner: args[1].as_atom("key_value_trait.owner")?,
                    namespace: args[2].as_atom("key_value_trait.namespace")?,
                    values,
                });
            }
            ("table_trait", 5) => {
                let columns_raw = args[3].as_atom("table_trait.columns")?;
                let rows_raw = args[4].as_atom("table_trait.rows")?;
                let columns: Vec<TableColumn> = serde_json::from_str(&columns_raw).map_err(|e| {
                    format!("table_trait.columns: invalid JSON payload: {}", e)
                })?;
                let rows: Vec<HashMap<String, serde_json::Value>> =
                    serde_json::from_str(&rows_raw).map_err(|e| {
                        format!("table_trait.rows: invalid JSON payload: {}", e)
                    })?;
                patch.table_traits.push(TableTrait {
                    id: args[0].as_atom("table_trait.id")?,
                    owner: args[1].as_atom("table_trait.owner")?,
                    namespace: args[2].as_atom("table_trait.namespace")?,
                    columns,
                    rows,
                });
            }
            ("blob_file", 4) => {
                patch.blob_files.push(BlobFile {
                    blob_id: args[0].as_atom("blob_file.blob_id")?,
                    relative_path: args[1].as_atom("blob_file.relative_path")?,
                    hash: args[2].as_atom("blob_file.hash")?,
                    mime: args[3].as_atom("blob_file.mime")?,
                });
            }
            ("relationship_type", 8) => {
                patch.relationship_types.push(RelationshipType {
                    id: args[0].as_atom("relationship_type.id")?,
                    label: args[1].as_atom("relationship_type.label")?,
                    transitive: args[2].as_bool("relationship_type.transitive")?,
                    symmetric: args[3].as_bool("relationship_type.symmetric")?,
                    inherits_traits: args[4].as_bool("relationship_type.inherits_traits")?,
                    visible: args[5].as_bool("relationship_type.visible")?,
                    flow: args[6].as_opt_atom("relationship_type.flow")?,
                    routing: args[7].as_opt_atom("relationship_type.routing")?,
                    color: None,
                });
            }
            ("edge", 3) => {
                patch.edges.push(EdgeRecord {
                    from: args[0].as_atom("edge.from")?,
                    to: args[1].as_atom("edge.to")?,
                    label: args[2].as_atom("edge.label")?,
                    strength: None,
                    latency: None,
                    metadata: None,
                });
            }
            ("edge_payload", 5) => {
                let from = args[0].as_atom("edge_payload.from")?;
                let to = args[1].as_atom("edge_payload.to")?;
                let label = args[2].as_atom("edge_payload.label")?;
                let strength = args[3].as_opt_number("edge_payload.strength")?;
                let latency = args[4].as_opt_number("edge_payload.latency")?.map(|f| f as i64);
                if let Some(edge) = patch
                    .edges
                    .iter_mut()
                    .find(|e| e.from == from && e.to == to && e.label == label)
                {
                    edge.strength = strength;
                    edge.latency = latency;
                } else {
                    patch.edges.push(EdgeRecord {
                        from,
                        to,
                        label,
                        strength,
                        latency,
                        metadata: None,
                    });
                }
            }
            (other, arity) => {
                return Err(format!(
                    "unknown predicate {}/{} at line {}",
                    other, arity, line
                ));
            }
        }
    }

    Ok(patch)
}

// ---------------------------------------------------------------------------
// Bridging-rule generator
// ---------------------------------------------------------------------------

/// Emits Model 2 view rules that expose each known relationship label as a
/// directly-callable predicate over `edge/3`. Used to keep user-authored
/// rules ergonomic (`contains(X,Y)` instead of `edge(X,Y,contains)`).
pub fn bridging_rules(types: &[RelationshipType]) -> String {
    let mut out = String::new();
    for rt in types {
        let functor = sanitize_functor(&rt.label);
        out.push_str(&format!(
            "{}(X, Y) :- edge(X, Y, {}).\n",
            functor,
            quote_atom(&rt.label),
        ));
        if rt.symmetric {
            out.push_str(&format!(
                "{}(X, Y) :- edge(Y, X, {}).\n",
                functor,
                quote_atom(&rt.label),
            ));
        }
    }
    out
}

fn sanitize_functor(label: &str) -> String {
    let mut out = String::with_capacity(label.len());
    for ch in label.chars() {
        if ch.is_ascii_lowercase() || ch.is_ascii_digit() || ch == '_' {
            out.push(ch);
        } else if ch.is_ascii_uppercase() {
            out.push(ch.to_ascii_lowercase());
        } else {
            out.push('_');
        }
    }
    if out.is_empty() || !out.chars().next().unwrap().is_ascii_lowercase() {
        out.insert(0, 'r');
    }
    out
}

// ---------------------------------------------------------------------------
// Tokenizer / fact reader
// ---------------------------------------------------------------------------

#[derive(Debug, Clone)]
enum Term {
    Atom(String),
    Number(f64),
    Bool(bool),
    None,
    List(Vec<Term>),
}

impl Term {
    fn as_atom(&self, ctx: &str) -> Result<String, String> {
        match self {
            Term::Atom(s) => Ok(s.clone()),
            other => Err(format!("{}: expected atom, got {:?}", ctx, other)),
        }
    }
    fn as_opt_atom(&self, ctx: &str) -> Result<Option<String>, String> {
        match self {
            Term::None => Ok(None),
            Term::Atom(s) => Ok(Some(s.clone())),
            other => Err(format!("{}: expected atom or none, got {:?}", ctx, other)),
        }
    }
    fn as_number(&self, ctx: &str) -> Result<f64, String> {
        match self {
            Term::Number(n) => Ok(*n),
            other => Err(format!("{}: expected number, got {:?}", ctx, other)),
        }
    }
    fn as_opt_number(&self, ctx: &str) -> Result<Option<f64>, String> {
        match self {
            Term::None => Ok(None),
            Term::Number(n) => Ok(Some(*n)),
            other => Err(format!("{}: expected number or none, got {:?}", ctx, other)),
        }
    }
    fn as_opt_number_list(&self, ctx: &str) -> Result<Option<Vec<f64>>, String> {
        match self {
            Term::None => Ok(None),
            Term::List(items) => {
                let mut out = Vec::with_capacity(items.len());
                for (i, t) in items.iter().enumerate() {
                    out.push(t.as_number(&format!("{}[{}]", ctx, i))?);
                }
                Ok(Some(out))
            }
            other => Err(format!("{}: expected list or none, got {:?}", ctx, other)),
        }
    }
    fn as_bool(&self, ctx: &str) -> Result<bool, String> {
        match self {
            Term::Bool(b) => Ok(*b),
            other => Err(format!("{}: expected bool, got {:?}", ctx, other)),
        }
    }
}

struct Fact {
    functor: String,
    args: Vec<Term>,
    line: usize,
}

struct Tokenizer<'a> {
    chars: std::str::Chars<'a>,
    peeked: Option<char>,
    line: usize,
}

impl<'a> Tokenizer<'a> {
    fn new(s: &'a str) -> Self {
        Self {
            chars: s.chars(),
            peeked: None,
            line: 1,
        }
    }

    fn peek(&mut self) -> Option<char> {
        if self.peeked.is_none() {
            self.peeked = self.chars.next();
        }
        self.peeked
    }

    fn next_char(&mut self) -> Option<char> {
        let c = self.peeked.take().or_else(|| self.chars.next());
        if c == Some('\n') {
            self.line += 1;
        }
        c
    }

    fn skip_ws_and_comments(&mut self) {
        loop {
            match self.peek() {
                Some(c) if c.is_whitespace() => {
                    self.next_char();
                }
                Some('%') => {
                    while let Some(c) = self.next_char() {
                        if c == '\n' {
                            break;
                        }
                    }
                }
                _ => break,
            }
        }
    }

    fn next_fact(&mut self) -> Result<Option<Fact>, String> {
        self.skip_ws_and_comments();
        if self.peek().is_none() {
            return Ok(None);
        }
        let line = self.line;
        let functor = self.read_unquoted_atom()?;
        self.skip_ws_and_comments();
        let args = if self.peek() == Some('(') {
            self.next_char();
            let args = self.read_arg_list()?;
            self.skip_ws_and_comments();
            args
        } else {
            Vec::new()
        };
        self.skip_ws_and_comments();
        match self.next_char() {
            Some('.') => {}
            Some(c) => return Err(format!("line {}: expected '.', got {:?}", line, c)),
            None => return Err(format!("line {}: unexpected end of input", line)),
        }
        Ok(Some(Fact { functor, args, line }))
    }

    fn read_arg_list(&mut self) -> Result<Vec<Term>, String> {
        let mut args = Vec::new();
        loop {
            self.skip_ws_and_comments();
            if self.peek() == Some(')') {
                self.next_char();
                return Ok(args);
            }
            args.push(self.read_term()?);
            self.skip_ws_and_comments();
            match self.peek() {
                Some(',') => {
                    self.next_char();
                }
                Some(')') => {
                    self.next_char();
                    return Ok(args);
                }
                Some(c) => return Err(format!("line {}: expected ',' or ')', got {:?}", self.line, c)),
                None => return Err(format!("line {}: unexpected end of arg list", self.line)),
            }
        }
    }

    fn read_term(&mut self) -> Result<Term, String> {
        self.skip_ws_and_comments();
        match self.peek() {
            Some('\'') => {
                let s = self.read_quoted_atom()?;
                Ok(Term::Atom(s))
            }
            Some('[') => {
                self.next_char();
                let items = self.read_list()?;
                Ok(Term::List(items))
            }
            Some(c) if c.is_ascii_digit() || c == '-' || c == '+' => {
                let n = self.read_number()?;
                Ok(Term::Number(n))
            }
            Some(c) if c.is_ascii_alphabetic() || c == '_' => {
                let atom = self.read_unquoted_atom()?;
                match atom.as_str() {
                    "none" => Ok(Term::None),
                    "true" => Ok(Term::Bool(true)),
                    "false" => Ok(Term::Bool(false)),
                    _ => Ok(Term::Atom(atom)),
                }
            }
            Some(c) => Err(format!("line {}: unexpected character {:?}", self.line, c)),
            None => Err(format!("line {}: unexpected end of input in term", self.line)),
        }
    }

    fn read_list(&mut self) -> Result<Vec<Term>, String> {
        let mut items = Vec::new();
        loop {
            self.skip_ws_and_comments();
            if self.peek() == Some(']') {
                self.next_char();
                return Ok(items);
            }
            items.push(self.read_term()?);
            self.skip_ws_and_comments();
            match self.peek() {
                Some(',') => {
                    self.next_char();
                }
                Some(']') => {
                    self.next_char();
                    return Ok(items);
                }
                Some(c) => return Err(format!("line {}: expected ',' or ']', got {:?}", self.line, c)),
                None => return Err(format!("line {}: unterminated list", self.line)),
            }
        }
    }

    fn read_number(&mut self) -> Result<f64, String> {
        let mut buf = String::new();
        if matches!(self.peek(), Some('-') | Some('+')) {
            buf.push(self.next_char().unwrap());
        }
        while let Some(c) = self.peek() {
            if c.is_ascii_digit() || c == '.' || c == 'e' || c == 'E' || c == '-' || c == '+' {
                buf.push(c);
                self.next_char();
            } else {
                break;
            }
        }
        buf.parse::<f64>().map_err(|e| format!("line {}: bad number {:?}: {}", self.line, buf, e))
    }

    fn read_unquoted_atom(&mut self) -> Result<String, String> {
        let mut buf = String::new();
        while let Some(c) = self.peek() {
            if c.is_ascii_alphanumeric() || c == '_' {
                buf.push(c);
                self.next_char();
            } else {
                break;
            }
        }
        if buf.is_empty() {
            return Err(format!("line {}: expected atom", self.line));
        }
        Ok(buf)
    }

    fn read_quoted_atom(&mut self) -> Result<String, String> {
        self.next_char(); // consume opening '
        let mut buf = String::new();
        loop {
            match self.next_char() {
                Some('\\') => match self.next_char() {
                    Some('n') => buf.push('\n'),
                    Some('r') => buf.push('\r'),
                    Some('t') => buf.push('\t'),
                    Some('\'') => buf.push('\''),
                    Some('\\') => buf.push('\\'),
                    Some(c) => buf.push(c),
                    None => return Err(format!("line {}: unterminated escape", self.line)),
                },
                Some('\'') => return Ok(buf),
                Some(c) => buf.push(c),
                None => return Err(format!("line {}: unterminated quoted atom", self.line)),
            }
        }
    }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;

    fn sample_snapshot() -> DomainSnapshot {
        DomainSnapshot {
            entities: vec![
                Entity {
                    id: "entity:01HZK0".to_string(),
                    category: EntityKind::Physical,
                    label: "Tanker A".to_string(),
                    lang_canonical: "en".to_string(),
                    deleted_at: None,
                },
                Entity {
                    id: "entity:01HZK1".to_string(),
                    category: EntityKind::Abstract,
                    label: "Cargo's Bay".to_string(),
                    lang_canonical: "en".to_string(),
                    deleted_at: None,
                },
            ],
            label_traits: vec![LabelTrait {
                id: "lt:01".to_string(),
                owner: "entity:01HZK0".to_string(),
                lang: "es".to_string(),
                text: "Petrolero A".to_string(),
            }],
            spatial_traits: vec![SpatialTrait {
                id: "sp:01".to_string(),
                owner: "entity:01HZK0".to_string(),
                lat: 36.12,
                lng: -5.35,
                alt: 0.0,
                heading: 90.0,
                bbox: None,
                projection: "wgs84".to_string(),
            }],
            temporal_traits: vec![],
            blob_traits: vec![BlobTrait {
                id: "bt:01".to_string(),
                owner: "entity:01HZK0".to_string(),
                filename: "manifest.pdf".to_string(),
                storage_id: "sha256/ab/cdef-manifest.pdf".to_string(),
                bucket: "local".to_string(),
                mime: "application/pdf".to_string(),
                hash: "abcdef".to_string(),
                size: 1024,
            }],
            key_value_traits: vec![KeyValueTrait {
                id: "kv:01".to_string(),
                owner: "entity:01HZK0".to_string(),
                namespace: "entity".to_string(),
                values: HashMap::from([(
                    "content.description".to_string(),
                    serde_json::Value::String("Ship manifest".to_string()),
                )]),
            }],
            table_traits: vec![TableTrait {
                id: "table:01".to_string(),
                owner: "entity:01HZK0".to_string(),
                namespace: "manifest".to_string(),
                columns: vec![
                    TableColumn {
                        name: "item".to_string(),
                        data_type: "string".to_string(),
                        nullable: false,
                    },
                    TableColumn {
                        name: "count".to_string(),
                        data_type: "int".to_string(),
                        nullable: false,
                    },
                ],
                rows: vec![HashMap::from([
                    ("item".to_string(), serde_json::Value::String("crate".to_string())),
                    (
                        "count".to_string(),
                        serde_json::Value::Number(serde_json::Number::from(4)),
                    ),
                ])],
            }],
            relationship_types: vec![RelationshipType {
                id: "rt:contains".to_string(),
                label: "contains".to_string(),
                transitive: true,
                symmetric: false,
                inherits_traits: false,
                visible: true,
                flow: Some("down".to_string()),
                routing: None,
                color: None,
            }],
            edges: vec![EdgeRecord {
                from: "entity:01HZK0".to_string(),
                to: "entity:01HZK1".to_string(),
                label: "contains".to_string(),
                strength: Some(0.9),
                latency: None,
                metadata: None,
            }],
            blob_files: vec![BlobFile {
                blob_id: "bt:01".to_string(),
                relative_path: "blobs/abcdef".to_string(),
                hash: "abcdef".to_string(),
                mime: "application/pdf".to_string(),
            }],
        }
    }

    #[test]
    fn round_trip_preserves_structure() {
        let original = sample_snapshot();
        let text = to_facts(&original);
        let parsed = from_facts(&text).unwrap();

        assert_eq!(parsed.entities.len(), original.entities.len());
        assert_eq!(parsed.entities[0].id, original.entities[0].id);
        assert_eq!(parsed.entities[1].label, "Cargo's Bay"); // escaped quote
        assert_eq!(parsed.label_traits.len(), 1);
        assert_eq!(parsed.spatial_traits[0].lat, 36.12);
        assert_eq!(parsed.blob_traits[0].hash, "abcdef");
        assert_eq!(
            parsed.key_value_traits[0]
                .values
                .get("content.description")
                .and_then(|v| v.as_str()),
            Some("Ship manifest")
        );
        assert_eq!(parsed.table_traits[0].rows.len(), 1);
        assert_eq!(parsed.blob_files[0].relative_path, "blobs/abcdef");
        assert_eq!(parsed.relationship_types[0].transitive, true);
        assert_eq!(parsed.relationship_types[0].flow.as_deref(), Some("down"));
        assert_eq!(parsed.edges.len(), 1);
        assert_eq!(parsed.edges[0].strength, Some(0.9));
    }

    #[test]
    fn export_is_byte_deterministic() {
        let s = sample_snapshot();
        let a = to_facts(&s);
        let b = to_facts(&s);
        assert_eq!(a, b);
    }

    #[test]
    fn parser_rejects_unknown_predicate() {
        let bad = "mystery('a', 'b').\n";
        assert!(from_facts(bad).is_err());
    }

    #[test]
    fn parser_handles_comments_and_blank_lines() {
        let text = "% header\n\nentity('e1', physical, 'Hello', 'en').\n";
        let p = from_facts(text).unwrap();
        assert_eq!(p.entities.len(), 1);
        assert_eq!(p.entities[0].label, "Hello");
    }

    #[test]
    fn bridging_rules_emit_one_per_label() {
        let types = vec![
            RelationshipType {
                id: "rt:contains".to_string(),
                label: "contains".to_string(),
                transitive: true,
                symmetric: false,
                inherits_traits: false,
                visible: true,
                flow: None,
                routing: None,
                color: None,
            },
            RelationshipType {
                id: "rt:adjacent".to_string(),
                label: "adjacent_to".to_string(),
                transitive: false,
                symmetric: true,
                inherits_traits: false,
                visible: true,
                flow: None,
                routing: None,
                color: None,
            },
        ];
        let rules = bridging_rules(&types);
        assert!(rules.contains("contains(X, Y) :- edge(X, Y, 'contains')."));
        assert!(rules.contains("adjacent_to(X, Y) :- edge(X, Y, 'adjacent_to')."));
        assert!(rules.contains("adjacent_to(X, Y) :- edge(Y, X, 'adjacent_to')."));
    }

    #[test]
    fn sanitize_functor_normalizes_label() {
        assert_eq!(sanitize_functor("contains"), "contains");
        assert_eq!(sanitize_functor("Hosted On"), "hosted_on");
        assert_eq!(sanitize_functor("123abc"), "r123abc");
    }
}
