/**
 * A small capped, throttled diagnostic log that a feedback report can attach. Everything here is
 * pure; `createDiagnosticLog` in `@bdemann/app-kit/ui` does the storage and event wiring.
 *
 * PRIVACY: the log is for app events and errors only. Hosts must never log personal data: no
 * locations, names, emails or note text. Error messages are trimmed (`maxJsErrorMessageLength`) and
 * URLs keep only the file name (`stripOrigin`).
 */

export type DiagnosticEntry = {
    /** ISO timestamp. */
    at: string;
    event: string;
    /** Compact `key=value` pairs, may be empty. */
    details: string;
};

export type DiagnosticDetails = Readonly<Record<string, string | number | boolean | undefined>>;

export type DiagnosticLogLimits = {
    /** Routine entries: newest N. */
    maxEntries: number;
    maxAgeMs: number;
    /** Failure entries have their own cap and age, so routine lines cannot push them out. */
    maxFailureEntries: number;
    maxFailureAgeMs: number;
    /** Longest details string kept per entry. */
    maxDetailsLength: number;
    /** Same event with the same details within this window is recorded only once. */
    throttleMs: number;
};

export const defaultDiagnosticLogLimits: Readonly<DiagnosticLogLimits> = {
    maxEntries: 300,
    maxAgeMs: 48 * 60 * 60 * 1000,
    maxFailureEntries: 100,
    maxFailureAgeMs: 7 * 24 * 60 * 60 * 1000,
    maxDetailsLength: 320,
    throttleMs: 15_000,
};

export type DiagnosticLogOptions = {
    /** Overrides for any of the default limits. */
    limits?: Partial<DiagnosticLogLimits> | undefined;
    /** Events kept longer (own cap and age). Default `error`, `js-error`, `storage-error`. */
    failureEvents?: Iterable<string> | undefined;
    /**
     * Events whose repeat (same details as the previous entry of that event, within `throttleMs`) is
     * dropped. Default none.
     */
    throttledEvents?: Iterable<string> | undefined;
    /**
     * Events whose repeat is dropped when ANY recent entry of the event has the same details, so
     * alternating errors in a render loop cannot flood the log. Default `js-error`.
     */
    anyRepeatThrottledEvents?: Iterable<string> | undefined;
};

export const defaultFailureEvents: ReadonlySet<string> = new Set([
    'error',
    'js-error',
    'storage-error',
]);
export const defaultAnyRepeatThrottledEvents: ReadonlySet<string> = new Set(['js-error']);

type ResolvedOptions = {
    limits: Readonly<DiagnosticLogLimits>;
    failureEvents: ReadonlySet<string>;
    throttledEvents: ReadonlySet<string>;
    anyRepeatThrottledEvents: ReadonlySet<string>;
};

function resolveOptions(options: Readonly<DiagnosticLogOptions> | undefined): ResolvedOptions {
    return {
        limits: {
            ...defaultDiagnosticLogLimits,
            ...options?.limits,
        },
        failureEvents: options?.failureEvents
            ? new Set(options.failureEvents)
            : defaultFailureEvents,
        throttledEvents: new Set(options?.throttledEvents ?? []),
        anyRepeatThrottledEvents: options?.anyRepeatThrottledEvents
            ? new Set(options.anyRepeatThrottledEvents)
            : defaultAnyRepeatThrottledEvents,
    };
}

export function isDiagnosticEntry(value: unknown): value is DiagnosticEntry {
    if (typeof value !== 'object' || value == undefined) {
        return false;
    }
    const entry = value as Record<string, unknown>;
    return (
        typeof entry['at'] === 'string' &&
        typeof entry['event'] === 'string' &&
        typeof entry['details'] === 'string'
    );
}

/** `key=value` pairs on one line; whitespace in values becomes `_`; undefined values are skipped. */
export function formatDetails({
    details,
    options,
}: {
    details: DiagnosticDetails | undefined;
    options?: Readonly<DiagnosticLogOptions> | undefined;
}): string {
    if (!details) {
        return '';
    }
    const maxLength = resolveOptions(options).limits.maxDetailsLength;
    const text = Object.entries(details)
        .filter(([, value]) => value != undefined)
        .map(([key, value]) => `${key}=${String(value).replaceAll(/\s+/g, '_')}`)
        .join(' ');
    return text.length > maxLength ? `${text.slice(0, maxLength - 1)}…` : text;
}

function entryMs(entry: Readonly<DiagnosticEntry>): number {
    return Date.parse(entry.at);
}

/**
 * Drops entries past their age limit (or with an unreadable timestamp), then keeps the newest
 * routine and failure entries up to their caps. Order stays chronological.
 */
export function pruneLog({
    log,
    nowMs,
    options,
}: {
    log: ReadonlyArray<Readonly<DiagnosticEntry>>;
    nowMs: number;
    options?: Readonly<DiagnosticLogOptions> | undefined;
}): DiagnosticEntry[] {
    const {limits, failureEvents} = resolveOptions(options);
    const fresh = log.filter((entry) => {
        const age = nowMs - entryMs(entry);
        const maxAge = failureEvents.has(entry.event) ? limits.maxFailureAgeMs : limits.maxAgeMs;
        return Number.isFinite(age) && age <= maxAge;
    });
    const seen = {
        failure: 0,
        routine: 0,
    };
    const keep = new Set<Readonly<DiagnosticEntry>>();
    for (const entry of fresh.toReversed()) {
        const isFailure = failureEvents.has(entry.event);
        const key = isFailure ? 'failure' : 'routine';
        const cap = isFailure ? limits.maxFailureEntries : limits.maxEntries;
        if (seen[key] < cap) {
            seen[key]++;
            keep.add(entry);
        }
    }
    return fresh.filter((entry) => keep.has(entry));
}

/** Adds an entry, skipping a throttled repeat, then prunes. */
export function appendEntry({
    log,
    entry,
    nowMs,
    options,
}: {
    log: ReadonlyArray<Readonly<DiagnosticEntry>>;
    entry: Readonly<DiagnosticEntry>;
    nowMs: number;
    options?: Readonly<DiagnosticLogOptions> | undefined;
}): DiagnosticEntry[] {
    const resolved = resolveOptions(options);
    const {throttleMs} = resolved.limits;
    if (resolved.throttledEvents.has(entry.event)) {
        const previous = log.findLast((candidate) => candidate.event === entry.event);
        if (
            previous &&
            previous.details === entry.details &&
            entryMs(entry) - entryMs(previous) < throttleMs
        ) {
            return [...log];
        }
    }
    if (
        resolved.anyRepeatThrottledEvents.has(entry.event) &&
        log.some((candidate) => {
            return (
                candidate.event === entry.event &&
                candidate.details === entry.details &&
                entryMs(entry) - entryMs(candidate) < throttleMs
            );
        })
    ) {
        return [...log];
    }
    return pruneLog({
        log: [...log, entry],
        nowMs,
        options,
    });
}

export function serializeLog(log: ReadonlyArray<Readonly<DiagnosticEntry>>): string {
    return JSON.stringify(log);
}

/** Reads stored text; anything malformed yields an empty log or drops the bad entries. */
export function parseLog({
    raw,
    nowMs,
    options,
}: {
    raw: string | null | undefined;
    nowMs: number;
    options?: Readonly<DiagnosticLogOptions> | undefined;
}): DiagnosticEntry[] {
    if (!raw) {
        return [];
    }
    let parsed: unknown;
    try {
        parsed = JSON.parse(raw);
    } catch {
        return [];
    }
    if (!Array.isArray(parsed)) {
        return [];
    }
    return pruneLog({
        log: parsed.filter(isDiagnosticEntry),
        nowMs,
        options,
    });
}

/** One compact line per entry: `<ISO time> <event> <details>`. */
export function formatLogLines(log: ReadonlyArray<Readonly<DiagnosticEntry>>): string[] {
    return log.map((entry) => {
        const suffix = entry.details ? ' ' + entry.details : '';
        return `${entry.at} ${entry.event}${suffix}`;
    });
}

export type DiagnosticReportInput = {
    userAgent: string;
    online: boolean;
    standalone: boolean;
    /** The app's own lines (version, settings, ...). Never personal data. */
    info: Readonly<Record<string, string | number | boolean>>;
    /** Output of `formatLogLines`. */
    logLines: readonly string[];
};

export type DiagnosticReport = {
    /** Device lines, then the app's info lines. */
    info: string;
    /** One line per log entry, oldest first. */
    log: string;
};

export function buildDiagnosticReport(input: Readonly<DiagnosticReportInput>): DiagnosticReport {
    const extra = Object.entries(input.info)
        .toSorted((left, right) => left[0].localeCompare(right[0]))
        .map(([key, value]) => `${key}: ${String(value)}`);
    return {
        info: [
            `user agent: ${input.userAgent}`,
            `online: ${input.online}`,
            `standalone (installed app): ${input.standalone}`,
            ...extra,
        ].join('\n'),
        log: input.logLines.join('\n'),
    };
}
