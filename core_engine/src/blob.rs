use crate::ports::BlobStorageProvider;
use async_trait::async_trait;
use aws_config::meta::region::RegionProviderChain;
use aws_sdk_s3::Client;
use sha2::{Digest, Sha256};
use std::fs;
use std::path::PathBuf;
use std::time::Duration;

#[derive(Debug, Clone)]
pub struct StoredBlob {
    pub storage_id: String,
    pub hash: String,
    pub size: i64,
}

fn content_hash(bytes: &[u8]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(bytes);
    hex::encode(hasher.finalize())
}

fn normalize_extension(ext: Option<&str>) -> Option<String> {
    ext.map(|raw| raw.trim().trim_start_matches('.').to_ascii_lowercase())
        .filter(|ext| !ext.is_empty())
        .map(|ext| {
            ext.chars()
                .filter(|c| c.is_ascii_alphanumeric())
                .collect::<String>()
        })
        .filter(|ext| !ext.is_empty())
}

fn sanitize_label(label: Option<&str>) -> Option<String> {
    label
        .map(|raw| raw.trim().to_ascii_lowercase())
        .filter(|raw| !raw.is_empty())
        .map(|raw| {
            let mut out = String::with_capacity(raw.len());
            let mut last_dash = false;
            for ch in raw.chars() {
                if ch.is_ascii_alphanumeric() {
                    out.push(ch);
                    last_dash = false;
                } else if !last_dash {
                    out.push('-');
                    last_dash = true;
                }
            }
            out.trim_matches('-').to_string()
        })
        .filter(|s| !s.is_empty())
        .map(|mut s| {
            if s.len() > 64 {
                s.truncate(64);
                s.truncate(s.trim_end_matches('-').len());
            }
            s
        })
}

pub fn blob_filename_for_label(label: Option<&str>, extension: Option<&str>) -> String {
    let stem = sanitize_label(label).unwrap_or_else(|| "blob".to_string());
    let ext_suffix = normalize_extension(extension)
        .map(|ext| format!(".{}", ext))
        .unwrap_or_default();
    format!("{}{}", stem, ext_suffix)
}

pub fn storage_id_for_hash(hash: &str, extension: Option<&str>, label: Option<&str>) -> String {
    let ext_suffix = normalize_extension(extension)
        .map(|ext| format!(".{}", ext))
        .unwrap_or_default();
    let label_suffix = sanitize_label(label)
        .map(|label| format!("-{}", label))
        .unwrap_or_default();
    format!("sha256/{}/{}{}{}", &hash[..2], &hash[2..], label_suffix, ext_suffix)
}

pub fn extension_from_storage_id(storage_id: &str) -> Option<String> {
    let filename = std::path::Path::new(storage_id).file_name()?.to_str()?;
    let dot = filename.rfind('.')?;
    if dot == 0 || dot + 1 >= filename.len() {
        return None;
    }
    normalize_extension(Some(&filename[dot + 1..]))
}

pub fn infer_mime_from_path(path: &str) -> String {
    let lower = path.to_ascii_lowercase();
    let fname = std::path::Path::new(&lower)
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("");
    // Images
    if lower.ends_with(".png") {
        "image/png".to_string()
    } else if lower.ends_with(".jpg") || lower.ends_with(".jpeg") {
        "image/jpeg".to_string()
    } else if lower.ends_with(".gif") {
        "image/gif".to_string()
    } else if lower.ends_with(".webp") {
        "image/webp".to_string()
    } else if lower.ends_with(".svg") {
        "image/svg+xml".to_string()
    // Documents
    } else if lower.ends_with(".pdf") {
        "application/pdf".to_string()
    // 3D models
    } else if lower.ends_with(".glb") {
        "model/gltf-binary".to_string()
    } else if lower.ends_with(".gltf") {
        "model/gltf+json".to_string()
    // Markup / prose
    } else if lower.ends_with(".md") || lower.ends_with(".markdown") {
        "text/markdown".to_string()
    } else if lower.ends_with(".txt") || lower.ends_with(".text") {
        "text/plain".to_string()
    } else if lower.ends_with(".html") || lower.ends_with(".htm") {
        "text/html".to_string()
    } else if lower.ends_with(".xml") {
        "text/xml".to_string()
    } else if lower.ends_with(".csv") {
        "text/csv".to_string()
    // Data / config
    } else if lower.ends_with(".json") || lower.ends_with(".jsonc") {
        "application/json".to_string()
    } else if lower.ends_with(".yaml") || lower.ends_with(".yml") {
        "application/yaml".to_string()
    } else if lower.ends_with(".toml") {
        "application/toml".to_string()
    // Programming languages
    } else if lower.ends_with(".rs") {
        "text/x-rust".to_string()
    } else if lower.ends_with(".py") || lower.ends_with(".pyw") {
        "text/x-python".to_string()
    } else if lower.ends_with(".js") || lower.ends_with(".mjs") || lower.ends_with(".cjs") {
        "text/javascript".to_string()
    } else if lower.ends_with(".ts") || lower.ends_with(".mts") || lower.ends_with(".cts") {
        "text/typescript".to_string()
    } else if lower.ends_with(".tsx") {
        "text/typescript-tsx".to_string()
    } else if lower.ends_with(".jsx") {
        "text/javascript-jsx".to_string()
    } else if lower.ends_with(".c") || lower.ends_with(".h") {
        "text/x-c".to_string()
    } else if lower.ends_with(".cpp") || lower.ends_with(".cc") || lower.ends_with(".cxx")
        || lower.ends_with(".hpp") || lower.ends_with(".hxx") || lower.ends_with(".hh")
    {
        "text/x-c++".to_string()
    } else if lower.ends_with(".cs") {
        "text/x-csharp".to_string()
    } else if lower.ends_with(".java") {
        "text/x-java".to_string()
    } else if lower.ends_with(".go") {
        "text/x-go".to_string()
    } else if lower.ends_with(".rb") {
        "text/x-ruby".to_string()
    } else if lower.ends_with(".sh") || lower.ends_with(".bash") || lower.ends_with(".zsh") {
        "text/x-sh".to_string()
    } else if lower.ends_with(".css") {
        "text/css".to_string()
    } else if lower.ends_with(".scss") || lower.ends_with(".sass") {
        "text/x-scss".to_string()
    } else if lower.ends_with(".nix") {
        "text/x-nix".to_string()
    } else if lower.ends_with(".lua") {
        "text/x-lua".to_string()
    } else if lower.ends_with(".pl") || lower.ends_with(".pro") {
        "application/x-prolog".to_string()
    } else if lower.ends_with(".sql") {
        "text/x-sql".to_string()
    } else if lower.ends_with(".r") {
        "text/x-r".to_string()
    } else if lower.ends_with(".swift") {
        "text/x-swift".to_string()
    } else if lower.ends_with(".kt") || lower.ends_with(".kts") {
        "text/x-kotlin".to_string()
    } else if lower.ends_with(".zig") {
        "text/x-zig".to_string()
    } else if lower.ends_with(".tex") || lower.ends_with(".latex") || lower.ends_with(".sty") || lower.ends_with(".cls") {
        "text/x-tex".to_string()
    // Well-known dotfiles / config files with no or atypical extensions
    } else if matches!(
        fname,
        ".gitignore" | ".gitattributes" | ".env" | ".envrc" | ".editorconfig"
            | ".prettierrc" | ".eslintrc" | ".babelrc" | ".npmrc" | ".nvmrc"
            | "dockerfile" | "makefile" | "gemfile" | "rakefile" | "procfile"
            | "cargo.toml" | "cargo.lock" | "flake.nix" | "flake.lock"
            | "justfile" | "taskfile"
    ) {
        "text/plain".to_string()
    } else {
        "application/octet-stream".to_string()
    }
}

#[derive(Clone)]
pub struct S3BlobAdapter {
    pub client: Client,
    pub bucket: String,
}

impl S3BlobAdapter {
    pub async fn new(bucket: &str) -> Self {
        let region_provider = RegionProviderChain::default_provider().or_else("us-east-1");
        let config = aws_config::from_env().region(region_provider).load().await;
        let client = Client::new(&config);

        Self {
            client,
            bucket: bucket.to_string(),
        }
    }

    // Test dummy
    pub fn dummy() -> Self {
        let config = aws_sdk_s3::Config::builder()
            .behavior_version_latest()
            .build();
        let client = Client::from_conf(config);
        Self {
            client,
            bucket: "dummy".to_string(),
        }
    }
}

#[async_trait]
impl BlobStorageProvider for S3BlobAdapter {
    async fn store_file(
        &self,
        local_path: &str,
        label_hint: Option<String>,
    ) -> Result<StoredBlob, String> {
        let content = fs::read(local_path).map_err(|e| e.to_string())?;
        let extension = PathBuf::from(local_path)
            .extension()
            .and_then(|ext| ext.to_str())
            .map(|ext| ext.to_string());
        let inferred_label = label_hint.or_else(|| {
            PathBuf::from(local_path)
                .file_stem()
                .and_then(|stem| stem.to_str())
                .map(|stem| stem.to_string())
        });
        self.store_bytes(content, extension, inferred_label).await
    }

    async fn store_bytes(
        &self,
        content: Vec<u8>,
        extension_hint: Option<String>,
        label_hint: Option<String>,
    ) -> Result<StoredBlob, String> {
        let hash = content_hash(&content);
        let storage_id = storage_id_for_hash(&hash, extension_hint.as_deref(), label_hint.as_deref());
        let _id = &storage_id;
        let _content = content;
        Ok(StoredBlob {
            storage_id,
            hash,
            size: _content.len() as i64,
        })
    }

    async fn presign_url(&self, storage_id: &str) -> Result<String, String> {
        let expires_in = Duration::from_secs(3600);
        let config = aws_sdk_s3::presigning::PresigningConfig::expires_in(expires_in)
            .map_err(|e| e.to_string())?;

        let req = self
            .client
            .get_object()
            .bucket(&self.bucket)
            .key(storage_id)
            .presigned(config)
            .await
            .map_err(|e| e.to_string())?;

        Ok(req.uri().to_string())
    }

    async fn delete(&self, _storage_id: &str) -> Result<(), String> {
        Ok(())
    }
}

#[derive(Clone)]
pub struct LocalBlobAdapter {
    pub base_dir: PathBuf,
}

impl LocalBlobAdapter {
    pub fn new(base_dir: PathBuf) -> Self {
        if !base_dir.exists() {
            fs::create_dir_all(&base_dir).unwrap_or_else(|_| {
                tracing::error!(path = ?base_dir, "failed to create blob storage directory");
            });
        }
        Self { base_dir }
    }

    fn existing_storage_id_for_hash(&self, hash: &str) -> Result<Option<String>, String> {
        let shard_dir = self.base_dir.join("sha256").join(&hash[..2]);
        if !shard_dir.exists() {
            return Ok(None);
        }
        let prefix = &hash[2..];
        let mut matches: Vec<String> = fs::read_dir(&shard_dir)
            .map_err(|e| e.to_string())?
            .filter_map(|entry| entry.ok())
            .filter_map(|entry| {
                let file_name = entry.file_name();
                let file_name = file_name.to_str()?;
                if file_name.starts_with(prefix) {
                    Some(format!("sha256/{}/{}", &hash[..2], file_name))
                } else {
                    None
                }
            })
            .collect();
        matches.sort();
        Ok(matches.into_iter().next())
    }

    fn persist(
        &self,
        content: Vec<u8>,
        extension_hint: Option<String>,
        label_hint: Option<String>,
    ) -> Result<StoredBlob, String> {
        let hash = content_hash(&content);
        if let Some(storage_id) = self.existing_storage_id_for_hash(&hash)? {
            return Ok(StoredBlob {
                storage_id,
                hash,
                size: content.len() as i64,
            });
        }
        let storage_id = storage_id_for_hash(&hash, extension_hint.as_deref(), label_hint.as_deref());
        let dest = self.base_dir.join(&storage_id);
        if let Some(parent) = dest.parent() {
            fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        if !dest.exists() {
            fs::write(&dest, &content).map_err(|e| e.to_string())?;
        }
        tracing::info!(hash = %hash, bytes = content.len(), "blob stored");
        Ok(StoredBlob {
            storage_id,
            hash,
            size: content.len() as i64,
        })
    }
}

impl LocalBlobAdapter {
    /// Create a new empty blob with a unique path (no CAS deduplication).
    /// Used when creating notes files so each entity gets its own independent file.
    pub fn alloc_empty(&self, unique_id: &str, extension: &str) -> Result<StoredBlob, String> {
        let ext = normalize_extension(Some(extension)).unwrap_or_else(|| extension.to_string());
        let storage_id = format!("notes/{}.{}", unique_id, ext);
        let dest = self.base_dir.join(&storage_id);
        if let Some(parent) = dest.parent() {
            fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        fs::write(&dest, b"").map_err(|e| e.to_string())?;
        // Empty content hash is constant; size is 0
        let hash = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855".to_string();
        Ok(StoredBlob { storage_id, hash, size: 0 })
    }
}

#[async_trait]
impl BlobStorageProvider for LocalBlobAdapter {
    async fn store_file(
        &self,
        local_path: &str,
        label_hint: Option<String>,
    ) -> Result<StoredBlob, String> {
        let content = fs::read(local_path).map_err(|e| e.to_string())?;
        let extension = PathBuf::from(local_path)
            .extension()
            .and_then(|ext| ext.to_str())
            .map(|ext| ext.to_string());
        let inferred_label = label_hint.or_else(|| {
            PathBuf::from(local_path)
                .file_stem()
                .and_then(|stem| stem.to_str())
                .map(|stem| stem.to_string())
        });
        self.persist(content, extension, inferred_label)
    }

    async fn store_bytes(
        &self,
        content: Vec<u8>,
        extension_hint: Option<String>,
        label_hint: Option<String>,
    ) -> Result<StoredBlob, String> {
        self.persist(content, extension_hint, label_hint)
    }

    async fn presign_url(&self, storage_id: &str) -> Result<String, String> {
        let dest = self.base_dir.join(storage_id);
        if !dest.exists() {
            return Err("Blob not found".into());
        }
        Ok(dest.to_string_lossy().to_string())
    }

    async fn delete(&self, storage_id: &str) -> Result<(), String> {
        let dest = self.base_dir.join(storage_id);
        if dest.exists() {
            std::fs::remove_file(dest).map_err(|e| e.to_string())?;
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::{
        blob_filename_for_label, extension_from_storage_id, storage_id_for_hash, LocalBlobAdapter,
    };
    use crate::ports::BlobStorageProvider;
    use std::fs;

    fn temp_dir() -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!("spatial-os-blob-test-{}", ulid::Ulid::new()));
        fs::create_dir_all(&dir).expect("create temp dir");
        dir
    }

    #[tokio::test]
    async fn reuses_same_hash_for_same_content() {
        let dir = temp_dir();
        let adapter = LocalBlobAdapter::new(dir.clone());

        let first = adapter
            .store_bytes(
                b"hello world".to_vec(),
                Some("md".to_string()),
                Some("hello note".to_string()),
            )
            .await
            .unwrap();
        let second = adapter
            .store_bytes(
                b"hello world".to_vec(),
                Some("md".to_string()),
                Some("different label".to_string()),
            )
            .await
            .unwrap();

        assert_eq!(first.hash, second.hash);
        assert_eq!(first.storage_id, second.storage_id);
        assert!(dir.join(&first.storage_id).exists());

        let _ = fs::remove_dir_all(dir);
    }

    #[tokio::test]
    async fn changing_content_creates_new_blob_path() {
        let dir = temp_dir();
        let adapter = LocalBlobAdapter::new(dir.clone());

        let first = adapter
            .store_bytes(
                b"v1".to_vec(),
                Some("md".to_string()),
                Some("first note".to_string()),
            )
            .await
            .unwrap();
        let second = adapter
            .store_bytes(
                b"v2".to_vec(),
                Some("md".to_string()),
                Some("first note".to_string()),
            )
            .await
            .unwrap();

        assert_ne!(first.hash, second.hash);
        assert_ne!(first.storage_id, second.storage_id);
        assert_eq!(
            extension_from_storage_id(&first.storage_id).as_deref(),
            Some("md")
        );
        assert!(dir.join(&first.storage_id).exists());
        assert!(dir.join(&second.storage_id).exists());

        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn storage_ids_include_sanitized_labels() {
        let storage_id = storage_id_for_hash(
            "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
            Some("md"),
            Some("Project Plan v1"),
        );
        assert!(storage_id.ends_with(
            "23456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef-project-plan-v1.md"
        ));
    }

    #[test]
    fn blob_filename_defaults_to_sanitized_label() {
        assert_eq!(
            blob_filename_for_label(Some("Project Plan v1"), Some("md")),
            "project-plan-v1.md"
        );
        assert_eq!(blob_filename_for_label(None, Some("txt")), "blob.txt");
    }
}
