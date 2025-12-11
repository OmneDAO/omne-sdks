// Command line helper to verify WASM artifacts against the runtime golden manifest.
import { createHash } from "crypto";
import { existsSync, readFileSync } from "fs";
import path from "path";

interface SerializedValue {
  kind: string;
  value: number;
}

interface TierSnapshot {
  tier: string;
  execution_time_bucket: string;
  gas_consumed: number;
  return_value?: SerializedValue;
  deterministic_state: string;
}

interface FixtureSnapshot {
  slug: string;
  description: string;
  entry_function: string;
  module_sha256: string;
  tiers: TierSnapshot[];
}

interface RuntimeManifest {
  generated_at_unix: number;
  fixtures: FixtureSnapshot[];
}

interface CliOptions {
  artifact?: string;
  slug?: string;
  manifest?: string;
  listOnly: boolean;
  outputJson: boolean;
  help: boolean;
}

interface VerificationResult {
  artifact: string;
  slug: string;
  expected_sha256: string;
  actual_sha256: string;
  match: boolean;
}

const DEFAULT_MANIFEST_PATH = path.resolve(__dirname, "..", "data", "runtime-snapshots.json");

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = {
    listOnly: false,
    outputJson: false,
    help: false
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];

    switch (arg) {
      case "--artifact":
      case "-a": {
        const value = argv[i + 1];
        if (!value) {
          throw new Error(`${arg} requires a value`);
        }
        options.artifact = value;
        i += 1;
        break;
      }
      case "--slug":
      case "-s": {
        const value = argv[i + 1];
        if (!value) {
          throw new Error(`${arg} requires a value`);
        }
        options.slug = value;
        i += 1;
        break;
      }
      case "--manifest":
      case "-m": {
        const value = argv[i + 1];
        if (!value) {
          throw new Error(`${arg} requires a value`);
        }
        options.manifest = value;
        i += 1;
        break;
      }
      case "--list":
        options.listOnly = true;
        break;
      case "--json":
        options.outputJson = true;
        break;
      case "--help":
      case "-h":
        options.help = true;
        break;
      default:
        throw new Error(`unknown argument: ${arg}`);
    }
  }

  return options;
}

function loadManifest(location?: string): RuntimeManifest {
  const manifestPath = location ? path.resolve(location) : DEFAULT_MANIFEST_PATH;

  if (!existsSync(manifestPath)) {
    throw new Error(`Manifest not found at ${manifestPath}`);
  }

  const raw = readFileSync(manifestPath, "utf8");
  return JSON.parse(raw) as RuntimeManifest;
}

function listManifest(manifest: RuntimeManifest): void {
  console.log("Available runtime fixtures:");
  manifest.fixtures.forEach((fixture) => {
    console.log(`- ${fixture.slug}: ${fixture.description}`);
  });
}

function computeSha256(filePath: string): string {
  const buffer = readFileSync(filePath);
  const hash = createHash("sha256");
  hash.update(buffer);
  return hash.digest("hex");
}

function verifyArtifact(artifactPath: string, fixture: FixtureSnapshot): VerificationResult {
  const resolvedArtifact = path.resolve(artifactPath);

  if (!existsSync(resolvedArtifact)) {
    throw new Error(`Artifact not found at ${resolvedArtifact}`);
  }

  const actual = computeSha256(resolvedArtifact);
  const expected = fixture.module_sha256;

  return {
    artifact: resolvedArtifact,
    slug: fixture.slug,
    expected_sha256: expected,
    actual_sha256: actual,
    match: actual === expected
  };
}

function printUsage(): void {
  console.log("Usage: omne-sdk-verify-runtime --artifact <path> --slug <fixture>");
  console.log("Options:");
  console.log("  -a, --artifact <path>   Path to the WASM artifact to verify");
  console.log("  -s, --slug <slug>       Fixture slug recorded in the manifest");
  console.log("  -m, --manifest <path>   Override manifest location (defaults to packaged data)");
  console.log("      --list              List available fixture slugs");
  console.log("      --json              Emit verification result as JSON");
  console.log("  -h, --help              Show this help message");
}

function main(): void {
  let options: CliOptions;
  try {
    options = parseArgs(process.argv.slice(2));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Argument error: ${message}`);
    printUsage();
    process.exit(2);
    return;
  }

  if (options.help) {
    printUsage();
    process.exit(0);
    return;
  }

  const manifest = loadManifest(options.manifest);

  if (options.listOnly) {
    listManifest(manifest);
    process.exit(0);
    return;
  }

  if (!options.artifact || !options.slug) {
    console.error("Both --artifact and --slug are required.");
    printUsage();
    process.exit(2);
    return;
  }

  const fixture = manifest.fixtures.find((item) => item.slug === options.slug);

  if (!fixture) {
    console.error(`Fixture '${options.slug}' not found in manifest.`);
    process.exit(3);
    return;
  }

  let result: VerificationResult;
  try {
    result = verifyArtifact(options.artifact, fixture);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Verification failed: ${message}`);
    process.exit(4);
    return;
  }

  if (options.outputJson) {
    console.log(JSON.stringify(result, null, 2));
  } else if (result.match) {
    console.log(`OK: ${result.slug} matches recorded SHA256 (${result.expected_sha256}).`);
  } else {
    console.error(`Mismatch: expected ${result.expected_sha256}, found ${result.actual_sha256}.`);
  }

  process.exit(result.match ? 0 : 5);
}

main();
