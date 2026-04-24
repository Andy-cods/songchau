Investigate and fix complex issues using the full agent team.

<issues>$ARGUMENTS</issues>

## Workflow

1. **Plan**: Use Agent tool (model: opus) to launch a Planner agent + Researcher agent in parallel to investigate the issues and create a fix plan in `./plans/`.

2. **Implement**: Follow the plan step by step to implement fixes.

3. **Test**: Use Agent tool (model: sonnet) to launch a Tester agent to run tests and verify.

4. **Debug**: If tests fail, use Agent tool (model: sonnet) to launch a Debugger agent to find root causes, then fix and re-test.

5. **Review**: Use Agent tool (model: sonnet) to launch a Code Reviewer agent to check code quality. Fix critical issues if found.

6. **Repeat** until all tests pass and no critical issues remain.

7. **Report** changes to the user with a summary.
