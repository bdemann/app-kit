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
    endpoint), `links`, and an optional `reloadTimeoutMs` (default 10,000). Reload asks the new
    service worker to take over and waits until it is activated (or the timeout passes) before
    reloading, showing "Reloading..." meanwhile. When the latest-commit check says a newer version is
    live, "App updates" says "A new version is ready. Reload to use it." too.
-   **`FeedbackPage`**: `send(draft)` returning `{ok: true}` or `{ok: false, message}`, and an optional
    `draftStorageKey` to keep unsent drafts. With none of the inputs below it looks and behaves as in
    0.1.0, and the draft is exactly `{kind, message}`. All of these are optional:
    -   `intro: string`: replaces the sentence under the heading.
    -   `contactFields: boolean`: shows "Name (optional)" and "Email (optional, if you'd like a
        reply)"; the draft gets trimmed `name` and `email`. An invalid email shows an inline error and
        does not send. `contactStorageKey: string` remembers both in localStorage.
    -   `diagnostics: {label?, note?, defaultKinds?, collect}`: a checkbox (default label "Attach diagnostic
        logs"), checked by default for `defaultKinds` (default `['problem']`) until the person touches
        it, with a collapsed "What will be sent" preview of what `collect(): {info, log}` returned.
        When checked, the draft gets `diagnosticsInfo` and `diagnosticsLog` (the log is trimmed to the
        newest lines that fit `feedbackLimits.diagnosticsLog`). `note` is one muted sentence under the
        checkbox row (aligned with the label text, linked by `aria-describedby`), so the label can stay
        short; without it nothing changes.
    -   `prefill: {kind?, message?, attachDiagnostics?}`: starting values, applied once when the
        element is created. A prefill message wins over a stored draft.
    -   `honeypot: boolean`: a visually hidden, `aria-hidden`, untabbable "Website" field whose value
        goes into the draft as `website`.

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
| `--kit-field`      | `--kit-surface`       | Feedback text fields and preview  |
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

Options beyond the example above (all optional):

-   `sender`: leave it out for a public app. The issue's "From" line then shows the name the person
    typed, or "unknown". A `sender` you supply always wins over a typed name.
-   `labels: {base: string[]; byKind: Partial<Record<FeedbackKind, string[]>>}`: replaces the default
    labels `['feedback', <kind>]` with `base` plus the entry for the request's kind.
-   `maxBodyChars`: largest raw body `handleFeedbackRequest` reads (default `feedbackLimits.request`,
    70,000).

A request with a non-empty `website` (the honeypot) is a bot: it gets 200 `{ok: true}` and GitHub is
never called. When the request has an `email`, the issue gets a "Reply to" line. Diagnostics are
appended to the issue in a collapsed section after the message, so the message part keeps its
5,000 character cap and the whole issue stays under GitHub's limit. Message text, names, emails and
diagnostics are never logged.

Public app without sign-in (Netlify Function, contact fields, honeypot and diagnostics):

```ts
// netlify/functions/feedback.mts
import {handleFeedbackRequest} from '@bdemann/app-kit/server';

export default (request: Request) =>
    handleFeedbackRequest(request, {
        token: process.env['GITHUB_FEEDBACK_TOKEN'],
        repo: 'bdemann/my-app',
        appName: 'My App',
        labels: {base: ['app-feedback'], byKind: {idea: ['idea'], problem: ['bug']}},
        commit: process.env['COMMIT_REF'] ?? 'dev',
        submittedAt: new Date().toISOString(),
        fetchFunction: fetch,
    });
```

```ts
html`
    <${FeedbackPage.assign({
        send: (draft) => postToFunction(draft),
        draftStorageKey: 'my-app.feedbackDraft',
        contactFields: true,
        contactStorageKey: 'my-app.feedbackContact',
        honeypot: true,
        diagnostics: {collect: () => ({info: appInfoLines(), log: recentLogLines()})},
    })}></${FeedbackPage}>
`;
```

`handleFeedbackRequest` answers 405 for anything but POST, 415 for a content type that is not JSON,
and 400 for a body over `maxBodyChars` or that is not JSON.

The status codes:

-   200: the issue was filed (or the honeypot caught a bot).
-   400: the message is invalid, or the body is too large.
-   415: the content type is not JSON.
-   502: GitHub failed or rejected the request.
-   503: no token is set.

The token is only ever sent in a header. Failures are logged by status and error name only.

## Changelog

### 0.2.2

-   `FeedbackPage` `diagnostics.note`: an optional muted sentence under the checkbox, linked with
    `aria-describedby`.
-   The feedback textarea, name, email and "What will be sent" box now share one explicit background
    and text color (they followed the browser default on dark themes), and placeholders use the muted
    color. New optional `--kit-field` property (falls back to `--kit-surface`) sets that background.

### 0.2.1

The same code as 0.2.0, published with its built files. 0.2.0 on npm has no `dist` folder (the
publish workflow skipped the build because `.npmrc` sets `ignore-scripts=true`), so it cannot be
imported: use 0.2.1.

### 0.2.0

-   Feedback, all optional and backward compatible: contact fields (`name`, `email`, "Reply to" line),
    diagnostics attachment, `prefill`, `honeypot` (`website`), `intro`, a `labels` override, optional
    `sender`, `maxBodyChars`. New data helpers: `looksLikeEmail`, `trimOldestLines`,
    `sanitizeDiagnosticText`, `buildDiagnosticsSection`, `isDiagnosticsAttached`,
    `isHoneypotTripped`; new limits in `feedbackLimits`.
-   `handleFeedbackRequest` now answers 415 for a content type that is not JSON (a request with no
    `application/json` content type used to be parsed anyway) and 400 for an oversized body.
-   `AboutPage`: Reload waits for the new service worker to activate (with a timeout) instead of
    reloading at once, so it cannot reload into the old cached shell.
-   `AboutPage`: "App updates" no longer says "Up to date." next to "A newer version is live"
    (`describeCombinedUpdateStatus`).
-   `AboutPage`: the commit link keeps its 44px touch target without pushing the value below its label.

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
