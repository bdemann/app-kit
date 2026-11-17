import assert from 'node:assert/strict';
import {afterEach, describe, it} from 'node:test';
import {createDiagnosticLog} from './diagnostic-log.js';

type Listener = (event: unknown) => void;

function installGlobals({failStorage = false}: {failStorage?: boolean} = {}) {
    const store = new Map<string, string>();
    const listeners = new Map<string, Set<Listener>>();
    const g = globalThis as Record<string, unknown>;
    g['localStorage'] = {
        getItem: (key: string) => {
            if (failStorage) throw new Error('blocked');
            return store.get(key) ?? null;
        },
        setItem: (key: string, value: string) => {
            if (failStorage) throw new Error('blocked');
            store.set(key, value);
        },
    };
    g['addEventListener'] = (name: string, listener: Listener) => {
        const set = listeners.get(name) ?? new Set();
        set.add(listener);
        listeners.set(name, set);
    };
    g['removeEventListener'] = (name: string, listener: Listener) => {
        listeners.get(name)?.delete(listener);
    };
    g['matchMedia'] = () => ({matches: true});
    Object.defineProperty(globalThis, 'navigator', {
        configurable: true,
        value: {userAgent: 'UA', onLine: true},
    });
    return {
        store,
        fire: (name: string, event: unknown) => {
            for (const listener of listeners.get(name) ?? []) listener(event);
        },
        count: (name: string) => listeners.get(name)?.size ?? 0,
    };
}

afterEach(() => {
    const g = globalThis as Record<string, unknown>;
    delete g['localStorage'];
    delete g['addEventListener'];
    delete g['removeEventListener'];
    delete g['matchMedia'];
});

describe(createDiagnosticLog.name, () => {
    it('logs, persists, reloads and clears', () => {
        const env = installGlobals();
        const diag = createDiagnosticLog({storageKey: 'k', now: () => 1_000});
        diag.log('start', {a: 1});
        assert.equal(diag.entries()[0]?.details, 'a=1');
        assert.ok(env.store.get('k')?.includes('start'));
        const again = createDiagnosticLog({storageKey: 'k', now: () => 2_000});
        assert.equal(again.entries().length, 1);
        again.clear();
        assert.deepEqual(again.entries(), []);
        assert.equal(env.store.get('k'), '[]');
    });

    it('never throws when storage fails', () => {
        installGlobals({failStorage: true});
        const diag = createDiagnosticLog({storageKey: 'k'});
        diag.log('start');
        diag.clear();
        assert.equal(diag.entries().length, 0);
    });

    it('never throws when logging itself fails', () => {
        installGlobals();
        const diag = createDiagnosticLog({
            storageKey: 'k',
            now: () => {
                throw new Error('clock');
            },
        });
        diag.log('start');
    });

    it('captures errors once and can remove the listeners', () => {
        const env = installGlobals();
        const diag = createDiagnosticLog({storageKey: 'k'});
        const remove = diag.captureErrors();
        assert.equal(diag.captureErrors(), remove);
        assert.equal(env.count('error'), 1);
        assert.equal(env.count('unhandledrejection'), 1);

        const error = new TypeError('boom');
        error.stack = 'TypeError: boom\n    at f (https://h.example/a.js:3:4)';
        env.fire('error', {error, message: 'boom', filename: '', lineno: 0});
        env.fire('error', {error: undefined, message: 'plain', filename: 'b.js', lineno: 7});
        env.fire('unhandledrejection', {reason: 'nope'});
        assert.deepEqual(
            diag.entries().map((item) => item.details),
            [
                'kind=error name=TypeError msg=boom at=a.js:3',
                'kind=error name=unknown msg=plain at=b.js:7',
                'kind=rejection name=string msg=nope',
            ],
        );

        remove();
        assert.equal(env.count('error'), 0);
        assert.equal(env.count('unhandledrejection'), 0);
        diag.captureErrors()();
    });

    it('builds the feedback diagnostics input', () => {
        installGlobals();
        const diag = createDiagnosticLog({storageKey: 'k', now: () => Date.parse('2026-01-01')});
        diag.log('start');
        const input = diag.feedbackDiagnostics({info: () => ({app: 'v1'}), note: 'n'});
        assert.equal(input.note, 'n');
        const report = input.collect();
        assert.ok(report.info.includes('user agent: UA'));
        assert.ok(report.info.includes('online: true'));
        assert.ok(report.info.includes('standalone (installed app): true'));
        assert.ok(report.info.includes('app: v1'));
        assert.equal(report.log, '2026-01-01T00:00:00.000Z start');
    });

    it('reports not standalone and missing navigator safely', () => {
        installGlobals();
        (globalThis as Record<string, unknown>)['matchMedia'] = () => {
            throw new Error('no');
        };
        Object.defineProperty(globalThis, 'navigator', {configurable: true, value: undefined});
        const report = createDiagnosticLog({storageKey: 'k'})
            .feedbackDiagnostics({info: () => ({})})
            .collect();
        assert.ok(report.info.includes('user agent: unknown'));
        assert.ok(report.info.includes('standalone (installed app): false'));
    });
});
