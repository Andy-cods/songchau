Fix all type errors in the project.

## Process

1. Run the type checker (e.g., `bun run typecheck`, `tsc --noEmit`, `npx tsc`)
2. Analyze all type errors
3. Fix each error properly
4. Re-run type checker
5. Repeat until zero type errors

## Rules
- Do NOT use `any` type just to pass the check
- Fix the actual type issue, not suppress it
- Maintain type safety throughout
- If a type needs to be updated, update it properly with the correct type
