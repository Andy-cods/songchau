Stage all changes, create a commit, and push to remote.

## Process

Use Agent tool (model: sonnet) to launch a **Git Manager** agent:

1. **Security scan**: Check for sensitive files (.env, API keys, credentials, secrets). Warn and exclude if found.
2. **Review changes**: Run `git status` and `git diff` to understand all changes
3. **Stage**: Add relevant files (exclude sensitive files)
4. **Commit**: Create a commit with conventional commit format:
   - `feat:` for new features
   - `fix:` for bug fixes
   - `refactor:` for refactoring
   - `docs:` for documentation
   - `test:` for tests
   - `chore:` for maintenance
5. Write a clear, concise commit message
6. **Push**: Push to the remote repository on the current branch

**IMPORTANT:** Confirm with user before pushing.
