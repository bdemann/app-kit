import {
    appendEntry,
    buildDiagnosticReport,
    formatDetails,
    formatLogLines,
    parseLog,
    serializeLog,
    type DiagnosticDetails,
    type DiagnosticEntry,
    type DiagnosticLogOptions,
} from '../data/diagnostic-log.js';
import {describeThrown, jsErrorDetails} from '../data/js-error.js';
import type {FeedbackDiagnosticsInput} from './feedback-page.element.js';

/**
 * PRIVACY: the log is for app events and errors only. Hosts must never log personal data: no
 * locations, names, emails or note text. Error messages are trimmed and URLs keep only the file
 * name.
 */
export type DiagnosticLog = {
    /** Appends an entry and saves it. Never throws. */
    log: (event: string, details?: DiagnosticDetails) => void;
    entries: () => DiagnosticEntry[];
    clear: () => void;
    /**
     * Logs `window` `error` and `unhandledrejection` as `js-error`. Returns a function that removes
     * the listeners. Calling this again while active adds nothing and returns the same remover.
     */
    captureErrors: () => () => void;
    /** A ready `diagnostics` input for `FeedbackPage`. */
    feedbackDiagnostics: (params: {
        /** App lines such as version and settings. Never personal data. */
        info: () => Record<string, string | number | boolean>;
        note?: string | undefined;
    }) => FeedbackDiagnosticsInput;
};

function isStandalone(): boolean {
    try {
        return (
            globalThis.matchMedia('(display-mode: standalone)').matches ||
            (globalThis.navigator as unknown as {standalone?: boolean}).standalone === true
        );
    } catch {
        return false;
    }
}

export function createDiagnosticLog({
    storageKey,
    options,
    now = () => Date.now(),
}: {
    storageKey: string;
    options?: DiagnosticLogOptions | undefined;
    /** Milliseconds since the epoch; replaceable for tests. */
    now?: (() => number) | undefined;
}): DiagnosticLog {
    let current: DiagnosticEntry[] | undefined;
    let removeListeners: (() => void) | undefined;

    function load(): DiagnosticEntry[] {
        if (!current) {
            let raw: string | null = null;
            try {
                raw = globalThis.localStorage.getItem(storageKey);
            } catch {
                /** Storage unavailable: start empty. */
            }
            current = parseLog({
                raw,
                nowMs: now(),
                options,
            });
        }
        return current;
    }

    function save(): void {
        try {
            globalThis.localStorage.setItem(storageKey, serializeLog(current ?? []));
        } catch {
            /** Storage full or unavailable: the log stays in memory. */
        }
    }

    function log(event: string, details?: DiagnosticDetails): void {
        try {
            const nowMs = now();
            current = appendEntry({
                log: load(),
                entry: {
                    at: new Date(nowMs).toISOString(),
                    event,
                    details: formatDetails({
                        details,
                        options,
                    }),
                },
                nowMs,
                options,
            });
            save();
        } catch {
            /** Diagnostics must never break the app. */
        }
    }

    function captureErrors(): () => void {
        if (removeListeners) {
            return removeListeners;
        }
        const onError = (event: ErrorEvent) => {
            const thrown = describeThrown(event.error);
            log(
                'js-error',
                jsErrorDetails({
                    kind: 'error',
                    name: event.error instanceof Error ? thrown.name : undefined,
                    message: event.message || thrown.message,
                    filename: event.filename || thrown.filename,
                    line: event.lineno || thrown.line,
                }),
            );
        };
        const onRejection = (event: PromiseRejectionEvent) => {
            const thrown = describeThrown(event.reason);
            log(
                'js-error',
                jsErrorDetails({
                    kind: 'rejection',
                    ...thrown,
                }),
            );
        };
        globalThis.addEventListener('error', onError);
        globalThis.addEventListener('unhandledrejection', onRejection);
        const remove = () => {
            globalThis.removeEventListener('error', onError);
            globalThis.removeEventListener('unhandledrejection', onRejection);
            removeListeners = undefined;
        };
        removeListeners = remove;
        return remove;
    }

    return {
        log,
        entries: () => [...load()],
        clear: () => {
            current = [];
            save();
        },
        captureErrors,
        feedbackDiagnostics: ({info, note}) => ({
            note,
            collect: () =>
                buildDiagnosticReport({
                    userAgent: globalThis.navigator?.userAgent ?? 'unknown',
                    online: globalThis.navigator?.onLine ?? true,
                    standalone: isStandalone(),
                    info: info(),
                    logLines: formatLogLines(load()),
                }),
        }),
    };
}
