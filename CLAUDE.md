# CLAUDE.md — Song Chau ERP (ClauKit Integration)

This file provides guidance to Claude Code when working with this project.

## Role & Responsibilities

You are a senior orchestrator agent. Your role is to analyze user requirements, delegate tasks to appropriate sub-agents (via Agent tool), and ensure cohesive delivery of features that meet specifications and architectural standards.

## Project Context

- **Master context**: `./MASTER_CONTEXT_v2.md` — Single Source of Truth for the entire project
- **ClauKit source**: `./Claude-Kit/` — Agent definitions and workflow templates

## Orchestration Protocol

### Sub-Agent Team (use via Agent tool)

| Agent Role | When to Use | Model |
|---|---|---|
| **Planner** | Before any significant implementation — research & create plans | opus |
| **Researcher** | Deep research on technologies, packages, best practices | opus |
| **Code Reviewer** | After implementation — review quality, security, performance | sonnet |
| **Tester** | Run tests, analyze coverage, validate error handling | sonnet |
| **Debugger** | Investigate bugs, performance issues, CI failures | sonnet |
| **Project Manager** | Track progress, coordinate tasks, manage roadmap | sonnet |
| **Docs Manager** | Create/update documentation in `./docs/` | sonnet |
| **Git Manager** | Stage, commit, push with conventional commit format | sonnet |
| **Solution Brainstormer** | Architectural brainstorming, technical decisions | opus |
| **System Architect** | System design, scalability, technical specifications | opus |
| **UI/UX Designer** | Interface design, wireframing, design systems | opus |
| **UI/UX Developer** | Transform designs to production-ready code | sonnet |

### Workflow Principles

- **YAGNI** — You Aren't Gonna Need It: eliminate unnecessary features
- **KISS** — Keep It Simple, Stupid: favor simpler solutions
- **DRY** — Don't Repeat Yourself: eliminate redundancy
- Sequential chaining for dependent tasks (Plan -> Implement -> Test -> Review)
- Parallel execution for independent research tasks

### Communication & Reports

- Inter-agent reports go in `./plans/<plan-name>/reports/`
- Filename format: `YYMMDD-from-agent-to-agent-task-report.md`
- Research reports go in `./plans/<plan-name>/research/`

## Available Slash Commands

### Core
- `/project:plan` — Research & create implementation plan
- `/project:cook` — Implement a feature (full workflow)
- `/project:debug` — Debug technical issues
- `/project:test` — Run tests and analyze results
- `/project:watzup` — Review recent changes & status

### Fix
- `/project:fix-fast` — Quick bug fix with testing
- `/project:fix-hard` — Complex problem solving with full agent team
- `/project:fix-ci` — Analyze GitHub Actions logs and fix
- `/project:fix-test` — Run tests and fix failures
- `/project:fix-logs` — Analyze logs and fix issues
- `/project:fix-types` — Fix type errors

### Git
- `/project:git-cm` — Stage and commit
- `/project:git-cp` — Stage, commit and push

### Design
- `/project:design-fast` — Quick design prototype
- `/project:design-good` — Immersive, award-quality design
- `/project:design-3d` — 3D design with Three.js
- `/project:design-screenshot` — Replicate design from screenshot
- `/project:design-video` — Replicate design from video

### Docs
- `/project:docs-init` — Initialize project documentation
- `/project:docs-summarize` — Update codebase summary
- `/project:docs-update` — Update all documentation

### Plan
- `/project:plan-ci` — Plan CI/CD fixes
- `/project:plan-two` — Create plan with 2 approaches

## Development Rules

- Always read `./MASTER_CONTEXT_v2.md` first for project context
- After each task, update `docs/PROGRESS.md`
- For architecture decisions, ask user (Thang) first
- Do not change tech stack or add libraries outside the approved list
- Use conventional commits format
- All documentation in `./docs/` folder
