Stage all changes and create a commit.

## Process

Use Agent tool (model: sonnet) to launch a **Git Manager** agent:

1. **Security scan**: Check for sensitive files (.env, API keys, credentials, secrets). Warn if found.
2. **Review changes**: Run `git status` and `git diff` to understand all changes
3. **Stage**: Add relevant files (exclude sensitive files)
4. **Commit**: Create a commit with conventional commit format:
   - `feat:` for new features
   - `fix:` for bug fixes
   - `refactor:` for refactoring
   - `docs:` for documentation
   - `test:` for tests
   - `chore:` for maintenance
5. Write a clear, concise commit message describing the "why"

**IMPORTANT:** Do NOT push to remote. Only stage and commit locally.
