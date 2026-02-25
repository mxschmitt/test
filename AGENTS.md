# AGENTS.md

## Cursor Cloud specific instructions

This is a minimal Node.js project for browser automation testing with **Playwright** and **Puppeteer**. There is no backend server or locally-served frontend — all tests hit external URLs.

### Key commands

| Task | Command |
|---|---|
| Run all Playwright tests (Chromium only) | `npx playwright test --project=chromium` |
| Run full Playwright suite (all browsers) | `npx playwright test` |
| Run Puppeteer screenshot script | `node screenshot.mjs` |

### Non-obvious notes

- Playwright browsers must be installed after `npm install` via `npx playwright install --with-deps chromium`. The `--with-deps` flag installs required OS-level libraries.
- Tests require internet access — they navigate to `https://playwright.dev/` and `https://demo.playwright.dev/todomvc`.
- The Puppeteer script (`screenshot.mjs`) opens a local `canvas.html` file and saves `screenshot.png` to the working directory. Don't commit `screenshot.png`.
- There is no lint configuration, no build step, and no `tsconfig.json`. The `package.json` defines no scripts.
- The Playwright config (`playwright.config.ts`) defines three projects: chromium, firefox, webkit. For speed, use `--project=chromium`.
