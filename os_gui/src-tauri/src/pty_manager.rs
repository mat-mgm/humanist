use portable_pty::{native_pty_system, PtySize, CommandBuilder};
use std::sync::{Arc, Mutex};
use std::io::{Read, Write};
use tauri::{AppHandle, Emitter};
use std::thread;

fn workspace_root() -> std::path::PathBuf {
    std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .and_then(|p| p.parent())
        .map(|p| p.to_path_buf())
        .unwrap_or_else(|| std::path::PathBuf::from("."))
}

pub struct PtyHost {
    writer: Arc<Mutex<Box<dyn Write + Send>>>,
    master: Arc<Mutex<Box<dyn portable_pty::MasterPty + Send>>>,
    transcript: Arc<Mutex<Vec<u8>>>,
    pub on_exit: Arc<tokio::sync::Notify>,
}

impl PtyHost {
    pub fn spawn(app: AppHandle, session_id: String, command: Option<String>) -> Result<Self, String> {
        let pty_system = native_pty_system();
        let pair = pty_system.openpty(PtySize {
            rows: 24,
            cols: 80,
            pixel_width: 0,
            pixel_height: 0,
        }).map_err(|e: anyhow::Error| e.to_string())?;

        let mut cmd = if cfg!(windows) {
            let shell = command.unwrap_or_else(|| "powershell.exe".to_string());
            let mut c = CommandBuilder::new("powershell.exe");
            c.arg("-Command");
            c.arg(shell);
            c
        } else if let Some(script) = command {
            let mut c = CommandBuilder::new("bash");
            c.arg("--noprofile");
            c.arg("--norc");
            c.arg("-ic");
            c.arg(script);
            c
        } else {
            let c = CommandBuilder::new("zsh");
            c
        };

        // Ensure $EDITOR is respected
        if let Some(editor) = std::env::var_os("EDITOR") {
            cmd.env("EDITOR", editor);
        }
        cmd.env("TERM", "xterm-256color");
        cmd.cwd(workspace_root());

        let mut child = pair.slave.spawn_command(cmd).map_err(|e: anyhow::Error| e.to_string())?;

        let reader = pair.master.try_clone_reader().map_err(|e: anyhow::Error| e.to_string())?;
        let writer = pair.master.take_writer().map_err(|e: anyhow::Error| e.to_string())?;
        let writer = Arc::new(Mutex::new(writer));
        let master = Arc::new(Mutex::new(pair.master));
        let transcript = Arc::new(Mutex::new(Vec::new()));
        let on_exit = Arc::new(tokio::sync::Notify::new());

        let app_c = app.clone();
        let sid_data = session_id.clone();
        let transcript_c = transcript.clone();
        thread::spawn(move || {
            let mut reader = reader;
            let mut buffer = [0u8; 4096];
            loop {
                match reader.read(&mut buffer) {
                    Ok(0) => break,
                    Ok(n) => {
                        let data = &buffer[..n];
                        if let Ok(mut existing) = transcript_c.lock() {
                            existing.extend_from_slice(data);
                        }
                        let _ = app_c.emit("pty-data", (sid_data.clone(), data.to_vec()));
                    }
                    Err(_) => break,
                }
            }
            let _ = app_c.emit("pty-exit", sid_data);
        });

        // Monitor child exit
        let app_cc = app.clone();
        let sid_exit = session_id.clone();
        let notify = on_exit.clone();
        thread::spawn(move || {
            let _ = child.wait();
            let _ = app_cc.emit("pty-process-exit", sid_exit);
            notify.notify_one();
        });

        Ok(Self { writer, master, transcript, on_exit })
    }

    pub fn write(&self, data: &[u8]) -> Result<(), String> {
        let mut writer = self.writer.lock().map_err(|_| "Lock failed".to_string())?;
        writer.write_all(data).map_err(|e| e.to_string())?;
        writer.flush().map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn resize(&self, rows: u16, cols: u16) -> Result<(), String> {
        let master = self.master.lock().map_err(|_| "Lock failed".to_string())?;
        master.resize(PtySize {
            rows,
            cols,
            pixel_width: 0,
            pixel_height: 0,
        }).map_err(|e: anyhow::Error| e.to_string())?;
        Ok(())
    }

    pub fn snapshot(&self) -> Result<Vec<u8>, String> {
        let transcript = self.transcript.lock().map_err(|_| "Lock failed".to_string())?;
        Ok(transcript.clone())
    }
}
