# Consolidated Technical Review: Telemetry Agent Specification

**Date:** 2026-02-05
**Spec Author:** Whitney Lee
**Spec Status:** Draft
**Reviewers:** Michael Rishi Forrester + Claude (AI-assisted research)

---

## Overall Assessment

This is a strong draft. The coordinator + per-file agent pattern is architecturally sound, the schema-driven Weaver validation loop is genuinely differentiated from existing tools (o11y.ai, OllyGarden), and the scope boundaries are well-drawn for a PoC. The "fresh instance per file" strategy is the right call for preventing LLM context degradation. The writing is clean and decision rationale is documented throughout.

That said, there are **two categories of gaps**: technical recency issues (things that changed in the OTel ecosystem since the spec was drafted) and operational workflow gaps (things the spec doesn't address that will cause friction during implementation). Both are addressed below in a unified, deduplicated list.

---

## Critical (Must Address Before Implementation)

### C1. The SDK Init File Is a Single Point of Failure

**Three separate problems all converge on one file.**

The spec describes per-file agents modifying the SDK initialization file (`src/telemetry/setup.ts`) to register auto-instrumentation libraries. This creates a cluster of issues:

**Discovery gap:** The init phase checks that "OTel SDK initialization exists somewhere" (line 83) but doesn't record the path. The Instrumentation Agent can't scan the codebase (line 51) but needs to know where this file is.

**Sequential mutation fragility:** Even with sequential processing, having an LLM parse and rewrite the same setup file 10 times is fragile. A hallucination on iteration 5 breaks the SDK for files 6-10. The agent's "fresh context" means it doesn't know why previous imports were added, risking accidental removal.

**The spec already knows this:** The "Known Scaling Limitations" section describes exactly this problem and sketches the solution — agents record library needs in result files, and the Coordinator makes a single clean SDK modification after all agents complete.

**Recommendation:** Promote this from "future improvement" to PoC architecture:

- **Init phase** records the SDK init file path in `telemetry-agent.yaml`
- **Instrumentation Agent** outputs library requirements in the result file: `"libraries_needed": ["@opentelemetry/instrumentation-pg"]`
- **Coordinator** collects all requirements, deduplicates, and performs one deterministic write to the SDK init file after all agents complete

This eliminates discovery, race conditions, and mutation fragility in one architectural change.

**Status: INCORPORATED INTO SPEC** — Coordinator now owns SDK file modifications. Agents output `libraries_needed` in result files.

### C2. Missing Dependency Installation Workflow

The spec describes the agent discovering libraries via npm registry and adding imports, but never addresses who actually installs the packages.

**The gap:** If the agent adds `import { PgInstrumentation } from '@opentelemetry/instrumentation-pg'` to the SDK file but doesn't install the package, `npm test` immediately fails with `Module not found`.

**Recommendation:** Explicitly define whether:

- **(a)** The Instrumentation Agent can run `npm install <package>` directly, or
- **(b)** The Coordinator aggregates all `libraries_needed` from result files and performs one bulk `npm install` at the end (before the end-of-run validation)

Option (b) is cleaner and consistent with the C1 recommendation — keep the Coordinator as the single writer for shared resources (package.json, SDK init file, lockfile).

**Status: INCORPORATED INTO SPEC** — Coordinator performs bulk `npm install` after collecting all `libraries_needed`.

### C3. Missing File Revert Protocol

The validation loop describes "validate → fix → retry" but doesn't define what happens when the agent mangles a file beyond recovery.

**The gap:** If the agent introduces a syntax error it can't fix after N attempts, the spec says "fail forward" and skip the file. But if the broken file is left on the feature branch, the end-of-run `npm test` fails for the entire project — not just the broken file.

**Recommendation:** The Coordinator must snapshot each file (via `git stash` or temp copy) before handing it to the agent. If the agent returns a "failed" status, the Coordinator reverts the file to its pre-agent state before continuing. This ensures the PR remains compilable even with partial failures.

**Status: INCORPORATED INTO SPEC** — Coordinator snapshots files before agent processing and reverts on failure. Q3 updated to distinguish local vs global failures.

### C4. Fastify Instrumentation Package Is Deprecated

The trusted allowlist includes `@opentelemetry/instrumentation-fastify`. This package is **deprecated** as of `@opentelemetry/auto-instrumentations-node` v0.68.0 (February 2026). The Fastify team now maintains their own official package: `@fastify/otel`.

**Impact:** The deprecated package still works but generates warnings and won't receive updates. More importantly, this is a concrete example of why a hardcoded allowlist has maintenance burden — worth calling out explicitly in the spec.

**Fix:** Replace the allowlist entry. Add a note about allowlist maintenance cadence.

**Status: INCORPORATED INTO SPEC** — Allowlist updated. Maintenance note added.

### C5. Variable Shadowing Should Be in the PoC

The spec correctly identifies variable shadowing as a risk (line 473) but defers it to "post-PoC."

**Why it's critical:** If the agent wraps a function with `tracer.startActiveSpan('...', (span) => { ... })` and the file already has a variable named `span` in an outer scope, the code will compile, lint, and pass Weaver validation — but silently change runtime behavior. This is the kind of bug that destroys trust in the tool.

**The fix is cheap:** ts-morph v27.x provides access to TypeScript's binder for scope analysis. A pre-check before inserting new variables — "does `span` or `tracer` already exist in this scope?" — takes minimal effort. If collision detected, use a suffixed name (`otelSpan`, `otelTracer`) or bail out.

**Status: INCORPORATED INTO SPEC** — Variable shadowing pre-check promoted to PoC feature in validation chain.

---

## Important (Should Address)

### I1. Token Budget and Fix Loop Limits

The per-file validation "fix loop" has no defined ceiling.

**The gap:** If an agent gets stuck trying to satisfy a Weaver schema check, it could burn through API credits in an infinite retry loop.

**Recommendation:** Add to configuration:

```yaml
maxFixAttempts: 3          # bail out after N failed validation cycles
maxTokensPerFile: 50000    # hard token budget per file
```

The spec already captures `validation_retries` in the result file — this just needs a corresponding hard limit in the Coordinator.

**Status: INCORPORATED INTO SPEC** — Configuration updated with `maxFixAttempts`, `maxTokensPerFile`, and `maxSpansPerFile`.

### I2. Span Density Guardrails

LLMs tend to over-instrument when told to "add telemetry." Without constraints, the agent might wrap every helper function in a span.

**The gap:** The heuristics section says to skip "utilities, formatters, pure helpers," but this is guidance to the LLM, not a measurable constraint. In a high-throughput Node.js app, excessive spans cause real performance overhead.

**Recommendation:** Two levers:

- **System prompt constraint:** Limit instrumentation to entry points, external calls (DB/HTTP/gRPC), and complex business logic only. Explicitly prohibit instrumenting functions under N lines or pure synchronous utilities.
- **Coordinator enforcement:** The drift detection already sums `spans_added` across files. Add a per-file cap (e.g., max 5 manual spans per file) and a project-wide cap. Flag violations for human review rather than silently accepting.

**Status: INCORPORATED INTO SPEC** — Span Density Guardrails section added with per-file cap, project-wide cap, and explicit prohibitions.

### I3. Weaver Now Has a Native MCP Server

Weaver v0.21.2 introduced `weaver registry mcp` — an MCP server providing search, get, and live-check tools directly. Since the spec's architecture already uses MCP (Claude Code → MCP server → Coordinator), the agent could interact with Weaver's native MCP server for schema operations instead of shelling out to CLI commands.

This doesn't change PoC architecture, but it's worth noting in the "Agent Framework Choice" section (Q5). Weaver v0.21.2 also added `weaver serve` (REST API + web UI) which could help during development/debugging.

**Status: INCORPORATED INTO SPEC** — Noted in Q5 framework decision section.

### I4. Semantic Conventions Version Is Behind

The example `registry_manifest.yaml` pins to semconv `v1.37.0`. The latest release is **v1.39.0**, which includes significant GenAI semconv updates: `gen_ai.conversation.id`, reasoning content message parts, multimodal support, agent span kind guidance, and evaluation events.

This matters because:

- The agent itself uses `gen_ai.*` attributes for self-instrumentation (line 555)
- The target codebase (commit-story-v2) does AI content generation
- The `db.name` attribute used in schema examples (line 268) is being replaced by `db.namespace` in the database semconv stability push (v1.38.0+)

**Recommendation:** For the PoC, pinning to v1.37.0 is fine — but document why and note that `db.name` → `db.namespace` migration will be needed when upgrading. Consider bumping to v1.39.0 if the GenAI conventions are important for commit-story-v2.

**Status: INCORPORATED INTO SPEC** — Semconv version note added with pin rationale and db.name migration warning. db.name references annotated in schema examples. gen_ai.* development status warning added.

### I5. OTel JS SDK 2.0 Compatibility

The `@opentelemetry/auto-instrumentations-node` v0.68.0 now states compatibility with "OpenTelemetry JS API and SDK 2.0+." The spec's code examples use the NodeSDK constructor pattern (still valid), but the SDK 2.0 transition includes breaking changes from 1.x. The spec should note the minimum SDK version the agent targets somewhere in Prerequisites or Dependencies.

**Status: INCORPORATED INTO SPEC** — Prerequisites updated with Node.js and SDK version requirements.

### I6. OllyGarden "Rose" Product Name Unverifiable

The spec references "OllyGarden Rose" as a PR review tool with "agentic instrumentation" coming. Publicly verifiable OllyGarden products are **Insights** (Instrumentation Score) and **Tulip** (OTel Collector distribution, Oct 2025). OllyGarden's co-founder Juraci confirmed the "agentic instrumentation" direction at KubeCon NA 2025 and in a December 2025 panel, but the specific product name "Rose" doesn't appear in public materials.

**Recommendation:** If "Rose" is from a private conversation or early access, note the source. If this spec may be shared externally, consider using a generic description or verifiable product names to avoid confusion.

**Status: INCORPORATED INTO SPEC** — Prior art section updated with verifiable product names. OllyGarden Rose reference replaced.

---

## Minor (Nice to Have)

### M1. Localhost/Docker Environment Constraints

The validation chain runs `weaver registry live-check` on `localhost:4317`. Ensure the PoC's Docker/runner environment allows spawning background processes and binding to those ports. Worth a one-liner in Prerequisites.

**Status: INCORPORATED INTO SPEC** — Added to Prerequisites.

### M2. Test Command Flexibility

Config specifies `testCommand: "npm test"`. For the distributable tool goal, this needs to support arbitrary runners (vitest, jest, nx, turbo). Fine for the PoC — just note it.

**Status: INCORPORATED INTO SPEC** — Note added to Configuration section.

### M3. Result File Lifecycle Ambiguity

Line 651 says "include result files in PR" but line 617 says the Coordinator "either renders as PR description body, OR commits as a single manifest." Pick one for the PoC. Committing them is better — makes the agent's work auditable without depending on GitHub's PR rendering.

**Status: INCORPORATED INTO SPEC** — Resolved: commit manifest, render summary in PR description.

### M4. Agent Self-Instrumentation Trace Propagation

If the agent framework choice (Q5) lands on direct Anthropic API calls, trace context propagation from Coordinator to Agent must be handled manually (in system prompt or tool parameters). There's no built-in OTel context propagation for LLM API calls. Worth flagging as a constraint on the Q5 decision.

**Status: INCORPORATED INTO SPEC** — Constraint noted in Trace Context Propagation section and Q5.

### M5. 10-File Limit Needs a Growth Story

The PoC cap is smart, but add a one-liner: "Post-PoC, the Coordinator-level SDK modification and schema assembly patterns described in Known Scaling Limitations would remove the need for this cap."

**Status: INCORPORATED INTO SPEC** — Growth narrative added to file limit description.

---

## Additional Findings from AI-Assisted Research

These findings came from the parallel research agents and supplement the manual review above:

### Weaver Validation (All Claims Checked)

| Claim | Status |
|-------|--------|
| `weaver registry check` exists | **Confirmed** |
| `weaver registry live-check` on :4317/:4320 | **Confirmed** (ports configurable, defaults match) |
| `weaver registry resolve -f json` | **Confirmed** |
| Registry manifest format | **Mostly confirmed** (`schema_base_url` may be optional) |
| Zip URL with `[model]` suffix | **Confirmed** |
| `groups`, `type: span`, `type: attribute_group`, `ref:` | **Confirmed** |
| `stability: development` | **Confirmed** (5 levels: development, alpha, beta, release_candidate, stable) |
| Weaver actively maintained | **Yes** — v0.21.2 released Feb 3, 2026 |

Minor Weaver notes:
- `curl localhost:4320/stop` should be `curl -X POST localhost:4320/stop` (**fixed in spec**)
- v0.20.0 renamed "Violation"/"Advice" to "PolicyFinding" in output

### ts-morph Validation

| Claim | Status |
|-------|--------|
| TypeScript-native, full type access | **Confirmed** |
| Scope analysis via binder | **Partially confirmed** — requires `compilerNode.locals` (internal API) |
| Detect imports | **Confirmed** — `getImportDeclarations()` |
| Add imports | **Confirmed** — `addImportDeclaration()` |
| Wrap function bodies | **Confirmed** — via `setBodyText()` |
| Pattern match for existing instrumentation | **Confirmed** — via AST traversal |

Key risk: TypeScript 7 (Go rewrite) targeted for early-to-mid 2026 will likely break ts-morph. **Noted in spec.**

### Competitive Landscape

The core thesis holds: **"No existing tool combines Weaver schema + AI + source transformation"** — confirmed as of February 2026.

New entrants to watch:
- **Liatrio Labs otel-instrumentation-mcp** — MCP server for OTel docs/examples. Plans "future Weaver support." (**Added to spec.**)
- **OllyGarden Instrumentation Score** — Open-source spec (0-100 quality metric). Could be a post-run quality gate.
- **Datadog orchestrion-js** — Build/load-time JS instrumentation. Not schema-driven.

### Framework Evaluation (Resolves Q5)

Full evaluation of 10 frameworks. **Added to spec Q5.** Summary:
- **Direct Anthropic SDK** — best fit for stateless per-file workers
- **Vercel AI SDK v6** — strong second, slightly more ergonomic
- **Mastra** — best OTel story (GenAI semconv v1.38.0 native)
- **LangGraph** — overkill for this pattern
- **AutoGen/CrewAI** — eliminated (no TypeScript)

---

## Consolidated Checklist

| # | Finding | Severity | Status |
|---|---------|----------|--------|
| C1 | SDK init file is single point of failure | Critical | Incorporated into spec |
| C2 | No dependency installation workflow | Critical | Incorporated into spec |
| C3 | No file revert protocol for failed agents | Critical | Incorporated into spec |
| C4 | Fastify instrumentation package deprecated | Critical | Incorporated into spec |
| C5 | Variable shadowing deferred but should be in PoC | Critical | Incorporated into spec |
| I1 | No token budget or fix loop ceiling | Important | Incorporated into spec |
| I2 | No span density guardrails | Important | Incorporated into spec |
| I3 | Weaver v0.21.2 has native MCP server | Important | Incorporated into spec |
| I4 | Semconv pinned to v1.37.0 (latest is v1.39.0) | Important | Incorporated into spec |
| I5 | OTel JS SDK 2.0 compatibility undocumented | Important | Incorporated into spec |
| I6 | "OllyGarden Rose" not publicly verifiable | Important | Incorporated into spec |
| M1 | Localhost/Docker port binding for Weaver live-check | Minor | Incorporated into spec |
| M2 | Test command flexibility for non-npm-test projects | Minor | Incorporated into spec |
| M3 | Result file PR inclusion is ambiguous | Minor | Incorporated into spec |
| M4 | Trace propagation constraint for direct API choice | Minor | Incorporated into spec |
| M5 | 10-file limit needs growth narrative | Minor | Incorporated into spec |

---

## What's Done Well

- **Fresh instance per file** avoids LLM context degradation and future-proofs for parallelism
- **Schema-as-contract with Weaver validation** is the genuine differentiator
- **Dual telemetry pipelines** (target codebase vs. agent operational) shows mature thinking
- **Explicit descoping of Schema Builder Agent** was the right call
- **Result file design** is solid — per-file JSON with clear semantics
- **Fail-forward philosophy** is correct for a PoC, now strengthened with file revert protocol
