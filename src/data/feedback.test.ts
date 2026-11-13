import {assert} from '@augment-vir/assert';
import {describe, it} from 'node:test';
import {
    buildFeedbackIssue,
    buildGitHubIssueRequest,
    buildDiagnosticsSection,
    feedbackLimits,
    isDiagnosticsAttached,
    isHoneypotTripped,
    looksLikeEmail,
    neutralizeMentions,
    parseFeedbackRequest,
    sanitizeDiagnosticText,
    sanitizeFeedbackText,
    stripHtml,
    trimOldestLines,
    zeroWidthSpace,
} from './feedback.js';

const when = '2026-11-04T12:00:00.000Z';

function issueFor(
    request: Parameters<typeof buildFeedbackIssue>[0]['request'],
    ...senderArgs: [sender?: string | undefined]
) {
    return buildFeedbackIssue({
        request,
        /** An explicit `undefined` means "no sender"; leaving it out means Ben. */
        sender: senderArgs.length ? senderArgs[0] : 'Ben',
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
                name: undefined,
                email: undefined,
                website: undefined,
                diagnosticsInfo: undefined,
                diagnosticsLog: undefined,
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
                unknown: 'a@b.com',
            },
            ...(['name', 'email', 'website', 'diagnosticsInfo', 'diagnosticsLog'] as const).map(
                (key) => ({...good, [key]: 5}),
            ),
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

describe('parseFeedbackRequest optional fields', () => {
    const good = {
        kind: 'problem',
        message: 'hello',
    } as const;

    it('accepts and returns contact, honeypot and diagnostics fields', () => {
        const extras = {
            name: 'Ben',
            email: 'ben@example.com',
            website: '',
            diagnosticsInfo: 'info',
            diagnosticsLog: 'a\nb',
        };
        const result = parseFeedbackRequest({...good, ...extras});
        assert.isTrue(result.ok);
        assert.deepEquals(result.ok && result.request, {
            ...good,
            page: undefined,
            version: undefined,
            commit: undefined,
            ...extras,
        });
        assert.isTrue(parseFeedbackRequest({...good, email: ''}).ok);
    });

    it('rejects a long name, a bad email and over-long diagnostics', () => {
        assert.deepEquals(
            parseFeedbackRequest({...good, name: 'x'.repeat(feedbackLimits.name + 1)}),
            {
                ok: false as const,
                error: `That name is too long (limit ${feedbackLimits.name} characters).`,
            },
        );
        assert.isTrue(parseFeedbackRequest({...good, name: 'x'.repeat(feedbackLimits.name)}).ok);
        assert.deepEquals(parseFeedbackRequest({...good, email: 'nope'}), {
            ok: false,
            error: 'That email address does not look right.',
        });
        const tooLong = {ok: false as const, error: 'The diagnostic logs are too long.'};
        assert.deepEquals(
            parseFeedbackRequest({
                ...good,
                diagnosticsInfo: 'x'.repeat(feedbackLimits.diagnosticsInfo + 1),
            }),
            tooLong,
        );
        assert.deepEquals(
            parseFeedbackRequest({
                ...good,
                diagnosticsLog: 'x'.repeat(feedbackLimits.diagnosticsLog + 1),
            }),
            tooLong,
        );
        assert.isTrue(
            parseFeedbackRequest({
                ...good,
                diagnosticsInfo: 'x'.repeat(feedbackLimits.diagnosticsInfo),
                diagnosticsLog: 'x'.repeat(feedbackLimits.diagnosticsLog),
            }).ok,
        );
    });
});

describe(looksLikeEmail.name, () => {
    it('accepts ordinary addresses and rejects malformed ones', () => {
        assert.isTrue(looksLikeEmail('a@b.co'));
        for (const bad of [
            '',
            'a',
            'a@b',
            '@b.com',
            'a@',
            'a@@b.com',
            'a b@c.com',
            'a@.com',
            'a@b.',
            'a<@b.com',
            `${'x'.repeat(250)}@b.com`,
        ]) {
            assert.isFalse(looksLikeEmail(bad), bad);
        }
    });
});

describe(isHoneypotTripped.name, () => {
    it('is true only for a non-empty website', () => {
        assert.isTrue(isHoneypotTripped({website: 'http://spam'}));
        assert.isFalse(isHoneypotTripped({website: ''}));
        assert.isFalse(isHoneypotTripped({website: undefined}));
    });
});

describe(trimOldestLines.name, () => {
    it('keeps whole newest lines, or the end of one huge line', () => {
        assert.strictEquals(trimOldestLines({text: 'a\nb', max: 10}), 'a\nb');
        assert.strictEquals(trimOldestLines({text: 'aaa\nbbb\nccc', max: 9}), 'bbb\nccc');
        assert.strictEquals(trimOldestLines({text: 'abcdefgh', max: 3}), 'fgh');
    });
});

describe(sanitizeDiagnosticText.name, () => {
    it('strips html and neutralizes backticks but leaves mentions', () => {
        assert.strictEquals(sanitizeDiagnosticText(' <b>x</b> ```y``` @me '), "x '''y''' @me");
    });
});

describe(isDiagnosticsAttached.name, () => {
    it('defaults on for problems only, until the person chooses', () => {
        assert.isTrue(isDiagnosticsAttached({kind: 'problem', userChoice: undefined}));
        assert.isFalse(isDiagnosticsAttached({kind: 'idea', userChoice: undefined}));
        assert.isFalse(isDiagnosticsAttached({kind: 'problem', userChoice: false}));
        assert.isTrue(isDiagnosticsAttached({kind: 'idea', userChoice: true}));
        assert.isTrue(
            isDiagnosticsAttached({
                kind: 'idea',
                userChoice: undefined,
                defaultKinds: ['idea', 'other'],
            }),
        );
        assert.isFalse(
            isDiagnosticsAttached({
                kind: 'problem',
                userChoice: undefined,
                defaultKinds: ['idea'],
            }),
        );
    });
});

describe(buildDiagnosticsSection.name, () => {
    it('is empty without diagnostics', () => {
        assert.strictEquals(buildDiagnosticsSection({}), '');
        assert.strictEquals(
            buildDiagnosticsSection({diagnosticsInfo: ' ', diagnosticsLog: '<i></i>'}),
            '',
        );
    });

    it('builds a collapsed fenced block that backticks cannot escape', () => {
        assert.strictEquals(
            buildDiagnosticsSection({diagnosticsInfo: 'app 1', diagnosticsLog: 'l1\n```\nl2'}),
            [
                '<details><summary>Diagnostic logs</summary>',
                '',
                '```text',
                'app 1',
                '',
                'log (oldest first):',
                "l1\n'''\nl2",
                '```',
                '',
                '</details>',
            ].join('\n'),
        );
        assert.isTrue(buildDiagnosticsSection({diagnosticsLog: 'only log'}).includes('only log'));
        assert.isFalse(
            buildDiagnosticsSection({diagnosticsInfo: 'only info'}).includes('log (oldest'),
        );
    });

    it('clips info and trims the log to the newest lines', () => {
        const section = buildDiagnosticsSection({
            diagnosticsInfo: 'i'.repeat(feedbackLimits.diagnosticsInfo + 10),
            diagnosticsLog: `zzzold\n${'n'.repeat(feedbackLimits.diagnosticsLog - 1)}`,
        });
        assert.isFalse(section.includes('zzzold'));
        assert.isTrue(section.includes('…'));
    });
});

describe('buildFeedbackIssue backward compatibility with 0.1.0', () => {
    it('produces the exact 0.1.0 text and labels for a 0.1.0 request', () => {
        const issue = issueFor(
            {
                kind: 'problem',
                message: 'The list is slow',
                page: '/list',
                version: '0.1.0',
                commit: 'abc',
            },
            'Marley',
        );
        assert.strictEquals(issue.title, '[App feedback] [Problem] The list is slow');
        assert.deepEquals(issue.labels, ['feedback', 'problem']);
        assert.strictEquals(
            issue.body,
            [
                '> **Submitted from the Shopping List app**',
                '',
                '- **Kind:** Problem',
                '- **From:** Marley',
                '- **Version:** 0.1.0',
                '- **Commit:** abc',
                '- **Page:** `/list`',
                `- **Date:** ${when}`,
                '',
                '---',
                '',
                'The list is slow',
            ].join('\n'),
        );
    });
});

describe('buildFeedbackIssue optional features', () => {
    const request = {kind: 'idea', message: 'hi', name: 'Typed Name', email: 'a@b.com'} as const;

    it('prefers a server sender over the typed name, then falls back to the name', () => {
        assert.isTrue(issueFor(request, 'Server').body.includes('- **From:** Server\n'));
        assert.isFalse(issueFor(request, 'Server').body.includes('Typed Name'));
        assert.isTrue(issueFor(request, undefined).body.includes('- **From:** Typed Name\n'));
        assert.isTrue(issueFor(request, '').body.includes('- **From:** Typed Name\n'));
        assert.isTrue(
            issueFor({kind: 'idea', message: 'hi'}, undefined).body.includes(
                '- **From:** unknown\n',
            ),
        );
    });

    it('adds a sanitized reply-to line only when there is an email', () => {
        assert.isTrue(
            issueFor(request).body.includes('- **From:** Ben\n- **Reply to:** a@b.com\n'),
        );
        assert.isFalse(issueFor({kind: 'idea', message: 'hi'}).body.includes('Reply to'));
        assert.isFalse(
            issueFor({kind: 'idea', message: 'hi', email: ''}).body.includes('Reply to'),
        );
        assert.isTrue(
            issueFor({...request, email: '<b>x</b>@y.com @z'}).body.includes(
                `- **Reply to:** x@y.com @${zeroWidthSpace}z`,
            ),
        );
    });

    it('overrides labels with base plus the per-kind entry', () => {
        const labels = {base: ['app-feedback'], byKind: {idea: ['idea'], problem: ['bug']}};
        const make = (kind: 'idea' | 'problem' | 'other') =>
            buildFeedbackIssue({
                request: {kind, message: 'x'},
                submittedAt: when,
                appName: 'A',
                labels,
            }).labels;
        assert.deepEquals(make('idea'), ['app-feedback', 'idea']);
        assert.deepEquals(make('problem'), ['app-feedback', 'bug']);
        assert.deepEquals(make('other'), ['app-feedback']);
    });

    it('appends diagnostics after the clipped body and stays under the GitHub limit', () => {
        const issue = issueFor({
            kind: 'problem',
            message: 'm'.repeat(feedbackLimits.message),
            page: 'p'.repeat(1000),
            diagnosticsInfo: 'i'.repeat(feedbackLimits.diagnosticsInfo),
            diagnosticsLog: 'l'.repeat(feedbackLimits.diagnosticsLog),
        });
        assert.isTrue(issue.body.includes('<details><summary>Diagnostic logs</summary>'));
        assert.isTrue(issue.body.length < 65_536);
        const [message = ''] = issue.body.split('\n\n<details>');
        assert.isTrue(message.length <= feedbackLimits.body);
        assert.endsWith(issue.body, '</details>');
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
