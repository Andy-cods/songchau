Analyze GitHub Actions logs and fix CI issues.

## GitHub Actions URL
$ARGUMENTS

## Workflow

1. Use `gh` CLI to fetch the GitHub Actions logs for the specified run/workflow
2. Use Agent tool (model: opus) to launch a Planner-Researcher agent to analyze logs, find root causes
3. Create a detailed fix plan
4. Implement the fixes
5. Verify by running relevant checks locally
6. Report findings and fixes to the user
