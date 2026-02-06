# Telemetry Agent Specification

**Status:** Draft
**Created:** 2026-02-05
**Purpose:** AI agent that auto-instruments TypeScript code with OpenTelemetry based on a Weaver schema

## Vision

An AI agent that takes a Weaver schema and code files, then automatically instruments them with OpenTelemetry. The agent prioritizes semantic conventions, can extend the schema as needed, and validates its work through Weaver.

**Short-term goal:** Works on commit-story-v2 repository
**Long-term goal:** Distributable tool that works on any TypeScript codebase

### Why Schema-Driven?

**The gap:** No existing tool combines Weaver schema + AI + source transformation.

Tools like o11y.ai already do AI + TypeScript + PR generation. OllyGarden is moving toward agentic instrumentation (confirmed at KubeCon NA 2025; their public products are Insights and Tulip). But none of them validate against a schema contract. The difference is **"AI guesses what to instrument"** vs **"AI implements a contract that Weaver can verify."**

That verification loop is what makes this approach trustworthy enough to run autonomously. The schema defines the contract, the agent implements it, and Weaver validates the result. Without schema-driven validation, you're trusting AI judgment alone.

---

## Architecture

### Coordinator + Agents Architecture

The system has a **Coordinator** (deterministic script) that manages workflow and delegates to **AI Agents** for the parts that need intelligence.

#### Coordinator (Not AI)
- **What it is:** A deterministic script/program
- **Responsibilities:**
  - Branch management (create feature branch)
  - File iteration (glob for files to process)
  - **Snapshot each file before agent processing** (for revert on failure)
  - Spawn AI agent instances
  - Collect results from each agent
  - **Revert files to pre-agent state on agent failure** (ensures PR remains compilable)
  - **Aggregate library requirements** from all result files and perform **one bulk `npm install`**
  - **Own SDK init file modifications exclusively** — agents output library requirements in result files, Coordinator renders the SDK init file deterministically from accumulated declarations
  - Run end-of-run validation (Weaver live-check)
  - Assemble PR with summary
- **Why not AI:** These are mechanical tasks that don't need intelligence

#### Schema Builder Agent (Future - Not in PoC)
- **Purpose:** Discover codebase structure, auto-generate Weaver schema
- **Status:** Descoped from PoC - "detecting service boundaries" and "mapping directories to spans" is too ambiguous
- **PoC approach:** Schema must already exist. User or Claude Code creates it manually.
- **Future:** Research how to automatically map directory structure to span patterns

#### Instrumentation Agent (Per-File)
- **Purpose:** Instrument a single file according to existing schema
- **Runs:** Fresh instance per file (prevents laziness)
- **Allowed to:** Read schema + single file, extend schema within guardrails
- **Not allowed to:** Scan codebase, restructure existing schema definitions
- **Outputs:** Result file with what it did, including `libraries_needed` declarations for Coordinator to handle (see Result Files)

**What "fresh instance" means:** A new LLM API call with a clean context. The context contains only: the system prompt, the resolved Weaver schema, the single file to instrument, and trace context (trace ID + parent span ID for observability). No conversation history, result data, or context from previous files carries over. This is the key mechanism that prevents quality degradation across files — each file gets the agent's full attention as if it were the only file. (Trace context is operational metadata, not task context — it doesn't undermine the quality argument.)

This separation solves the "scope problem": discovery happens once in init, instrumentation follows established patterns. The Coordinator handles the mechanical orchestration.

### Interfaces (cosmetic wrappers around core)
- **MCP server** (PoC) - invoked from Claude Code
- **CLI** (future) - `telemetry-agent instrument src/`
- **GitHub Action** (future) - runs on PR/push

**PoC call chain:** Claude Code invokes MCP server tools → MCP server wraps the Coordinator → Coordinator runs the deterministic workflow (branch, file iteration, validation, PR) and spawns fresh Instrumentation Agent instances for each file. The MCP server is a thin interface layer; the Coordinator is where the orchestration logic lives.

### Key Tools
- **ts-morph** for AST manipulation (TypeScript-native, full type access). **Known risk:** TypeScript 7 (Go rewrite, targeted early-to-mid 2026) will likely break ts-morph with no migration path. ts-morph is the right choice for the PoC; plan for migration in 12-18 months.
- **Weaver** for schema validation and live-check (v0.21.2 is current, actively maintained)
- **Prettier** for post-transformation formatting

---

## Init Phase (Required)

Before instrumentation can begin, user must run `telemetry-agent init`. This is mandatory.

### What Init Does

1. **Verify prerequisites**
   - `package.json` exists → extracts project name for namespace
   - `@opentelemetry/api` in dependencies (or offers to add it)
   - OTel SDK initialization exists somewhere → **record the file path**
   - OTLP endpoint configured
   - Test suite exists (warns if missing, continues anyway)
   - Node.js version is `^18.19.0 || >=20.6.0` (required by OTel JS SDK 2.0)
   - Environment supports binding to `localhost:4317` and `:4320` (required for Weaver live-check)

2. **Validate Weaver schema**
   - Schema must already exist (PoC requirement)
   - Run `weaver registry check` to validate
   - If invalid or missing → fail with helpful error

3. **Create config file**
   - Writes `telemetry-agent.yaml` with schema path, **SDK init file path**, and settings
   - Config file is the gate for instrumentation phase

### Prerequisites (verified during init)

1. **`package.json`** - provides namespace
2. **OTel SDK initialized** - user's responsibility, not agent's job. Init records the file path for Coordinator use.
3. **`@opentelemetry/api` in dependencies** — compatible with OTel JS SDK 2.0+ (`@opentelemetry/auto-instrumentations-node` v0.68.0 requires SDK 2.0)
4. **OTLP endpoint configured** - for production use (Datadog, Jaeger, etc.). During validation, agent temporarily overrides to point at Weaver.
5. **Test suite exists** - for validation (agent warns if missing)
6. **Node.js `^18.19.0 || >=20.6.0`** — minimum for OTel JS SDK 2.0
7. **Localhost port access** — Weaver live-check binds to `:4317` (gRPC) and `:4320` (HTTP). Ensure no conflicts in Docker/CI environments.

---

## Complete Workflow

```text
┌─────────────────────────────────────────────────────────────────┐
│  telemetry-agent init (REQUIRED, ONE-TIME)                      │
│                                                                 │
│  1. Verify prerequisites (package.json, OTel deps, etc.)        │
│  2. Validate existing schema (weaver registry check)            │
│     - Schema must exist (PoC requirement)                       │
│     - If missing → fail with error                              │
│  3. Create telemetry-agent.yaml config                          │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│  telemetry-agent instrument <path> (REQUIRES INIT)              │
│                                                                 │
│  COORDINATOR (deterministic script):                            │
│  1. Create feature branch                                       │
│  2. Glob for files to process                                   │
│  3. For each file:                                              │
│     a. Snapshot file (record HEAD SHA or temp copy)             │
│     b. Spawn Instrumentation Agent                              │
│     c. On agent failure → revert file to snapshot               │
│  4. Collect result files from .telemetry-agent-results/         │
│  5. Aggregate libraries_needed → bulk npm install               │
│  6. Render SDK init file from accumulated library declarations  │
│  7. Run end-of-run validation (tests + Weaver live-check)       │
│  8. Commit result manifest + create PR with summary             │
│                                                                 │
│  INSTRUMENTATION AGENT (per file, fresh instance):              │
│  1. Read config → get schema path + SDK init file path          │
│  2. Read schema → understand patterns                           │
│  3. Analyze imports → what libraries/frameworks are used?       │
│  4. Check schema for libraries, discover new via npm            │
│  5. Record library requirements in result file (NOT SDK file)   │
│  6. Add manual spans ONLY for business logic gaps               │
│  7. Scope-check new variables (span, tracer) before inserting   │
│  8. Extend schema if needed (within guardrails)                 │
│  9. Per-file validation (fix loops): syntax → lint → Weaver     │
│  10. Write result file to .telemetry-agent-results/             │
│  11. Commit code + schema changes to feature branch (or skip)   │
└─────────────────────────────────────────────────────────────────┘
```

---

## How It Works

### Input
- Config file (`telemetry-agent.yaml`) - must exist (created by init)
- Weaver schema (resolved from path in config)
- File or directory path to instrument

### Processing (per file)
1. **Check imports** - what libraries/frameworks does this file use?
2. **Check schema for libraries** - does schema already specify instrumentation?
3. **Discover new libraries** - if not in schema, query npm registry
4. **Record library requirements in result file** - auto-instrumentation handles framework boundaries (HTTP, DB, etc.). Agent does NOT modify the SDK init file; it outputs `libraries_needed` for the Coordinator.
5. **Find business logic gaps** - code paths that libraries can't instrument
6. **Skip already-instrumented functions** - pattern match for `tracer.startActiveSpan` etc.
7. **For business logic gaps only:**
   - Determine needed attributes
   - Check semconv first, then existing schema, then create new
   - **Scope-check before inserting variables** — verify `span`, `tracer` don't shadow existing names in scope (see Validation Chain)
   - Add manual span
8. **Update Weaver schema** if new libraries/attributes/spans added
9. **Per-file validation** - syntax → lint → Weaver static (fix loops)
10. **Commit code + schema changes to branch** (SDK init file and package.json are Coordinator-owned)

### Output
- Single PR with all changes (code + schema updates)
- Validation results

---

## File/Directory Processing

- **User specifies:** file or directory
- **Directory processing:** sequential, one file at a time
- **New AI instance per file:** prevents laziness, ensures quality
- **Schema changes propagate:** via git commits on feature branch
- **Single PR at end:** contains all instrumented files and schema updates
- **PoC file limit:** Maximum 10 files per run. If a directory glob returns more than 10 files, the Coordinator fails with an error suggesting the user target a subdirectory or specific files. This avoids known scaling issues (see "Known Scaling Limitations"). Post-PoC, the Coordinator-level SDK modification pattern and schema assembly described in this spec would remove the need for this cap.

---

## What Gets Instrumented

### Heuristics (agent decides where to instrument)
- Exported async functions
- Functions in `services/`, `handlers/`, `api/` directories
- Functions making external calls (DB, HTTP, etc.)
- Skip: utilities, formatters, pure helpers, functions under ~10 lines that are pure synchronous logic

### Span Density Guardrails

LLMs tend to over-instrument when told to "add telemetry." Without constraints, the agent may wrap every function in a span, causing real performance overhead in high-throughput Node.js apps.

- **Per-file cap:** Maximum 5 manual spans per file. If the agent identifies more instrumentation points, it should prioritize entry points and external calls.
- **Project-wide cap:** The Coordinator sums `spans_added` across all result files. Unreasonable totals (configurable threshold) get flagged for human review rather than silently accepted.
- **Explicit prohibition:** Do not instrument pure synchronous utilities, formatters, or helper functions that make no external calls.

### Schema guidance
- Schema defines attribute groups and naming patterns
- Schema can define specific spans for critical paths (overrides heuristics)
- Agent applies schema conventions to discovered instrumentation points

### Patterns Not Covered (PoC)

The PoC focuses on request-path functions (handlers, services, external calls). These async/event-driven patterns are common in TypeScript services but require different instrumentation strategies — future work:

- Event handlers / event emitters
- Pub/sub callbacks
- Cron jobs / scheduled tasks
- Queue consumers

---

## What the Agent Actually Does to Code

Two paths: auto-instrumentation (common) and manual spans (fallback).

### Path 1: Auto-Instrumentation Library (Primary)

Agent detects a framework import and ensures the OTel instrumentation library is registered.

**Scenario:** File imports `pg` (PostgreSQL client)

**Step 1: Agent detects import in target file**
```typescript
// src/services/user-service.ts
import { Pool } from 'pg';

export async function getUser(id: string) {
  const result = await pool.query('SELECT * FROM users WHERE id = $1', [id]);
  return result.rows[0];
}
```

**Step 2: Agent records library requirement in result file (NOT modifying SDK file)**

The agent does NOT modify the SDK init file directly. Instead, it records the library requirement in its result file:

```json
{
  "libraries_needed": [
    {
      "package": "@opentelemetry/instrumentation-pg",
      "import": "PgInstrumentation",
      "config": {}
    }
  ]
}
```

**Step 2b: Coordinator renders SDK init file (after all agents complete)**

The Coordinator collects all `libraries_needed` from result files, deduplicates, and performs a single deterministic write:

```typescript
// src/telemetry/setup.ts (rendered by Coordinator)
import { NodeSDK } from '@opentelemetry/sdk-node';
import { PgInstrumentation } from '@opentelemetry/instrumentation-pg';

const sdk = new NodeSDK({
  serviceName: 'commit-story',
  instrumentations: [
    new PgInstrumentation(),
  ],
});
sdk.start();
```

This eliminates the fragility of multiple agents sequentially modifying the same file.

**Step 3: Agent updates Weaver schema**
```yaml
# telemetry/registry/signals.yaml (added)
groups:
  - id: span.commit_story.db.pg
    type: span
    brief: PostgreSQL database operations (via instrumentation-pg)
    span_kind: client
    note: Auto-instrumentation library handles span creation
    attributes:
      # Reference OTel db semconv attributes
      - ref: db.system
        requirement_level: required
      - ref: db.name              # Note: migrating to db.namespace in semconv v1.38.0+
        requirement_level: recommended
      - ref: db.operation.name
        requirement_level: recommended
      - ref: db.statement
        requirement_level: recommended
```

**Key point:** The target file (`user-service.ts`) is NOT modified. The library handles instrumentation automatically once registered.

### Path 2: Manual Span (Fallback for Business Logic)

Agent wraps business logic that no library can instrument.

**Scenario:** Custom journal generation function

**Before:**
```typescript
// src/generators/summary.ts
export async function generateSummary(context: Context): Promise<string> {
  const filtered = filterContext(context);
  const prompt = buildPrompt(filtered);
  const response = await callAI(prompt);
  return response.content;
}
```

**After:**
```typescript
// src/generators/summary.ts
import { trace, SpanStatusCode } from '@opentelemetry/api';

const tracer = trace.getTracer('commit-story');

export async function generateSummary(context: Context): Promise<string> {
  return tracer.startActiveSpan('commit_story.journal.generate_summary', async (span) => {
    try {
      span.setAttribute('commit_story.context.messages_count', context.messages.length);

      const filtered = filterContext(context);
      const prompt = buildPrompt(filtered);
      const response = await callAI(prompt);

      span.setAttribute('commit_story.journal.word_count', response.content.split(' ').length);
      return response.content;
    } catch (error) {
      span.recordException(error);
      span.setStatus({ code: SpanStatusCode.ERROR });
      throw error;
    } finally {
      span.end();
    }
  });
}
```

**Schema entry created:**
```yaml
# telemetry/registry/signals.yaml (added)
groups:
  - id: span.commit_story.journal.generate_summary
    type: span
    stability: development
    brief: AI-powered journal summary generation
    span_kind: internal
    attributes:
      - ref: commit_story.context.messages_count
        requirement_level: recommended
      - ref: commit_story.journal.word_count
        requirement_level: recommended
```

### Decision: Which Path?

| Import Detected | OTel Library Exists? | Action |
|-----------------|---------------------|--------|
| `pg`, `express`, `http`, etc. | Yes | Path 1: Add library to SDK setup |
| Custom business logic | N/A | Path 2: Wrap with manual span |
| Already instrumented | N/A | Skip |

---

## Attribute Priority Chain

When agent needs an attribute:

1. **Check OTel semantic conventions** - use semconv reference if exists
2. **Check existing Weaver schema** - use if already defined
3. **Neither exists** - create new custom attribute under project namespace

**Agent has full authority to extend schema** (create spans, attributes, groups) - within the guardrails below.

### Schema Extension Guardrails

The agent can extend the schema, but must follow existing patterns:

1. **Namespace prefix is mandatory** - New attributes MUST use the project namespace prefix as defined in the existing schema. If the schema uses `commit_story.*`, all new attributes must follow that prefix.

2. **Follow existing structural patterns** - New attribute groups should match the naming and structural conventions already present in the user-provided schema.

3. **Add or create, but stay consistent** - Agent can add to existing groups or create new ones, but must observe and follow the conventions in the existing schema.

4. **Coordinator enforces via drift detection** - The Coordinator sums `attributes_created` and `spans_added` across all result files. Unreasonable totals (e.g., 30 new attributes for a single file) get flagged for human review.

---

## Auto-Instrumentation Libraries

**Libraries are the PRIMARY approach.** Manual spans are only for gaps.

### Why Libraries First
- Auto-instrumentation libraries are battle-tested
- They handle framework internals correctly (middleware, connection pooling, etc.)
- Less code to maintain
- Follows OTel best practices

### Detection Flow
1. **Check schema first** - does schema already reference an auto-instrumentation library for this file's imports?
   - If yes → ensure file has the library import (schema is source of truth)
2. **Discovery** - if file uses a framework not in schema (e.g., `import express from 'express'`):
   - Query npm registry for matching OTel library
   - If found and `autoApproveLibraries: true`:
     - Add library import to file
     - Add library's spans/attributes to Weaver schema (semconv references)
   - If found and `autoApproveLibraries: false` → prompt user

### Library Discovery

**Approach:** Hardcoded allowlist first, npm registry as fallback.

**Trusted Allowlist (PoC)**

Common OTel JS instrumentation packages, sourced from `@opentelemetry/auto-instrumentations-node`:

| Framework/Library | Instrumentation Package |
|-------------------|------------------------|
| `http` / `https` | `@opentelemetry/instrumentation-http` |
| `express` | `@opentelemetry/instrumentation-express` |
| `pg` | `@opentelemetry/instrumentation-pg` |
| `mysql` / `mysql2` | `@opentelemetry/instrumentation-mysql` / `mysql2` |
| `mongodb` | `@opentelemetry/instrumentation-mongodb` |
| `redis` / `ioredis` | `@opentelemetry/instrumentation-redis` / `ioredis` |
| `grpc` / `@grpc/grpc-js` | `@opentelemetry/instrumentation-grpc` |
| `koa` | `@opentelemetry/instrumentation-koa` |
| `fastify` | `@fastify/otel` (note: `@opentelemetry/instrumentation-fastify` is deprecated as of v0.68.0) |
| `nestjs` | `@opentelemetry/instrumentation-nestjs-core` |
| `mongoose` | `@opentelemetry/instrumentation-mongoose` |
| `kafkajs` | `@opentelemetry/instrumentation-kafkajs` |
| `pino` | `@opentelemetry/instrumentation-pino` |

**Allowlist Maintenance:** The OTel JS ecosystem is actively evolving. Packages get deprecated (e.g., `@opentelemetry/instrumentation-fastify` → `@fastify/otel`) and framework teams increasingly maintain their own instrumentation. This allowlist needs periodic review against `@opentelemetry/auto-instrumentations-node` releases.

**npm Registry Search (Fallback)**

If a file imports a framework not in the allowlist, the agent queries npm as a discovery mechanism. This is best-effort - the allowlist is the trusted set.

**Future:** Vector database synced with OTel ecosystem

Sources: [@opentelemetry/auto-instrumentations-node](https://github.com/open-telemetry/opentelemetry-js-contrib/tree/main/packages/auto-instrumentations-node)

### Schema Updates for Libraries
When a library is added, the schema should reference what it produces:
```yaml
# Example: express instrumentation added
groups:
  - id: span.myapp.http.server
    type: span
    brief: HTTP server spans from express instrumentation
    span_kind: server
    attributes:
      # Reference OTel HTTP semconv attributes
      - ref: http.request.method
        requirement_level: required
      - ref: url.path
        requirement_level: required
      - ref: http.response.status_code
        requirement_level: required
      - ref: http.route
        requirement_level: recommended
```

This enables Weaver live-check to validate library output.

### Manual Spans (Secondary)
Only add manual spans for:
- Business logic that libraries can't see
- Custom operations with no framework equivalent
- Schema-defined critical paths

Agent does NOT add manual spans for things libraries already handle.

---

## Validation Chain

Validation stays in the Instrumentation Agent so it can fix what it breaks.

### Per-File Validation (with fix loops)

Each check runs in a loop: validate → fix errors → retry until clean.

1. **Syntax** - TypeScript compiler / ts-morph (code must compile)
2. **Lint** - Prettier/ESLint (code must be properly formatted)
3. **Weaver registry check** - static schema validation

Order matters: syntax first (must compile), then lint, then schema.

The agent fixes issues it introduces. The Coordinator enforces hard limits on the fix loop (see Configuration).

**Variable Shadowing Pre-Check (before inserting new variables):**

Before the agent inserts `span`, `tracer`, or any OTel-related variable, it must use ts-morph's binder access to check whether that name already exists in the target scope. Shadowed variables compile and lint successfully but silently change runtime behavior — this is the kind of bug that destroys trust in the tool.

- If `span` or `tracer` already exists in scope → use a suffixed name (`otelSpan`, `otelTracer`)
- If the scope analysis is ambiguous → bail out of instrumenting that function and note it in the result file
- This is a pre-check, not a fix loop — it runs once before code insertion

### End-of-Run Validation (once, after all files)

These are slow, so they run once before creating the PR:

1. **Run tests with Weaver live-check**

Weaver acts as an OTLP receiver itself - no external collector needed for validation.

```text
Agent workflow:
1. Start Weaver: weaver registry live-check -r ./registry
   → Listens on localhost:4317 (gRPC) and :4320 (HTTP /stop)

2. Run tests with endpoint override:
   OTEL_EXPORTER_OTLP_ENDPOINT=localhost:4317 npm test
   → Tests exercise code, telemetry goes to Weaver

3. Stop Weaver: curl -X POST localhost:4320/stop
   → Weaver outputs compliance report

4. Parse results:
   → Coverage stats, violations, advisories by severity
```

The agent temporarily overrides the OTLP endpoint during validation. Normal production telemetry goes to the user's configured backend.

### Future Optimizations
- Smart test discovery (only tests touching changed files)
- Backend verification (query Datadog/Jaeger to confirm data arrived)

### If Tests Don't Exist
- Agent warns user
- Skips live-check validation
- Per-file validations still run

---

## Agent Self-Instrumentation

How the telemetry agent instruments its own operations.

### Bootstrapping

The agent cannot instrument itself using itself — that's circular. Its own instrumentation is hand-written, a fixed known set of spans covering the agent's workflow. This is distinct from the instrumentation it adds to target codebases.

### Separate Telemetry Pipelines

The agent maintains two independent telemetry streams that must not cross:

| Pipeline | Destination | Purpose |
|----------|-------------|---------|
| Target codebase telemetry | Weaver (validation) → user's backend (production) | What the agent creates |
| Agent operational telemetry | Developer's observability backend (e.g., Datadog) | Debugging the agent itself |

The OTLP endpoint override during Weaver live-check applies only to the target codebase's SDK, not to the agent's own exporter.

### Coordinator Spans (one trace per run)

| Span | Attributes |
|------|------------|
| `telemetry_agent.run` | Parent span for entire instrumentation run |
| | `files.attempted`, `files.succeeded`, `files.failed` |
| | `duration_ms` |
| | `schema_drift.attributes_created`, `schema_drift.spans_added` (totals from result files) |
| | `validation.tests_passed`, `validation.weaver_compliance` (end-of-run outcomes) |

### Instrumentation Agent Spans (child spans per file)

Nested under the Coordinator's trace:

| Span | Purpose |
|------|---------|
| `telemetry_agent.file.process` | Parent span per file |
| `telemetry_agent.file.analyze` | File analysis (imports detected, frameworks found) |
| `telemetry_agent.file.discover_libraries` | Library lookup (allowlist hit or npm fallback, what was found) |
| `telemetry_agent.file.transform` | Code transformation (manual spans added, libraries registered) |
| `telemetry_agent.file.validate` | Validation loop iteration (syntax/lint/Weaver, pass or fail) |

`telemetry_agent.file.validate` should include attributes for `retry_count` and `check_failed` (which check failed if any).

LLM calls should use `gen_ai.*` semconv attributes: `gen_ai.request.model`, `gen_ai.usage.input_tokens`, `gen_ai.usage.output_tokens`, latency. **Note:** The GenAI semantic conventions are in "Development" status (not stable) and may change. v1.39.0 adds `gen_ai.conversation.id`, reasoning content message parts, agent span kind guidance, and evaluation events.

### Trace Context Propagation

The Coordinator creates the root span and must propagate trace context to each Instrumentation Agent instance. Since each agent is a fresh LLM API call, the Coordinator passes the trace context (trace ID + parent span ID) as input to each agent, and the agent attaches its spans as children.

How this works depends on the framework choice (Q5) — but agent spans must be children of the Coordinator's file span, not independent traces.

**Constraint:** If the framework choice (Q5) lands on direct Anthropic API calls, trace context propagation must be handled manually — there is no built-in OTel context propagation for LLM API calls. The Coordinator would pass trace ID + parent span ID as parameters to the agent invocation function, and the agent wraps its API calls in child spans.

### PoC Scope

**Minimum:** Coordinator-level spans and LLM call spans with `gen_ai.*` attributes.

**Nice-to-have:** Per-phase child spans within the Instrumentation Agent.

The Weaver schema for the agent itself (as opposed to target codebases) is a separate registry that lives in the agent's own repo.

---

## Handling Existing Instrumentation

### Already instrumented (complete)
- Pattern match for `tracer.startActiveSpan`, `tracer.startSpan`, etc.
- Skip the function

### Broken instrumentation
- Agent is **additive only** - doesn't try to detect/fix broken patterns
- Weaver validation catches issues
- Agent fixes what Weaver reports

### Telemetry removed by user
- If user deletes instrumentation but schema still defines it
- Agent re-instruments according to schema (schema is source of truth)
- If user wants telemetry gone: don't feed file to agent

---

## Schema as Source of Truth

- Weaver schema defines what SHOULD be instrumented
- Agent implements the contract
- Agent can EXTEND schema (with semconv check)
- Code follows schema, not the other way around

---

## Result Files

Each Instrumentation Agent writes its own result file. The Coordinator collects them to generate the PR summary.

### Why Per-File Results (Not Shared File)
- Sequential processing means no race condition now
- But per-file results scale to parallel processing later
- No append coordination needed
- Coordinator just globs: `.telemetry-agent-results/*.json`

### Lifecycle

Result files live on the **local filesystem** during processing — they are NOT committed to the feature branch per-file.

1. Each Instrumentation Agent writes its result to `.telemetry-agent-results/` on disk
2. The agent's git commit contains only code changes and schema updates, not the result file
3. After all files are processed, the Coordinator reads result files from the filesystem
4. Coordinator assembles the summary and **commits a single result manifest** in the final PR commit. This makes the agent's work auditable directly in the repo without depending on GitHub's PR description rendering. The PR description should include a human-readable summary table derived from the manifest.

Result files only enter git once (if at all), at PR creation time — not per-file. This avoids noisy intermediate commits and keeps the feature branch history clean (each commit is one file's instrumentation changes).

The Coordinator manages `.telemetry-agent-results/` — creating the directory, collecting results, and cleaning up.

### Result Structure

```json
{
  "path": "src/services/payment.ts",
  "status": "success",
  "spans_added": 3,
  "libraries_needed": [
    {
      "package": "@opentelemetry/instrumentation-pg",
      "import": "PgInstrumentation",
      "config": {}
    }
  ],
  "schema_extensions": ["span.commit_story.payment.process"],
  "attributes_created": 2,
  "validation_retries": 1
}
```

For failures:
```json
{
  "path": "src/services/crypto.ts",
  "status": "failed",
  "reason": "syntax errors after 3 fix attempts",
  "last_error": "Unexpected token at line 42"
}
```

### Include in PR

Don't delete result files — commit the consolidated manifest in the PR. This builds trust with reviewers who want to see what the agent did across all files.

### Future: Schema State Tracking

Each agent can extend the schema, and extensions propagate via git commits. If Agent C's extension conflicts with Agent B's, Weaver validation catches it at end-of-run.

For future debugging, could add schema version/hash per agent run to track what schema state each agent started with. Not needed for PoC.

---

## Configuration

The config file is created during `telemetry-agent init` and serves as the gate for instrumentation. If no config file exists, the Instrumentation Agent refuses to run.

```yaml
# telemetry-agent.yaml (created by init, checked into repo)

# Required - path to Weaver registry
schemaPath: ./telemetry/registry

# Required - path to OTel SDK initialization file (recorded by init)
sdkInitFile: ./src/telemetry/setup.ts

# Agent behavior
autoApproveLibraries: true   # false = prompt before adding OTel libraries
testCommand: "npm test"       # command to run test suite

# Operational controls
maxFixAttempts: 3              # bail out after N failed validation cycles per file
maxTokensPerFile: 50000        # hard token budget per file (prevents runaway fix loops)
maxSpansPerFile: 5             # manual span cap per file (library spans are uncapped)
exclude:                       # files to skip
  - "**/*.test.ts"
  - "**/*.spec.ts"
  - "**/*.d.ts"
  - "node_modules/**"
```

### What Goes Where

| In Config | In Schema |
|-----------|-----------|
| Schema path | Namespace (authoritative) |
| SDK init file path | Semconv version |
| Test command | Attribute definitions |
| Agent behavior settings | Span definitions |
| Operational controls (limits, caps, excludes) | |

The config tells the agent **how to run**. The schema tells it **what telemetry looks like**.

**Note:** `testCommand` is hardcoded to `"npm test"` for the PoC. Post-PoC, this needs to support arbitrary runners (vitest, jest with custom configs, nx, turbo) and possibly test filtering to run only tests touching changed files.

Note: OTLP endpoint for production is configured in the user's OTel SDK setup, not here. During validation, the agent temporarily uses Weaver as the receiver.

---

## Minimum Viable Schema Example

A complete, valid Weaver schema that passes `weaver registry check`. Based on commit-story-v2.

**Location:** `telemetry/registry/`

### registry_manifest.yaml

```yaml
# The root manifest - defines namespace and pulls in OTel semconv
name: commit_story
description: OpenTelemetry semantic conventions for commit-story
semconv_version: 0.1.0
schema_base_url: https://commit-story.dev/schemas/

# Import official OTel semantic conventions
# The [model] suffix specifies the subdirectory containing registry files
dependencies:
  - name: otel
    registry_path: https://github.com/open-telemetry/semantic-conventions/archive/refs/tags/v1.37.0.zip[model]
```

**Semconv version note:** This example pins to v1.37.0. The latest release is v1.39.0 (January 2026), which adds significant GenAI semconv updates (`gen_ai.conversation.id`, agent span kind guidance, evaluation events) and database semconv stability changes (`db.name` → `db.namespace`). For the PoC, v1.37.0 is acceptable — but document that `db.name` will need migration when upgrading. The GenAI semconv additions in v1.39.0 are relevant for both the agent's self-instrumentation and AI-focused target codebases like commit-story-v2.

### attributes.yaml

```yaml
# Custom attributes for gaps not covered by OTel semconv
groups:
  # Attribute group with OTel refs + custom attributes
  - id: registry.commit_story.ai
    type: attribute_group
    display_name: AI Generation Attributes
    brief: Attributes for AI content generation
    attributes:
      # Reference OTel GenAI semconv (resolved from dependencies)
      - ref: gen_ai.request.model
        requirement_level: required
      - ref: gen_ai.operation.name
        requirement_level: required
      - ref: gen_ai.usage.input_tokens
        requirement_level: recommended
      - ref: gen_ai.usage.output_tokens
        requirement_level: recommended

      # Custom extension (not in OTel semconv)
      - id: commit_story.ai.section_type
        type:
          members:
            - id: summary
              value: summary
              brief: Daily summary generation
              stability: development
            - id: dialogue
              value: dialogue
              brief: Developer dialogue extraction
              stability: development
        stability: development
        brief: The type of journal section being generated

  # Pure custom attribute group (no OTel equivalent)
  - id: registry.commit_story.journal
    type: attribute_group
    display_name: Journal Attributes
    brief: Attributes for journal entry output
    attributes:
      - id: commit_story.journal.entry_date
        type: string
        stability: development
        brief: The date of the journal entry (YYYY-MM-DD)
        examples: ["2026-02-03"]

      - id: commit_story.journal.word_count
        type: int
        stability: development
        brief: Total word count of generated entry
        examples: [450, 1200]
```

### signals.yaml

```yaml
# Span definitions - what telemetry the system emits
groups:
  # Span using OTel semconv attributes (for library instrumentation)
  - id: span.commit_story.db.operations
    type: span
    brief: Database operations (via @opentelemetry/instrumentation-pg)
    span_kind: client
    note: Auto-instrumentation library handles span creation
    attributes:
      # Reference OTel db semconv via ref
      - ref: db.system
        requirement_level: required
      - ref: db.name              # Note: migrating to db.namespace in semconv v1.38.0+
        requirement_level: recommended
      - ref: db.operation.name
        requirement_level: recommended

  # Custom span (for manual instrumentation)
  - id: span.commit_story.journal.generate_summary
    type: span
    stability: development
    brief: AI-powered journal summary generation
    span_kind: internal
    attributes:
      - ref: gen_ai.request.model
        requirement_level: required
      - ref: commit_story.ai.section_type
        requirement_level: required
      - ref: commit_story.journal.word_count
        requirement_level: recommended
```

### Validation

```bash
# Validate schema syntax and references
weaver registry check -r ./telemetry/registry

# Resolve and view (includes semconv from dependencies)
weaver registry resolve -r ./telemetry/registry -f json -o resolved.json
```

### Key Points

| File | Purpose |
|------|---------|
| `registry_manifest.yaml` | Namespace, semconv version, OTel dependency |
| `attributes.yaml` | Custom attributes + refs to OTel semconv |
| `signals.yaml` | Span definitions (library-backed and manual) |

The agent reads the resolved output, which includes all semconv references expanded inline.

---

## Outstanding Questions

### Q1: Weaver Schema Structure (Resolved)
- **Scope problem:** Solved by requiring schema to exist before instrumentation (Schema Builder descoped from PoC)
- **Minimum viable schema:** See "Minimum Viable Schema Example" section above
- **commit-story-v2 reference:** `telemetry/registry/` contains a working example

### Q2: Live-Check Setup (Resolved)
Weaver acts as its own OTLP receiver:
- Agent starts `weaver registry live-check` (listens on :4317)
- Agent runs tests with `OTEL_EXPORTER_OTLP_ENDPOINT=localhost:4317`
- Agent stops Weaver via `curl localhost:4320/stop`
- Agent parses compliance report

No external collector needed for validation. Test suite needs no code changes - just environment variable override.

### Q3: Error Handling (Resolved)
**Approach:** Fail forward with file revert. Commit successful files, revert and skip failed ones, create PR with summary.

- **Before each file:** Coordinator snapshots the file (records HEAD SHA or temp copy)
- **Per-file failures** → Coordinator reverts file to pre-agent state, then continues to next. This ensures the PR remains compilable even with partial failures.
- **End-of-run failures** → note in PR, create anyway
- **Global failures** (SDK init file corruption, schema parse failure, git state corruption) → halt the run. These are distinguished from per-file failures because they affect all subsequent files.
- Partial success with clear reporting is more useful for learning

See "Result Files" section for how agents communicate results to the Coordinator.

### Q4: Semconv Lookup (Resolved)
The agent doesn't need to look up semconv separately - it's already in the resolved schema.

- `registry_manifest.yaml` has a `dependencies` field that pulls in OTel semconv
- `weaver registry resolve` produces output with resolved semconv references
- Agent just reads the resolved JSON and has everything it needs

```yaml
# registry_manifest.yaml
dependencies:
  - name: otel
    registry_path: https://github.com/open-telemetry/semantic-conventions/archive/refs/tags/v1.37.0.zip[model]
```

### Q5: Agent Framework Choice (Research Complete — Decision Pending)

Framework landscape was evaluated against this spec's requirements (deterministic coordinator + stateless per-file AI workers with tool use, structured output, and trace propagation):

| Framework | Verdict |
|-----------|---------|
| **Direct Anthropic SDK (`@anthropic-ai/sdk`)** | **Best fit.** Tool runner (beta) handles the agentic call-execute-feed loop. Zod handles structured output. Full OTel control. Zero framework overhead. Perfect "fresh instance" pattern — each `messages.create` is inherently stateless. |
| **Vercel AI SDK v6** | **Strong second.** `Agent` class + `maxSteps` + unified structured output. Built-in OTel telemetry (custom `ai.*` namespace, not `gen_ai.*` semconv — may need supplementation). |
| **Mastra** | **Best OTel story.** Native GenAI Semantic Conventions v1.38.0 via `OtelBridge`. TypeScript-native, Zod support. Trade-off: v1 just shipped (January 2026), still stabilizing. |
| **LangGraph** | **Overkill.** Graph-based state machines solve problems this spec doesn't have. Awkward fit for stateless single-shot tasks. |
| **LangChain** | Unnecessary indirection for single-shot tool-use pattern. |
| **AutoGen/CrewAI** | Eliminated — no TypeScript support (AutoGen/Python+.NET only; CrewAI Python-only). |

**Additional context for decision:**
- Weaver v0.21.2 introduced `weaver registry mcp` — a native MCP server for schema operations. Since the spec already uses MCP, this could simplify the interface layer regardless of framework choice.
- Weaver v0.21.2 also added `weaver serve` (REST API + web UI) which is useful for development/debugging.
- If direct Anthropic API is chosen, trace context propagation from Coordinator to Agent must be handled manually (see Agent Self-Instrumentation → Trace Context Propagation).

**Decision:** To be made by Whitney before implementation.

### Q6: Quality Checks for AI (Resolved)
Three main levers:

1. **Fresh instance per file** - Prevents laziness, each file gets full attention
2. **Weaver validation chain** - Catches errors via static check and live-check
3. **Schema drift detection** - Compare resolved schema before/after each file. Flag if agent adds too many attributes (e.g., 30 attributes for a single file = something wrong). Cheap check that catches sprawl.

The result file already captures `attributes_created` and `spans_added` - Coordinator can sum across files and flag unreasonable totals.

---

## Dependencies

### PRD 25 (Autonomous Dev Infrastructure)
- Should be completed first
- Provides testing infrastructure for this repo
- Agent doesn't depend on it architecturally (self-contained validation)
- But this repo benefits from having it

### Separate Repository
- Agent should live in its own repo
- commit-story-v2 is first test subject, not home
- Enables distribution to other codebases

---

## PoC Scope

### In Scope
- Assumes target codebase already has OTel API and SDK installed, initialized, and a valid Weaver schema in place
- MCP server interface
- Coordinator + agent architecture:
  - Coordinator (deterministic script for orchestration)
  - Instrumentation Agent (per-file)
  - Schema Builder Agent descoped (schema must exist)
- Mandatory init phase with prerequisite verification
- Per-file result files for agent-to-coordinator communication
- TypeScript support
- Traces only (no metrics/logs yet)
- File/directory input
- Sequential processing with fresh agent instance per file
- PR output
- Per-file validation with fix loops: syntax, lint, Weaver static
- End-of-run validation: tests, Weaver live-check
- npm registry queries for library discovery
- Schema extension with semconv priority

### Out of Scope (Future)
- Schema Builder Agent (auto-generate schema from codebase discovery)
- Async/event-driven patterns (event emitters, pub/sub, cron jobs, queue consumers)
- CLI and GitHub Action interfaces
- Multi-agent for different signal types (separate metrics/logs/traces agents)
- Other languages
- Smart test discovery
- Vector database for OTel knowledge
- Backend verification (query observability platform)
- Configurable instrumentation levels (dev-heavy vs production-selective)

### Known Scaling Limitations

These concerns are mitigated in the PoC by the 10-file limit:

**SDK file modification fragility:** ~~At high file counts, multiple agents sequentially modifying the SDK initialization file is fragile.~~ **Resolved in this spec:** agents record library needs in result files, and the Coordinator makes a single deterministic SDK modification after all agents complete (see Coordinator responsibilities and Path 1 example).

**Schema accumulation inconsistencies:** Schema accumulation across many files may produce structural inconsistencies that per-file Weaver validation doesn't catch. A post-run schema consistency check (or Coordinator-level schema assembly) would address this.

**Dependency installation:** The Coordinator performs a bulk `npm install` after collecting all `libraries_needed` from result files. At high file counts with many unique dependencies, this install step could be slow. The PoC's 10-file limit makes this manageable.

---

## Research Summary

### Prior Art
- **o11y.ai** - AI-powered, TypeScript, generates PRs. Not schema-driven. (Launched by Observe Inc., November 2025)
- **OllyGarden** - Insights (Instrumentation Score, 0-100 quality metric) and Tulip (OTel Collector distribution). Co-founder Juraci has confirmed "agentic instrumentation" direction at KubeCon NA 2025. Analyzes OTLP streams, not source code.
- **Orchestrion (Datadog)** - Compile-time AST instrumentation for Go. Separate `orchestrion-js` for JS/TS (SWC + TracingChannel), not schema-driven.
- **Liatrio Labs otel-instrumentation-mcp** - MCP server providing OTel docs/examples to AI assistants. Plans "future Weaver support." Reference material, not autonomous transformation.

See "Why Schema-Driven?" in Vision section for why the gap matters.

### Optional Telemetry Pattern
- `@opentelemetry/api` has zero dependencies (~8-10KB)
- Use peer dependencies with optional flag
- Without SDK initialization, all API calls are automatic no-ops
- Agent can instrument code that works with or without OTel present

Relevant when the agent targets codebases that don't already have OTel installed (see Out of Scope — PoC assumes OTel is pre-installed).

### Instrumentation Level (Still Open)
- "Instrument everything" is NOT industry best practice for production
- Consensus: auto-instrumentation baseline + manual for business-critical paths
- v1's heavy dev instrumentation was intentional for AI debugging assistance
- Agent should eventually support configurable modes

---

## References

### Research Documents
- [Prior Art: AI Instrumentation Tools](./research/telemetry-agent-prior-art.md)
- [Optional Telemetry Patterns](./research/optional-telemetry-patterns.md)
- [TypeScript AST Tools](./research/typescript-ast-tools.md)
- [Instrumentation Level Strategies](./research/instrumentation-level-strategies.md)
- [Weaver TypeScript Capabilities](./research/weaver-typescript.md)

### External Resources
- [OllyGarden](https://ollygarden.com)
- [OpenTelemetry Weaver](https://github.com/open-telemetry/weaver)
- [ts-morph](https://ts-morph.com/)
