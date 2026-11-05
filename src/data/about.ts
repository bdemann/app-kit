/** Shown when build info was not injected (tests, odd tooling) or a commit is not known. */
export const unknownBuildValue = 'dev';

/** Short (7 character) commit SHA, or "dev" when there is none. */
export function shortCommitSha(sha: string | undefined): string {
    const trimmed = sha?.trim();
    return trimmed ? trimmed.slice(0, 7) : unknownBuildValue;
}

/** True for a real commit SHA (not empty and not the "dev" placeholder). */
function isRealCommit(sha: string | undefined): sha is string {
    const trimmed = sha?.trim();
    return !!trimmed && trimmed !== unknownBuildValue;
}

/** The GitHub URL of a commit, or `undefined` when there is no real commit to link to. */
export function commitUrl({
    repoUrl,
    commit,
}: Readonly<{repoUrl: string; commit: string | undefined}>): string | undefined {
    return isRealCommit(commit)
        ? `${repoUrl.endsWith('/') ? repoUrl.slice(0, -1) : repoUrl}/commit/${commit.trim()}`
        : undefined;
}

/**
 * Formats an ISO timestamp in the given IANA time zone (default: the device's), like "Nov 1, 2026,
 * 9:15 AM MDT". Returns "unknown" when it is not a date. Uses `Intl` directly because date-vir
 * needs code generation, which the no-eval test run forbids.
 */
export function formatIsoTimestamp(
    iso: string | undefined,
    {timezone, locale}: Readonly<{timezone?: string | undefined; locale?: string | undefined}> = {},
): string {
    const epochMs = iso ? Date.parse(iso) : Number.NaN;
    if (Number.isNaN(epochMs)) {
        return 'unknown';
    }
    return new Intl.DateTimeFormat(locale, {
        timeZone: timezone,
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
        timeZoneName: 'short',
    }).format(epochMs);
}

/** How the running build compares to the one deployed right now. */
export type LatestStatus = 'up-to-date' | 'newer-available' | 'unknown';

/**
 * Compares the running commit with the deployed one. Either may be abbreviated (a prefix of the
 * other). When either is missing or "dev", it cannot tell.
 */
export function compareCommits({
    current,
    latest,
}: Readonly<{current: string | undefined; latest: string | undefined}>): LatestStatus {
    if (!isRealCommit(current) || !isRealCommit(latest)) {
        return 'unknown';
    }
    const currentTrimmed = current.trim().toLowerCase();
    const latestTrimmed = latest.trim().toLowerCase();
    return currentTrimmed.startsWith(latestTrimmed) || latestTrimmed.startsWith(currentTrimmed)
        ? 'up-to-date'
        : 'newer-available';
}

const latestStatusDescriptions: Record<LatestStatus, string> = {
    'up-to-date': 'Up to date',
    'newer-available': 'A newer version is live',
    unknown: 'Could not tell which version is live',
};

export function describeLatestStatus(status: LatestStatus): string {
    return latestStatusDescriptions[status];
}

/** Service worker lifecycle as the About page reports it. */
export type UpdateStatus =
    | 'unsupported'
    | 'not-registered'
    | 'up-to-date'
    | 'update-ready'
    | 'checking';

const updateStatusDescriptions: Record<UpdateStatus, string> = {
    unsupported: 'Offline support is not available in this browser.',
    'not-registered': 'Not installed yet (the service worker is not active).',
    'up-to-date': 'Up to date.',
    'update-ready': 'A new version is ready. Reload to use it.',
    checking: 'Checking for updates...',
};

export function describeUpdateStatus(status: UpdateStatus): string {
    return updateStatusDescriptions[status];
}

/** Decides the status from what the service worker registration exposes. */
export function updateStatusFromRegistration({
    supported,
    registered,
    hasWaitingWorker,
}: Readonly<{
    supported: boolean;
    registered: boolean;
    hasWaitingWorker: boolean;
}>): UpdateStatus {
    if (!supported) {
        return 'unsupported';
    } else if (registered) {
        return hasWaitingWorker ? 'update-ready' : 'up-to-date';
    } else {
        return 'not-registered';
    }
}
