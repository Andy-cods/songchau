Analyze and fix the following issue quickly.

<issue>$ARGUMENTS</issue>

## Workflow

1. Read relevant code and understand the issue
2. Implement a targeted fix
3. Use Agent tool (model: sonnet) to launch a **Tester** agent to verify the fix works
4. If tests fail, analyze and fix until all tests pass
5. Report the fix to the user

## Rules
- Keep the fix minimal and focused
- Do not refactor unrelated code
- Ensure tests pass after the fix
