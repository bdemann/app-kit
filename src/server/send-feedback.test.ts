import {assert} from '@augment-vir/assert';
import {describe, it} from 'node:test';
import {feedbackFailedMessage, feedbackNotConfiguredMessage} from '../data/feedback.js';
import {handleFeedbackRequest, sendFeedback, type SendFeedbackOptions} from './send-feedback.js';

const secretToken = 'github_pat_SECRET_VALUE';

type Sent = {url: string; init: RequestInit};

function setup(answer: number | Error = 201) {
    const sent: Sent[] = [];
    const logs: unknown[][] = [];
    const options: Omit<SendFeedbackOptions, 'body'> = {
        token: secretToken,
        repo: 'owner/app',
        appName: 'Test App',
        sender: 'Ben',
        commit: 'server-commit',
        submittedAt: '2026-11-04T12:00:00.000Z',
        fetchFunction: (async (url: string, init: RequestInit) => {
            sent.push({
                url,
                init,
            });
            if (answer instanceof Error) {
                throw answer;
            }
            return new Response(null, {
                status: answer,
            });
        }) as typeof fetch,
        logError(...values: unknown[]) {
            logs.push(values);
        },
    };
    return {
        sent,
        logs,
        options,
    };
}

const validBody = {
    kind: 'idea',
    message: 'Add a dark mode',
    commit: 'browser-claimed',
};

describe(sendFeedback.name, () => {
    it('files the issue with the server commit and a token header', async () => {
        const {sent, options, logs} = setup();
        const result = await sendFeedback({
            ...options,
            body: validBody,
        });
        assert.deepEquals(result, {
            status: 200,
            body: {
                ok: true,
            },
        });
        assert.strictEquals(sent.length, 1);
        const [first] = sent;
        assert.isDefined(first);
        assert.strictEquals(first.url, 'https://api.github.com/repos/owner/app/issues');
        const headers = first.init.headers as Record<string, string>;
        assert.strictEquals(headers.Authorization, `Bearer ${secretToken}`);
        assert.strictEquals(headers['User-Agent'], 'Test App-feedback');
        assert.instanceOf(first.init.signal, AbortSignal);
        const issue = JSON.parse(String(first.init.body)) as {body: string};
        assert.isTrue(issue.body.includes('server-commit'));
        assert.isFalse(issue.body.includes('browser-claimed'));
        assert.isEmpty(logs);
    });

    it('answers 503 without a token and sends nothing', async () => {
        const {sent, options} = setup();
        const result = await sendFeedback({
            ...options,
            token: '',
            body: validBody,
        });
        assert.deepEquals(result, {
            status: 503,
            body: {
                ok: false,
                error: feedbackNotConfiguredMessage,
            },
        });
        assert.isEmpty(sent);
    });

    it('answers 400 for an invalid body', async () => {
        const {sent, options} = setup();
        const result = await sendFeedback({
            ...options,
            body: {
                kind: 'nope',
            },
        });
        assert.strictEquals(result.status, 400);
        assert.isEmpty(sent);
    });

    it('answers 502 when GitHub rejects it, without logging the token', async () => {
        const {options, logs} = setup(500);
        const result = await sendFeedback({
            ...options,
            body: validBody,
        });
        assert.deepEquals(result, {
            status: 502,
            body: {
                ok: false,
                error: feedbackFailedMessage,
            },
        });
        assert.deepEquals(logs, [['GitHub rejected the feedback issue with status', 500]]);
    });

    it('answers 502 when the request fails, logging only the error name', async () => {
        const {options, logs} = setup(new TypeError(`network down ${secretToken}`));
        const result = await sendFeedback({
            ...options,
            body: validBody,
        });
        assert.strictEquals(result.status, 502);
        assert.deepEquals(logs, [['Feedback request to GitHub failed:', 'TypeError']]);
    });

    it('logs to console.error by default', async () => {
        const {options} = setup(500);
        const {logError: _unused, ...withoutLogger} = options;
        const original = console.error;
        const logged: unknown[][] = [];
        console.error = (...values: unknown[]) => {
            logged.push(values);
        };
        try {
            await sendFeedback({
                ...withoutLogger,
                body: validBody,
            });
        } finally {
            console.error = original;
        }
        assert.strictEquals(logged.length, 1);
    });
});

describe(handleFeedbackRequest.name, () => {
    it('maps the result to a JSON response', async () => {
        const {options} = setup();
        const response = await handleFeedbackRequest(
            new Request('https://app.example/api/feedback', {
                method: 'POST',
                body: JSON.stringify(validBody),
            }),
            options,
        );
        assert.strictEquals(response.status, 200);
        assert.deepEquals(await response.json(), {
            ok: true,
        });
    });

    it('rejects other methods with 405', async () => {
        const {options, sent} = setup();
        const response = await handleFeedbackRequest(
            new Request('https://app.example/api/feedback'),
            options,
        );
        assert.strictEquals(response.status, 405);
        assert.strictEquals(response.headers.get('Allow'), 'POST');
        assert.isEmpty(sent);
    });

    it('answers 400 for a body that is not JSON', async () => {
        const {options, sent} = setup();
        const response = await handleFeedbackRequest(
            new Request('https://app.example/api/feedback', {
                method: 'POST',
                body: 'not json',
            }),
            options,
        );
        assert.strictEquals(response.status, 400);
        assert.isEmpty(sent);
    });
});
