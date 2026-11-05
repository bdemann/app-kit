# @bdemann/app-kit

The shared shell pieces for Benjamin's small web apps: a bottom nav bar, a slide-out drawer, an
About page that says whether the app is up to date, and a Feedback page that files GitHub issues.
They were built and proven in [shopping-list](https://github.com/bdemann/shopping-list) first.

| Entry point               | What                                                                                                                                     | Runs in                          |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------- |
| `@bdemann/app-kit/ui`     | `BottomNav` (`kit-bottom-nav`), `SlideDrawer` (`kit-slide-drawer`), `AboutPage` (`kit-about-page`), `FeedbackPage` (`kit-feedback-page`) | the browser, with element-vir 27 |
| `@bdemann/app-kit/data`   | Pure helpers: commit/timestamp formatting, update status, feedback limits, sanitizing, GitHub issue building                             | anywhere                         |
| `@bdemann/app-kit/server` | `sendFeedback` (platform neutral) and `handleFeedbackRequest` (Fetch API `Request` → `Response`)                                         | Workers, Netlify Functions, Node |

Nothing here uses `new Function` or `eval`, so it runs inside Cloudflare Workers and under a strict
CSP. The tests also run with `--disallow-code-generation-from-strings`.

## Install

Every app has `min-release-age=5` in `.npmrc`, which would hold back a fresh kit release for five
days. Exempt Benjamin's own scope by adding this line to the app's `.npmrc`:

```ini
min-release-age-exclude[]=@bdemann/*
```

Then:

```bash
npm install @bdemann/app-kit
```

`element-vir` 27 is a peer dependency. Apps on element-vir 26 need to upgrade first: in 27,
`defineElementEvent` constructors take `{detail}`.

## UI

```ts
import {AboutPage, BottomNav, FeedbackPage, SlideDrawer} from '@bdemann/app-kit/ui';

html`
    <${BottomNav.assign({tabs, currentId})}
        ${listen(BottomNav.events.tabSelected, (event) => goTo(event.detail))}
    ></${BottomNav}>
    <${SlideDrawer.assign({open, label: 'Menu'})}
        ${listen(SlideDrawer.events.closeRequested, () => close())}
    >
        <a href="/about" data-drawer-close>About</a>
    </${SlideDrawer}>
`;
```

-   **`BottomNav`**: `tabs: {id, label, href, iconPath}[]` (an SVG path in a 24×24 viewBox), `currentId`, optional `label`. Fires `tabSelected` with the tab id.
-   **`SlideDrawer`**: `open`, `label`. Traps focus, closes on Escape, on the scrim, and on any
    child with `data-drawer-close`. Fires `closeRequested`.
-   **`AboutPage`**: `appName`, `logoUrl`, `repoUrl`, `buildInfo` (`{version, commit, buildTime}`),
    `fetchLatestCommit()` (resolve the commit that is deployed now, for example from a health
    endpoint), and `links`.
-   **`FeedbackPage`**: `send(draft)` returning `{ok: true}` or `{ok: false, message}`, and an optional
    `draftStorageKey` to keep unsent drafts.

### Theming

Every color is a CSS custom property with the original shopping-list colors as the fallback. Set
any of them on `:root` or on a parent element:

| Property           | Default               | Used for                          |
| ------------------ | --------------------- | --------------------------------- |
| `--kit-accent`     | `#6b4423`             | Buttons, borders, the active tab  |
| `--kit-on-accent`  | `#ffffff`             | Text on accent backgrounds        |
| `--kit-text`       | `#2b2118`             | Body text                         |
| `--kit-muted-text` | `#5c4631`             | Hints, inactive tabs              |
| `--kit-surface`    | `#ffffff`             | Page, nav, and drawer backgrounds |
| `--kit-border`     | `#b9a27f`             | The nav's top border              |
| `--kit-focus`      | `#1a5fd0`             | Focus outlines                    |
| `--kit-error`      | `#a4262c`             | Error messages                    |
| `--kit-scrim`      | `rgba(0, 0, 0, 0.45)` | Behind the open drawer            |

## Server: feedback

Create a fine-grained GitHub token with **Issues: read and write** on the app's repo only, store it
as a server secret, and create a `feedback` label in the repo. Only call the handler for a
signed-in person; it does no authentication of its own.

Cloudflare Worker (or anything with Fetch API `Request`/`Response`):

```ts
import {handleFeedbackRequest} from '@bdemann/app-kit/server';

return handleFeedbackRequest(request, {
    token: env.GITHUB_FEEDBACK_TOKEN,
    repo: 'bdemann/my-app',
    appName: 'My App',
    sender: firstName,
    commit: env.COMMIT,
    submittedAt: new Date().toISOString(),
    fetchFunction: fetch,
});
```

Netlify Functions v2 use the same call, since they also receive a `Request` and return a `Response`.
For any other framework, call `sendFeedback({body, ...})` and send back its `{status, body}`.

The status codes:

-   200: the issue was filed.
-   400: the message is invalid.
-   502: GitHub failed or rejected the request.
-   503: no token is set.

The token is only ever sent in a header. Failures are logged by status and error name only.

## Releasing

1. Bump `version` in `package.json` and merge to `main`.
2. Publish a GitHub release tagged `v<version>`. `.github/workflows/publish.yml` publishes it to
   npm with provenance through npm trusted publishing, so no npm token is stored anywhere.

The very first release (0.1.0) has to be published by hand, because trusted publishing can only be
set up on a package that already exists:

```bash
npm login            # as bdemann, with the security key
npm run test:all && npm run build
npm publish --access public
```

Then on npmjs.com, open **@bdemann/app-kit → Settings → Trusted publishing**. Add GitHub Actions
with the repository `bdemann/app-kit` and the workflow `publish.yml`.

## Development

```bash
npm ci
npm run test:all   # type check, tests with 100% coverage of data and server, the no-eval run, prettier
npm run build      # dist/
```
