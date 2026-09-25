# Launch repository workflow

- The GitHub repository for this PWA is https://github.com/scottkoons/LaunchApp.
- Whenever creating a commit for this project, also push it to its GitHub upstream before reporting the work complete, unless the user explicitly asks otherwise. If the push fails, resolve the problem or clearly report that the commit remains local.
- Use `origin` for GitHub and the current branch's configured upstream. Preserve remote history; do not force-push.
- Keep API keys, local environment files, local databases, uploaded user files, dependencies, and generated deployment archives out of Git. Preserve the existing `.gitignore` exclusions.
- The live PWA is deployed through Sites using `.openai/hosting.json`. A Sites source push and a GitHub push are separate operations; publishing through Sites does not satisfy the instruction to push commits to GitHub.
- Read `CHANGELOG.md` before starting work; it records recent changes, known open issues and suggested next work. Add an entry there for each notable change.
