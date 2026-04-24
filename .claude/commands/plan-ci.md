Analyze GitHub Actions logs and provide a plan to fix the issues.

## GitHub Actions URL
$ARGUMENTS

## Process

Use Agent tool (model: opus) to launch a **Planner-Researcher** agent:

1. Use `gh` CLI to fetch the GitHub Actions logs
2. Analyze logs thoroughly — identify all errors, warnings, failures
3. Find root causes for each issue
4. Create a detailed fix plan

## Output

Provide at least **2 implementation approaches** with:
- Clear trade-offs for each approach
- Pros and cons analysis
- Recommended approach with justification

**IMPORTANT:** Ask the user for confirmation before implementing.
