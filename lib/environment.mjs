export function getEnvironmentVariable(name, environment = process.env) {
  return environment[`RUBIDIUM_${name}`] ?? environment[`BARKER_${name}`];
}
