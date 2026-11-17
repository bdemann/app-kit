import assert from 'node:assert/strict';
import {describe, it} from 'node:test';
import {
    appendEntry,
    buildDiagnosticReport,
    defaultDiagnosticLogLimits,
    formatDetails,
    formatLogLines,
    parseLog,
    pruneLog,
    serializeLog,
    type DiagnosticEntry,
} from './diagnostic-log.js';

const nowMs = Date.parse('2026-01-10T12:00:00.000Z');

function entry(event: string, agoMs = 0, details = ''): DiagnosticEntry {
    return {at: new Date(nowMs - agoMs).toISOString(), event, details};
}

describe(formatDetails.name, () => {
    it('formats pairs, skips undefined, replaces whitespace', () => {
        assert.equal(
            formatDetails({details: {a: 1, b: 'x y', c: undefined, d: false}}),
            'a=1 b=x_y d=false',
        );
    });

    it('handles no details', () => {
        assert.equal(formatDetails({details: undefined}), '');
    });

    it('truncates to the limit', () => {
        const text = formatDetails({details: {a: 'x'.repeat(500)}});
        assert.equal(text.length, defaultDiagnosticLogLimits.maxDetailsLength);
        assert.ok(text.endsWith('…'));
        assert.equal(
            formatDetails({
                details: {a: 'x'.repeat(50)},
                options: {limits: {maxDetailsLength: 10}},
            }),
            'a=xxxxxxx…',
        );
    });
});

describe(pruneLog.name, () => {
    it('drops old and unreadable entries', () => {
        const day = 24 * 60 * 60 * 1000;
        const result = pruneLog({
            log: [
                entry('old', 3 * day),
                {at: 'nope', event: 'bad', details: ''},
                entry('keep', day),
                entry('error', 3 * day),
                entry('error', 8 * day),
            ],
            nowMs,
        });
        assert.deepEqual(
            result.map((item) => item.event),
            ['keep', 'error'],
        );
    });

    it('caps routine and failure entries separately', () => {
        const log = [
            entry('a', 5),
            entry('error', 4),
            entry('a', 3),
            entry('error', 2),
            entry('a', 1),
            entry('error', 0),
        ];
        const result = pruneLog({
            log,
            nowMs,
            options: {limits: {maxEntries: 1, maxFailureEntries: 2}},
        });
        assert.deepEqual(result, [log[3], log[4], log[5]]);
    });

    it('uses custom failure events', () => {
        const result = pruneLog({
            log: [entry('x', 1), entry('x', 0)],
            nowMs,
            options: {failureEvents: ['x'], limits: {maxFailureEntries: 1}},
        });
        assert.equal(result.length, 1);
    });
});

describe(appendEntry.name, () => {
    it('appends and prunes', () => {
        const result = appendEntry({
            log: [entry('a', 10)],
            entry: entry('b'),
            nowMs,
            options: {limits: {maxEntries: 1}},
        });
        assert.deepEqual(
            result.map((item) => item.event),
            ['b'],
        );
    });

    it('does not throttle by default except js-error repeats', () => {
        const log = [entry('a', 1000, 'x=1')];
        assert.equal(appendEntry({log, entry: entry('a', 0, 'x=1'), nowMs}).length, 2);
        const errors = [entry('js-error', 1000, 'x=1'), entry('js-error', 500, 'x=2')];
        assert.equal(
            appendEntry({log: errors, entry: entry('js-error', 0, 'x=1'), nowMs}).length,
            2,
        );
        assert.equal(
            appendEntry({log: errors, entry: entry('js-error', 0, 'x=3'), nowMs}).length,
            3,
        );
    });

    it('throttles a repeat of a throttled event within the window only', () => {
        const options = {throttledEvents: ['waiting']};
        const log = [entry('waiting', 1000, 'x=1')];
        assert.equal(
            appendEntry({log, entry: entry('waiting', 0, 'x=1'), nowMs, options}).length,
            1,
        );
        assert.equal(
            appendEntry({log, entry: entry('waiting', 0, 'x=2'), nowMs, options}).length,
            2,
        );
        assert.equal(
            appendEntry({
                log: [entry('waiting', 20_000, 'x=1')],
                entry: entry('waiting', 0, 'x=1'),
                nowMs,
                options,
            }).length,
            2,
        );
        assert.equal(appendEntry({log: [], entry: entry('waiting'), nowMs, options}).length, 1);
    });

    it('lets the any-repeat events be replaced', () => {
        const log = [entry('js-error', 1000, 'x=1')];
        assert.equal(
            appendEntry({
                log,
                entry: entry('js-error', 0, 'x=1'),
                nowMs,
                options: {anyRepeatThrottledEvents: []},
            }).length,
            2,
        );
    });
});

describe('serializeLog and parseLog', () => {
    it('round trips', () => {
        const log = [entry('a', 1), entry('error', 0, 'k=v')];
        assert.deepEqual(parseLog({raw: serializeLog(log), nowMs}), log);
    });

    it('is lenient', () => {
        assert.deepEqual(parseLog({raw: undefined, nowMs}), []);
        assert.deepEqual(parseLog({raw: null, nowMs}), []);
        assert.deepEqual(parseLog({raw: '{not json', nowMs}), []);
        assert.deepEqual(parseLog({raw: '{"a":1}', nowMs}), []);
        const good = entry('a');
        assert.deepEqual(
            parseLog({
                raw: JSON.stringify([good, 5, null, {at: 1, event: 'a', details: ''}, {at: 'x'}]),
                nowMs,
            }),
            [good],
        );
    });
});

describe(formatLogLines.name, () => {
    it('formats with and without details', () => {
        assert.deepEqual(formatLogLines([entry('a', 0, 'x=1'), entry('b')]), [
            `${new Date(nowMs).toISOString()} a x=1`,
            `${new Date(nowMs).toISOString()} b`,
        ]);
    });
});

describe(buildDiagnosticReport.name, () => {
    it('builds info and log text', () => {
        assert.deepEqual(
            buildDiagnosticReport({
                userAgent: 'UA',
                online: false,
                standalone: true,
                info: {zeta: 1, app: 'v1 (abc)'},
                logLines: ['one', 'two'],
            }),
            {
                info: 'user agent: UA\nonline: false\nstandalone (installed app): true\napp: v1 (abc)\nzeta: 1',
                log: 'one\ntwo',
            },
        );
    });
});
