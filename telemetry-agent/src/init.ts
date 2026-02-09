// ABOUTME: Init phase — verifies prerequisites and creates telemetry-agent.yaml config.
// ABOUTME: Discovers SDK init file, checks OTel deps, validates schema, writes config.

import * as fs from "node:fs";
import * as path from "node:path";
import * as net from "node:net";
import { writeConfig } from "./config.js";

export interface InitResult {
  success: boolean;
  configPath: string;
  warnings: string[];
  errors: string[];
  discovered: {
    projectName: string;
    sdkInitFile: string;
    schemaPath: string;
    hasTestSuite: boolean;
    nodeVersion: string;
  };
}

export async function runInit(
  targetDir: string,
  options?: { schemaPath?: string }
): Promise<InitResult> {
  const errors: string[] = [];
  const warnings: string[] = [];
  let projectName = "";
  let sdkInitFile = "";
  let hasTestSuite = false;
  const nodeVersion = checkNodeVersion();

  // Check package.json
  const pkgPath = path.join(targetDir, "package.json");
  if (!fs.existsSync(pkgPath)) {
    errors.push("package.json not found in target directory");
    return makeResult(false, "", errors, warnings, {
      projectName,
      sdkInitFile,
      schemaPath: "",
      hasTestSuite,
      nodeVersion: nodeVersion.version,
    });
  }

  const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));
  projectName = pkg.name ?? "unknown";

  // Check @opentelemetry/api
  const allDeps = {
    ...(pkg.dependencies ?? {}),
    ...(pkg.devDependencies ?? {}),
  };
  if (!allDeps["@opentelemetry/api"]) {
    errors.push(
      "@opentelemetry/api not found in dependencies. Install it first."
    );
    return makeResult(false, "", errors, warnings, {
      projectName,
      sdkInitFile,
      schemaPath: "",
      hasTestSuite,
      nodeVersion: nodeVersion.version,
    });
  }

  // Find SDK init file
  const foundSdk = await findSdkInitFile(targetDir);
  if (foundSdk) {
    sdkInitFile = foundSdk;
  } else {
    warnings.push(
      "Could not find OTel SDK initialization file. Set sdkInitFile in config manually."
    );
  }

  // Check Node.js version
  if (!nodeVersion.compatible) {
    warnings.push(
      `Node.js ${nodeVersion.version} may not be compatible. Requires ^18.19.0 || >=20.6.0.`
    );
  }

  // Check test suite
  if (pkg.scripts?.test) {
    hasTestSuite = true;
  } else {
    warnings.push("No test script found in package.json. Tests will be skipped.");
  }

  // Validate schema path
  const schemaPath = options?.schemaPath ?? path.join(targetDir, "registry");
  if (!fs.existsSync(schemaPath)) {
    errors.push(`schema path does not exist: ${schemaPath}`);
    return makeResult(false, "", errors, warnings, {
      projectName,
      sdkInitFile,
      schemaPath,
      hasTestSuite,
      nodeVersion: nodeVersion.version,
    });
  }

  // Write config
  const configPath = path.join(targetDir, "telemetry-agent.yaml");
  writeConfig(configPath, {
    schemaPath,
    sdkInitFile: sdkInitFile || "src/telemetry/setup.ts",
    autoApproveLibraries: true,
    testCommand: pkg.scripts?.test ? "npm test" : "",
    maxFixAttempts: 3,
    maxTokensPerFile: 50000,
    maxSpansPerFile: 5,
    maxFilesPerRun: 50,
    maxSpansPerRun: 50,
    schemaCheckpointInterval: 5,
    exclude: ["**/*.test.ts", "**/*.spec.ts", "**/*.d.ts", "node_modules/**"],
  });

  return makeResult(true, configPath, errors, warnings, {
    projectName,
    sdkInitFile,
    schemaPath,
    hasTestSuite,
    nodeVersion: nodeVersion.version,
  });
}

function makeResult(
  success: boolean,
  configPath: string,
  errors: string[],
  warnings: string[],
  discovered: InitResult["discovered"]
): InitResult {
  return { success, configPath, warnings, errors, discovered };
}

export async function findSdkInitFile(
  targetDir: string
): Promise<string | null> {
  const searchDirs = [
    "src/telemetry",
    "src/tracing",
    "src/instrumentation",
    "src",
  ];

  for (const dir of searchDirs) {
    const fullDir = path.join(targetDir, dir);
    if (!fs.existsSync(fullDir)) continue;

    const files = fs.readdirSync(fullDir).filter((f) => f.endsWith(".ts"));
    for (const file of files) {
      const content = fs.readFileSync(path.join(fullDir, file), "utf-8");
      if (
        content.includes("NodeSDK") ||
        content.includes("@opentelemetry/sdk-node")
      ) {
        return path.join(dir, file);
      }
    }
  }

  return null;
}

export function checkNodeVersion(): { compatible: boolean; version: string } {
  const version = process.version;
  const match = version.match(/^v(\d+)\.(\d+)\.(\d+)/);
  if (!match) return { compatible: false, version };

  const major = parseInt(match[1]);
  const minor = parseInt(match[2]);

  // ^18.19.0 || >=20.6.0
  const compatible =
    (major === 18 && minor >= 19) ||
    (major === 20 && minor >= 6) ||
    major > 20;

  return { compatible, version };
}

export async function checkPortAvailability(
  port: number
): Promise<boolean> {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once("error", () => resolve(false));
    server.once("listening", () => {
      server.close(() => resolve(true));
    });
    server.listen(port, "127.0.0.1");
  });
}
