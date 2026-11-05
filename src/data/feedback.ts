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
} as const;

/** What the page sends: no contact details, because only signed-in people can send feedback. */
export type FeedbackRequest = {
    kind: FeedbackKind;
    message: string;
    /** The route the person was on, e.g. `/list`. */
    page?: string | undefined;
    version?: string | undefined;
    commit?: string | undefined;
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

/** Builds the GitHub issue (title, body, labels) from a validated request. */
export function buildFeedbackIssue({
    request,
    sender,
    submittedAt,
    appName,
}: Readonly<{
    request: Readonly<FeedbackRequest>;
    /** Who sent it, by first name. Never an email address. */
    sender: string;
    submittedAt: string;
    appName: string;
}>): FeedbackIssue {
    const label = kindLabels[request.kind];
    const message = clip({
        text: sanitizeFeedbackText(request.message),
        max: feedbackLimits.message,
    });
    const senderText = oneLine({
        text: sender,
        max: feedbackLimits.sender,
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
        body: clip({
            text: lines.join('\n'),
            max: feedbackLimits.body,
        }),
        labels: ['feedback', request.kind],
    };
}

export type FeedbackParseResult = {ok: true; request: FeedbackRequest} | {ok: false; error: string};

const allowedKeys = new Set(['kind', 'message', 'page', 'version', 'commit']);

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
    const {kind, message, page, version, commit} = value;
    if (
        !Object.keys(value).every((key) => allowedKeys.has(key)) ||
        !feedbackKinds.includes(kind as FeedbackKind) ||
        typeof message !== 'string' ||
        !isOptionalString(page) ||
        !isOptionalString(version) ||
        !isOptionalString(commit)
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
    } else {
        return {
            ok: true,
            request: {
                kind: kind as FeedbackKind,
                message,
                page,
                version,
                commit,
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
