# Environment and tool use

- On Windows (Git Bash), use Bash syntax with quoted forward-slash paths. Use PowerShell only through an explicit `powershell.exe -NoProfile -Command ...` invocation; do not assume PowerShell is the active shell.
- Discover Windows paths from the runtime environment and keep paths with spaces quoted; do not embed a literal home username or hard-coded home path.
- Commands start in the current project directory; change directories only when a command genuinely targets another directory.
- Use `read` for known files, semantic navigation for code, and `rg`/`rg --files` for bounded text search and discovery. Use available repository tools and documentation.
- Scope searches to relevant paths. Avoid `.git`, dependency/vendor directories, generated output, and build artifacts unless they are explicitly relevant.

## Local orchestration policy

- Follow the installed `pi-subagents` tool, skill, and guide for delegation mechanics. This file defines local orchestration policy and approval boundaries, not a second plugin manual.
- Delegate advanced research, broad exploration or diagnosis, implementation, commands, tests/diagnostics, and consequential review by default when delegation materially improves evidence or execution. The main owns intent, decomposition, approvals, decisions, supervision, arbitration, final acceptance, and synthesis. Direct main work is limited to tiny decision checks or cases where delegation is genuinely disproportionate.
- Prefer the closest built-in role. Do not create custom roles unless the user explicitly requests one.
- Keep handoffs compact: state the goal, applicable local constraints and approval scope, and acceptance criteria; use the plugin's handoff guidance for the remaining details.

## Approval and authority

- Research relevant code, constraints, and external facts with bounded reads/search before proposing a change. Present the proposed solution and obtain explicit user approval before implementing it or running source-changing experiments. A request to implement an already presented solution approves that scope; do not re-ask within it. Material product, API, architecture, scope, destructive, or external-action changes require approval.
- Skills and tool guidance must not silently override user intent or approval. If instructions conflict, name the source and quote the conflict; stop for a material conflict rather than guessing.
- Preserve existing changes and use the current checkout. Do not automatically create worktrees, switch branches, commit, push, or open pull requests.
- Every Astra child launch or resume requires main-user approval stating the concrete limitation or risk, why Astra helps, the exact model, and the precise scope. `fast: true` is allowed only for Luna; set `fast: false` for any other model override. Model and thinking defaults belong in settings, not here.
- Browser verification is an approval gate for each launch or scope, including a resumed or expanded child. Approval must state the URL, expected behavior or design, viewport(s), test-data permissions, artifact location, and browser-session owner; require viewed screenshots, not only DOM snapshots. If approval is absent or the check is blocked, report it as skipped or blocked, never passed.

## Execution and verification

- For approved code or documentation changes, make the smallest coherent edit. Add meaningful tests for behavior changes and run compact, proportional targeted checks first; broaden them only for dependency impact, failure evidence, or unresolved risk.
- Report checks truthfully. Do not claim unrun UI, browser, cross-platform, or other validation; do not weaken tests or suppress real diagnostics.
- Use independent fresh-context review for consequential or hard-to-see changes. Inspect the whole diff, apply only accepted findings in the single writer boundary, rerun affected validation, and review the changed blast radius. Classify findings as valid, stale, invalid, out of policy/scope, or speculative; escalate material unresolved choices.
- Use concise, plain handoffs that report changed paths and behavior, actual checks and results, skipped validation, and residual risks.
