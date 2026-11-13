/**
 * Pure, app agnostic pieces of the in-app feedback feature: limits, sanitizing, validation, and
 * building the GitHub issue (and the request that creates it). Shared by every app that has a
 * feedback page, so this file must not import anything outside `src/data/kit`.
 */

export const feedbackKinds = ['idea', 'problem', 'other'] as const;

export type FeedbackKind = (typeof feedbackKinds)[number];

export const feedbackLimits = {
    title: 100,
    body: 5000,
    message: 4000,
    sender: 60,
    page: 200,
    appInfo: 60,
    name: 60,
    email: 254,
    /** App, device and settings lines above the diagnostic log. */
    diagnosticsInfo: 4000,
    /** Diagnostic log text; the page trims the oldest lines first. GitHub allows 65,536 per issue. */
    diagnosticsLog: 50_000,
    /** Largest raw request body, in characters. */
    request: 70_000,
} as const;

/**
 * What the page sends. Apps with signed-in people send only `kind` and `message` (plus app info);
 * public apps can also collect the optional contact, honeypot and diagnostics fields.
 */
export type FeedbackRequest = {
    kind: FeedbackKind;
    message: string;
    /** The route the person was on, e.g. `/list`. */
    page?: string | undefined;
    version?: string | undefined;
    commit?: string | undefined;
    /** Optional name, up to {@link feedbackLimits}.name characters. */
    name?: string | undefined;
    /** Optional reply address; when non-empty it must pass {@link looksLikeEmail}. */
    email?: string | undefined;
    /** Honeypot: hidden from people, so only bots fill it. See {@link isHoneypotTripped}. */
    website?: string | undefined;
    /** Optional diagnostics attachment: app, device and settings lines. */
    diagnosticsInfo?: string | undefined;
    /** Optional diagnostics attachment: one log line per row, oldest first. */
    diagnosticsLog?: string | undefined;
};

export type FeedbackIssue = {
    title: string;
    body: string;
    labels: string[];
};

export const feedbackSentMessage = 'Thank you. Your feedback has been sent.';
export const feedbackFailedMessage = 'Could not send that right now. Please try again later.';
export const feedbackNotConfiguredMessage =
    'Feedback is not set up yet. Ask Benjamin to add the GitHub token.';

/** Strips HTML tags (repeatedly, so nested fragments cannot reassemble) and control characters. */
export function stripHtml(text: string): string {
    let previous: string;
    let current = text.replaceAll('\r\n', '\n').replaceAll('\r', '\n');
    do {
        previous = current;
        current = removeTags(current);
    } while (current !== previous);
    let result = '';
    for (const character of current) {
        const code = character.codePointAt(0) as number;
        const isControl = (code < 32 && code !== 9 && code !== 10) || code === 127;
        if (!isControl && character !== '<' && character !== '>') {
            result += character;
        }
    }
    return result;
}

/** Removes every complete `<...>` span in one left-to-right pass (linear time). */
function removeTags(text: string): string {
    let result = '';
    let index = 0;
    while (index < text.length) {
        const open = text.indexOf('<', index);
        const close = open < 0 ? -1 : text.indexOf('>', open);
        if (close < 0) {
            result += text.slice(index);
            break;
        }
        result += text.slice(index, open);
        index = close + 1;
    }
    return result;
}

export const zeroWidthSpace = String.fromCodePoint(0x20_0b);

/** Inserts a zero-width space after `@` so GitHub does not notify anyone. */
export function neutralizeMentions(text: string): string {
    return text.replaceAll(/(?<![\w.])@(?=[\w-])/g, `@${zeroWidthSpace}`);
}

/** HTML-stripped, mention-neutralized, trimmed. */
export function sanitizeFeedbackText(text: string): string {
    return neutralizeMentions(stripHtml(text)).trim();
}

/** Whether the honeypot field was filled in, which only a bot does. */
export function isHoneypotTripped(request: Readonly<Pick<FeedbackRequest, 'website'>>): boolean {
    return !!request.website;
}

/** Loose shape check only: something@something.tld, no spaces, at most 254 characters. */
export function looksLikeEmail(email: string): boolean {
    const parts = email.split('@');
    const [local, domain] = parts;
    return (
        email.length <= feedbackLimits.email &&
        parts.length === 2 &&
        !!local &&
        !!domain &&
        !/[\s<>]/.test(email) &&
        domain.includes('.') &&
        !domain.startsWith('.') &&
        !domain.endsWith('.')
    );
}

/** Keeps the newest lines: drops whole lines from the start until the text fits in `max`. */
export function trimOldestLines({text, max}: Readonly<{text: string; max: number}>): string {
    if (text.length <= max) {
        return text;
    }
    const tail = text.slice(text.length - max);
    const firstBreak = tail.indexOf('\n');
    /** A single line longer than max: keep its end. */
    return firstBreak < 0 ? tail : tail.slice(firstBreak + 1);
}

/**
 * Makes diagnostics safe inside a markdown code fence: HTML and control characters go, and
 * backticks become apostrophes so nothing can close the fence. Mentions cannot notify from a code
 * block, so they are left alone.
 */
export function sanitizeDiagnosticText(text: string): string {
    return stripHtml(text).replaceAll('`', "'").trim();
}

/**
 * Whether the "Attach diagnostic logs" box is checked: on for the `defaultKinds` (default only a
 * Problem) until the person touches it (`userChoice`), after which their choice wins.
 */
export function isDiagnosticsAttached({
    kind,
    userChoice,
    defaultKinds = ['problem'],
}: Readonly<{
    kind: FeedbackKind;
    userChoice: boolean | undefined;
    defaultKinds?: ReadonlyArray<FeedbackKind> | undefined;
}>): boolean {
    return userChoice ?? defaultKinds.includes(kind);
}

/** The collapsed diagnostics section of the issue body, or '' when nothing was attached. */
export function buildDiagnosticsSection(
    request: Readonly<Pick<FeedbackRequest, 'diagnosticsInfo' | 'diagnosticsLog'>>,
): string {
    const info = clip({
        text: sanitizeDiagnosticText(request.diagnosticsInfo ?? ''),
        max: feedbackLimits.diagnosticsInfo,
    });
    const log = trimOldestLines({
        text: sanitizeDiagnosticText(request.diagnosticsLog ?? ''),
        max: feedbackLimits.diagnosticsLog,
    });
    if (!info && !log) {
        return '';
    }
    return [
        '<details><summary>Diagnostic logs</summary>',
        '',
        '```text',
        [info, log].filter(Boolean).join('\n\nlog (oldest first):\n'),
        '```',
        '',
        '</details>',
    ].join('\n');
}

function sanitizeOneLine(text: string): string {
    return sanitizeFeedbackText(text).replaceAll(/\s+/g, ' ');
}

function clip({text, max}: Readonly<{text: string; max: number}>): string {
    return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}

function oneLine({text, max}: Readonly<{text: string | undefined; max: number}>): string {
    return clip({
        text: sanitizeOneLine(text ?? ''),
        max,
    });
}

const kindLabels: Readonly<Record<FeedbackKind, string>> = {
    idea: 'Idea',
    problem: 'Problem',
    other: 'Other',
};

/** Issue labels: `base` on every issue, plus the `byKind` entry for the request's kind. */
export type FeedbackLabels = {
    base: string[];
    byKind: Partial<Record<FeedbackKind, string[]>>;
};

/**
 * Builds the GitHub issue (title, body, labels) from a validated request. The diagnostics section,
 * when attached, is appended after the clipped body, so the body cap covers only the message part.
 */
export function buildFeedbackIssue({
    request,
    sender,
    submittedAt,
    appName,
    labels,
}: Readonly<{
    request: Readonly<FeedbackRequest>;
    /**
     * Who sent it, from the app's session (by first name, never an email address). It always wins
     * over a typed `request.name`. Leave out for apps without sign-in.
     */
    sender?: string | undefined;
    submittedAt: string;
    appName: string;
    /** Default: `['feedback', <kind>]`. */
    labels?: Readonly<FeedbackLabels> | undefined;
}>): FeedbackIssue {
    const label = kindLabels[request.kind];
    const message = clip({
        text: sanitizeFeedbackText(request.message),
        max: feedbackLimits.message,
    });
    const senderText =
        oneLine({
            text: sender,
            max: feedbackLimits.sender,
        }) ||
        oneLine({
            text: request.name,
            max: feedbackLimits.name,
        });
    const email = oneLine({
        text: request.email,
        max: feedbackLimits.email,
    });
    const appText = oneLine({
        text: appName,
        max: feedbackLimits.sender,
    });
    const page = oneLine({
        text: request.page,
        max: feedbackLimits.page,
    });
    const version = oneLine({
        text: request.version,
        max: feedbackLimits.appInfo,
    });
    const commit = oneLine({
        text: request.commit,
        max: feedbackLimits.appInfo,
    });

    const lineEnd = message.indexOf('\n');
    const firstLine = lineEnd < 0 ? message : message.slice(0, lineEnd);
    const prefix = `[App feedback] [${label}] `;
    const title =
        prefix +
        clip({
            text: sanitizeOneLine(firstLine) || 'Feedback',
            max: feedbackLimits.title - prefix.length,
        });

    const lines = [
        `> **Submitted from the ${appText} app**`,
        '',
        `- **Kind:** ${label}`,
        `- **From:** ${senderText || 'unknown'}`,
        ...(email ? [`- **Reply to:** ${email}`] : []),
        `- **Version:** ${version || 'unknown'}`,
        `- **Commit:** ${commit || 'unknown'}`,
        `- **Page:** ${page ? '`' + page.replaceAll('`', "'") + '`' : 'unknown'}`,
        `- **Date:** ${submittedAt}`,
        '',
        '---',
        '',
        message,
    ];

    return {
        title,
        body: [
            clip({
                text: lines.join('\n'),
                max: feedbackLimits.body,
            }),
            buildDiagnosticsSection(request),
        ]
            .filter(Boolean)
            .join('\n\n'),
        labels: labels
            ? [...labels.base, ...(labels.byKind[request.kind] ?? [])]
            : ['feedback', request.kind],
    };
}

export type FeedbackParseResult = {ok: true; request: FeedbackRequest} | {ok: false; error: string};

const allowedKeys = new Set([
    'kind',
    'message',
    'page',
    'version',
    'commit',
    'name',
    'email',
    'website',
    'diagnosticsInfo',
    'diagnosticsLog',
]);

const notFeedback: FeedbackParseResult = {
    ok: false,
    error: 'That does not look like a feedback message.',
};

function isOptionalString(value: unknown): value is string | undefined {
    return value === undefined || typeof value === 'string';
}

/** Validates untrusted JSON by hand (no shape library, so it runs anywhere): fields and limits. */
export function parseFeedbackRequest(raw: unknown): FeedbackParseResult {
    if (typeof raw !== 'object' || raw == undefined || Array.isArray(raw)) {
        return notFeedback;
    }
    const value = raw as Record<string, unknown>;
    const {kind, message, page, version, commit, name, email, website} = value;
    const {diagnosticsInfo, diagnosticsLog} = value;
    if (
        !Object.keys(value).every((key) => allowedKeys.has(key)) ||
        !feedbackKinds.includes(kind as FeedbackKind) ||
        typeof message !== 'string' ||
        !isOptionalString(page) ||
        !isOptionalString(version) ||
        !isOptionalString(commit) ||
        !isOptionalString(name) ||
        !isOptionalString(email) ||
        !isOptionalString(website) ||
        !isOptionalString(diagnosticsInfo) ||
        !isOptionalString(diagnosticsLog)
    ) {
        return notFeedback;
    } else if (!stripHtml(message).trim()) {
        return {
            ok: false,
            error: 'Please write a message first.',
        };
    } else if (message.length > feedbackLimits.message) {
        return {
            ok: false,
            error: `That message is too long (limit ${feedbackLimits.message} characters).`,
        };
    } else if (name !== undefined && name.length > feedbackLimits.name) {
        return {
            ok: false,
            error: `That name is too long (limit ${feedbackLimits.name} characters).`,
        };
    } else if (email && !looksLikeEmail(email)) {
        return {
            ok: false,
            error: 'That email address does not look right.',
        };
    } else if (
        (diagnosticsInfo?.length ?? 0) > feedbackLimits.diagnosticsInfo ||
        (diagnosticsLog?.length ?? 0) > feedbackLimits.diagnosticsLog
    ) {
        return {
            ok: false,
            error: 'The diagnostic logs are too long.',
        };
    } else {
        return {
            ok: true,
            request: {
                kind: kind as FeedbackKind,
                message,
                page,
                version,
                commit,
                name,
                email,
                website,
                diagnosticsInfo,
                diagnosticsLog,
            },
        };
    }
}

/** The request that creates a GitHub issue. The caller sends it with its own `fetch`. */
export function buildGitHubIssueRequest({
    token,
    repo,
    issue,
    userAgent,
    apiUrl = 'https://api.github.com',
}: Readonly<{
    token: string;
    /** `owner/name`. */
    repo: string;
    issue: Readonly<FeedbackIssue>;
    userAgent: string;
    /** Only tests and local dev point this somewhere else. */
    apiUrl?: string | undefined;
}>): {url: string; init: RequestInit} {
    return {
        url: `${apiUrl.endsWith('/') ? apiUrl.slice(0, -1) : apiUrl}/repos/${repo}/issues`,
        init: {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${token}`,
                Accept: 'application/vnd.github+json',
                'X-GitHub-Api-Version': '2022-11-28',
                'User-Agent': userAgent,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(issue),
        },
    };
}
