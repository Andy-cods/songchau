Analyze the codebase and create initial documentation.

## Process

Use Agent tool (model: sonnet) to launch a **Docs Manager** agent:

1. Analyze the entire codebase structure
2. Read `./MASTER_CONTEXT_v2.md` for project context
3. Create the following docs in `./docs/`:
   - `project-overview-pdr.md` — Project overview and Product Development Requirements
   - `codebase-summary.md` — Codebase summary and structure
   - `code-standards.md` — Coding standards, architecture, and conventions
   - `system-architecture.md` — System architecture documentation

4. Use `./docs/` directory as the source of truth for documentation

**IMPORTANT:** Do NOT implement code. Only create documentation.
