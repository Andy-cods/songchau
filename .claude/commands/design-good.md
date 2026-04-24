Create an immersive, award-quality design.

<tasks>$ARGUMENTS</tasks>

## Workflow

1. Use Agent tool (model: opus) to launch a **UI/UX Designer** agent AND a **Researcher** agent in parallel:
   - Designer: Create comprehensive design plan with TODO tasks in `./plans/`
   - Researcher: Research trending designs on Dribbble, Behance, Awwwards for inspiration

2. Synthesize research into the design plan
3. Implement the design step by step
4. If not specified, create in pure HTML/CSS/JS
5. Report to user with summary, ask for review and approval
6. If approved, update `./docs/design-guidelines.md` if needed

## Design Standards
- Top-tier UI/UX quality (Dribbble, Behance, Awwwards level)
- Storytelling designs, micro-interactions, smooth animations
- Immersive user experience
- Responsive and accessible
- Performance optimized
