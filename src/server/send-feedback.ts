import {
    buildFeedbackIssue,
    buildGitHubIssueRequest,
    feedbackFailedMessage,
    feedbackLimits,
    isHoneypotTripped,
    type FeedbackLabels,
    feedbackNotConfiguredMessage,
    parseFeedbackRequest,
} from '../data/feedback.js';

/** Longer than this and the person is told to retry; their draft stays on their screen. */
export const defaultGitHubTimeoutMs = 8000;

/** What to send back: an HTTP status and a JSON body. Map it to your platform's response. */
export type SendFeedbackResult =
    | {status: 200; body: {ok: true}}
    | {status: 400 | 502 | 503; body: {ok: false; error: string}};

export type SendFeedbackOptions = Readonly<{
    /** The parsed JSON body the feedback page sent. Untrusted; validated here. */
    body: unknown;
    /**
     * A fine-grained GitHub token with Issues read/write on `repo` only. Empty or undefined
     * answers 503. Only ever put in a header, never logged.
     */
    token: string | undefined;
    /** `owner/name`. */
    repo: string;
    appName: string;
    /**
     * Who sent it, by first name, from your session. Never an email address. Leave out for a public
     * app without sign-in: the issue then shows the name the person typed, if any.
     */
    sender?: string | undefined;
    /** Issue labels. Default: `['feedback', <kind>]`. */
    labels?: Readonly<FeedbackLabels> | undefined;
    /**
     * Largest raw request body, in characters, that {@link handleFeedbackRequest} reads. Default
     * `feedbackLimits.request`. Ignored by `sendFeedback`, which receives an already parsed body.
     */
    maxBodyChars?: number | undefined;
    /** The server's own build; the browser's claimed commit is ignored. */
    commit: string;
    /** ISO timestamp for the issue body. */
    submittedAt: string;
    /** `fetch`, or a fake in tests. */
    fetchFunction: typeof fetch;
    userAgent?: string | undefined;
    /** Only tests and local dev point this somewhere else. */
    apiUrl?: string | undefined;
    timeoutMs?: number | undefined;
    /** Where failures are reported (status and error name only). Defaults to `console.error`. */
    logError?: ((...values: unknown[]) => void) | undefined;
}>;

function failure(status: 400 | 502 | 503, error: string): SendFeedbackResult {
    return {
        status,
        body: {
            ok: false,
            error,
        },
    };
}

/**
 * Validates a feedback submission and files it as a GitHub issue. Platform neutral: it runs in a
 * Cloudflare Worker, a Netlify Function, or Node, and never uses `new Function`. Authentication
 * is the caller's job: only call this for a signed-in person, or for a public app, set up the
 * contact and honeypot fields. A submission whose honeypot is filled answers 200 without calling
 * GitHub. Message text, names, emails and diagnostics are never logged.
 */
export async function sendFeedback({
    body,
    token,
    repo,
    appName,
    sender,
    labels,
    commit,
    submittedAt,
    fetchFunction,
    userAgent = `${appName}-feedback`,
    apiUrl,
    timeoutMs = defaultGitHubTimeoutMs,
    logError = console.error,
}: SendFeedbackOptions): Promise<SendFeedbackResult> {
    if (!token) {
        return failure(503, feedbackNotConfiguredMessage);
    }
    const parsed = parseFeedbackRequest(body);
    if (!parsed.ok) {
        return failure(400, parsed.error);
    }
    if (isHoneypotTripped(parsed.request)) {
        return {
            status: 200,
            body: {
                ok: true,
            },
        };
    }
    const issue = buildFeedbackIssue({
        request: {
            ...parsed.request,
            commit,
        },
        sender,
        submittedAt,
        appName,
        labels,
    });
    const github = buildGitHubIssueRequest({
        token,
        repo,
        issue,
        userAgent,
        apiUrl,
    });
    let status: number;
    try {
        const response = await fetchFunction(github.url, {
            ...github.init,
            signal: AbortSignal.timeout(timeoutMs),
        });
        status = response.status;
    } catch (error) {
        logError('Feedback request to GitHub failed:', (error as Error).name);
        return failure(502, feedbackFailedMessage);
    }
    if (status !== 201) {
        logError('GitHub rejected the feedback issue with status', status);
        return failure(502, feedbackFailedMessage);
    }
    return {
        status: 200,
        body: {
            ok: true,
        },
    };
}

/**
 * Wraps {@link sendFeedback} for platforms with Fetch API `Request` / `Response` (Cloudflare
 * Workers, Netlify Functions v2, Deno, Bun). Answers 405 for anything but POST, 415 for a
 * content type that is not JSON, and 400 for a body that is too large (`maxBodyChars`) or not JSON.
 */
export async function handleFeedbackRequest(
    request: Request,
    options: Omit<SendFeedbackOptions, 'body'>,
): Promise<Response> {
    if (request.method !== 'POST') {
        return Response.json(
            {
                ok: false,
                error: 'Method not allowed.',
            },
            {
                status: 405,
                headers: {
                    Allow: 'POST',
                },
            },
        );
    }
    if (!(request.headers.get('content-type') ?? '').toLowerCase().includes('application/json')) {
        return Response.json(
            {
                ok: false,
                error: 'Send JSON.',
            },
            {
                status: 415,
            },
        );
    }
    const maxBodyChars = options.maxBodyChars ?? feedbackLimits.request;
    const declaredLength = Number(request.headers.get('content-length'));
    const tooLarge = Response.json(
        {
            ok: false,
            error: 'That message is too long.',
        },
        {
            status: 400,
        },
    );
    if (declaredLength > maxBodyChars) {
        return tooLarge;
    }
    const text = await request.text();
    if (text.length > maxBodyChars) {
        return tooLarge;
    }
    let body: unknown;
    try {
        body = JSON.parse(text);
    } catch {
        body = undefined;
    }
    const result = await sendFeedback({
        ...options,
        body,
    });
    return Response.json(result.body, {
        status: result.status,
    });
}
