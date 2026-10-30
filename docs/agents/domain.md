# Domain Docs

How the engineering skills should consume this repo's domain documentation when exploring the codebase.

## Before exploring, read these

- **`docs/internals/glossary.md`**: the single shared glossary for the whole monorepo.
- **`docs/internals/overview.md`**, plus any other `docs/internals/*.md` page that touches the area you're about to work in. These hold the repo's architectural decisions and cross-component constraints; treat them as this repo's ADRs.

There is no root `GLOSSARY.md`, `GLOSSARY-MAP.md`, or `docs/adr/`, and none should be created. `/domain-modeling` adds terms to `docs/internals/glossary.md` and records decisions in the relevant `docs/internals/` page, following the Documentation rules in `AGENTS.md`.

## Use the glossary's vocabulary

When your output names a domain concept (in an issue title, a refactor proposal, a hypothesis, a test name), use the term as defined in the glossary and in the `AGENTS.md` glossary section. Don't drift to synonyms.

If the concept you need isn't in the glossary yet, either you're inventing language the project doesn't use (reconsider) or there's a real gap (note it for `/domain-modeling`).

## Flag decision conflicts

If your output contradicts a decision recorded in `docs/internals/`, surface it explicitly rather than silently overriding:

> _Contradicts `docs/internals/overview.md` (orchestration stays pure), but worth reopening because…_
