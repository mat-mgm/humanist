import { invoke } from "@tauri-apps/api/core";

type LogLevel = "debug" | "info" | "warn" | "error";

export function logFrontend(level: LogLevel, message: string): void {
  invoke("log_frontend", { level, message }).catch(() => {
    // Swallow — if the backend is not yet ready, console is the fallback.
    console.error(`[${level}] ${message}`);
  });
}
