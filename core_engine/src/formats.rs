use serde::{Deserialize, Serialize};
use crate::models::{Entity, SpatialTrait, BlobTrait, TemporalTrait};

#[derive(Debug, Serialize, Deserialize)]
pub struct CompositeEntity {
    #[serde(flatten)]
    pub entity: Entity,
    pub spatial: Option<SpatialTrait>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub blobs: Vec<BlobTrait>,
    pub temporal: Option<TemporalTrait>,
}

pub fn to_yaml(composite: &CompositeEntity) -> Result<String, String> {
    serde_yaml::to_string(composite).map_err(|e| e.to_string())
}

pub fn from_yaml(yaml: &str) -> Result<CompositeEntity, String> {
    serde_yaml::from_str(yaml).map_err(|e: serde_yaml::Error| e.to_string())
}

pub fn to_json(composite: &CompositeEntity) -> Result<String, String> {
    serde_json::to_string_pretty(composite).map_err(|e: serde_json::Error| e.to_string())
}

pub fn from_json(json: &str) -> Result<CompositeEntity, String> {
    serde_json::from_str(json).map_err(|e: serde_json::Error| e.to_string())
}

pub fn to_markdown(composite: &CompositeEntity) -> Result<String, String> {
    let yaml = to_yaml(composite)?;
    let description = composite.entity.metadata.get("description")
        .and_then(|v| v.as_str())
        .unwrap_or("");
    
    // Standard Markdown Front Matter (--- separators)
    Ok(format!("---\n{}---\n\n# Entity: {}\n\n{}", yaml, composite.entity.label, description))
}

pub fn from_markdown(md: &str) -> Result<CompositeEntity, String> {
    let parts: Vec<&str> = md.splitn(3, "---").collect();
    if parts.len() < 3 {
        return Err("Invalid Markdown format: Missing front matter delimiters (---)".to_string());
    }
    
    let yaml_part = parts[1];
    let body_part = parts[2];

    let mut composite: CompositeEntity = serde_yaml::from_str(yaml_part)
        .map_err(|e: serde_yaml::Error| format!("YAML Error in Front Matter: {}", e))?;

    // Inject body into description metadata, stripping the # Entity header if present
    let clean_body = body_part.trim().lines()
        .filter(|line| !line.starts_with("# Entity:"))
        .collect::<Vec<_>>()
        .join("\n")
        .trim()
        .to_string();

    if !clean_body.is_empty() {
        composite.entity.metadata.insert("description".to_string(), serde_json::Value::String(clean_body));
    }

    Ok(composite)
}
