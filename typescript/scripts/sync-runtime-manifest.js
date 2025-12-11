#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");

const scriptDir = __dirname;
const repoRoot = path.resolve(scriptDir, "../../..");
const source = path.resolve(repoRoot, "axiom-runtime/tests/runtime_golden/manifest/runtime-snapshots.json");
const target = path.resolve(scriptDir, "../src/data/runtime-snapshots.json");

if (!fs.existsSync(source)) {
  console.error(`runtime snapshot manifest not found at ${source}`);
  process.exit(1);
}

fs.mkdirSync(path.dirname(target), { recursive: true });
fs.copyFileSync(source, target);
console.log(`Copied runtime snapshot manifest to ${path.relative(repoRoot, target)}`);
