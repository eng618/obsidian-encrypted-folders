# Contributing to Encrypted Folders

First off, thank you for considering contributing to Encrypted Folders! It's people like you who make the Obsidian community such a great place.

## 🤝 Code of Conduct

By participating in this project, you agree to abide by our code of conduct. Please be respectful and professional in all interactions.

## 🚀 Getting Started

1.  **Fork the repository** on GitHub.
2.  **Clone your fork** locally:
    ```bash
    git clone https://github.com/YOUR_USERNAME/obsidian-encrypted-folders.git
    ```
3.  **Install dependencies**:
    ```bash
    bun install
    ```
4.  **Create a branch** for your changes:
    ```bash
    git checkout -b feature/your-feature-name
    ```

## 🛠 Development Workflow

- **Build**: `bun run build`
- **Watch**: `bun run dev`
- **Lint**: `bun run lint`
- **Test**: `bun run test`

We use **Vitest** for testing and **oxlint** with **oxfmt** for code quality. Please ensure your changes pass all checks before submitting a Pull Request.

## 🧪 Testing Guidelines

- **Unit Tests**: Add tests for any new logic in `src/services`.
- **Integration Tests**: If you add new vault interactions, update `src/test/FolderService.test.ts`.
- **Mocks**: Use and extend the mocks in `src/test/mocks/obsidian.ts`.

## 📝 Commit Messages

We follow the **Conventional Commits** specification. This is important because our release process is automated based on these messages.

- `feat:` for new features
- `fix:` for bug fixes
- `docs:` for documentation changes
- `chore:` for maintenance tasks
- `refactor:` for code improvements

## 📬 Submitting a Pull Request

1.  Push your changes to your fork.
2.  Open a Pull Request against the `main` branch of the original repository.
3.  Describe your changes in detail and link any relevant issues.
4.  Once the CI passes, a maintainer will review your code.

## ⚖️ License

By contributing, you agree that your contributions will be licensed under the MIT License.
