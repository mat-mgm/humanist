use portable_pty::{native_pty_system, PtySize, CommandBuilder};
use std::sync::{Arc, Mutex};
use std::io::{Read, Write};
use tauri::{AppHandle, Emitter};
use std::thread;

pub struct PtyHost {
    writer: Arc<Mutex<Box<dyn Write + Send>>>,
    master: Arc<Mutex<Box<dyn portable_pty::MasterPty + Send>>>,
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

        let shell = command.unwrap_or_else(|| {
            if cfg!(windows) { "powershell.exe".to_string() } else { "zsh".to_string() }
        });

        let mut cmd = if cfg!(windows) {
            let mut c = CommandBuilder::new("powershell.exe");
            c.arg("-Command");
            c.arg(shell);
            c
        } else {
            let mut c = CommandBuilder::new("sh");
            c.arg("-c");
            c.arg(shell);
            c
        };

        // Ensure $EDITOR is respected
        if let Some(editor) = std::env::var_os("EDITOR") {
            cmd.env("EDITOR", editor);
        }

        let mut child = pair.slave.spawn_command(cmd).map_err(|e: anyhow::Error| e.to_string())?;

        let reader = pair.master.try_clone_reader().map_err(|e: anyhow::Error| e.to_string())?;
        let writer = pair.master.take_writer().map_err(|e: anyhow::Error| e.to_string())?;
        let writer = Arc::new(Mutex::new(writer));
        let master = Arc::new(Mutex::new(pair.master));
        let on_exit = Arc::new(tokio::sync::Notify::new());

        let app_c = app.clone();
        let sid_data = session_id.clone();
        thread::spawn(move || {
            let mut reader = reader;
            let mut buffer = [0u8; 4096];
            loop {
                match reader.read(&mut buffer) {
                    Ok(0) => break,
                    Ok(n) => {
                        let data = &buffer[..n];
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

        Ok(Self { writer, master, on_exit })
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
}
