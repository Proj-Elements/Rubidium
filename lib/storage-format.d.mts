import type { DatabaseSync } from "node:sqlite";

export const DATABASE_FILENAME: "rubidium.sqlite";
export const CURRENT_SCHEMA_VERSION: 6;
export const TRANSFER_VERSION: 2;
export function databaseNeedsInitialization(database: DatabaseSync): boolean;
export function assertV2DataDirectory(directory: string): void;
