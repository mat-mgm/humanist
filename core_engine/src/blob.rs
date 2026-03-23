use async_trait::async_trait;
use aws_sdk_s3::Client;
use aws_config::meta::region::RegionProviderChain;
use std::time::Duration;
use std::path::{PathBuf};
use std::fs;
use crate::ports::BlobStorageProvider;

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
        let config = aws_sdk_s3::Config::builder().behavior_version_latest().build();
        let client = Client::from_conf(config);
        Self { client, bucket: "dummy".to_string() }
    }
}

#[async_trait]
impl BlobStorageProvider for S3BlobAdapter {
    async fn upload(&self, local_path: &str, storage_id: &str) -> Result<(), String> {
        // Dummy implementation for now
        let _path = local_path;
        let _id = storage_id;
        Ok(())
    }

    async fn presign_url(&self, storage_id: &str) -> Result<String, String> {
        let expires_in = Duration::from_secs(3600);
        let config = aws_sdk_s3::presigning::PresigningConfig::expires_in(expires_in)
            .map_err(|e| e.to_string())?;
            
        let req = self.client.get_object()
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
            fs::create_dir_all(&base_dir).unwrap_or_else(|_| eprintln!("Failed to create local blob storage directory: {:?}", base_dir));
        }
        Self { base_dir }
    }
}

#[async_trait]
impl BlobStorageProvider for LocalBlobAdapter {
    async fn upload(&self, local_path: &str, storage_id: &str) -> Result<(), String> {
        let dest = self.base_dir.join(storage_id);
        if let Some(parent) = dest.parent() {
            fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        fs::copy(local_path, &dest).map_err(|e| e.to_string())?;
        Ok(())
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
