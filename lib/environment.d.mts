export function getEnvironmentVariable(
  name: string,
  environment?: Record<string, string | undefined>,
): string | undefined;
export function resolveRuntimeDataDirectory(directory?: string, configured?: string): string;
