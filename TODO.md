# Telemetry Agent — Implementation TODO

Tracks implementation progress against the 19-prompt TDD plan (`plan.md`) and v2.1 upgrade.
Framework decision: **Direct Anthropic SDK** (`@anthropic-ai/sdk`).

---

## Pre-Implementation Decisions

- [x] **Q5: Choose agent framework** — Direct Anthropic SDK (recommended). Decision made 2026-02-05.
- [ ] **Semconv version: pin v1.37.0 or bump to v1.39.0?** — v1.37.0 pinned for PoC. Migration path documented in SPEC.md.
- [ ] **Verify commit-story-v2 prerequisites** — OTel SDK installed, SDK init file exists, test suite runs, Node.js version compatible.

---

## Foundation Layer (Prompts 1-3)

- [x] **Prompt 1: Project Scaffolding + Config Types**
  - [x] Initialize TypeScript project (package.json, tsconfig.json, vitest)
  - [x] Create `src/config.ts` — Zod schema for telemetry-agent.yaml
  - [x] Tests: config parsing, validation, defaults, error cases (7/7 passing)

- [x] **Prompt 2: Result File Types + I/O**
  - [x] Create `src/results.ts` — Zod schemas for FileResult (success/failure union)
  - [x] Functions: writeResult, readResult, collectResults, aggregateLibraries, summarizeResults
  - [x] Tests: parse, write/read roundtrip, aggregation, dedup (9/9 passing)

- [x] **Prompt 3: Library Allowlist + SDK Init File Renderer**
  - [x] Create `src/allowlist.ts` — hardcoded Map with 15 framework entries
  - [x] Create `src/sdk-renderer.ts` — renderSdkInitFile (deterministic SDK file update)
  - [x] Tests: allowlist lookup, SDK rendering, dedup, idempotency (11/11 passing)

---

## External Tool Wrappers (Prompts 4-5)

- [x] **Prompt 4: Git Operations Wrapper**
  - [x] Create `src/git.ts` — simple-git wrapper
  - [x] Functions: createFeatureBranch, snapshotFile, revertFile, commitFile(s), isClean, getCurrentBranch
  - [x] Tests: branch creation, snapshot/revert cycle, commit, status checks (9/9 passing)

- [x] **Prompt 5: Weaver CLI Wrapper**
  - [x] Create `src/weaver.ts` — typed wrapper around Weaver CLI
  - [x] Functions: weaverCheck, weaverResolve, startWeaverLiveCheck, isWeaverInstalled
  - [x] Tests: unit (fixtures) + integration (skip if Weaver not installed) (6/6 passing)
  - [x] Create test fixture: `src/__tests__/fixtures/test-registry/`

---

## Analysis + Transformation (Prompts 6-8)

- [x] **Prompt 6: ts-morph — Import Analysis + Scope Analysis**
  - [x] Create `src/analysis.ts` — analyzeImports, detectFrameworks, detectExistingInstrumentation
  - [x] Variable shadowing: checkVariableShadowing via ts-morph binder
  - [x] findInstrumentableFunctions (exported async, handler patterns)
  - [x] Tests: import detection, framework matching, shadowing detection (13/13 passing)

- [x] **Prompt 7: ts-morph — Code Transformation (Span Insertion)**
  - [x] Create `src/transform.ts` — addOtelImports, addTracerDeclaration, wrapFunctionWithSpan
  - [x] applyTransformations chains all transforms
  - [x] Tests: import insertion, span wrapping, otelSpan fallback, round-trip validity (11/11 passing)

- [x] **Prompt 8: npm Registry Client**
  - [x] Create `src/npm-registry.ts` — searchOtelLibrary, getPackageInfo, toLibraryRequirement
  - [x] Tests: unit (no network) + integration (skip in CI) (6/6 passing)

---

## Business Logic (Prompts 9-11)

- [x] **Prompt 9: Init Phase**
  - [x] Create `src/init.ts` — runInit, findSdkInitFile, checkNodeVersion, checkPortAvailability
  - [x] Create test fixtures: valid-project, no-otel-project
  - [x] Tests: prerequisite checks, config creation, error cases (9/9 passing)

- [x] **Prompt 10: Validation Chain**
  - [x] Create `src/validation.ts` — checkSyntax, checkLint, fixLint, checkWeaver
  - [x] runValidationChain with retry logic and maxRetries enforcement
  - [x] Tests: each step, fix loop, retry limit (9/9 passing)

- [x] **Prompt 11: File Analysis Pipeline + Schema Extension**
  - [x] Create `src/pipeline.ts` — analyzeFile, buildSpanName
  - [x] Create `src/schema.ts` — readSchema, extendSchema
  - [x] Tests: pipeline decisions, schema extension, namespace validation (10/10 passing)

---

## Orchestration (Prompts 12-14)

- [x] **Prompt 12: Coordinator Core — File Iteration + Snapshot/Revert**
  - [x] Create `src/coordinator.ts` — resolveFiles, enforceFileLimit, processFiles
  - [x] Create `src/glob-util.ts` — recursive file glob utility
  - [x] File snapshot before agent, revert on failure, global failure detection
  - [x] Tests: globbing, exclude patterns, 10-file limit, snapshot/revert cycle (10/10 passing)

- [x] **Prompt 13: Coordinator Post-Processing**
  - [x] Extend coordinator — postProcess, installDependencies
  - [x] Aggregate libraries, render SDK init file, bulk npm install, commit
  - [x] Tests: aggregation, dedup, SDK rendering, install simulation (7/7 passing)

- [x] **Prompt 14: End-of-Run Validation — Weaver Live-Check**
  - [x] Create `src/end-of-run.ts` — runEndOfRunValidation, runTests
  - [x] Weaver live-check lifecycle with OTLP override
  - [x] Tests: test execution, skip conditions, graceful failures (6/6 passing)

---

## Agent + Integration (Prompts 15-16)

- [x] **Prompt 15: Instrumentation Agent — Tools + LLM Integration**
  - [x] Create `src/agent.ts` — tool definitions (Zod), system prompt builder, runAgent
  - [x] 6 tools: analyze_file, search_npm, transform_code, extend_schema, validate, read_file
  - [x] Token budget enforcement (maxTokensPerFile)
  - [x] Tests: unit (no API) + integration (skip without ANTHROPIC_API_KEY) (11/11 passing)

- [x] **Prompt 16: Wire Agent into Coordinator + PR Creation**
  - [x] Create `src/pr.ts` — buildResultManifest, buildPrDescription, createPullRequest
  - [x] Tests: full workflow with mock agent, PR markdown generation (8/8 passing)

---

## Polish (Prompts 17-19)

- [x] **Prompt 17: Self-Instrumentation — OTel Spans**
  - [x] Create `src/telemetry.ts` — initAgentTelemetry, shutdown, span helpers
  - [x] Spans: telemetry_agent.run, telemetry_agent.file.process, gen_ai.*
  - [x] Tests: span creation, attribute setting, trace context propagation (5/5 passing)

- [x] **Prompt 18: MCP Server**
  - [x] Create `src/mcp-server.ts` — 3 tools: init, instrument, status
  - [x] Tests: tool registration, input validation, response format (6/6 passing)

- [x] **Prompt 19: End-to-End Integration Test**
  - [x] Create `src/__tests__/e2e.test.ts` — full workflow test
  - [x] Create `src/__tests__/fixtures/e2e-project/` — 3-file test project
  - [x] Create `src/index.ts` — public API entry point
  - [x] Tests: init -> instrument -> results, failure handling, file revert (9/9 passing)

---

## v2.1 Upgrade (2026-02-06)

Baseline: 162 tests passing, 22 test files.

- [x] **Phase 0: Update SPEC.md + TODO.md**
  - [x] SPEC.md updated with v2.1 changes
  - [x] TODO.md updated with upgrade tracking

- [x] **Phase 1: Config Schema — 3 New Fields** (+3 tests)
  - [x] Add `maxFilesPerRun`, `maxSpansPerRun`, `schemaCheckpointInterval` to ConfigSchema
  - [x] TDD tests for defaults and range validation
  - [x] Cascade fix: update DEFAULT_CONFIG in 8 test files + init.ts
  - Result: 165 tests passing

- [x] **Phase 2: FailureResult Schema Unification** (+2 tests)
  - [x] Add all fields with defaults to FailureResultSchema
  - [x] TDD tests for failure with defaults and explicit zeros
  - [x] Fixed agent.ts failure result literals for unified schema
  - Result: 167 tests passing

- [x] **Phase 3: In-Memory Results (Remove Filesystem I/O)** (-3 tests)
  - [x] Remove writeResult, readResult, collectResults, resultFilename from results.ts
  - [x] Remove fs/path imports from results.ts
  - [x] Remove resultDir from coordinator's FileProcessingContext
  - [x] Remove .telemetry-agent-results/ directory creation
  - [x] Remove writeResult call and import from coordinator.ts
  - [x] Remove filesystem I/O tests from results.test.ts
  - Result: 164 tests passing

- [x] **Phase 4: Coordinator Enhancements** (+3 tests)
  - [x] Use config.maxFilesPerRun instead of hardcoded 10
  - [x] Add spanDensityWarning to CoordinatorResult
  - [x] Compute totalSpans and set warning flag
  - Result: 167 tests passing

- [x] **Phase 5: Span Prioritization Heuristic** (+4 tests)
  - [x] Add classifyPriority() 4-tier function to pipeline.ts
  - [x] Sort candidates by priority tier before applying cap
  - [x] Deprioritized functions go to skippedFunctions with reason
  - Result: 171 tests passing

- [x] **Phase 6: PR Description — Token/Cost + Span Warning** (+3 tests)
  - [x] Add TokenUsageSummary, SpanDensityInfo interfaces
  - [x] Update buildPrDescription with optional params
  - [x] Token usage section and span density warning banner
  - Result: 174 tests passing

- [x] **Phase 7: Agent Prompt + Telemetry Attributes** (+3 tests)
  - [x] Update buildSystemPrompt with prioritization guidance
  - [x] Add maxSpansPerRun density mention
  - [x] Token/cost attributes test for telemetry
  - Result: 177 tests passing

---

## Verification (Post-Implementation)

- [x] `npm test` — all 162 unit tests pass (22 test files) — v1 baseline
- [x] `npm test` — all 177 unit tests pass (22 test files) — v2.1 complete
- [x] `tsc --noEmit` — TypeScript compiles cleanly
- [ ] E2E test passes with ANTHROPIC_API_KEY set (integration tests)
- [ ] Manual test against commit-story-v2 as target codebase
- [ ] MCP server starts and responds to tool calls

---

## Post-PoC Backlog

These are documented in the spec but explicitly out of scope for the PoC:

- [ ] Schema Builder Agent (auto-generate schema from codebase discovery)
- [ ] Parallel file processing (architecture supports it via in-memory results)
- [ ] Smart test discovery (only run tests touching changed files)
- [ ] Test command flexibility (vitest, jest, nx, turbo)
- [ ] Bump semconv to v1.39.0 — migrate `db.name` -> `db.namespace`
- [ ] File processing order strategy (dependency analysis via madge or TS compiler)
- [ ] Cross-file learning (Coordinator-maintained project context summary)
- [ ] TypeScript path alias resolution
- [ ] Type checking in validation chain (`tsc --noEmit`)
- [ ] Dry-run mode
- [ ] Cost estimation/caps per run
- [ ] CLI and GitHub Action interfaces
- [ ] ts-morph migration plan (TypeScript 7 Go rewrite)
- [ ] OllyGarden Instrumentation Score as post-run quality gate
- [ ] Weaver `weaver registry mcp` native MCP server integration
