const BOOT_TRACE_ENABLED = import.meta.env.DEV;

export function markBootEvent(
  name: string,
  detail?: Record<string, unknown>,
): void {
  if (typeof performance !== "undefined" && typeof performance.mark === "function") {
    try {
      performance.mark(name);
    } catch {
      // Ignore invalid marks; the dev log is enough for fallback visibility.
    }
  }

  if (!BOOT_TRACE_ENABLED) {
    return;
  }

  if (detail) {
    console.info(`[Boot] ${name}`, detail);
    return;
  }

  console.info(`[Boot] ${name}`);
}
