Implement the following feature using the full orchestration workflow.

<tasks>$ARGUMENTS</tasks>

## Workflow

1. **Plan Phase**: Use Agent tool (model: opus) to launch a Planner agent to research and create an implementation plan in `./plans/` directory. Read `./MASTER_CONTEXT_v2.md` first.

2. **Implement Phase**: After the plan is ready, implement the solution step by step following the plan. Follow YAGNI, KISS, DRY principles.

3. **Test Phase**: Use Agent tool (model: sonnet) to launch a Tester agent to run tests and verify the implementation works correctly.

4. **Review Phase**: Use Agent tool (model: sonnet) to launch a Code Reviewer agent to review code quality, security, and performance. Fix any critical issues found.

5. **Report**: Summarize changes to the user. Update `docs/PROGRESS.md` if applicable.

## Rules
- Read `./MASTER_CONTEXT_v2.md` for project context before starting
- Follow coding standards in the project
- Do not change tech stack or add unapproved libraries
- Ask user for architecture decisions
