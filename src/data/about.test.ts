import {describe, itCases} from '@augment-vir/test';
import {
    commitUrl,
    compareCommits,
    describeLatestStatus,
    describeUpdateStatus,
    formatIsoTimestamp,
    shortCommitSha,
    updateStatusFromRegistration,
} from './about.js';

describe(shortCommitSha.name, () => {
    itCases(shortCommitSha, [
        {
            it: 'shortens a SHA',
            input: 'abcdef1234567',
            expect: 'abcdef1',
        },
        {
            it: 'trims',
            input: '  abcdef1234567 ',
            expect: 'abcdef1',
        },
        {
            it: 'falls back for empty',
            input: '  ',
            expect: 'dev',
        },
        {
            it: 'falls back for undefined',
            input: undefined,
            expect: 'dev',
        },
    ]);
});

describe(commitUrl.name, () => {
    itCases(commitUrl, [
        {
            it: 'links a commit',
            input: {
                repoUrl: 'https://github.com/o/r/',
                commit: 'abc1234',
            },
            expect: 'https://github.com/o/r/commit/abc1234',
        },
        {
            it: 'links a commit when the repo URL has no trailing slash',
            input: {
                repoUrl: 'https://github.com/o/r',
                commit: 'abc1234',
            },
            expect: 'https://github.com/o/r/commit/abc1234',
        },
        {
            it: 'has no link for dev',
            input: {
                repoUrl: 'https://github.com/o/r',
                commit: 'dev',
            },
            expect: undefined,
        },
        {
            it: 'has no link for undefined',
            input: {
                repoUrl: 'https://github.com/o/r',
                commit: undefined,
            },
            expect: undefined,
        },
    ]);
});

describe(formatIsoTimestamp.name, () => {
    itCases(formatIsoTimestamp, [
        {
            it: 'reports unknown for undefined',
            inputs: [undefined],
            expect: 'unknown',
        },
        {
            it: 'reports unknown for empty',
            inputs: [''],
            expect: 'unknown',
        },
        {
            it: 'reports unknown for garbage',
            inputs: ['not a date'],
            expect: 'unknown',
        },
        {
            it: 'formats in the given time zone',
            inputs: [
                '2026-11-01T15:15:00.000Z',
                {
                    timezone: 'America/Denver',
                    locale: 'en-US',
                },
            ],
            expect: 'Nov 1, 2026, 8:15 AM MST',
        },
        {
            it: 'formats with defaults',
            inputs: ['2026-11-01T15:15:00.000Z'],
            expect: formatIsoTimestamp('2026-11-01T15:15:00.000Z', {}),
        },
    ]);
});

describe(compareCommits.name, () => {
    itCases(compareCommits, [
        {
            it: 'matches equal',
            input: {
                current: 'abc1234',
                latest: 'abc1234',
            },
            expect: 'up-to-date',
        },
        {
            it: 'matches a short and a full SHA',
            input: {
                current: 'ABC1234',
                latest: 'abc1234ffff',
            },
            expect: 'up-to-date',
        },
        {
            it: 'matches a full and a short SHA',
            input: {
                current: 'abc1234ffff',
                latest: 'abc1234',
            },
            expect: 'up-to-date',
        },
        {
            it: 'detects a newer one',
            input: {
                current: 'abc1234',
                latest: 'def5678',
            },
            expect: 'newer-available',
        },
        {
            it: 'cannot tell with dev current',
            input: {
                current: 'dev',
                latest: 'abc',
            },
            expect: 'unknown',
        },
        {
            it: 'cannot tell with dev latest',
            input: {
                current: 'abc',
                latest: 'dev',
            },
            expect: 'unknown',
        },
        {
            it: 'cannot tell with none',
            input: {
                current: 'abc',
                latest: undefined,
            },
            expect: 'unknown',
        },
    ]);
});

describe(describeLatestStatus.name, () => {
    itCases(describeLatestStatus, [
        {
            it: 'describes newer',
            input: 'newer-available',
            expect: 'A newer version is live',
        },
        {
            it: 'describes current',
            input: 'up-to-date',
            expect: 'Up to date',
        },
        {
            it: 'describes unknown',
            input: 'unknown',
            expect: 'Could not tell which version is live',
        },
    ]);
});

describe(describeUpdateStatus.name, () => {
    itCases(describeUpdateStatus, [
        {
            it: 'describes checking',
            input: 'checking',
            expect: 'Checking for updates...',
        },
        {
            it: 'describes ready',
            input: 'update-ready',
            expect: 'A new version is ready. Reload to use it.',
        },
        {
            it: 'describes unsupported',
            input: 'unsupported',
            expect: 'Offline support is not available in this browser.',
        },
        {
            it: 'describes up to date',
            input: 'up-to-date',
            expect: 'Up to date.',
        },
        {
            it: 'describes not registered',
            input: 'not-registered',
            expect: 'Not installed yet (the service worker is not active).',
        },
    ]);
});

describe(updateStatusFromRegistration.name, () => {
    itCases(updateStatusFromRegistration, [
        {
            it: 'is unsupported',
            input: {
                supported: false,
                registered: false,
                hasWaitingWorker: false,
            },
            expect: 'unsupported',
        },
        {
            it: 'is not registered',
            input: {
                supported: true,
                registered: false,
                hasWaitingWorker: false,
            },
            expect: 'not-registered',
        },
        {
            it: 'is up to date',
            input: {
                supported: true,
                registered: true,
                hasWaitingWorker: false,
            },
            expect: 'up-to-date',
        },
        {
            it: 'has an update ready',
            input: {
                supported: true,
                registered: true,
                hasWaitingWorker: true,
            },
            expect: 'update-ready',
        },
    ]);
});
