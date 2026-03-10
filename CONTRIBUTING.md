# Contributing to Vesta

Thanks for your interest in contributing to Vesta! This guide will help you get started.

## Code of Conduct

This project follows the [Contributor Covenant Code of Conduct](CODE_OF_CONDUCT.md). By participating, you agree to uphold this code.

---

## How to Contribute

### Report a Bug

Found something broken? [Open a bug report](../../issues/new?template=bug_report.md) with:
- Steps to reproduce
- Expected vs actual behavior
- Your device, OS, and model file

### Suggest a Feature

Have an idea? [Open a feature request](../../issues/new?template=feature_request.md). Describe the problem you're solving and your proposed approach.

### Submit a Pull Request

1. **Open an issue first** for non-trivial changes. This saves everyone time.
2. Fork the repo and create a branch from `main`.
3. Make your changes, keeping PRs focused and small.
4. Test on a real device or emulator.
5. Submit the PR with a clear description.

---

## Development Setup

### Prerequisites

| Tool | Version | Notes |
|------|---------|-------|
| Node.js | 18+ | LTS recommended |
| Java | 17 | Required for Android builds |
| Android SDK | API 34+ | Via Android Studio |
| A GGUF model | — | e.g., Qwen3 4B Q4_K_M |

### Getting Started

```bash
# Clone your fork
git clone https://github.com/YOUR_USERNAME/vesta.git
cd vesta/apps/mobile

# Install dependencies
npm install --legacy-peer-deps

# Generate native project
npx expo prebuild

# Set Android SDK path
echo "sdk.dir=$HOME/Library/Android/sdk" > android/local.properties

# Set Java 17 (macOS with Homebrew)
export JAVA_HOME=/opt/homebrew/opt/openjdk@17

# Run
npx expo run:android
```

### Known Gotchas

- **`--legacy-peer-deps`** is required because `llama.rn` has peer dependency conflicts with React 19.
- **`android/local.properties`** gets deleted by `npx expo prebuild --clean`. Recreate it after clean prebuilds.
- **`JAVA_HOME`** must point to Java 17. If `java_home -v 17` fails, use the direct path.
- **Metro port**: If port 8081 is busy, Expo may use 8082. For emulators, run `adb reverse tcp:PORT tcp:PORT`.

---

## Project Architecture

```
apps/mobile/
├── app/                   # Screens (Expo Router, file-based routing)
├── components/            # Reusable UI components
├── lib/
│   ├── orchestrator/      # Core brain: router, prompt builder, tools
│   ├── llm/               # llama.rn wrapper
│   ├── storage/           # SQLite layer (expo-sqlite)
│   └── store/             # Zustand state management
├── native/android/        # Kotlin: SystemActionsModule, Widget, Voice
└── plugins/               # Expo config plugins
```

For full architecture details, see [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

---

## Code Style

- **Language**: TypeScript with `strict: true`
- **State management**: Zustand (single store at `lib/store/chat-store.ts`)
- **Database**: Raw SQL via `expo-sqlite` (no ORM)
- **Components**: React Native functional components with hooks
- **Naming**: camelCase for functions/variables, PascalCase for components/types
- **Comments**: English only, keep them minimal — code should be self-explanatory
- **UI text**: Support both English and Italian

---

## Commit Messages

Follow [Conventional Commits](https://www.conventionalcommits.org/):

```
feat: add voice input to widget
fix: prevent orphaned conversations on delete
docs: update Quick Start with Java 17 requirement
refactor: extract prompt building into dedicated module
```

---

## Pull Request Guidelines

- **Keep PRs small and focused.** One feature or fix per PR.
- **Link the related issue** (`Fixes #123`).
- **Test on a real device or emulator** before submitting.
- **Don't include unrelated changes** (formatting, refactoring) in the same PR.
- **Update docs** if your change affects setup, architecture, or user-facing behavior.

---

## Current Priorities

Check [docs/GAMEPLAN.md](docs/GAMEPLAN.md) for what's in scope. The project follows a phased approach — contributions that align with the current phase are most likely to be merged quickly.

Good areas for first contributions:
- Bug fixes in existing features
- Test coverage
- Documentation improvements
- Tool implementations (Fase 2)
- Translations (Tier 2 languages)

---

## Questions?

Open a [Discussion](../../discussions) or reach out in issues. We're happy to help you get started.
