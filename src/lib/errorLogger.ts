import { getApiBase } from "./apiBase";

let installed = false;

async function sendError(payload: Record<string, unknown>) {
  try {
    await fetch(`${getApiBase()}/api/dev/error-logs`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
  } catch {
    // do not break UI if logging fails
  }
}

export function installGlobalErrorLogging() {
  if (installed) return;
  installed = true;

  window.addEventListener("error", (e) => {
    void sendError({
      level: "ERROR",
      source: "frontend-window-error",
      route: window.location.pathname,
      message: e.message || "window error",
      stack: e.error?.stack || "",
      client_time: new Date().toISOString(),
      payload: {
        filename: e.filename,
        lineno: e.lineno,
        colno: e.colno,
      },
    });
  });

  window.addEventListener("unhandledrejection", (e) => {
    const reason = e.reason as { message?: string; stack?: string } | string | null;
    const message = typeof reason === "string" ? reason : reason?.message || "Unhandled promise rejection";
    const stack = typeof reason === "string" ? "" : reason?.stack || "";
    void sendError({
      level: "ERROR",
      source: "frontend-unhandledrejection",
      route: window.location.pathname,
      message,
      stack,
      client_time: new Date().toISOString(),
      payload: {},
    });
  });
}

