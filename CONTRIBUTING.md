# Contributing to NORIA

Thanks for contributing to NORIA.

## Reporting Issues

- Search existing issues before opening a new one.
- Open a bug report when you can reproduce a problem and include steps, expected behavior, actual behavior, and environment details.
- Open a feature request when you have a concrete user problem, proposed solution, and any relevant alternatives.
- Do not use public issues for security reports. Follow the process in `SECURITY.md`.

## Submitting Pull Requests

1. Fork the repository and create a focused branch for your change.
2. Keep each pull request scoped to one logical change.
3. Add or update tests when behavior changes.
4. Update documentation when interfaces, workflows, or behavior change.
5. Ensure the diff does not include secrets, credentials, or personal paths.
6. Open a pull request with a clear summary, testing notes, and linked issues where relevant.

## Commit Message Conventions

This project uses Conventional Commits.

Examples:

- `feat: add evidence aggregation endpoint`
- `fix: preserve approval gate when inbox sync fails`
- `docs: clarify Copybara release workflow`
- `chore: update lint configuration`

Recommended types:

- `feat`
- `fix`
- `docs`
- `refactor`
- `test`
- `build`
- `ci`
- `chore`

## Code Style

- Follow the existing style and structure of the files you touch.
- Prefer small, reviewable changes over broad refactors.
- Use descriptive names and keep comments concise and purposeful.
- Add tests for new behavior or regressions when practical.
- Keep Markdown clear and direct.
- Default to ASCII unless a file already requires Unicode content.
