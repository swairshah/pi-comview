#!/usr/bin/env node

import { chmodSync, existsSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const binDir = resolve(root, "bin");

function log(msg) {
	process.stdout.write(`[pi-comview] ${msg}\n`);
}

if (!existsSync(binDir)) {
	log("No bin directory found; extension will fall back to comview from PATH.");
	process.exit(0);
}

const files = readdirSync(binDir).filter((name) => name.startsWith("comview-"));
if (files.length === 0) {
	log("No bundled comview binaries found; extension will fall back to PATH.");
	process.exit(0);
}

for (const file of files) {
	const fullPath = resolve(binDir, file);
	try {
		chmodSync(fullPath, 0o755);
	} catch {
		// best-effort
	}
}

log(`Prepared ${files.length} bundled comview binary(ies).`);
