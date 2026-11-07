import { existsSync } from "fs";
import { join } from "path";
import { homedir } from "os";

const CANDIDATES = [
  process.env.ADB_PATH,
  join(homedir(), "Library/Android/sdk/platform-tools/adb"),
  "/opt/homebrew/bin/adb",
  "/usr/local/bin/adb",
].filter(Boolean) as string[];

export function resolveAdbPath(): string {
  for (const candidate of CANDIDATES) {
    if (existsSync(candidate)) return candidate;
  }
  return "adb";
}
