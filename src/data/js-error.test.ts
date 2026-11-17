import assert from 'node:assert/strict';
import {describe, it} from 'node:test';
import {describeThrown, jsErrorDetails, maxJsErrorMessageLength, stripOrigin} from './js-error.js';

describe(stripOrigin.name, () => {
    it('keeps only the file name', () => {
        assert.equal(stripOrigin('https://host.example/assets/app-1.js?x=1#y'), 'app-1.js');
        assert.equal(stripOrigin('app.js'), 'app.js');
        assert.equal(stripOrigin(''), undefined);
        assert.equal(stripOrigin(undefined), undefined);
        assert.equal(stripOrigin('https://host/'), undefined);
    });
});

describe(jsErrorDetails.name, () => {
    it('builds details with file and line', () => {
        assert.deepEqual(
            jsErrorDetails({
                kind: 'error',
                name: 'TypeError',
                message: 'x is not a function\n    at foo',
                filename: 'https://h/assets/a.js',
                line: 12,
            }),
            {kind: 'error', name: 'TypeError', msg: 'x is not a function', at: 'a.js:12'},
        );
    });

    it('handles missing parts and cuts long messages', () => {
        assert.deepEqual(jsErrorDetails({kind: 'rejection'}), {
            kind: 'rejection',
            name: 'unknown',
            msg: '',
            at: undefined,
        });
        assert.equal(jsErrorDetails({kind: 'error', filename: 'a.js'}).at, 'a.js');
        const msg = jsErrorDetails({kind: 'error', message: 'z'.repeat(500)}).msg as string;
        assert.equal(msg.length, maxJsErrorMessageLength);
        assert.ok(msg.endsWith('…'));
    });
});

describe(describeThrown.name, () => {
    it('reads the stack location of an Error', () => {
        const error = new TypeError('boom');
        error.stack = 'TypeError: boom\n    at f (https://h.example/assets/a.js:10:5)';
        assert.deepEqual(describeThrown(error), {
            name: 'TypeError',
            message: 'boom',
            filename: 'https://h.example/assets/a.js',
            line: 10,
        });
    });

    it('copes with an Error without a usable stack', () => {
        const error = new Error('plain');
        delete (error as {stack?: string}).stack;
        assert.deepEqual(describeThrown(error), {name: 'Error', message: 'plain'});
    });

    it('describes non-errors', () => {
        assert.deepEqual(describeThrown('text'), {name: 'string', message: 'text'});
        assert.deepEqual(describeThrown(5), {name: 'number', message: ''});
    });
});
