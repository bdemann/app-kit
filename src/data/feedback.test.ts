import {assert} from '@augment-vir/assert';
import {describe, it} from 'node:test';
import {
    buildFeedbackIssue,
    buildGitHubIssueRequest,
    feedbackLimits,
    neutralizeMentions,
    parseFeedbackRequest,
    sanitizeFeedbackText,
    stripHtml,
    zeroWidthSpace,
} from './feedback.js';

const when = '2026-11-04T12:00:00.000Z';

function issueFor(request: Parameters<typeof buildFeedbackIssue>[0]['request'], sender = 'Ben') {
    return buildFeedbackIssue({
        request,
        sender,
        submittedAt: when,
        appName: 'Shopping List',
    });
}

describe(stripHtml.name, () => {
    it('removes tags, nested fragments, stray angle brackets and control characters', () => {
        assert.strictEquals(stripHtml('a <b>bold</b> move'), 'a bold move');
        assert.strictEquals(stripHtml('<a<b>c>x'), 'cx');
        assert.strictEquals(stripHtml('1 < 2 and 3 > 2'), '1  2');
        assert.strictEquals(stripHtml('a\u0000b\u007Fc\td'), 'abc\td');
        assert.strictEquals(stripHtml('one\r\ntwo\rthree'), 'one\ntwo\nthree');
        assert.strictEquals(stripHtml('open <tag never closed'), 'open tag never closed');
    });
});

describe(neutralizeMentions.name, () => {
    it('breaks @mentions but not email addresses or a lone @', () => {
        assert.strictEquals(neutralizeMentions('hi @someone'), `hi @${zeroWidthSpace}someone`);
        assert.strictEquals(neutralizeMentions('a@b.com @ x'), 'a@b.com @ x');
    });
});

describe(sanitizeFeedbackText.name, () => {
    it('strips, neutralizes and trims', () => {
        assert.strictEquals(sanitizeFeedbackText('  <i>hi</i> @me  '), `hi @${zeroWidthSpace}me`);
    });
});

describe(buildFeedbackIssue.name, () => {
    it('builds a labelled issue that names the sender', () => {
        const issue = issueFor(
            {
                kind: 'problem',
                message: 'The list is slow\nwhen I add milk',
                page: '/list',
                version: '0.1.0',
                commit: 'abc1234',
            },
            'Marley',
        );
        assert.strictEquals(issue.title, '[App feedback] [Problem] The list is slow');
        assert.deepEquals(issue.labels, ['feedback', 'problem']);
        assert.deepEquals(issue.body.split('\n').slice(0, 9), [
            '> **Submitted from the Shopping List app**',
            '',
            '- **Kind:** Problem',
            '- **From:** Marley',
            '- **Version:** 0.1.0',
            '- **Commit:** abc1234',
            '- **Page:** `/list`',
            `- **Date:** ${when}`,
            '',
        ]);
        assert.endsWith(issue.body, 'The list is slow\nwhen I add milk');
    });

    it('fills in unknowns, backticks and a title fallback', () => {
        const issue = issueFor(
            {
                kind: 'idea',
                message: '<b></b>\nbody only',
                page: 'a`b',
            },
            '',
        );
        assert.strictEquals(issue.title, '[App feedback] [Idea] body only');
        assert.isTrue(issue.body.includes('- **From:** unknown'));
        assert.isTrue(issue.body.includes("- **Page:** `a'b`"));
        assert.isTrue(issue.body.includes('- **Version:** unknown'));
        assert.isTrue(issue.body.includes('- **Commit:** unknown'));
        assert.strictEquals(
            issueFor({
                kind: 'other',
                message: '<b></b>',
            }).title,
            '[App feedback] [Other] Feedback',
        );
        assert.isTrue(
            issueFor({
                kind: 'other',
                message: 'x',
            }).body.includes('- **Page:** unknown'),
        );
    });

    it('clips long fields', () => {
        const long = 'x'.repeat(10_000);
        const issue = issueFor({
            kind: 'other',
            message: long,
            page: long,
            version: long,
        });
        assert.isTrue(issue.title.length <= feedbackLimits.title);
        assert.isTrue(issue.body.length <= feedbackLimits.body);
        assert.endsWith(issue.title, '…');
    });
});

describe(parseFeedbackRequest.name, () => {
    const good = {
        kind: 'idea',
        message: 'hello',
    };

    it('accepts a good request with optional fields', () => {
        assert.deepEquals(parseFeedbackRequest(good), {
            ok: true,
            request: {
                kind: 'idea',
                message: 'hello',
                page: undefined,
                version: undefined,
                commit: undefined,
            },
        });
        assert.isTrue(
            parseFeedbackRequest({
                ...good,
                page: '/',
                version: '1',
                commit: 'c',
            }).ok,
        );
    });

    it('rejects things that are not feedback', () => {
        for (const bad of [
            undefined,
            'text',
            [],
            {
                ...good,
                kind: 'rant',
            },
            {
                ...good,
                message: 5,
            },
            {
                ...good,
                page: 5,
            },
            {
                ...good,
                version: 5,
            },
            {
                ...good,
                commit: 5,
            },
            {
                ...good,
                email: 'a@b.com',
            },
        ]) {
            assert.deepEquals(parseFeedbackRequest(bad), {
                ok: false,
                error: 'That does not look like a feedback message.',
            });
        }
    });

    it('rejects empty and too long messages', () => {
        assert.deepEquals(
            parseFeedbackRequest({
                ...good,
                message: ' <b> </b> ',
            }),
            {
                ok: false,
                error: 'Please write a message first.',
            },
        );
        assert.deepEquals(
            parseFeedbackRequest({
                ...good,
                message: 'x'.repeat(feedbackLimits.message + 1),
            }),
            {
                ok: false,
                error: `That message is too long (limit ${feedbackLimits.message} characters).`,
            },
        );
    });
});

describe(buildGitHubIssueRequest.name, () => {
    const issue = {
        title: 't',
        body: 'b',
        labels: ['feedback'],
    };

    it('targets the repo issues endpoint with the token in a header only', () => {
        const {url, init} = buildGitHubIssueRequest({
            token: 'secret',
            repo: 'o/r',
            issue,
            userAgent: 'ua',
        });
        assert.strictEquals(url, 'https://api.github.com/repos/o/r/issues');
        assert.strictEquals(init.method, 'POST');
        assert.strictEquals(
            (init.headers as Record<string, string>)['Authorization'],
            'Bearer secret',
        );
        assert.strictEquals(init.body, JSON.stringify(issue));
    });

    it('honors an alternate API url', () => {
        assert.strictEquals(
            buildGitHubIssueRequest({
                token: 't',
                repo: 'o/r',
                issue,
                userAgent: 'ua',
                apiUrl: 'http://localhost:1/',
            }).url,
            'http://localhost:1/repos/o/r/issues',
        );
    });
});
