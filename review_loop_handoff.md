# Architect ↔ Security Reviewer — Portable Review-Loop Handoff

A reusable method for running an **automated design-review loop** between two AI personas: an **Architect** that designs the system and a **Security Reviewer** that independently attacks the design. They iterate until the reviewer can't break it, then a human signs off. This document is domain-agnostic — specialize the two marked spots per project (Section 9) and it drops into any codebase.

---

## 1. The pattern in one paragraph

This is the **evaluator-optimizer** loop (Anthropic, *Building Effective Agents*): one model generates, a second evaluates and returns feedback, and the loop repeats until the evaluator is satisfied. The value isn't a second opinion — it's **separation of duties**. The party that designed a system is the wrong party to certify it can't be broken, so the reviewer never designed it and has no stake in defending it. The loop automates the *drafting churn*; it never becomes the final authority.

---

## 2. The two roles

- **Architect (generator).** Owns secure-by-design. Produces and revises the architecture, responds to every finding, and never marks its own work approved. Its design target is the "north star" (the full vision); its build target is the current slice. Governing rule: **design for the ceiling, build the floor** — lay every interface the vision needs, build one implementation behind each.
- **Security Reviewer (evaluator).** Independent adversary. Attacks the design against a fixed set of **crown jewels** (the handful of outcomes a breach would make catastrophic). Names missing controls and the standard pattern that supplies them — but **hands the design back**; it never re-architects. Runs as a **gate**, not a co-designer.

Each role is a system prompt. Two spots are project-specific and get specialized (Section 9): the reviewer's **crown jewels** and the architect's **seams / north-star**.

---

## 3. Loop control flow

```
requirements ─▶ [Architect] ─▶ [Reviewer] ─▶ [Branch]
                    ▲                            │
                    │                            ├─ human_decision_required non-empty ─▶ HUMAN (exit)
                    │                            ├─ verdict=APPROVE & open_blockers=0 ──▶ HUMAN sign-off (exit)
                    │                            ├─ iteration ≥ max_iterations ─────────▶ HUMAN: cap hit (exit)
                    └──────── else: loop back with findings ◀─┘
```

Branch order: (1) anything needing a human decision exits immediately; (2) a clean approve with zero open blockers exits to human sign-off; (3) hitting the iteration cap (default **4**) exits with open findings; (4) otherwise loop back with findings. The reviewer only ever emits `APPROVE` or `REVISE` — the escalate/cap-hit outcomes are control flow, not verdicts the model invents.

---

## 4. The verdict contract (reviewer output)

The reviewer emits **only** this object so a branch can parse it directly. (When a Claude Code / Cursor session orchestrates instead of a rigid IF-node, it can stay structured-but-readable rather than strict JSON.)

```jsonc
{
  "iteration": 2,
  "verdict": "REVISE",                 // "APPROVE" | "REVISE" — the branch key
  "open_blocker_count": 1,             // findings still open at BLOCKER or Critical
  "reviewer_summary": "…",             // plain-English, for the human at exit

  "crown_jewel_coverage": [            // PROVE-A-NEGATIVE — every jewel, every pass
    {
      "jewel": "confidentiality of <X>",
      "status": "no_reachable_path",   // "no_reachable_path" | "findings_open"
      "attacks_attempted": ["…"],      // REQUIRED when no_reachable_path
      "open_finding_ids": []           // REQUIRED when findings_open
    }
  ],

  "findings": [
    {
      "id": "F-003",                   // STABLE across iterations — auditable lifecycle
      "iteration_raised": 1,
      "title": "…",
      "severity": "BLOCKER",           // BLOCKER | Critical | High | Medium | Low
      "crown_jewel": "…",
      "stride": "Tampering",           // STRIDE class
      "precondition": "what the attacker must already have",
      "exploit_path": "step-by-step to the jewel",
      "recommended_control": "the named standard pattern that closes it",
      "source": {                       // GROUNDING — real, never fabricated
        "name": "OWASP … / CWE … / vendor docs",
        "quote": "<exact short passage>",
        "url": "https://…"
      },
      "status": "open",                 // open | addressed_pending_verification | verified_closed | withdrawn
      "verification_note": ""
    }
  ],

  "human_decision_required": []         // forces exit to human (accepted-risk or constraint conflict)
}
```

Architect's reply each pass, per open finding, is exactly one of: **ADDRESS** (revise; mark `addressed_pending_verification`; the reviewer verifies, not the architect), **DISPUTE** (with a cited source; returns to the reviewer to adjudicate), or **ESCALATE** (to the human, if the fix would weaken a hard constraint or the only resolution is an accepted risk). Never silently drop a finding.

---

## 5. Anti-convergence guardrails (the important part)

Architect and reviewer are usually the **same base model** in two prompts, and same-model generator/critic pairs tend to *converge* — the critic drifts toward agreeing and rubber-stamps. That silently destroys the independence the whole pattern exists for. The failure is documented: the loop "becomes circular when the evaluator cannot reliably tell good output from bad." Six guardrails counter it:

1. **Prove-a-negative coverage.** Every pass, the reviewer fills `crown_jewel_coverage` for *all* jewels. A "no reachable path" claim is invalid without the attacks it actually attempted. This is the single strongest anti-convergence control — the reviewer can't quietly agree, it must show it attacked.
2. **Mandatory grounded citations.** Every finding needs a real `{name, exact quote, url}`. An ungrounded concern is dropped or downgraded to a note — never dressed up with an invented citation. Grounding anchors judgment in outside standards, not the architect's framing. **This only works if the reviewer has web access** (Section 6).
3. **Reviewer-only verification.** The architect claiming a fix doesn't close it; the reviewer must re-open the exploit path and confirm it's shut before moving a finding to `verified_closed`.
4. **Different models for the two roles.** Run the architect and reviewer on *different* models (e.g., a mid-tier architect, a top-tier reviewer). Different models converge far less than one model talking to itself.
5. **Human on the final gate.** `APPROVE` routes to a human with the full findings ledger — it never ships on its own. Hard constraints (whatever they are for the project) can never be traded away inside the loop; they force an escalate.
6. **Stack review — every proposed platform is an attack surface, not a fixed constraint.** The reviewer must independently evaluate every platform, tool, and service the architect proposes — secret residency, breach history, compliance posture, blast radius if compromised. Both roles consult `SAAS_REFERENCE_CATALOG.md` to ground their choices in how best-in-class commercial SaaS companies actually build. Without this, the reviewer accepts the architect's stack as given and reviews only the code deployed *to* it — missing platform-level vulnerabilities that dwarf any code-level finding.

Plus an **iteration cap** — guarantees termination and bounds cost. Multi-agent loops run markedly more tokens per run than a single pass, so the cap protects the wallet too.

---

## 6. Build it in Claude Code (recommended for reviewing code)

Subagents are markdown files with YAML frontmatter in `.claude/agents/` (project) or `~/.claude/agents/` (all projects). Each gets its own system prompt, tool access, and model, and returns results to the main session — which plays orchestrator. Official docs: https://code.claude.com/docs/en/sub-agents

**Architect** — `.claude/agents/architect.md`
```yaml
---
name: architect
description: Designs and revises the system architecture; responds to review findings. Reads/updates ARCHITECTURE.md.
tools: Read, Write, Edit, Grep, Glob
model: sonnet
---
# (architect persona body — Section 2 role + your project's seams from Section 9)
```

**Security Reviewer** — `.claude/agents/security-reviewer.md`
```yaml
---
name: security-reviewer
description: Use PROACTIVELY after the architect produces or revises the design. Attacks it against the crown jewels; emits the verdict contract. Read-only + web for grounding.
tools: Read, Grep, Glob, WebSearch, WebFetch
model: opus
---
# (reviewer persona body — Section 2 role + your project's crown jewels from Section 9 + the verdict contract from Section 4)
```

Key wiring:
- **`WebSearch` + `WebFetch` on the reviewer** — without them it can't ground findings, and guardrail #2 collapses.
- **Different `model:` values** (sonnet vs opus) — that's guardrail #4, for free.
- **Blackboard file for state.** Subagents start with a fresh context and return only their final message, so keep the evolving design in **`ARCHITECTURE.md`** in the repo. Both subagents read and update that file; it carries state across iterations, not conversation memory.
- **Reference catalog for grounding.** Both subagents read **`SAAS_REFERENCE_CATALOG.md`** in the repo — a citable catalog of how best-in-class commercial SaaS companies (Stripe, Atlassian, HubSpot, Shopify) build their infrastructure, handle secrets, deploy, and isolate tenants. This is guardrail #6: without it, both roles reason from frameworks alone and miss platform-level findings that any commercial security review would catch.
- **Run the loop** by telling the main session: *"Have the architect design X in ARCHITECTURE.md, then have the security-reviewer attack it and write findings; loop until the reviewer returns APPROVE with zero blockers or you hit 4 rounds, then summarize for me."*

---

## 7. Build it in Cursor (more manual, good for learning the loop)

Modern Cursor rules are `.mdc` files in `.cursor/rules/` with frontmatter (`description`, `globs`, `alwaysApply`) and four activation modes (Always / Auto-attached / Agent-requested / Manual). The legacy flat `.cursorrules` is ignored in Agent mode — don't use it. Cursor also has Ask / Plan / Agent / Debug modes (Shift+Tab). Check Cursor's official docs for current specifics; practitioner reference: https://www.morphllm.com/cursor-rules-best-practices

Cursor has no delegated-subagent loop, so you drive it: put the architect as one rule and the reviewer as another (`alwaysApply: false`, Agent-requested or Manual so they don't tax every request), design in **Plan mode**, then invoke the reviewer rule to attack it, then revise. Slower, but you see each step of the loop — useful while learning it.

---

## 8. Alternative: n8n (for reviewing documents, not code)

If the thing under review is an architecture *document* rather than a live codebase, orchestrate in n8n: two model nodes (architect + reviewer, each loaded with its persona), an IF node reading `verdict`, a counter for the cap, a human-handoff node. Loop by connecting a node's output back to an earlier node; n8n warns you must include a valid termination condition or the run hangs. Docs: https://docs.n8n.io/flow-logic/looping/

---

## 9. Specialize per project (the only two spots that change)

**A. Reviewer crown jewels** — list the 4–6 outcomes that would be catastrophic if an attacker reached them. Method: *what data, integrity, or control, if breached, causes real loss here?* Start from these generic categories and make each concrete to the domain:
1. Confidentiality of the most sensitive data.
2. Integrity of the system of record / core data (no unvalidated or fabricated writes).
3. The untrusted-input boundary — injection generally, and **LLM prompt injection** specifically if any model reads attacker-influenced text.
4. Credential / secret security.
5. Access control & exposure (auth on every surface; nothing publicly reachable that shouldn't be).
6. Third-party data-sharing boundary (what leaves the system, to whom, minimized).

**B. Architect seams** — list the interfaces the north-star needs that would be catastrophic to retrofit. Typically: an **adapter port** for anything pluggable (data sources, providers, channels); a **canonical, append-only data model** with provenance; **config-as-data** for tunable values; an **analysis/scoring interface**; an **API boundary**; and a **multi-tenant / identity seam** if multiple users are ever realistic.

Keep the reviewer's methodology (STRIDE, OWASP Top 10, OWASP API Top 10, OWASP Top 10 for LLM Applications, ASVS) and all of Sections 3–6 unchanged — only A and B move.

---

## 10. Worked example — personal health-data ingestion + analysis pipeline

A pipeline that ingests from email exports and manual entries (e.g., calorie/food, workout, body-composition, tape measurements), normalizes it, and analyzes progress against goals. The dominant axis is **privacy**, not fraud. Specialization:

**Crown jewels**
1. **Health-data confidentiality** — intimate body/eating/workout data never leaks (at rest, in transit, in logs, in backups, or in prompts sent to any third-party model).
2. **Ingestion trust boundary** — inbound email is untrusted; only verified senders/sources accepted; a spoofed email can't inject false measurements; an LLM parser can't be prompt-injected by email content.
3. **Credential / token security** — email OAuth/IMAP and any source API tokens are scoped and never in code, logs, or client.
4. **Analysis integrity** — insights are traceable to stored measurements; low-confidence or model-generated conclusions are flagged, never asserted as fact.
5. **Access control & exposure** — any web/API/webhook surface is authenticated; the datastore isn't publicly reachable.
6. **Third-party sharing minimization** — what health data leaves to any external analysis service is known and minimized.

**Architect seams**
- **Source-adapter port** — each source behind one interface; a new source is a new adapter.
- **Canonical, append-only measurement model** — `{ metric, value, unit, source, observed_at, ingested_at, confidence, raw_ref }`, provenance on every datum.
- **Ingestion/parse boundary** — parser (regex today, LLM later) swappable without touching storage.
- **Analysis/insight interface** — simple stats now, richer/LLM analysis later, same contract.
- **Goal model as config-as-data** — targets and timeframes tunable without code.
- **Reconciliation rules** — when sources disagree on the same metric, a defined rule decides which wins or keeps both with provenance.
- **Identity/sharing seam (deferred impl)** — lay a thin owner/viewer boundary only if a coach/partner view is realistic; don't build sharing yet.

Cross-cutting: idempotent ingestion (reprocessing the same email doesn't double-count), unit/timezone normalization at the adapter edge, encryption in transit + at rest, and a defined retention policy.

---

## 11. Sources

- Anthropic, *Building Effective Agents* (evaluator-optimizer) — https://www.anthropic.com/engineering/building-effective-agents
- AgentPatterns, on the circular-evaluator failure mode — https://www.agentpatterns.ai/agent-design/anthropic-effective-agents-framework/
- Claude Code — Create custom subagents — https://code.claude.com/docs/en/sub-agents
- Claude Code — subagents overview / security-reviewer example — https://claude.com/blog/subagents-in-claude-code
- Cursor rules (`.mdc`) practitioner reference (verify against Cursor's official docs) — https://www.morphllm.com/cursor-rules-best-practices
- n8n — looping / flow logic — https://docs.n8n.io/flow-logic/looping/
- Methodology frameworks to cite inside findings: OWASP Top 10, OWASP API Security Top 10, OWASP Top 10 for LLM Applications, OWASP ASVS, STRIDE, NIST SSDF (SP 800-218).
