# Security Policy

## Supported versions

The `main` branch is the only supported version. There are no releases yet; every
commit on `main` is expected to pass `npm run verify` and `node evals/gate.mjs`.

## Reporting a vulnerability

This repository is private. If you are working on it and find a security issue:

1. **Do not open a public issue or commit a proof of concept.**
2. Open a private security advisory on the repository (Security ▸ Advisories ▸ Report a vulnerability), or contact the maintainer directly.
3. Include: what breaks, how to reproduce it, the commit you tested, and what an attacker gains.

Please do not include real credentials, tokens, or personal data in a report. Redact them and describe where they were.

## What is in scope

- The sandbox layers (`core/sandbox/`, `core/governance/`) failing to contain an artifact.
- The static gate allowing code it should block, or blocking code it should not.
- The approval policy (`core/governance/approval.mjs`) failing to pause on network, credentials, or writes outside the workspace.
- The evolutionary loop editing a protected area (`evals/`, `core/governance/`).
- Credentials, tokens, or personal data reaching the repository or the ledger.
- Command injection through any value that originates in an artifact, a ledger entry, or a generated artifact.

## What is out of scope

- Vulnerabilities in dependencies or in the PI Coding Agent itself — report those upstream.
- Findings that require the attacker to already control the machine or the repository.
- Denial of service through the local panel: it binds to `127.0.0.1` and is a development convenience, not a hardened service.

## Security model in one page

| Boundary | What it guarantees |
|:---|:---|
| Static gate (13 rules) | credential access, network, subprocess spawning and destructive filesystem operations are blocked before execution |
| Node Permission Model | read/write confined to the worktree; no network; no child processes |
| Process containment | the full process tree is torn down when a run ends |
| Approval policy | anything that needs network, credentials, or a write outside the workspace pauses for a human, with a specific question |
| Protected areas | the evolutionary loop cannot edit `evals/` or `core/governance/` |
| Credentials | never stored in the repository; provider configuration is an example file with environment-variable placeholders |

## Hardening checklist for contributors

- [ ] `npm run verify` passes.
- [ ] Any new rule in the static gate has a test that proves it blocks and a test that proves it does not block legitimate code.
- [ ] Any new path handling uses `path.join` / `os.homedir()`, never string concatenation with a POSIX separator.
- [ ] Any new subprocess call passes an argument array, never a shell string.
- [ ] No secret, token, or absolute user path is written to a log, a ledger entry, or a report.