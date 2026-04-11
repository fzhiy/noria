# Contributing to NORIA

Thank you for your interest in NORIA! We welcome contributions that improve the framework.

## How to Contribute

1. **Fork** the repository and create a feature branch
2. Make your changes following the conventions below
3. Run `npx tsx tools/kb-lint.ts` to verify wiki health
4. Submit a Pull Request with a clear description

## Conventions

- **Language**: TypeScript for new tools (unless Python-only dependencies required)
- **Filenames**: kebab-case (e.g., `kb-new-tool.ts`)
- **Skills**: One `.md` file per command in `.claude/commands/`
- **Provenance**: Every wiki claim must cite `[source: citekey, location]`
- **No fabricated citations**: Mark uncertain claims with `[UNVERIFIED]`

## Reporting Issues

Open a GitHub Issue with:
- Steps to reproduce
- Expected vs actual behavior
- Environment details (OS, Node.js version, Claude Code version)

## License

By contributing, you agree that your contributions will be licensed under the MIT License.
