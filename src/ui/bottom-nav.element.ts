import {css, defineElement, defineElementEvent, html, listen} from 'element-vir';

/** One tab in the bottom nav. */
export type BottomNavTab = {
    /** Stable id, matched against `currentId` and sent back in `tabSelected`. */
    id: string;
    label: string;
    /** Where the tab's link points, so it still works as a plain link. */
    href: string;
    /** The `d` attribute of a 24x24 filled SVG path. */
    iconPath: string;
};

/**
 * A fixed, safe-area aware bar of icon plus label tabs. App agnostic: tabs come in as an input and
 * a tap comes out as `tabSelected` (the tab id). The default link navigation is cancelled for plain
 * clicks, so the host decides how to navigate.
 */
export const BottomNav = defineElement<{
    tabs: ReadonlyArray<BottomNavTab>;
    currentId: string | undefined;
    /** Accessible name of the nav landmark. */
    label?: string;
}>()({
    tagName: 'kit-bottom-nav',
    events: {
        tabSelected: defineElementEvent<string>(),
    },
    styles: css`
        :host {
            display: block;
            position: fixed;
            z-index: 10;
            right: 0;
            bottom: 0;
            left: 0;
        }

        nav {
            display: flex;
            box-sizing: border-box;
            max-width: 560px;
            margin: 0 auto;
            padding-bottom: env(safe-area-inset-bottom, 0px);
            padding-left: env(safe-area-inset-left, 0px);
            padding-right: env(safe-area-inset-right, 0px);
            border-top: 2px solid var(--kit-border, #b9a27f);
            background: var(--kit-surface, #ffffff);
        }

        a {
            position: relative;
            display: flex;
            flex: 1;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            gap: 2px;
            box-sizing: border-box;
            min-width: 44px;
            min-height: 56px;
            padding: 6px 4px;
            color: var(--kit-muted-text, #5c4631);
            font-size: 12px;
            text-decoration: none;
            -webkit-tap-highlight-color: transparent;
        }

        a[aria-current='page'] {
            color: var(--kit-text, #2b2118);
            font-weight: bold;
        }

        a[aria-current='page']::before {
            content: '';
            position: absolute;
            top: 0;
            right: 20%;
            left: 20%;
            height: 3px;
            background: var(--kit-accent, #6b4423);
        }

        a:focus-visible {
            outline: 3px solid var(--kit-focus, #1a5fd0);
            outline-offset: -3px;
        }

        svg {
            display: block;
            width: 24px;
            height: 24px;
            fill: currentColor;
        }

        @media print {
            :host {
                display: none;
            }
        }
    `,
    render({inputs, dispatch, events}) {
        return html`
            <nav aria-label=${inputs.label ?? 'Screens'}>
                ${inputs.tabs.map((tab) => {
                    return html`
                        <a
                            href=${tab.href}
                            aria-current=${tab.id === inputs.currentId ? 'page' : 'false'}
                            ${listen('click', (event) => {
                                if (
                                    event.button !== 0 ||
                                    event.metaKey ||
                                    event.ctrlKey ||
                                    event.shiftKey ||
                                    event.altKey
                                ) {
                                    return;
                                }
                                event.preventDefault();
                                dispatch(
                                    new events.tabSelected({
                                        detail: tab.id,
                                    }),
                                );
                            })}
                        >
                            <svg viewBox="0 0 24 24" aria-hidden="true">
                                <path d=${tab.iconPath} />
                            </svg>
                            <span>${tab.label}</span>
                        </a>
                    `;
                })}
            </nav>
        `;
    },
});
