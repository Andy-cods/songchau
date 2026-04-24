Run the test suite, find failures, and fix them.

## Reported Issues
<issue>$ARGUMENTS</issue>

## Workflow

1. **Compile**: Check for syntax errors first and fix them
2. **Test**: Use Agent tool (model: sonnet) to launch a Tester agent to run the full test suite
3. **Debug**: If failures found, use Agent tool (model: sonnet) to launch a Debugger agent to find root causes
4. **Plan**: Use Agent tool (model: opus) to launch a Planner agent to create a fix plan in `./plans/`
5. **Fix**: Implement the plan step by step
6. **Verify**: Run tests again to confirm all pass
7. **Review**: Use Agent tool (model: sonnet) to launch a Code Reviewer. Fix critical issues.
8. **Repeat** until all tests pass with no errors.
