# TDD Implementation Plan: Telemetry Agent

**Source spec:** `SPEC.md`
**Framework:** Direct Anthropic SDK (`@anthropic-ai/sdk`) — per Q5 recommendation
**Language:** TypeScript, Node.js ^18.19.0 || >=20.6.0
**Test runner:** vitest (fast, TypeScript-native, compatible with Zod)

---

## Architecture: Dependency Graph

```
Config Types (1) <- Result Files (2) <- Library Allowlist + SDK Renderer (3)
     ^                    ^                        ^
Git Ops (4)        Weaver CLI (5)          ts-morph Analysis (6)
     ^                    ^               ts-morph Transform (7)
     |                    |                npm Registry (8)
     |                    |                        |
     +-------- Init Phase (9) ---------+          |
               Validation Chain (10)               |
               File Analysis + Schema (11) --------+
                        |
          Coordinator Core (12)
          Coordinator Post (13)
          End-of-Run Validation (14)
                        |
          Instrumentation Agent (15)
          Wire Agent + PR (16)
                        |
          Self-Instrumentation (17)
          MCP Server (18)
          E2E Integration (19)
```

---

## Prompt 1: Project Scaffolding + Config Types

**Produces:** Project structure, Zod config schema, YAML parser, config validator
**Depends on:** Nothing (foundation)
**Tests:** Config parsing, validation, defaults, error cases

```text
You are building a TypeScript project called "telemetry-agent" — an AI agent
that auto-instruments TypeScript code with OpenTelemetry based on a Weaver schema.

This is Prompt 1 of 19. We are starting from scratch.

## Task

1. Initialize a TypeScript project with:
   - `package.json` with name "telemetry-agent"
   - `tsconfig.json` targeting ES2022, NodeNext module resolution
   - vitest for testing
   - zod for schema validation
   - yaml for YAML parsing
   - Source in `src/`, tests in `src/__tests__/`
   - All code files start with a 2-line ABOUTME comment

2. Create the config module at `src/config.ts`:
   - Zod schema for `telemetry-agent.yaml` with these fields:
     - `schemaPath` (string, required) — path to Weaver registry
     - `sdkInitFile` (string, required) — path to OTel SDK init file
     - `autoApproveLibraries` (boolean, default: true)
     - `testCommand` (string, default: "npm test")
     - `maxFixAttempts` (number, default: 3, min: 1, max: 10)
     - `maxTokensPerFile` (number, default: 50000, min: 1000)
     - `maxSpansPerFile` (number, default: 5, min: 1, max: 20)
     - `exclude` (string array, default: ["**/*.test.ts", "**/*.spec.ts", "**/*.d.ts", "node_modules/**"])
   - `loadConfig(configPath: string): Config` — reads YAML, validates with Zod, returns typed config
   - `writeConfig(configPath: string, config: Config): void` — writes validated config to YAML
   - Export the Config type inferred from the Zod schema

3. Write tests FIRST in `src/__tests__/config.test.ts`:
   - Test: valid config parses correctly
   - Test: defaults are applied for optional fields
   - Test: missing required fields throw ZodError with helpful message
   - Test: out-of-range values (maxFixAttempts: 0, maxSpansPerFile: 100) rejected
   - Test: loadConfig reads from YAML file correctly
   - Test: writeConfig produces valid YAML that loadConfig can read back
   - Test: loadConfig throws if file doesn't exist

4. Run tests to confirm they fail, then implement to make them pass.

## File Structure
```
telemetry-agent/
  src/
    config.ts
    __tests__/
      config.test.ts
  package.json
  tsconfig.json
  vitest.config.ts
```

Do NOT install any dependencies beyond what's listed. Do NOT add any code
beyond what's specified. Keep it minimal.
```

---

## Prompt 2: Result File Types + I/O

**Produces:** Result file Zod schemas, read/write/aggregate functions
**Depends on:** Prompt 1 (Zod patterns, project structure)
**Tests:** Parse success/failure results, aggregate across files, glob collection

```text
You are building the telemetry-agent project. This is Prompt 2 of 19.

Prompt 1 created the project structure and config module (`src/config.ts`).

## Task

Create the result file module at `src/results.ts`:

1. Define Zod schemas for the per-file result structure:

   LibraryRequirement schema:
   - `package` (string) — npm package name
   - `import` (string) — named export to import
   - `config` (Record<string, unknown>, default: {})

   SuccessResult schema:
   - `path` (string) — file path processed
   - `status` (literal "success")
   - `spans_added` (number, min: 0)
   - `libraries_needed` (array of LibraryRequirement, default: [])
   - `schema_extensions` (string array, default: [])
   - `attributes_created` (number, min: 0, default: 0)
   - `validation_retries` (number, min: 0, default: 0)

   FailureResult schema:
   - `path` (string)
   - `status` (literal "failed")
   - `reason` (string)
   - `last_error` (string, optional)

   FileResult = SuccessResult | FailureResult (discriminated union on `status`)

2. Functions:
   - `writeResult(dir: string, result: FileResult): string` — writes JSON to
     `.telemetry-agent-results/{filename}.json`, returns path written.
     Filename derived from result.path (replace / with __ and .ts with .json).
   - `readResult(path: string): FileResult` — reads and validates JSON file
   - `collectResults(dir: string): FileResult[]` — globs `dir/*.json`, reads all,
     returns array sorted by path
   - `aggregateLibraries(results: FileResult[]): LibraryRequirement[]` — collects
     all libraries_needed from success results, deduplicates by package name
     (first occurrence wins)
   - `summarizeResults(results: FileResult[]): ResultSummary` — returns
     { total, succeeded, failed, totalSpansAdded, totalAttributesCreated,
       librariesNeeded: string[] }

3. Write tests FIRST in `src/__tests__/results.test.ts`:
   - Test: SuccessResult validates correctly
   - Test: FailureResult validates correctly
   - Test: invalid status value rejected
   - Test: writeResult creates file with correct name
   - Test: readResult reads back what writeResult wrote
   - Test: collectResults finds all JSON files in directory
   - Test: aggregateLibraries deduplicates by package name
   - Test: aggregateLibraries ignores failed results
   - Test: summarizeResults counts correctly with mixed success/failure

4. Run tests first (fail), then implement.

Use a temp directory (via Node.js `os.tmpdir()` + `crypto.randomUUID()`) for
file I/O tests. Clean up in afterEach.
```

---

## Prompt 3: Library Allowlist + SDK Init File Renderer

**Produces:** Allowlist lookup, SDK file rendering from library declarations
**Depends on:** Prompt 2 (LibraryRequirement type)
**Tests:** Allowlist lookup, SDK rendering, dedup, idempotency

```text
You are building the telemetry-agent project. This is Prompt 3 of 19.

Previous prompts created:
- `src/config.ts` — Config types and YAML I/O
- `src/results.ts` — Result file types including LibraryRequirement

## Task

Create two modules:

### A. Library Allowlist (`src/allowlist.ts`)

1. Define the hardcoded allowlist as a Map<string, LibraryRequirement>:
   Key = framework import name, Value = library requirement.

   Entries (from spec):
   | Framework Import | Package | Import Name |
   |-----------------|---------|-------------|
   | http, https | @opentelemetry/instrumentation-http | HttpInstrumentation |
   | express | @opentelemetry/instrumentation-express | ExpressInstrumentation |
   | pg | @opentelemetry/instrumentation-pg | PgInstrumentation |
   | mysql | @opentelemetry/instrumentation-mysql | MySQLInstrumentation |
   | mysql2 | @opentelemetry/instrumentation-mysql2 | MySQL2Instrumentation |
   | mongodb | @opentelemetry/instrumentation-mongodb | MongoDBInstrumentation |
   | redis | @opentelemetry/instrumentation-redis | RedisInstrumentation |
   | ioredis | @opentelemetry/instrumentation-ioredis | IORedisInstrumentation |
   | @grpc/grpc-js | @opentelemetry/instrumentation-grpc | GrpcInstrumentation |
   | koa | @opentelemetry/instrumentation-koa | KoaInstrumentation |
   | fastify | @fastify/otel | FastifyOtel |
   | @nestjs/core | @opentelemetry/instrumentation-nestjs-core | NestInstrumentation |
   | mongoose | @opentelemetry/instrumentation-mongoose | MongooseInstrumentation |
   | kafkajs | @opentelemetry/instrumentation-kafkajs | KafkaJsInstrumentation |
   | pino | @opentelemetry/instrumentation-pino | PinoInstrumentation |

2. Functions:
   - `lookupLibrary(importName: string): LibraryRequirement | null`
   - `isInAllowlist(importName: string): boolean`

### B. SDK Init File Renderer (`src/sdk-renderer.ts`)

1. Function:
   - `renderSdkInitFile(existingContent: string, libraries: LibraryRequirement[]): string`

   This reads the existing SDK init file content and produces a new version with
   all required instrumentation libraries added. It must:
   - Parse existing imports (find the `instrumentations: [...]` array in NodeSDK config)
   - Add new library imports at the top
   - Add new `new LibraryName(config)` entries to the instrumentations array
   - Preserve existing instrumentations (don't duplicate)
   - Sort imports alphabetically for determinism
   - Return the full file content as a string

2. Write tests FIRST:
   - Test: lookupLibrary returns correct result for "pg"
   - Test: lookupLibrary returns null for unknown import "some-random-lib"
   - Test: isInAllowlist returns true for "express", false for "unknown"
   - Test: renderSdkInitFile adds single library to empty instrumentations array
   - Test: renderSdkInitFile adds multiple libraries, sorted alphabetically
   - Test: renderSdkInitFile doesn't duplicate existing instrumentations
   - Test: renderSdkInitFile preserves existing file structure (service name, etc.)
   - Test: renderSdkInitFile handles empty libraries array (returns content unchanged)
```

---

## Prompt 4: Git Operations Wrapper

**Produces:** Git abstraction for branch, snapshot, revert, commit
**Depends on:** Prompt 1 (project structure)
**Tests:** Branch creation, snapshot/revert, commit, status checks

```text
You are building the telemetry-agent project. This is Prompt 4 of 19.

## Task

Create `src/git.ts` — a wrapper around git operations using `simple-git`.

Install `simple-git` as a dependency.

### Functions:

1. `createFeatureBranch(repoPath: string, branchName: string): Promise<string>`
   — Creates and checks out a new branch. Returns branch name.
   — Branch name format: `telemetry-agent/{timestamp}` if not provided.

2. `snapshotFile(repoPath: string, filePath: string): Promise<FileSnapshot>`
   — Records the current state of a file before agent processing.
   — FileSnapshot = { filePath: string, commitSha: string | null, content: string }
   — If file is untracked, commitSha is null and content is the current file content.

3. `revertFile(repoPath: string, snapshot: FileSnapshot): Promise<void>`
   — Restores a file to its snapshot state.
   — If commitSha exists, restore from that commit.
   — If commitSha is null (was untracked), write back the saved content.

4. `commitFile(repoPath: string, filePath: string, message: string): Promise<string>`
   — Stages and commits a single file. Returns commit SHA.

5. `commitFiles(repoPath: string, files: string[], message: string): Promise<string>`
   — Stages and commits multiple files. Returns commit SHA.

6. `isClean(repoPath: string): Promise<boolean>`
   — Returns true if working directory is clean (no uncommitted changes).

7. `getCurrentBranch(repoPath: string): Promise<string>`
   — Returns current branch name.

Export the FileSnapshot type.

### Tests (`src/__tests__/git.test.ts`):

Use a temp directory with `git init` for each test. Clean up after.

- Test: createFeatureBranch creates and checks out new branch
- Test: snapshotFile captures file content and commit SHA
- Test: snapshotFile handles untracked file (commitSha is null)
- Test: revertFile restores file to snapshot state after modification
- Test: revertFile restores untracked file
- Test: commitFile stages and commits, returns SHA
- Test: commitFiles commits multiple files
- Test: isClean returns true when clean, false when dirty
- Test: getCurrentBranch returns correct branch name

Write tests first, then implement.
```

---

## Prompt 5: Weaver CLI Wrapper

**Produces:** Typed wrapper around Weaver CLI commands
**Depends on:** Prompt 1 (project structure)
**Tests:** Command construction, output parsing (with fixtures)

```text
You are building the telemetry-agent project. This is Prompt 5 of 19.

## Task

Create `src/weaver.ts` — a wrapper around the Weaver CLI.

### Types:

```typescript
interface WeaverCheckResult {
  success: boolean;
  errors: string[];
  warnings: string[];
}

interface WeaverResolveResult {
  groups: WeaverGroup[];
  raw: unknown; // full parsed JSON
}

interface WeaverGroup {
  id: string;
  type: string; // "span" | "attribute_group" | etc.
  brief: string;
  attributes: WeaverAttribute[];
}

interface WeaverAttribute {
  id?: string;
  ref?: string;
  type?: string;
  requirement_level?: string;
}

interface WeaverLiveCheckHandle {
  process: ChildProcess;
  grpcPort: number;
  httpPort: number;
  stop: () => Promise<WeaverComplianceReport>;
}

interface WeaverComplianceReport {
  raw: string;
  // Parsed fields TBD based on actual Weaver output
}
```

### Functions:

1. `weaverCheck(registryPath: string): Promise<WeaverCheckResult>`
   — Runs `weaver registry check -r <path>`. Parses stdout/stderr.

2. `weaverResolve(registryPath: string): Promise<WeaverResolveResult>`
   — Runs `weaver registry resolve -r <path> -f json`. Parses JSON output.

3. `startWeaverLiveCheck(registryPath: string, opts?: { grpcPort?: number, httpPort?: number }): Promise<WeaverLiveCheckHandle>`
   — Starts `weaver registry live-check -r <path>` as a background process.
   — Default ports: 4317 (gRPC), 4320 (HTTP).
   — Returns handle with stop() that sends POST to /stop and parses output.

4. `isWeaverInstalled(): Promise<boolean>`
   — Runs `weaver --version`, returns true if successful.

### Tests (`src/__tests__/weaver.test.ts`):

Since Weaver may not be installed in all test environments, structure tests in two groups:

**Unit tests (always run, use fixtures):**
- Test: weaverCheck parses successful output correctly
- Test: weaverCheck parses error output with violations
- Test: weaverResolve parses JSON output into typed groups
- Test: command construction is correct (verify the args passed to exec)

**Integration tests (skip if Weaver not installed):**
- Test: isWeaverInstalled returns boolean
- Test: weaverCheck against a valid test registry (create a minimal one in fixtures)
- Test: weaverResolve against a valid test registry

For integration tests, use `describe.skipIf(!await isWeaverInstalled())`.

Create a test fixture at `src/__tests__/fixtures/test-registry/` with a minimal
valid Weaver registry (registry_manifest.yaml + one attribute + one span).

Write tests first, then implement.
```

---

## Prompt 6: ts-morph — Import Analysis + Scope Analysis

**Produces:** TypeScript file analysis: import detection, scope checking
**Depends on:** Prompt 1 (project structure)
**Tests:** Import detection, framework matching, variable shadowing detection

```text
You are building the telemetry-agent project. This is Prompt 6 of 19.

## Task

Install `ts-morph` as a dependency. Create `src/analysis.ts`.

### Functions:

1. `analyzeImports(fileContent: string): ImportInfo[]`
   — Uses ts-morph to parse a TypeScript file and extract all imports.
   — ImportInfo = { moduleSpecifier: string, namedImports: string[], defaultImport: string | null }

2. `detectFrameworks(imports: ImportInfo[]): string[]`
   — Given imports, returns list of framework module specifiers that might
     have OTel instrumentation libraries (e.g., "pg", "express", "fastify").
   — Checks against known framework names.

3. `detectExistingInstrumentation(fileContent: string): InstrumentationInfo[]`
   — Scans for existing OTel patterns: `tracer.startActiveSpan`, `tracer.startSpan`,
     imports from `@opentelemetry/api`, `trace.getTracer()` calls.
   — InstrumentationInfo = { type: "span" | "tracer" | "import", location: { line: number, column: number } }

4. `checkVariableShadowing(fileContent: string, variableNames: string[], targetFunction: string): ShadowingResult`
   — Uses ts-morph's binder access to check if any of the given variable names
     (e.g., ["span", "tracer"]) already exist in the scope of the target function.
   — ShadowingResult = { hasShadowing: boolean, conflicts: { name: string, existingLocation: { line: number } }[] }
   — Access scope via: get the function node, walk up scopes checking for variable declarations.

5. `findInstrumentableFunctions(fileContent: string): FunctionInfo[]`
   — Finds exported async functions, functions in handler/service patterns.
   — FunctionInfo = { name: string, isAsync: boolean, isExported: boolean, startLine: number, endLine: number, lineCount: number }
   — Skip functions under 10 lines that have no external calls.

### Tests (`src/__tests__/analysis.test.ts`):

Use inline TypeScript strings as test fixtures.

- Test: analyzeImports finds named imports (`import { Pool } from 'pg'`)
- Test: analyzeImports finds default imports (`import express from 'express'`)
- Test: analyzeImports finds namespace imports (`import * as grpc from '@grpc/grpc-js'`)
- Test: detectFrameworks returns ["pg"] for pg import
- Test: detectFrameworks returns empty for unknown modules
- Test: detectExistingInstrumentation finds tracer.startActiveSpan
- Test: detectExistingInstrumentation finds @opentelemetry/api import
- Test: detectExistingInstrumentation returns empty for uninstrumented file
- Test: checkVariableShadowing detects "span" in outer scope
- Test: checkVariableShadowing returns false when no conflicts
- Test: checkVariableShadowing detects "tracer" as module-level variable
- Test: findInstrumentableFunctions finds exported async functions
- Test: findInstrumentableFunctions skips short synchronous helpers

Write tests first, then implement.
```

---

## Prompt 7: ts-morph — Code Transformation (Span Insertion)

**Produces:** AST-based code transformation: add imports, wrap functions with spans
**Depends on:** Prompt 6 (analysis types, ts-morph patterns)
**Tests:** Import insertion, span wrapping, tracer setup, formatting

```text
You are building the telemetry-agent project. This is Prompt 7 of 19.

Previous prompt created `src/analysis.ts` with import analysis and scope checking.

## Task

Create `src/transform.ts` — code transformation using ts-morph.

### Functions:

1. `addOtelImports(fileContent: string): string`
   — Adds `import { trace, SpanStatusCode } from '@opentelemetry/api'` if not present.
   — Preserves existing imports. Doesn't duplicate.

2. `addTracerDeclaration(fileContent: string, serviceName: string): string`
   — Adds `const tracer = trace.getTracer('<serviceName>')` at module level.
   — Places it after imports, before first function/class declaration.
   — If a tracer declaration already exists, skip.

3. `wrapFunctionWithSpan(fileContent: string, functionName: string, spanName: string, attributes: SpanAttribute[]): string`
   — Wraps the body of the named function with:
     ```
     return tracer.startActiveSpan('<spanName>', async (span) => {
       try {
         span.setAttribute('<key>', <value>);
         // ... original body ...
         return originalReturnValue;
       } catch (error) {
         span.recordException(error);
         span.setStatus({ code: SpanStatusCode.ERROR });
         throw error;
       } finally {
         span.end();
       }
     });
     ```
   — SpanAttribute = { key: string, valueExpression: string }
   — Uses the variable name from scope check (defaults to "span", falls back to "otelSpan" if shadowed).
   — Handles async functions (adds async to callback).
   — Preserves the function's existing return type.

4. `applyTransformations(fileContent: string, transforms: TransformPlan): string`
   — Applies a series of transformations in order:
     a. Add OTel imports (if any manual spans needed)
     b. Add tracer declaration (if any manual spans needed)
     c. Wrap each function listed in transforms.spans
   — TransformPlan = { serviceName: string, spans: SpanTransform[] }
   — SpanTransform = { functionName: string, spanName: string, attributes: SpanAttribute[], variableName: string }

### Tests (`src/__tests__/transform.test.ts`):

- Test: addOtelImports adds import to file without it
- Test: addOtelImports skips if import already exists
- Test: addTracerDeclaration adds tracer after imports
- Test: addTracerDeclaration skips if tracer exists
- Test: wrapFunctionWithSpan wraps async function correctly
- Test: wrapFunctionWithSpan uses "otelSpan" when "span" is shadowed
- Test: wrapFunctionWithSpan adds attributes
- Test: wrapFunctionWithSpan preserves existing code structure
- Test: applyTransformations chains all transforms correctly
- Test: applyTransformations handles empty spans list (returns unchanged)
- Test: round-trip: transform output is valid TypeScript (use ts-morph to verify)

Write tests first, then implement.
```

---

## Prompt 8: npm Registry Client

**Produces:** npm registry search for OTel instrumentation packages
**Depends on:** Prompt 2 (LibraryRequirement type)
**Tests:** Search logic, response parsing, fallback behavior

```text
You are building the telemetry-agent project. This is Prompt 8 of 19.

## Task

Create `src/npm-registry.ts` — queries npm registry to discover OTel instrumentation packages.

### Functions:

1. `searchOtelLibrary(frameworkName: string): Promise<NpmSearchResult | null>`
   — Searches npm registry for OpenTelemetry instrumentation packages matching a framework.
   — Search strategy:
     a. Search for `@opentelemetry/instrumentation-{frameworkName}`
     b. Search for `@{frameworkName}/otel` (framework-maintained pattern)
     c. General search: `opentelemetry instrumentation {frameworkName}`
   — Returns the best match or null if nothing found.
   — NpmSearchResult = { packageName: string, version: string, description: string }

2. `getPackageInfo(packageName: string): Promise<PackageInfo | null>`
   — Fetches package metadata from npm registry.
   — PackageInfo = { name: string, version: string, description: string, deprecated: boolean }
   — Uses `https://registry.npmjs.org/{packageName}` endpoint.

3. `toLibraryRequirement(searchResult: NpmSearchResult): LibraryRequirement`
   — Converts search result to a LibraryRequirement.
   — Infers the import name from the package name (e.g., instrumentation-pg -> PgInstrumentation).
   — This is best-effort; the LLM agent may override.

### Tests (`src/__tests__/npm-registry.test.ts`):

**Unit tests (no network):**
- Test: toLibraryRequirement infers correct import name from "@opentelemetry/instrumentation-pg"
- Test: toLibraryRequirement handles scoped packages like "@fastify/otel"
- Test: search strategy constructs correct search URLs

**Integration tests (requires network, can be skipped in CI):**
- Test: searchOtelLibrary("pg") finds @opentelemetry/instrumentation-pg
- Test: searchOtelLibrary("nonexistent-framework-xyz") returns null
- Test: getPackageInfo("@opentelemetry/instrumentation-pg") returns valid info

Mark integration tests with `describe.skipIf(process.env.CI)` or similar.

Write tests first, then implement. Use native `fetch` (Node 18+).
```

---

## Prompt 9: Init Phase

**Produces:** `telemetry-agent init` implementation
**Depends on:** Prompts 1 (config), 5 (Weaver), 4 (git — for repo detection)
**Tests:** Prerequisite checks, config creation, error cases

```text
You are building the telemetry-agent project. This is Prompt 9 of 19.

Previous prompts created:
- `src/config.ts` — Config types, loadConfig, writeConfig
- `src/weaver.ts` — weaverCheck, isWeaverInstalled
- `src/git.ts` — Git operations

## Task

Create `src/init.ts` — the init phase that verifies prerequisites and creates config.

### Types:

```typescript
interface InitResult {
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
```

### Functions:

1. `runInit(targetDir: string, options?: { schemaPath?: string }): Promise<InitResult>`
   — Orchestrates all prerequisite checks and config creation.
   — Steps:
     a. Check package.json exists -> extract project name
     b. Check @opentelemetry/api in dependencies
     c. Find OTel SDK init file (search for NodeSDK usage patterns)
     d. Check Node.js version (^18.19.0 || >=20.6.0)
     e. Check test suite exists (look for test script in package.json)
     f. Validate schema with `weaver registry check`
     g. Write telemetry-agent.yaml

2. `findSdkInitFile(targetDir: string): Promise<string | null>`
   — Searches for the OTel SDK initialization file.
   — Look for files containing `NodeSDK` or `@opentelemetry/sdk-node` imports.
   — Search in common locations: src/telemetry/, src/tracing/, src/instrumentation/, src/
   — Returns relative path or null.

3. `checkNodeVersion(): { compatible: boolean, version: string }`
   — Checks process.version against ^18.19.0 || >=20.6.0.

4. `checkPortAvailability(port: number): Promise<boolean>`
   — Attempts to bind to the port briefly to check availability.
   — Used for Weaver live-check ports (4317, 4320).

### Tests (`src/__tests__/init.test.ts`):

Use temp directories with fixture projects.

- Test: runInit succeeds with valid project (package.json + OTel deps + schema + SDK init file)
- Test: runInit fails when package.json missing
- Test: runInit fails when @opentelemetry/api not in dependencies
- Test: runInit warns when no test suite found (but still succeeds)
- Test: runInit fails when schema path doesn't exist
- Test: findSdkInitFile finds file in src/telemetry/setup.ts
- Test: findSdkInitFile returns null when no SDK file exists
- Test: checkNodeVersion returns compatible for current Node
- Test: runInit writes correct telemetry-agent.yaml

Create test fixtures:
- `src/__tests__/fixtures/valid-project/` — minimal valid project with package.json, SDK init, schema
- `src/__tests__/fixtures/no-otel-project/` — project without OTel deps

Write tests first, then implement.
```

---

## Prompt 10: Validation Chain

**Produces:** Per-file validation: syntax -> lint -> Weaver static
**Depends on:** Prompts 5 (Weaver), 1 (config for limits)
**Tests:** Each validation step, fix loop with retry limit

```text
You are building the telemetry-agent project. This is Prompt 10 of 19.

Previous prompts created:
- `src/config.ts` — Config with maxFixAttempts
- `src/weaver.ts` — weaverCheck

## Task

Create `src/validation.ts` — the per-file validation chain.

### Types:

```typescript
interface ValidationResult {
  passed: boolean;
  step: "syntax" | "lint" | "weaver";
  errors: string[];
  fixable: boolean;
}

interface ValidationChainResult {
  passed: boolean;
  retries: number;
  failedStep: string | null;
  errors: string[];
}
```

### Functions:

1. `checkSyntax(filePath: string): Promise<ValidationResult>`
   — Uses ts-morph to parse the file and check for syntax errors.
   — Returns errors with line numbers.

2. `checkLint(filePath: string): Promise<ValidationResult>`
   — Runs Prettier check on the file (or ESLint if configured).
   — For PoC, use Prettier in check mode.
   — Returns formatting errors.

3. `fixLint(filePath: string): Promise<void>`
   — Runs Prettier write on the file to auto-fix formatting.

4. `checkWeaver(schemaPath: string): Promise<ValidationResult>`
   — Runs `weaver registry check` on the schema.
   — Parses output for errors/warnings.

5. `runValidationChain(filePath: string, schemaPath: string, maxRetries: number): Promise<ValidationChainResult>`
   — Runs the chain: syntax -> lint -> Weaver.
   — On failure at any step:
     - If fixable (lint), auto-fix and retry
     - If not fixable, return failure
   — Tracks retry count. Stops at maxRetries.
   — Returns overall result with retry count.

### Tests (`src/__tests__/validation.test.ts`):

- Test: checkSyntax passes for valid TypeScript
- Test: checkSyntax fails for invalid TypeScript (missing bracket)
- Test: checkLint passes for formatted code
- Test: checkLint fails for unformatted code
- Test: fixLint auto-formats code
- Test: runValidationChain passes on first try for valid code
- Test: runValidationChain retries on lint failure, passes after fix
- Test: runValidationChain stops at maxRetries
- Test: runValidationChain reports correct failedStep

Install `prettier` as a dependency for lint checking.

Write tests first, then implement.
```

---

## Prompt 11: File Analysis Pipeline + Schema Extension

**Produces:** Combines analysis -> library matching -> schema extension
**Depends on:** Prompts 3 (allowlist), 6 (analysis), 8 (npm), 2 (results)
**Tests:** Full pipeline from file -> decision -> schema updates

```text
You are building the telemetry-agent project. This is Prompt 11 of 19.

Previous prompts created:
- `src/analysis.ts` — Import analysis, scope checking, function finding
- `src/allowlist.ts` — Library allowlist lookup
- `src/npm-registry.ts` — npm search for OTel libraries
- `src/results.ts` — LibraryRequirement type

## Task

Create `src/pipeline.ts` — the file analysis pipeline that decides what to instrument.

### Types:

```typescript
interface AnalysisPlan {
  filePath: string;
  librariesNeeded: LibraryRequirement[];
  spansToAdd: SpanPlan[];
  alreadyInstrumented: string[]; // function names to skip
  skippedFunctions: SkippedFunction[];
}

interface SpanPlan {
  functionName: string;
  spanName: string;
  spanKind: "internal" | "client" | "server";
  attributes: SpanAttribute[];
  variableName: string; // "span" or "otelSpan" if shadowed
}

interface SkippedFunction {
  name: string;
  reason: "already_instrumented" | "too_short" | "shadowing_ambiguous";
}
```

### Functions:

1. `analyzeFile(filePath: string, fileContent: string, config: Config): Promise<AnalysisPlan>`
   — Full analysis pipeline:
     a. Analyze imports -> detect frameworks
     b. For each framework: check allowlist, then npm registry if autoApprove
     c. Detect existing instrumentation -> mark functions to skip
     d. Find instrumentable functions
     e. For each candidate function:
        - Check variable shadowing for "span" and "tracer"
        - Determine span name from namespace + function name
        - Plan attributes based on function signatures
     f. Enforce maxSpansPerFile cap (prioritize by: external calls > exports > others)
     g. Return the plan

2. `buildSpanName(namespace: string, functionName: string): string`
   — Constructs span name: `{namespace}.{function_name_in_snake_case}`

### Schema Extension (Create `src/schema.ts`):

1. `readSchema(schemaPath: string): Promise<SchemaData>`
   — Reads and parses the Weaver registry YAML files.
   — SchemaData = { namespace: string, groups: WeaverGroup[], rawFiles: Map<string, string> }

2. `extendSchema(schema: SchemaData, extensions: SchemaExtension[]): string`
   — Adds new span/attribute group entries to the schema YAML.
   — SchemaExtension = { groupId: string, type: "span" | "attribute_group", brief: string, spanKind?: string, attributes: { ref?: string, id?: string, type?: string, requirement_level: string }[] }
   — Validates namespace prefix rule (all new IDs must match schema namespace).
   — Returns updated YAML content for signals.yaml.

### Tests:

**`src/__tests__/pipeline.test.ts`:**
- Test: analyzeFile detects pg import and returns library requirement
- Test: analyzeFile skips already-instrumented functions
- Test: analyzeFile respects maxSpansPerFile cap
- Test: analyzeFile handles variable shadowing (uses otelSpan)
- Test: analyzeFile returns empty plan for file with no instrumentable functions
- Test: buildSpanName converts camelCase to snake_case correctly

**`src/__tests__/schema.test.ts`:**
- Test: readSchema parses valid registry
- Test: extendSchema adds new span group
- Test: extendSchema rejects group ID without correct namespace prefix
- Test: extendSchema preserves existing groups

Write tests first, then implement.
```

---

## Prompt 12: Coordinator Core — File Iteration + Snapshot/Revert

**Produces:** Coordinator file loop with snapshot/revert safety
**Depends on:** Prompts 1 (config), 4 (git), 2 (results)
**Tests:** File globbing, snapshot/revert cycle, 10-file limit, exclude patterns

```text
You are building the telemetry-agent project. This is Prompt 12 of 19.

Previous prompts created:
- `src/config.ts` — Config with exclude patterns
- `src/git.ts` — Branch, snapshot, revert, commit operations
- `src/results.ts` — Result file I/O

## Task

Create `src/coordinator.ts` — the Coordinator core that manages file iteration.

### Types:

```typescript
interface CoordinatorOptions {
  config: Config;
  targetPath: string; // file or directory
  repoPath: string;
}

interface FileProcessingContext {
  filePath: string;
  snapshot: FileSnapshot;
  resultDir: string;
}

type AgentFn = (ctx: FileProcessingContext, config: Config) => Promise<FileResult>;
```

### Functions:

1. `resolveFiles(targetPath: string, exclude: string[]): Promise<string[]>`
   — If targetPath is a file, returns [targetPath].
   — If directory, globs for `**/*.ts` files, applies exclude patterns.
   — Sorts results for deterministic processing order.

2. `enforceFileLimit(files: string[], limit: number): string[]`
   — If files.length > limit, throws error with helpful message:
     "Found {n} files, max is {limit}. Target a subdirectory or specific files."
   — Default limit: 10.

3. `processFiles(options: CoordinatorOptions, agentFn: AgentFn): Promise<CoordinatorResult>`
   — Core loop:
     a. Create feature branch
     b. Resolve and filter files
     c. Enforce 10-file limit
     d. Create results directory
     e. For each file:
        i.   Snapshot file
        ii.  Call agentFn(context, config)
        iii. If agent returns failure -> revert file from snapshot
        iv.  Write result file
        v.   Check for global failures (git dirty after revert = halt)
     f. Return CoordinatorResult with all results

   CoordinatorResult = {
     branchName: string;
     results: FileResult[];
     globalFailure: string | null;
   }

### Tests (`src/__tests__/coordinator.test.ts`):

Use temp git repos with test TypeScript files.

- Test: resolveFiles finds .ts files in directory
- Test: resolveFiles returns single file when given file path
- Test: resolveFiles excludes test files and node_modules
- Test: enforceFileLimit passes with <= 10 files
- Test: enforceFileLimit throws with > 10 files
- Test: processFiles calls agentFn for each file
- Test: processFiles reverts file on agent failure
- Test: processFiles creates feature branch
- Test: processFiles writes result files
- Test: processFiles halts on global failure (simulated git corruption)
- Test: processFiles snapshot preserves original file content

Use a mock agentFn that returns success for some files and failure for others.

Write tests first, then implement.
```

---

## Prompt 13: Coordinator Post-Processing — Aggregate + SDK Render + Install

**Produces:** Library aggregation, SDK file rendering, dependency installation
**Depends on:** Prompts 2 (results, aggregateLibraries), 3 (sdk-renderer), 4 (git)
**Tests:** Aggregation, SDK rendering integration, npm install simulation

```text
You are building the telemetry-agent project. This is Prompt 13 of 19.

Previous prompts created:
- `src/results.ts` — aggregateLibraries, collectResults
- `src/sdk-renderer.ts` — renderSdkInitFile
- `src/git.ts` — commitFiles
- `src/coordinator.ts` — Core coordinator with processFiles

## Task

Extend `src/coordinator.ts` with post-processing functions.

### Functions:

1. `postProcess(options: CoordinatorOptions, results: FileResult[]): Promise<PostProcessResult>`
   — After all files are processed:
     a. Collect results from `.telemetry-agent-results/`
     b. Aggregate libraries_needed (deduplicate by package name)
     c. If libraries found:
        - Run `npm install --save <packages>` in the target repo
        - Read existing SDK init file
        - Render updated SDK init file with new libraries
        - Write the updated SDK init file
        - Commit SDK init file + package.json + package-lock.json
     d. Return PostProcessResult

   PostProcessResult = {
     librariesInstalled: string[];
     sdkFileUpdated: boolean;
     installErrors: string[];
   }

2. `installDependencies(repoPath: string, packages: string[]): Promise<{ success: boolean, errors: string[] }>`
   — Runs `npm install --save <packages>` via child_process.
   — Captures stdout/stderr.
   — Returns success status.

### Integration into coordinator.ts:

Add to the CoordinatorResult type:
```typescript
interface CoordinatorResult {
  branchName: string;
  results: FileResult[];
  globalFailure: string | null;
  postProcess: PostProcessResult | null;
}
```

### Tests (`src/__tests__/coordinator-post.test.ts`):

- Test: postProcess aggregates libraries from multiple results
- Test: postProcess deduplicates identical library requirements
- Test: postProcess renders SDK init file with correct libraries
- Test: postProcess handles zero libraries (no SDK update needed)
- Test: installDependencies constructs correct npm command
- Test: postProcess commits SDK file and package files
- Test: postProcess reports install errors without halting

For installDependencies tests, use a temp directory with a package.json.
The npm install can install a small real package to verify.

Write tests first, then implement.
```

---

## Prompt 14: End-of-Run Validation — Weaver Live-Check

**Produces:** Orchestrates Weaver live-check with test execution
**Depends on:** Prompts 5 (Weaver), 1 (config)
**Tests:** Live-check lifecycle, OTLP override, report parsing

```text
You are building the telemetry-agent project. This is Prompt 14 of 19.

Previous prompts created:
- `src/weaver.ts` — startWeaverLiveCheck
- `src/config.ts` — Config with testCommand
- `src/coordinator.ts` — Coordinator

## Task

Create `src/end-of-run.ts` — end-of-run validation that runs tests against Weaver.

### Types:

```typescript
interface EndOfRunResult {
  testsRan: boolean;
  testsPassed: boolean;
  testOutput: string;
  weaverCompliance: WeaverComplianceReport | null;
  skipped: boolean;
  skipReason: string | null;
}
```

### Functions:

1. `runEndOfRunValidation(repoPath: string, config: Config): Promise<EndOfRunResult>`
   — Orchestrates:
     a. Check if test suite exists (testCommand in config)
     b. Start Weaver live-check on schema
     c. Run tests with OTLP endpoint override:
        `OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4317 {testCommand}`
     d. Stop Weaver (POST to :4320/stop)
     e. Parse compliance report
     f. Return combined result

   If Weaver is not installed -> skip with reason.
   If no test command -> skip with reason.
   If Weaver fails to start -> skip with reason (don't block PR).

2. `runTests(repoPath: string, testCommand: string, env?: Record<string, string>): Promise<{ passed: boolean, output: string }>`
   — Executes the test command in the repo directory with optional env overrides.
   — Captures stdout + stderr.
   — Returns pass/fail based on exit code.

### Wire into Coordinator:

Add `endOfRun: EndOfRunResult | null` to CoordinatorResult.

The coordinator should call `runEndOfRunValidation` after postProcess,
before creating the PR.

### Tests (`src/__tests__/end-of-run.test.ts`):

- Test: runTests executes command and captures output
- Test: runTests returns passed=false on non-zero exit
- Test: runTests passes environment variables correctly
- Test: runEndOfRunValidation skips when no test command
- Test: runEndOfRunValidation skips when Weaver not installed
- Test: runEndOfRunValidation handles Weaver start failure gracefully

Integration tests (skip if Weaver not available):
- Test: full lifecycle — start Weaver, run trivial test, stop, get report

Write tests first, then implement.
```

---

## Prompt 15: Instrumentation Agent — Tools + LLM Integration

**Produces:** The AI agent: system prompt, tool definitions, LLM invocation
**Depends on:** Prompts 6 (analysis), 7 (transform), 8 (npm), 11 (pipeline, schema)
**Tests:** System prompt construction, tool execution, structured output

```text
You are building the telemetry-agent project. This is Prompt 15 of 19.

This is the core AI agent. Install `@anthropic-ai/sdk` and `zod` (already installed).

Previous prompts created:
- `src/analysis.ts` — Import analysis, scope checking
- `src/transform.ts` — Code transformation
- `src/npm-registry.ts` — npm registry search
- `src/pipeline.ts` — File analysis pipeline
- `src/schema.ts` — Schema read/extend
- `src/validation.ts` — Validation chain
- `src/results.ts` — Result types

## Task

Create `src/agent.ts` — the Instrumentation Agent.

### Tool Definitions:

Define Zod schemas for each tool the agent can call:

1. **analyze_file** — Runs the analysis pipeline on the current file.
   Input: {} (no params, operates on context)
   Output: AnalysisPlan

2. **search_npm** — Search npm for OTel instrumentation library.
   Input: { frameworkName: string }
   Output: NpmSearchResult | null

3. **transform_code** — Apply code transformations.
   Input: { transforms: TransformPlan }
   Output: { success: boolean, newContent: string }

4. **extend_schema** — Add entries to Weaver schema.
   Input: { extensions: SchemaExtension[] }
   Output: { success: boolean, errors: string[] }

5. **validate** — Run validation chain on current file.
   Input: {}
   Output: ValidationChainResult

6. **read_file** — Read the current file content.
   Input: {}
   Output: { content: string }

### System Prompt:

Build a function `buildSystemPrompt(schema: string, config: Config): string`
that constructs the system prompt for the instrumentation agent. Include:
- Role description (you are an OpenTelemetry instrumentation agent)
- The resolved Weaver schema
- Rules: libraries first, manual spans as fallback, respect span density limits
- Namespace and naming conventions from the schema
- Constraint: maxSpansPerFile
- Variable shadowing rules

### Agent Invocation:

```typescript
async function runAgent(
  fileContent: string,
  filePath: string,
  resolvedSchema: string,
  config: Config,
  traceContext?: { traceId: string, spanId: string }
): Promise<FileResult>
```

Uses `@anthropic-ai/sdk`:
- Create message with system prompt + user message (file content)
- Define tools with Zod schemas
- Use tool runner to handle the agentic loop
- Parse final output into FileResult
- Enforce maxTokensPerFile budget (track via usage.input_tokens + output_tokens)
- On budget exceeded -> return partial result as failure

### Tests (`src/__tests__/agent.test.ts`):

**Unit tests (no API calls):**
- Test: buildSystemPrompt includes schema content
- Test: buildSystemPrompt includes maxSpansPerFile constraint
- Test: tool schemas validate correct inputs
- Test: tool schemas reject invalid inputs
- Test: each tool function executes correctly with valid input

**Integration tests (require ANTHROPIC_API_KEY, skip otherwise):**
- Test: runAgent with a simple file produces a valid FileResult
- Test: runAgent respects maxSpansPerFile
- Test: runAgent detects pg import and returns library requirement

Mark integration tests with `describe.skipIf(!process.env.ANTHROPIC_API_KEY)`.

Write tests first, then implement.
```

---

## Prompt 16: Wire Agent into Coordinator + PR Creation

**Produces:** Full coordinator loop with real agent, PR creation
**Depends on:** Prompts 12 (coordinator), 13 (post-process), 14 (end-of-run), 15 (agent)
**Tests:** Full workflow with mock agent, PR manifest creation

```text
You are building the telemetry-agent project. This is Prompt 16 of 19.

Previous prompts created:
- `src/coordinator.ts` — Core coordinator with processFiles, postProcess
- `src/end-of-run.ts` — End-of-run validation
- `src/agent.ts` — Instrumentation agent

## Task

### A. Wire the agent into the coordinator (`src/coordinator.ts`):

1. Create `createAgentFn(config: Config, resolvedSchema: string): AgentFn`
   — Returns an AgentFn that:
     a. Reads the file content
     b. Calls runAgent(fileContent, filePath, resolvedSchema, config)
     c. On success: writes the transformed file, extends schema, commits
     d. On failure: returns failure result (coordinator handles revert)

2. Create the main entry point:
   `runCoordinator(options: CoordinatorOptions): Promise<CoordinatorResult>`
   — Full orchestration:
     a. Load config
     b. Resolve Weaver schema
     c. Create feature branch
     d. Process files with agent
     e. Post-process (aggregate libraries, render SDK, install deps)
     f. End-of-run validation
     g. Create PR
     h. Return final result

### B. PR Creation (`src/pr.ts`):

1. `buildResultManifest(results: FileResult[], endOfRun: EndOfRunResult | null): string`
   — Builds JSON manifest of all results for committing.

2. `buildPrDescription(results: FileResult[], endOfRun: EndOfRunResult | null): string`
   — Builds markdown PR description with summary table:
     | File | Status | Spans | Libraries |
     Each row from results. Summary stats at top.

3. `createPullRequest(repoPath: string, branchName: string, title: string, body: string): Promise<string>`
   — Uses `gh pr create` or git push + API.
   — Returns PR URL.

### Tests:

**`src/__tests__/coordinator-full.test.ts`:**
- Test: runCoordinator with mock agent processes files end-to-end
- Test: runCoordinator creates feature branch
- Test: runCoordinator handles mixed success/failure
- Test: runCoordinator calls postProcess after all files

**`src/__tests__/pr.test.ts`:**
- Test: buildResultManifest produces valid JSON
- Test: buildPrDescription generates markdown table
- Test: buildPrDescription includes summary stats
- Test: buildPrDescription handles all-failure case

Write tests first, then implement.
```

---

## Prompt 17: Self-Instrumentation — OTel Spans

**Produces:** OTel spans for the agent's own operations
**Depends on:** All previous modules
**Tests:** Span creation, attribute setting, trace context propagation

```text
You are building the telemetry-agent project. This is Prompt 17 of 19.

## Task

Create `src/telemetry.ts` — self-instrumentation for the telemetry agent.

Install `@opentelemetry/sdk-node`, `@opentelemetry/api`,
`@opentelemetry/exporter-trace-otlp-grpc`.

### Setup:

1. `initAgentTelemetry(serviceName?: string): void`
   — Initializes OTel SDK for the agent itself.
   — Service name: "telemetry-agent"
   — Exports to configured OTLP endpoint (agent's own backend, NOT target codebase).
   — Must be called once at startup.

2. `shutdownAgentTelemetry(): Promise<void>`
   — Cleanly shuts down the OTel SDK.

### Span Helpers:

3. `withCoordinatorSpan<T>(fn: () => Promise<T>, attributes?: Record<string, string | number>): Promise<T>`
   — Wraps coordinator operations in `telemetry_agent.run` span.
   — Sets: files.attempted, files.succeeded, files.failed, duration_ms.

4. `withFileSpan<T>(filePath: string, fn: () => Promise<T>): Promise<T>`
   — Creates child span `telemetry_agent.file.process`.
   — Sets file path attribute.

5. `withLlmSpan<T>(model: string, fn: () => Promise<T>): Promise<T>`
   — Creates span for LLM calls with gen_ai.* attributes:
     gen_ai.request.model, gen_ai.usage.input_tokens, gen_ai.usage.output_tokens.
   — Captures token usage from the response.

6. `getTraceContext(): { traceId: string, spanId: string } | null`
   — Returns current trace context for propagation to agent instances.

### Wire into existing modules:

- Wrap `runCoordinator` in `withCoordinatorSpan`
- Wrap each file processing in `withFileSpan`
- Wrap agent LLM calls in `withLlmSpan`

### Tests (`src/__tests__/telemetry.test.ts`):

- Test: initAgentTelemetry creates tracer provider
- Test: withCoordinatorSpan creates span with correct name
- Test: withFileSpan creates child span
- Test: withLlmSpan sets gen_ai.* attributes
- Test: getTraceContext returns trace/span IDs within a span
- Test: getTraceContext returns null outside a span

Use in-memory exporter for tests to capture and verify spans.

Write tests first, then implement.
```

---

## Prompt 18: MCP Server

**Produces:** MCP server interface for Claude Code
**Depends on:** Prompts 9 (init), 16 (coordinator)
**Tests:** Tool definitions, request handling

```text
You are building the telemetry-agent project. This is Prompt 18 of 19.

## Task

Create `src/mcp-server.ts` — thin MCP server wrapping the Coordinator.

Install `@modelcontextprotocol/sdk` (MCP TypeScript SDK).

### MCP Tools:

1. **telemetry_agent_init**
   - Description: "Initialize telemetry agent for a TypeScript project"
   - Input: { targetDir: string, schemaPath?: string }
   - Calls: runInit(targetDir, options)
   - Returns: InitResult as formatted string

2. **telemetry_agent_instrument**
   - Description: "Instrument TypeScript files with OpenTelemetry"
   - Input: { targetPath: string, configPath?: string }
   - Calls: runCoordinator(options)
   - Returns: CoordinatorResult summary

3. **telemetry_agent_status**
   - Description: "Check if telemetry agent is initialized for a project"
   - Input: { targetDir: string }
   - Returns: Whether telemetry-agent.yaml exists and is valid

### Server Setup:

```typescript
function createMcpServer(): Server {
  // Register tools with input schemas
  // Handle tool calls
  // Return formatted results
}

// Entry point for running as standalone server
if (import.meta.url === ...) {
  const server = createMcpServer();
  server.listen();
}
```

### Tests (`src/__tests__/mcp-server.test.ts`):

- Test: server registers all three tools
- Test: telemetry_agent_init tool validates input schema
- Test: telemetry_agent_instrument tool validates input schema
- Test: telemetry_agent_status returns correct status
- Test: tools return formatted string responses

Write tests first, then implement.
```

---

## Prompt 19: End-to-End Integration Test

**Produces:** Full E2E test against a test fixture project
**Depends on:** All previous prompts
**Tests:** Complete workflow from init -> instrument -> PR

```text
You are building the telemetry-agent project. This is Prompt 19 of 19.

All modules are implemented. This prompt creates the end-to-end integration test.

## Task

Create `src/__tests__/e2e.test.ts` — full integration test.

### Test Fixture:

Create `src/__tests__/fixtures/e2e-project/` — a minimal TypeScript project that:
- Has package.json with @opentelemetry/api and @opentelemetry/sdk-node
- Has src/telemetry/setup.ts with a basic NodeSDK initialization
- Has a valid Weaver registry in telemetry/registry/ (manifest + attributes + signals)
- Has 3 source files:
  a. `src/services/user-service.ts` — imports pg, has async function (should get library)
  b. `src/services/order-service.ts` — pure business logic (should get manual spans)
  c. `src/utils/formatter.ts` — short sync utility (should be skipped)
- Has a basic test file that imports and runs the services

### E2E Test Flow:

```typescript
describe("End-to-end", () => {
  // Skip if no ANTHROPIC_API_KEY
  // Copy fixture to temp dir (fresh git repo for each test)

  it("full workflow: init -> instrument -> results", async () => {
    // 1. Run init
    const initResult = await runInit(tempDir);
    expect(initResult.success).toBe(true);
    expect(initResult.discovered.sdkInitFile).toBeDefined();

    // 2. Verify config was created
    const config = loadConfig(path.join(tempDir, "telemetry-agent.yaml"));
    expect(config.schemaPath).toBeDefined();

    // 3. Run coordinator
    const result = await runCoordinator({
      config,
      targetPath: path.join(tempDir, "src/services"),
      repoPath: tempDir,
    });

    // 4. Verify results
    expect(result.globalFailure).toBeNull();
    expect(result.results.length).toBe(2); // user-service + order-service
    // formatter.ts should be excluded or skipped

    // 5. Verify feature branch exists
    const branch = await getCurrentBranch(tempDir);
    expect(branch).toMatch(/telemetry-agent\//);

    // 6. Verify SDK init file was updated (if libraries found)
    // 7. Verify result manifest was written
    // 8. Verify schema was extended
  });

  it("init fails without package.json", async () => {
    const emptyDir = createTempDir();
    const result = await runInit(emptyDir);
    expect(result.success).toBe(false);
    expect(result.errors).toContain(expect.stringMatching(/package.json/));
  });

  it("coordinator reverts failed files", async () => {
    // Use a file that will cause the agent to fail
    // Verify the file is reverted to original content
  });
});
```

### Also: Create `src/index.ts` entry point

Export the public API:
```typescript
export { runInit } from './init';
export { runCoordinator } from './coordinator';
export { createMcpServer } from './mcp-server';
export { loadConfig, writeConfig } from './config';
export type { Config } from './config';
export type { CoordinatorResult, CoordinatorOptions } from './coordinator';
export type { InitResult } from './init';
```

Write tests first, then implement the fixture and entry point.
```

---

## Verification Plan

After all 19 prompts:
1. `npm test` — all unit tests pass
2. `npm run build` — TypeScript compiles cleanly
3. E2E test passes with ANTHROPIC_API_KEY set
4. Manual test against commit-story-v2 fixture
5. MCP server starts and responds to tool calls
