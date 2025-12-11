#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");

const scriptDir = __dirname;
const source = path.resolve(scriptDir, "../src/data/runtime-snapshots.json");
const targetDir = path.resolve(scriptDir, "../dist/data");
const target = path.join(targetDir, "runtime-snapshots.json");

if (!fs.existsSync(source)) {
  console.error(`runtime snapshot manifest not found at ${source}`);
  process.exit(1);
}

fs.mkdirSync(targetDir, { recursive: true });
fs.copyFileSync(source, target);
console.log(`Copied runtime snapshot manifest to ${path.relative(path.resolve(scriptDir, "../../.."), target)}`);
