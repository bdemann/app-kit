import {css, defineElement, html, listen, nothing} from 'element-vir';
import {
    commitUrl,
    compareCommits,
    describeLatestStatus,
    describeUpdateStatus,
    formatIsoTimestamp,
    shortCommitSha,
    updateStatusFromRegistration,
    type LatestStatus,
    type UpdateStatus,
} from '../data/about.js';

/** What the build knows about itself. */
export type AboutBuildInfo = {
    version: string;
    /** The full commit SHA (or "dev"). */
    commit: string;
    /** ISO timestamp. */
    buildTime: string | undefined;
};

/** A link at the bottom of the page. */
export type AboutLink = {label: string; href: string};

async function readUpdateStatus(): Promise<UpdateStatus> {
    const supported = 'serviceWorker' in navigator;
    const registration = supported ? await navigator.serviceWorker.getRegistration() : undefined;
    return updateStatusFromRegistration({
        supported,
        registered: !!registration,
        hasWaitingWorker: !!registration?.waiting,
    });
}

/**
 * An About page: the app's name and logo, the running build, whether a newer build is live, and the
 * service worker's update status. App agnostic: everything about the app comes in as an input.
 */
export const AboutPage = defineElement<{
    appName: string;
    logoUrl: string;
    /** The GitHub repo URL, used to link the commit. */
    repoUrl: string;
    buildInfo: AboutBuildInfo;
    /** Resolves to the commit that is deployed right now, or `undefined` when it cannot be read. */
    fetchLatestCommit: () => Promise<string | undefined>;
    links: ReadonlyArray<AboutLink>;
}>()({
    tagName: 'kit-about-page',
    styles: css`
        :host {
            display: block;
            color: inherit;
        }

        .identity {
            display: flex;
            align-items: center;
            gap: 16px;
            margin: 8px 0 16px;
        }

        img {
            width: 64px;
            height: 64px;
            border-radius: 14px;
        }

        h2 {
            margin: 0;
            font-size: 22px;
        }

        dl {
            display: grid;
            grid-template-columns: max-content 1fr;
            gap: 8px 16px;
            margin: 0 0 16px;
        }

        dt {
            font-weight: bold;
        }

        dd {
            margin: 0;
            overflow-wrap: anywhere;
        }

        .row {
            display: flex;
            flex-wrap: wrap;
            gap: 12px;
            margin: 0 0 16px;
        }

        button {
            min-height: 44px;
            padding: 0 16px;
            border: 2px solid var(--kit-accent, #6b4423);
            border-radius: 8px;
            background: var(--kit-surface, #ffffff);
            color: var(--kit-text, #2b2118);
            font: inherit;
            cursor: pointer;
        }

        button.primary {
            background: var(--kit-accent, #6b4423);
            color: var(--kit-on-accent, #ffffff);
        }

        ul {
            display: flex;
            flex-wrap: wrap;
            gap: 8px 20px;
            margin: 0;
            padding: 0;
            list-style: none;
        }

        a {
            display: inline-flex;
            align-items: center;
            min-height: 44px;
            color: inherit;
        }

        :is(button, a):focus-visible {
            outline: 3px solid var(--kit-focus, #1a5fd0);
            outline-offset: 2px;
        }
    `,
    state() {
        return {
            latest: 'loading' as LatestStatus | 'loading',
            updateStatus: 'checking' as UpdateStatus,
            started: false,
        };
    },
    render({inputs, state, updateState}) {
        async function refreshLatest() {
            const latestCommit = await inputs.fetchLatestCommit().catch(() => undefined);
            updateState({
                latest: compareCommits({
                    current: inputs.buildInfo.commit,
                    latest: latestCommit,
                }),
            });
        }

        async function refreshStatus() {
            updateState({
                updateStatus: await readUpdateStatus(),
            });
        }

        if (!state.started) {
            updateState({
                started: true,
            });
            void refreshLatest();
            void refreshStatus();
        }

        async function checkForUpdate() {
            updateState({
                updateStatus: 'checking',
                latest: 'loading',
            });
            try {
                const registration = await navigator.serviceWorker.getRegistration();
                await registration?.update();
            } catch {
                /** Offline or no service worker: the status below reports what is known. */
            }
            await Promise.all([refreshStatus(), refreshLatest()]);
        }

        async function reload() {
            try {
                const registration = await navigator.serviceWorker.getRegistration();
                await registration?.update();
                registration?.waiting?.postMessage({
                    type: 'SKIP_WAITING',
                });
            } catch {
                /** Reload anyway. */
            }
            globalThis.location.reload();
        }

        const {buildInfo} = inputs;
        const commitHref = commitUrl({
            repoUrl: inputs.repoUrl,
            commit: buildInfo.commit,
        });
        const shortCommit = shortCommitSha(buildInfo.commit);

        return html`
            <div class="identity">
                <img src=${inputs.logoUrl} alt="" width="64" height="64" />
                <h2>About ${inputs.appName}</h2>
            </div>
            <dl>
                <dt>Version</dt>
                <dd>${buildInfo.version}</dd>
                <dt>Commit</dt>
                <dd data-testid="commit">
                    ${commitHref
                        ? html`
                              <a href=${commitHref} target="_blank" rel="noopener noreferrer">
                                  ${shortCommit}
                              </a>
                          `
                        : shortCommit}
                </dd>
                <dt>Built</dt>
                <dd>${formatIsoTimestamp(buildInfo.buildTime)}</dd>
                <dt>Latest deployed</dt>
                <dd data-testid="latest" role="status">
                    ${state.latest === 'loading'
                        ? 'Checking...'
                        : describeLatestStatus(state.latest)}
                </dd>
                <dt>App updates</dt>
                <dd>${describeUpdateStatus(state.updateStatus)}</dd>
            </dl>
            <div class="row">
                <button type="button" ${listen('click', checkForUpdate)}>Check for update</button>
                ${state.latest === 'newer-available' || state.updateStatus === 'update-ready'
                    ? html`
                          <button type="button" class="primary" ${listen('click', reload)}>
                              Reload
                          </button>
                      `
                    : nothing}
            </div>
            <ul>
                ${inputs.links.map((link) => {
                    return html`
                        <li>
                            <a href=${link.href}>${link.label}</a>
                        </li>
                    `;
                })}
            </ul>
        `;
    },
});
