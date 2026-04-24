Analyze logs and fix identified issues.

## Workflow

1. Use Agent tool (model: sonnet) to launch a **Debugger** agent to:
   - Read and analyze the entire `./logs.txt` file
   - Identify all errors, warnings, and potential issues
   - Determine root causes for each issue
   - Create a detailed report

2. Fix all identified problems systematically based on the report

3. Verify fixes by running appropriate commands

4. Re-analyze logs after fixes to ensure issues are resolved

## Rules
- Read the complete log file, not just recent entries
- Identify ALL errors, not just the first one
- Fix issues in dependency order
