export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const [{ initializeAuth }, { startScheduler }, { initializeDatabase, refreshChannelLogSecrets }] = await Promise.all([
    import("./lib/auth"),
    import("./lib/scheduler"),
    import("./lib/db"),
  ]);
  initializeDatabase();
  refreshChannelLogSecrets();
  initializeAuth();
  startScheduler();
}
