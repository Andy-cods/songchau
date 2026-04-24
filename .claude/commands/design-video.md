Replicate a design from a video reference.

<video>$ARGUMENTS</video>

## Workflow

1. Analyze the video in detail — every element, interaction, animation, transition, color, font, spacing, texture, effect
2. Use Agent tool (model: opus) to launch a **UI/UX Designer** agent to create a plan to replicate the design exactly, with TODO tasks in `./plans/`
3. Implement the plan step by step
4. If not specified, create in pure HTML/CSS/JS
5. Report to user with summary, ask for review and approval
6. If approved, update `./docs/design-guidelines.md`

## Standards
- Faithful replication of all visual elements and animations
- Smooth transitions and micro-interactions
- Responsive and performant
- Clean, maintainable code
