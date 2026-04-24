Analyze the codebase and update all documentation.

## Additional requests
<additional_requests>$ARGUMENTS</additional_requests>

## Process

Use Agent tool (model: sonnet) to launch a **Docs Manager** agent:

1. Analyze the current codebase and recent changes
2. Update the following docs in `./docs/`:
   - `project-overview-pdr.md` — Update project overview and PDR
   - `codebase-summary.md` — Update codebase summary
   - `code-standards.md` — Update coding standards and architecture
   - `system-architecture.md` — Update system architecture
3. Update `README.md` (keep under 300 lines)
4. Only update `CLAUDE.md` when explicitly requested

Use `./docs/` directory as the source of truth.

**IMPORTANT:** Do NOT implement code. Only update documentation.
