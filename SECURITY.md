# Security Policy

## Supported versions

The `main` branch is the only supported version. Every commit on it is expected
to pass `npm run verify` and `node evals/gate.mjs`.

## Reporting a vulnerability

Report security issues **privately**, not in a public issue:

1. Use GitHub's private vulnerability reporting (Security ▸ Advisories ▸ Report a
   vulnerability), or contact the maintainer directly.
2. Do not open a public issue or commit a proof of concept before a fix exists.
3. Include: what breaks, how to reproduce it, the commit tested, and what an
   attacker gains.

Please do not include real credentials, tokens, or personal data in a report.
Redact them and describe where they were.

## What is in scope

- The sandbox layers (`core/sandbox/`, `core/governance/`) failing to contain an artifact.
- The static gate allowing code it should block, or blocking legitimate code it should not.
- The approval policy (`core/governance/approval.mjs`) failing to pause on network,
  credentials, or writes outside the workspace.
- The evolutionary loop editing a protected area (`evals/`, `core/governance/`).
- Credentials, tokens, or personal data reaching the repository or the ledger.
- Command injection through any value originating in an artifact, a ledger entry,
  or generated code.

## What is out of scope

- Vulnerabilities in the PI Coding Agent itself — report those upstream.
- Findings that require the attacker to already control the machine or the repository.

## Security model in one page

| Boundary | What it guarantees |
|:---|:---|
| Static gate (13 rules) | credential access, network, subprocess spawning and destructive filesystem operations are blocked before execution |
| Node Permission Model | read/write confined to the worktree; no network; no child processes |
| Process containment | the full process tree is torn down when a run ends |
| Approval policy | anything needing network, credentials or a write outside the workspace pauses for a human, with a specific question |
| Protected areas | the evolutionary loop cannot edit `evals/` or `core/governance/` |
| Credentials | never stored in the repository; provider configuration is an example file with environment-variable placeholders |

No provider or API key ships with the release. Users configure their own
providers locally, through `node scripts/providers-setup.mjs` or
`/providers discover <url> [ENV]`.

## Hardening checklist for contributors

- [ ] `npm run verify` passes.
- [ ] Any new static-gate rule has a test proving it blocks and a test proving it does not block legitimate code.
- [ ] New path handling uses `path.join` / `os.homedir()`, never string concatenation with a POSIX separator.
- [ ] New subprocess calls pass an argument array, never a shell string.
- [ ] No secret, token, or absolute user path is written to a log, ledger entry, or report.
