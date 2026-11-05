import {css, defineElement, defineElementEvent, html, listen} from 'element-vir';
import {collectFocusable, deepActiveElement} from './deep-focus.js';

type CloseEvents = {closeRequested: new (init: {detail: undefined}) => Event};

function closeEvent(events: CloseEvents): Event {
    return new events.closeRequested({
        detail: undefined,
    });
}

/**
 * A panel that slides in from the right over a dimmed backdrop. App agnostic: the host owns the
 * `open` flag and puts its content in the default slot.
 *
 * - Focus moves into the drawer on open, is trapped while open, and returns to the previously focused
 *   element on close.
 * - It asks to close (`closeRequested`) on Esc, a backdrop tap, the close button, a back gesture
 *   (`popstate`), and a click on any slotted element with a `data-drawer-close` attribute (or
 *   inside one). The host answers by setting `open` to false.
 * - `prefers-reduced-motion` turns the slide and fade off.
 */
export const SlideDrawer = defineElement<{
    open: boolean;
    /** Accessible name of the dialog. */
    label: string;
}>()({
    tagName: 'kit-slide-drawer',
    events: {
        closeRequested: defineElementEvent<void>(),
    },
    state() {
        return {
            /** The element to give focus back to when the drawer closes. */
            returnFocusTo: undefined as HTMLElement | undefined,
            wasOpen: false,
            cleanupListeners: undefined as (() => void) | undefined,
        };
    },
    styles: css`
        :host {
            display: contents;
        }

        .backdrop {
            position: fixed;
            z-index: 20;
            inset: 0;
            background: var(--kit-scrim, rgba(0, 0, 0, 0.45));
            opacity: 0;
            visibility: hidden;
            transition:
                opacity 0.2s ease,
                visibility 0s linear 0.2s;
        }

        .panel {
            position: fixed;
            z-index: 21;
            top: 0;
            right: 0;
            bottom: 0;
            display: flex;
            flex-direction: column;
            gap: 12px;
            box-sizing: border-box;
            width: min(320px, 85vw);
            padding: 12px 16px;
            padding-top: max(12px, env(safe-area-inset-top));
            padding-right: max(16px, env(safe-area-inset-right));
            padding-bottom: max(12px, env(safe-area-inset-bottom));
            overflow-y: auto;
            background: var(--kit-surface, #ffffff);
            color: var(--kit-text, #2b2118);
            box-shadow: -6px 0 16px rgba(0, 0, 0, 0.18);
            transform: translateX(100%);
            visibility: hidden;
            transition:
                transform 0.2s ease,
                visibility 0s linear 0.2s;
        }

        :host([data-open]) .backdrop {
            opacity: 1;
            visibility: visible;
            transition: opacity 0.2s ease;
        }

        :host([data-open]) .panel {
            transform: none;
            visibility: visible;
            transition: transform 0.2s ease;
        }

        .close {
            align-self: flex-end;
            min-width: 44px;
            min-height: 44px;
            border: 2px solid var(--kit-accent, #6b4423);
            border-radius: 10px;
            background: var(--kit-surface, #ffffff);
            color: var(--kit-text, #2b2118);
            font: inherit;
            font-size: 20px;
            cursor: pointer;
        }

        .close:focus-visible {
            outline: 3px solid var(--kit-focus, #1a5fd0);
            outline-offset: 2px;
        }

        @media (prefers-reduced-motion: reduce) {
            .backdrop,
            .panel,
            :host([data-open]) .backdrop,
            :host([data-open]) .panel {
                transition: none;
            }
        }

        @media print {
            .backdrop,
            .panel {
                display: none;
            }
        }
    `,
    init({host, dispatch, events}) {
        function requestClose() {
            dispatch(closeEvent(events));
        }
        function onKeydown(event: KeyboardEvent) {
            if (!host.instanceInputs.open) {
                return;
            }
            if (event.key === 'Escape') {
                event.preventDefault();
                requestClose();
            } else if (event.key === 'Tab') {
                const closeButton = host.shadowRoot.querySelector('.close');
                const slot = host.shadowRoot.querySelector('slot');
                const focusable = collectFocusable([
                    ...(closeButton ? [closeButton] : []),
                    ...(slot?.assignedElements({
                        flatten: true,
                    }) ?? []),
                ]);
                const active = deepActiveElement();
                const index = active ? focusable.indexOf(active) : -1;
                if (event.shiftKey && index <= 0) {
                    event.preventDefault();
                    focusable.at(-1)?.focus();
                } else if (!event.shiftKey && (index === -1 || index === focusable.length - 1)) {
                    event.preventDefault();
                    focusable[0]?.focus();
                }
            }
        }
        globalThis.addEventListener('popstate', requestClose);
        document.addEventListener('keydown', onKeydown);
        host.instanceState.cleanupListeners = () => {
            globalThis.removeEventListener('popstate', requestClose);
            document.removeEventListener('keydown', onKeydown);
        };
    },
    cleanup({host}) {
        host.instanceState.cleanupListeners?.();
    },
    render({inputs, state, updateState, host, dispatch, events}) {
        function requestClose() {
            dispatch(closeEvent(events));
        }
        host.toggleAttribute('data-open', inputs.open);

        if (inputs.open !== state.wasOpen) {
            if (inputs.open) {
                updateState({
                    wasOpen: true,
                    returnFocusTo: deepActiveElement(),
                });
                requestAnimationFrame(() => {
                    host.shadowRoot.querySelector<HTMLElement>('.close')?.focus();
                });
            } else {
                const target = state.returnFocusTo;
                updateState({
                    wasOpen: false,
                    returnFocusTo: undefined,
                });
                requestAnimationFrame(() => {
                    target?.focus();
                });
            }
        }

        return html`
            <div
                class="backdrop"
                ${listen('click', () => {
                    requestClose();
                })}
            ></div>
            <div
                class="panel"
                role="dialog"
                aria-modal="true"
                aria-label=${inputs.label}
                ?inert=${!inputs.open}
                ${listen('click', (event) => {
                    const clicked = event.composedPath().some((target) => {
                        return (
                            target instanceof HTMLElement &&
                            target.hasAttribute('data-drawer-close')
                        );
                    });
                    if (clicked) {
                        requestClose();
                    }
                })}
            >
                <button
                    type="button"
                    class="close"
                    aria-label="Close"
                    ${listen('click', requestClose)}
                >
                    &times;
                </button>
                <slot></slot>
            </div>
        `;
    },
});
