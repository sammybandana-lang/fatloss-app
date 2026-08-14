# Lessons Learned — DevOps Rehearsal

Running log of engineering lessons from the fat-loss app rehearsal, captured for reuse on Phalanx. The fat-loss app was deliberately built as a low-stakes production-grade DevOps rehearsal precisely so these lessons could be surfaced before Phalanx goes live.

Format for each lesson: **what happened → the underlying lesson → how to apply it going forward.**

---

## Environment parity (dev/prod drift)

The single largest source of production incidents in this project. Every one of them boiled down to the same root cause: an environment was assumed to be in sync with another, and wasn't.

### Migrations must be automated end-to-end

- **What happened:** A feature was merged to `main`, deployment succeeded, CI green, tests passing — production returned 500 on every page load. Root cause: the `diet_entries` migration existed in the repo but had never been applied to the prod Supabase project. The page-render code queried a table that only existed in dev.
- **Lesson:** "The migration is in the repo" and "the migration is applied to prod" are two separate things. Manually running `db push` against the right project after every merge is an unreliable process — the failure mode is silent (nothing complains until users hit the missing table).
- **Apply going forward:** On Phalanx, CI must apply migrations automatically on merge to `main`. Deployment must refuse to promote if migrations are pending. Manual `db push` is a workflow for exceptional cases, not the primary path.



### Env vars must be treated as infrastructure config that drifts

- **What happened:** Same production outage — after the migration was applied, the feature still failed because the three `GMAIL_`* env vars were in local `.env.local` but had never been added to Vercel's production environment.
- **Lesson:** Every new secret added locally represents an infrastructure change that must be replicated to every environment (Preview, Production, staging, etc.). There is no automatic reminder.
- **Apply going forward:** Either (a) use a secrets manager where dev and prod pull from the same source of truth, or (b) maintain an env-var manifest in the repo that CI diffs against the deployment platform and fails if any are missing. A checklist item on every PR that adds a new env var.



### "CI passed" ≠ "production works"

- **What happened:** All 40 tests green, four local checks green, reviewer approved, CI green — and prod still 500'd on the first request. Runtime environment (schema, env vars, service configuration) is a separate concern from code correctness.
- **Lesson:** The gap between "CI passed" and "prod works" is real and needs its own check. CI validates the code artifact. It does not validate the environment the artifact runs in.
- **Apply going forward:** Add a post-deploy smoke test that hits critical prod endpoints and fails the deploy if they return errors. On Phalanx: a health check that exercises at least one query per critical table and one call per critical external integration after every deploy.



### Redeploying alone does not always re-inject env vars

- **What happened:** After adding env vars to Vercel and clicking Redeploy, the running production build still saw them as unset.
- **Lesson:** Env vars added after a deployment don't automatically apply to it. Even a redeploy sometimes needs "Use existing Build Cache" *unchecked* to fully take effect.
- **Apply going forward:** After any env var change, redeploy explicitly with build cache cleared. Verify by hitting an endpoint that reads the new var, not by trusting the "Ready" status.
- **Source cited during troubleshooting:** [https://vercel.com/kb/guide/how-to-add-vercel-environment-variables](https://vercel.com/kb/guide/how-to-add-vercel-environment-variables)

---



## CI/CD pipeline



### Billing budgets are a suspect when CI silently dies — but so are vendor outages, and correlation isn't causation

- **What happened:** For three days, CI runs were stuck at "Expected — waiting for status" with zero runs appearing in the Actions tab. A $0 Actions budget with "Stop usage: Yes" was discovered in Settings → Billing → Budgets. **We deleted the budget — no effect. We added a credit card — no effect. CI only resumed when GitHub's own Actions outage was resolved.** The original session handoff wrote the budget up as the root cause anyway, based on the plausible-sounding story that a $0 stop-usage budget *could* have caused those symptoms. Later evidence showed that story was wrong.
- **Lesson:** Two lessons here, and the second one matters more than the first:
  - **CI-silent-death has multiple plausible causes.** Billing budgets, vendor outages, workflow-file bugs — any of them can produce identical symptoms. Match your suspicion to actual evidence, not to the first plausible story.
  - **A fix that "worked" is not necessarily the fix that worked.** In this case, two fixes were applied that didn't do anything, followed by an external resolution we had nothing to do with. The natural narrative — "we did work, then it resolved, therefore our work fixed it" — is exactly wrong.
- **Apply going forward:** When CI silently dies, check *both* billing budgets *and* the vendor's status page. Note both possible causes in the incident record. If you apply a fix and the problem doesn't resolve *immediately*, that fix is not the answer — keep looking. Public repos on GitHub get free unlimited Actions minutes, so a $0 budget on a public repo is safe to delete regardless of the incident.



### Required status checks and workflow files are independent

- **What happened:** Confusion during the CI outage about why workflows were running on some PRs but not others — an assumption that a deleted "required status check" in the ruleset would prevent CI from firing.
- **Lesson:** Two separate GitHub systems, easily conflated:
  - Workflow file (`.github/workflows/*.yml`) — its `on:` trigger decides when CI **runs**.
  - Ruleset "required status check" — decides whether a green result is **mandatory to merge**.
- **Apply going forward:** When CI behavior surprises, be precise about which system you're changing. Removing a required check does not stop CI from running. Deleting a workflow file does not remove it from ruleset requirements.



### Runtime logs are different from build logs

- **What happened:** Initial investigation of the production outage looked at Vercel Deployments (which showed "Ready" — the build succeeded). The actual 500s were only visible in **Runtime Logs** for the running deployment.
- **Lesson:** Build success and runtime success are separate. "Deployment Ready" only means "the artifact built and deployed"; it says nothing about whether the running code errors on real requests.
- **Apply going forward:** When investigating a production issue, go straight to runtime logs. Filter by production hostname, not preview hostnames. Build logs are secondary until runtime is understood.

---



## Git hygiene



### Never push directly to `main`

- **What happened:** Attempting to push an empty commit directly to `main` was correctly blocked by the branch ruleset. The commit was left orphaned on local `main`, which polluted subsequent feature branches with a stray commit until cleaned up.
- **Lesson:** Local `main` should always mirror `origin/main`. Any commit intended for `main` goes through a PR. The ruleset enforces this at push time — but if a commit is made locally to `main` and then rejected on push, it still sits on local `main` and needs cleanup.
- **Apply going forward:** Feature work always starts with `git checkout -b <branch>` from clean `main`. If a rejected local commit exists, `git reset --hard origin/main` clears it before starting new work.



### `git rebase --onto` cleanly drops unwanted commits from history

- **What happened:** An empty commit was accidentally on both local `main` and a feature branch. Rebasing the feature branch with `git rebase --onto origin/main <bad-commit>` moved the branch cleanly onto real `main` without the empty commit.
- **Lesson:** `--onto` lets you replay commits onto a chosen base while excluding an intermediate commit. Non-obvious but powerful.
- **Apply going forward:** For history repair before pushing, prefer `--onto` to interactive rebase (which opens Vim and has caused past problems).
- **Source cited during troubleshooting:** [https://git-scm.com/docs/git-rebase](https://git-scm.com/docs/git-rebase)



### Batch remote branch deletes are not atomic

- **What happened:** `git push origin --delete <13 branches>` — three of the names were phantom refs (already deleted server-side), causing the entire push to fail. Zero of the ten real deletes went through.
- **Lesson:** When a batched git push contains any invalid ref, the whole push can abort. Behavior is inconsistent across git versions and not documented as reliably atomic.
- **Apply going forward:** Before batch-deleting, run `git fetch --prune` first to sync tracking refs with the remote reality. Or delete in smaller batches. Or accept the "some failed, retry the rest" pattern.



### Enable "auto-delete branch on merge"

- **What happened:** 13 stale merged branches had accumulated on GitHub over the project's lifetime. Cleanup took a full round of coordinated deletes.
- **Lesson:** GitHub's default doesn't auto-delete merged branches; they pile up until someone cleans them.
- **Apply going forward:** Enable the "Automatically delete head branches" setting in repo Settings → General. From that point, every merge auto-cleans its own branch.



### Avoid Vim for commit messages

- **What happened:** `git revert` and `git commit` (without `-m`) opened Vim for the commit message on Windows, which caused tangled sessions and a leftover `.COMMIT_EDITMSG.swp` file that needed manual cleanup.
- **Lesson:** Vim is the default editor and requires knowledge (`Esc`, `:wq`) that isn't obvious.
- **Apply going forward:** Always use `git commit -m "message"` and `git revert -m 1 --no-edit <sha>` to avoid the editor. Or configure `core.editor` to something else.

---



## Supabase CLI / database operations



### The CLI link target is the single most dangerous variable

- **What happened:** The CLI was found linked to prod during development on multiple occasions. A stray `supabase db push` would have hit production.
- **Lesson:** `supabase db push` operates on whatever project the CLI is currently linked to. The link persists between commands and sessions. There is no confirmation prompt showing which project you're about to affect.
- **Apply going forward:** **Always run** `supabase projects list` **before any** `db` **command.** Confirm the ● is where you expect. After any intentional prod push, immediately relink to dev and verify. Add this to any team runbook.



### Verify the applied migration list before pushing to production

- **What happened:** No incident, but worth noting: `db push` compares local migrations to the linked project's ledger and applies whatever's missing. When pushing to prod, it must list *only* the migrations you expect.
- **Lesson:** If the diff shows more migrations than you expected, stop. Something is out of sync between environments and blindly pushing could apply schemas that were never meant for prod.
- **Apply going forward:** Read the migration list in `db push`'s prompt every time. Cancel if it doesn't match expectations.

---



## Security review discipline



### Substring matching on headers is bypassable

- **What happened:** The first version of the Gmail sender-verification check used `from.includes("donotreply@loseit.com")`. This is bypassable via display-name spoofing — a From header like `"donotreply@loseit.com" <attacker@evil.com>` has the trusted string in the display name (attacker-controlled free text), so `.includes()` matches while the real address is attacker's.
- **Lesson:** For sender/identity checks, extract the actual structured field and compare with **exact equality**, never substring match. Real-world attackers exploit exactly this pattern.
- **Apply going forward:** For any identity check on a structured value (email address, domain, sender ID, token subject): parse to the actual field, exact-match. Substring matching is the anti-pattern.
- **Source cited during review:** [https://en.wikipedia.org/wiki/Email_address](https://en.wikipedia.org/wiki/Email_address) (RFC 5322 display-name format and spoofing)



### RLS presence ≠ RLS enforcement

- **What happened:** During review of `diet_entries` schema, verified that RLS was not just enabled but that INSERT, UPDATE, SELECT, DELETE policies all enforced `user_id = auth.uid()`. UPDATE especially requires both `using` (which rows are visible to update) and `with check` (what the row is allowed to become).
- **Lesson:** From the security-reviewer role's own words: "owner_id present is not owner_id enforced." Enabling RLS alone denies everything by default; the policies define what's actually allowed. UPDATE without `with check` allows a row to change ownership silently.
- **Apply going forward:** For every table with RLS, verify all four CRUD paths have policies. UPDATE policies need both `using` and `with check`. Test isolation with a two-user integration test.



### Verify against docs, not "empirical verification"

- **What happened:** Cursor claimed a PapaParse behavior was "verified empirically." The claim happened to be correct — but empirical verification against test fixtures doesn't cover edge cases (empty lines, unusual delimiters). Confirmed against official docs before accepting.
- **Lesson:** "It worked in my test" is not the same as "the documented behavior guarantees this." AI code-generation tools frequently make empirical claims when documentation exists.
- **Apply going forward:** For any non-obvious library behavior AI code depends on, cite the actual docs. Especially for security-critical code. This aligns with the project's citation discipline.



### Independent adversarial review works — but the reviewer must attack, not agree

- **What happened:** Multiple security findings were caught by acting as an independent reviewer against Cursor's output, before merge. The `.includes()` bypass and the missing null-check paths would have shipped otherwise.
- **Lesson:** The value of separating "generator" and "reviewer" roles isn't the second opinion — it's the separation of duties. The party that wrote the code is the wrong party to certify it can't be broken.
- **Apply going forward:** On Phalanx, formalize this: architect and security-reviewer as separate personas, run adversarially per the review-loop pattern. Reviewer's job is to find the exploit path, not to agree.

---



## AI-assisted development discipline



### AI-generated constraints are often invented

- **What happened:** Cursor claimed it was "not permitted to touch `vitest.config.mts`" as justification for using inconsistent relative imports. That rule was never given. Cursor invented the constraint to rationalize a design choice.
- **Lesson:** AI tools sometimes fabricate constraints that let them avoid harder work. Read AI justifications skeptically — especially when they explain why a *worse* choice was made.
- **Apply going forward:** When AI says "I can't do X because Y" — verify Y is real. Especially when Y sounds like a rule you didn't set.



### Trust but verify — every claim, every time

- **What happened:** Cursor consistently produced good code but also consistently made claims that needed checking. The `.includes()` sender bug was in code Cursor described as "security gate."
- **Lesson:** AI-generated code quality is genuinely improving, but reviewer discipline must not weaken with it. Claims like "I checked" and "I verified" are hypotheses to test, not facts.
- **Apply going forward:** Read the code, don't just read the summary. Especially at trust boundaries.



### AI tends toward inconsistency more than verbosity

- **What happened:** Repeated small deviations — different import styles, different error message formats, different variable naming conventions between files that should have matched.
- **Lesson:** Contrary to intuition, AI code isn't especially verbose; it's inconsistent. Every new file becomes its own island unless the prompt actively enforces consistency with existing code.
- **Apply going forward:** Reference existing files in every spec ("match the pattern in `hevy-actions.ts`"). Review specifically for consistency, not just correctness.



### Cursor writes to `main` by default

- **What happened:** Cursor's default behavior places its changes on whatever branch happens to be checked out, which is `main` if you haven't branched first.
- **Lesson:** The IDE agent has no awareness of Git workflow — it just edits files where the terminal points.
- **Apply going forward:** Every session begins with `git checkout -b <branch>` before invoking the agent. Verify with `git branch --show-current`.



### User-provided ground truth must be diffed field-by-field, not pattern-matched

- **What happened:** During the Azure OpenAI endpoint debugging (see the "two endpoint families" lesson below), the user pasted the exact working target URI from the Foundry portal 10+ messages before the root cause was found. Claude compared it to the URL the code was constructing by skimming — anchored on the api-version segment (one visible difference) and missed that the hostname was entirely different (`services.ai.azure.com/models` vs `cognitiveservices.azure.com`). Claude then cited a Microsoft Q&A source that supported the wrong api-version hypothesis, which made the wrong story feel more grounded. Root cause was found ~1 hour later via a direct HTTP bypass test that surfaced the malformed URL immediately.
- **Lesson:** When an AI assistant has confirmation bias, grounded citations amplify it rather than counteract it — the source is only as good as the hypothesis it's applied to. "The user gave me the answer and I missed it because I was already looking at something else" is a specific failure mode of AI assistants with long chat histories. It cannot be fixed by asking the assistant to be more careful; it must be structural, encoded as reviewable rules the assistant can be pointed at in future sessions.
- **Apply going forward:** Enforcement lives in `CLAUDE.md` under "Working with Claude — mandatory verification rules." If Claude slips, point Claude at the specific rule number. Do not rely on Claude self-correcting from generic instruction.

---



## Testing discipline



### Unit tests with mocked externals prove less than they seem to

- **What happened:** The parser had 5 unit tests, all passing. Real LoseIt CSVs broke on the first live click because they mix food and exercise row shapes — a real-world quirk absent from the synthetic test data.
- **Lesson:** Mocked tests prove the code handles the shapes you gave the mocks. Real data is always weirder than the mocks. Unit tests are necessary but not sufficient.
- **Apply going forward:** For every parser, ingestion action, or format-handling piece of code: include at least one test fixture that contains **real production bytes** (redacted if needed). Not hand-crafted samples of what the real data probably looks like — actual bytes from an actual source.



### Live test in dev before merging, always

- **What happened:** Pushback on merging without a dev test caught the Exercise-row parser bug. Without that pushback, the bug would have hit prod (and did, briefly, until we rolled back).
- **Lesson:** "The tests pass" is not the same as "I clicked the button and watched it work." Every user-facing feature needs at least one live click-through in dev before merging.
- **Apply going forward:** Institutionalize "click-through-in-dev" as a required step. On Phalanx, this may be a preview-environment smoke test rather than localhost.



### Run the four checks locally even when CI works

- **What happened:** Local `tsc`, `lint`, `build`, and `test` before every push saved multiple round-trips to CI. Feedback loop is ~5 seconds locally vs ~45 seconds on CI.
- **Lesson:** CI is a backstop, not the primary check. The 45-second cost adds up; more importantly, it's noise in the reviewer's inbox when it fails.
- **Apply going forward:** Local checks are non-negotiable before any push. `npm run typecheck && npm run lint && npm run build && npm test`. Or automate as a pre-push git hook.



### The `test` output is untrusted output

- **What happened:** Third-party test tools (vestauth, dotenvx) inserted advertising strings into Vitest's output. Not harmful, but attention-hijacking.
- **Lesson:** Every piece of output in a build pipeline is a place where noise can hide signal. Ad-injection in dev tools is a real pattern now.
- **Apply going forward:** Watch for unexpected messages in tool output. Report and remove tools that inject content that isn't theirs to inject.

---



## Incident response



### Rollback first, diagnose second

- **What happened:** Production 500'd. First action was to promote the previous known-good deployment (~1 minute to restore service). Diagnosis happened after service was back.
- **Lesson:** Restoring service and finding the root cause are separate priorities. Service restoration wins on time. Diagnosis wins on preventing recurrence.
- **Apply going forward:** Practice rollback until it's muscle memory. On Phalanx, the runbook's first step for any prod alert is: promote previous deployment. Then investigate.



### Vercel's manual promotion is a sticky override

- **What happened:** After rolling back and later un-sticking (via a fresh un-cached redeploy), auto-deploy on main-push behavior was restored. But had that step been missed, the next merged PR would have built successfully but never appeared in production.
- **Lesson:** Manual production promotion in Vercel pauses auto-deploy. Auto-deploy resumes when you either promote a newer deployment or explicitly re-enable auto-deploy in project settings.
- **Apply going forward:** After any rollback, un-stick auto-deploy before the next PR merges. Otherwise the next deployment silently fails to reach production.



### Root cause attribution requires evidence, not correlation

- **What happened:** During the three-day CI outage, we discovered a $0 Actions budget, deleted it, added a credit card, and eventually CI came back. The session handoff wrote up the budget as the root cause. **In fact, the budget deletion had no effect, the credit card addition had no effect, and CI only came back when GitHub's own Actions outage was resolved externally.** The handoff was wrong. Someone reading that handoff would have carried forward a false lesson about billing budgets and never learned to check vendor status pages first.
- **Lesson:** "We changed X, then the problem went away" is correlation, not causation. In distributed systems especially, multiple things can go wrong simultaneously; the fix and the resolution can be unrelated. Writing up a plausible-sounding story as "the root cause" without isolating the variable pollutes the historical record and misleads future troubleshooting. This is one of the most common forms of dishonesty in engineering writeups — usually unintentional, always harmful.
- **Apply going forward:** When writing up an incident, distinguish carefully between:
  - **Confirmed:** the fix mechanistically explains the symptom AND applying it resolved the symptom immediately (e.g., "the sender check used `.includes()`, exploit is reproducible in a test, fixed the check, exploit test now fails").
  - **Plausible:** the fix could explain the symptom, but you didn't isolate it or the timing is ambiguous.
  - **Coincidental:** the fix and the resolution happened at the same time but no mechanism connects them, or the fix had no observable effect at all.
  Never write a "plausible" or "coincidental" fix up as "confirmed." When in doubt, write down both what you did and what happened externally at the same time.



### Runtime logs beat guessing

- **What happened:** Multiple diagnostic hypotheses ("cache issue," "browser problem," "CDN staleness") were speculated before the real cause (missing DB table, missing env vars) was found in the runtime logs.
- **Lesson:** Speculation is fast and cheap. Logs are slower but definitive. Get to the logs first, before formulating hypotheses.
- **Apply going forward:** When something breaks in prod, the first click is to runtime logs, not to StackOverflow.

---



## Architecture / multi-tenant patterns



### RLS at the identity level is the transferable seam

- **What happened:** The fat-loss app uses per-user RLS on every table (`user_id`). Phalanx will use per-account/company RLS. The mechanism is identical; the isolation boundary is what changes.
- **Lesson:** Row-Level Security at the DB layer, keyed to whatever "tenant" means in your domain, is the seam that survives every application-layer change.
- **Apply going forward:** On Phalanx, RLS at `account_id` (or equivalent). Every table has it. Every policy covers all four CRUD paths. Every table's isolation is proven by a two-tenant integration test.



### Ports/adapters for every external dependency

- **What happened:** The Gmail client, Hevy client, and (implicitly) the Supabase client all live behind their own interface. Swapping a provider is a new adapter, not a rewrite.
- **Lesson:** Every external system is behind one interface at the application boundary. Field mappings and quirks live inside the adapter. The rest of the code stays clean.
- **Apply going forward:** For Phalanx's freight-carrier integrations, this is the seam that matters most. Each carrier is one adapter; adding a new carrier is not a refactor.



### `output.data` shape may not match DB columns exactly

- **What happened:** A subtle risk during the ingestion action was that the parser's output row shape could have diverged from the `diet_entries` column names — Cursor claimed to have verified but the test mocked the parser, so a real mismatch wouldn't be caught by unit tests. Live testing confirmed it worked; but the safer path is to make the mismatch loud.
- **Lesson:** Parser output shapes and DB schema are two independently-changing things. Mocked tests won't catch drift.
- **Apply going forward:** Add a type or runtime check that asserts parser output rows match DB column names. Or use a shared type derived from the schema.

---



## Process discipline



### Verify before trusting a summary

- **What happened:** Reading handoff notes and prior-session summaries multiple times caught claims that no longer matched reality (e.g., "migration applied to both dev and prod" — it wasn't).
- **Lesson:** Written summaries decay. What was true when written may not be true now.
- **Apply going forward:** Before acting on any handoff claim about system state, verify against the actual system. Especially for infrastructure claims that could differ silently.



### Scope discipline — feature vs infra

- **What happened:** Infrastructure work (CI, ruleset, rebase, cleanup) can easily crowd out feature work. Each session needs a stated focus and a deliberate close-out.
- **Lesson:** Infrastructure and features are both real work, but they compete for the same attention. Without discipline, infra always wins because it feels urgent.
- **Apply going forward:** Every session has a primary goal. Infrastructure work is scheduled explicitly, not accreted opportunistically. Close threads cleanly.



### AI-assisted work needs a deliberate "human as gate" moment

- **What happened:** The strongest catches this session came from moments where a human decision was inserted — "let me test in dev first," "let me see the code, not the summary," "let me check the docs before accepting the claim."
- **Lesson:** AI-assisted development can generate correct code faster than human review can catch errors. The pace pulls toward "accept and move on." A gate is a moment where you deliberately don't.
- **Apply going forward:** Every non-trivial AI-generated change gets a human gate before it moves forward. Security-relevant changes get a stricter gate (paste the code, review manually).

---



## Vendor / third-party quirks



### GitHub Actions can go down; subscribe to the status page

- **What happened:** During this session, GitHub Actions was in a "Major Outage" affecting webhook triggers and runner acquisition. Symptoms exactly mimicked a workflow-file bug.
- **Lesson:** When CI is behaving oddly, check [https://www.githubstatus.com/](https://www.githubstatus.com/) before assuming your workflow is broken.
- **Apply going forward:** Subscribe to GitHub, Vercel, Supabase, and any other critical vendor status pages. Bookmarks aren't enough — subscriptions notify.



### Hevy weight precision

- **What happened:** Hevy's API returns `weight_kg` with 15-decimal precision because users log in lbs and Hevy converts.
- **Lesson:** External API precision is not always sensible; round on display.
- **Apply going forward:** For any external numeric field, decide display precision explicitly. Never trust the source's precision to be right.



### LoseIt CSV quirks

- **What happened:** Real LoseIt CSVs contain: `"n/a"` in place of missing macro values (must parse as null), MM/DD/YYYY dates (must convert), CRLF line endings, quoted values with internal commas (`"Bread, 21 Whole Grains And Seeds"`), and mixed row shapes (16-field food rows vs 8-field exercise rows).
- **Lesson:** Every real data source has more quirks than the docs describe. Discover them via real bytes, not synthetic test data.
- **Apply going forward:** For every external data source in Phalanx, maintain a fixture of real (redacted) bytes as the canonical test input.



### Azure AI Services resources expose two endpoint families on the same resource

- **What happened:** During the AI-assessment slice, wiring up the Azure OpenAI adapter, calls returned `404 Resource not found` even though the resource, deployment (`gpt-4o`), and API key were all correct. `AZURE_OPENAI_ENDPOINT` had been copied from Azure Portal's "Keys and Endpoint" page, which showed `https://revvitt-openai.services.ai.azure.com/models`. The OpenAI SDK's `AzureOpenAI` class appended `/openai/deployments/...` to that, producing the malformed URL `https://revvitt-openai.services.ai.azure.com/modelsopenai/deployments/gpt-4o/chat/completions?api-version=...`, which 404'd. The correct endpoint is `https://revvitt-openai.cognitiveservices.azure.com/` (no `/models`), visible only in the Foundry portal's per-deployment Target URI.
- **Lesson:** Azure AI Services (AIServices / Foundry) resources expose multiple API surfaces on the same physical resource — an AI Inference API at `.services.ai.azure.com/models` and an Azure OpenAI API at `.cognitiveservices.azure.com/`. The Portal's Keys and Endpoint page defaults to the wrong one for OpenAI SDK usage. Unit tests didn't catch this because they mocked the SDK; the live smoke test caught it because it made a real call — another instance of "Unit tests with mocked externals prove less than they seem to." A direct `Invoke-RestMethod` bypass test surfaced the malformed URL in seconds after two SDK-layer debugging attempts (api-version, cache clearing) went nowhere. When a client library is behaving mysteriously, going one layer below it to a raw HTTP call is often the fastest path to root cause.
- **Apply going forward:** For Azure OpenAI adapters, always get the endpoint from the Foundry portal's model deployment page → Target URI, not from the Portal's Keys and Endpoint. Strip everything from the path onward — keep only `https://<resource>.cognitiveservices.azure.com/`. If the endpoint contains `/models`, it's wrong for the OpenAI SDK. On Phalanx, if Azure OpenAI is used, the env-var manifest for the project should document which endpoint family is correct next to the variable.

---



## What we would build differently at Phalanx from day one

Reading back over this document, a few themes emerge that are worth building into Phalanx from the beginning, not bolted on later:

1. **Migrations are part of the CI/CD pipeline, not a manual step.** CI applies pending migrations to prod on merge to `main`, and refuses to deploy if migrations fail. No `db push` from a developer machine to prod, ever.
2. **Env var and secrets management is centralized and diffable.** A manifest in the repo describes what secrets each environment needs; CI diffs the manifest against Vercel/Supabase and fails on drift.
3. **Post-deploy smoke tests are mandatory.** Every deploy exercises critical paths before being considered "successful."
4. **RLS is verified with two-tenant tests on every table.** Not just enabled — actively proven to isolate.
5. **The evaluator-optimizer review loop is formalized.** Architect and security-reviewer are separate personas with separate models; findings are grounded in cited sources; the human sits on the final gate.
6. **Real-data fixtures are the default, not the exception.** Every external integration has a redacted sample of real production bytes as its canonical test fixture.
7. **Every session with an AI agent begins with** `git checkout -b`**.** No exceptions.
8. **The status page for every critical vendor is subscribed to.** GitHub, Vercel, Supabase, and every carrier or partner API on Phalanx.
9. **Rollback is muscle memory.** Practice it regularly, not just when the alarm sounds.
10. **The reviewer pool is resilient — 2–3 reviewers plus an audited break-glass path.** Not admin bypass.

## Security review must question the stack, not just the code

### The reviewer accepted the architect's stack as a fixed constraint

- **What happened:** The architect-reviewer subagent loop ran two full iterations reviewing the fatloss-app architecture. Both passes approved the stack — Vercel, [trigger.dev](http://trigger.dev), Supabase — without questioning whether secrets should reside on those platforms at all. The `service_role` key (which bypasses all RLS) was pasted into three independent dashboards (Vercel, [trigger.dev](http://trigger.dev), `.env.local`) with no centralized rotation and no audit trail. Neither subagent flagged this. Crown jewel #5 (credential/secret security) received a `no_reachable_path` verdict both times.

- **Lesson:** The reviewer attacked the code deployed *to* Vercel without attacking Vercel as a dependency. Both subagents shared the assumption that the stack was given and reviewed within it — "are secrets out of the client bundle?" rather than "should these secrets exist on this platform?" This is the convergence failure the handoff document warns about: the reviewer drifted toward the architect's framing instead of maintaining independence. No best-in-class SaaS company (Stripe, Atlassian, HubSpot, Shopify) distributes secrets across third-party convenience platforms — they own their cloud accounts and use managed identity. The subagents had no reference frame for that because they were reasoning from OWASP/STRIDE frameworks alone, not from how commercial SaaS companies actually build.

- **Apply going forward:** Three structural changes were made: (1) a new `SAAS_REFERENCE_CATALOG.md` grounds both subagents in real commercial SaaS practice with citable sources, (2) the security reviewer's workflow now starts with a "Stack / Platform Review" step that questions every tool choice before running STRIDE, and (3) the handoff document's anti-convergence guardrails were expanded from five to six, adding "every proposed platform is an attack surface, not a fixed constraint." Azure was established as the default platform for Phalanx based on the existing relationship via Azure OpenAI.

---

*This document is a living log. Every future outage or near-miss adds a lesson. The point isn't to look back; it's to make the next system fail differently, or not at all.*