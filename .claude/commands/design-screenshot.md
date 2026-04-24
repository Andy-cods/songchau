Replicate a design from a screenshot.

<screenshot>$ARGUMENTS</screenshot>

## Workflow

1. Analyze the screenshot in detail — every element, color, spacing, font, layout
2. Use Agent tool (model: opus) to launch a **UI/UX Designer** agent to create a plan to replicate the design exactly, with TODO tasks in `./plans/`
3. Implement the plan step by step
4. If not specified, create in pure HTML/CSS/JS
5. Report to user with summary, ask for review and approval
6. If approved, update `./docs/design-guidelines.md`

## Standards
- Pixel-perfect replication of the screenshot
- Responsive adaptation
- Clean, semantic HTML
- Accessible and performant
