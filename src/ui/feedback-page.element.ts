import {css, defineElement, html, listen, nothing} from 'element-vir';
import {feedbackKinds, feedbackLimits, type FeedbackKind} from '../data/feedback.js';

/** What the page hands to the host's `send`. Page and version are attached by the host. */
export type FeedbackDraft = {
    kind: FeedbackKind;
    message: string;
};

export type FeedbackSendResult = {ok: true} | {ok: false; message: string};

const kindLabels: Readonly<Record<FeedbackKind, string>> = {
    idea: 'Idea',
    problem: 'Problem',
    other: 'Other',
};

function readDraft(key: string | undefined): string {
    if (!key) {
        return '';
    }
    try {
        return globalThis.localStorage.getItem(key) ?? '';
    } catch {
        return '';
    }
}

function writeDraft({key, value}: Readonly<{key: string | undefined; value: string}>): void {
    if (!key) {
        return;
    }
    try {
        if (value) {
            globalThis.localStorage.setItem(key, value);
        } else {
            globalThis.localStorage.removeItem(key);
        }
    } catch {
        /** Storage is unavailable: the draft just is not kept across reloads. */
    }
}

/**
 * A "send feedback" form: a kind (Idea / Problem / Other) and a message. App agnostic: the host
 * supplies `send`, which turns the draft into a GitHub issue (or whatever it likes) and reports
 * success or an error message.
 *
 * - While sending, the button is disabled. On failure the draft stays exactly as typed, the error is
 *   shown, and the same button retries.
 * - With `draftStorageKey`, the unsent message is also kept in localStorage so a reload, or a failure
 *   followed by closing the app, loses nothing. It is cleared once the send succeeds.
 */
export const FeedbackPage = defineElement<{
    send: (draft: Readonly<FeedbackDraft>) => Promise<FeedbackSendResult>;
    /** LocalStorage key for the unsent message. Leave out to not keep drafts. */
    draftStorageKey?: string | undefined;
}>()({
    tagName: 'kit-feedback-page',
    styles: css`
        :host {
            display: block;
            color: var(--kit-text, #2b2118);
        }

        h2 {
            margin: 12px 0 8px;
            font-size: 20px;
        }

        p {
            margin: 0 0 12px;
        }

        fieldset {
            margin: 0 0 12px;
            padding: 0;
            border: none;
        }

        legend {
            padding: 0;
            margin-bottom: 4px;
            font-size: 14px;
            color: var(--kit-muted-text, #5c4631);
        }

        .kinds {
            display: flex;
            flex-wrap: wrap;
            gap: 8px;
        }

        .kinds label {
            display: inline-flex;
            align-items: center;
            gap: 8px;
            box-sizing: border-box;
            min-height: 44px;
            padding: 0 14px;
            border: 2px solid var(--kit-accent, #6b4423);
            border-radius: 10px;
            background: var(--kit-surface, #ffffff);
            cursor: pointer;
        }

        .kinds label:has(input:checked) {
            background: var(--kit-accent, #6b4423);
            color: var(--kit-on-accent, #ffffff);
        }

        .kinds input {
            margin: 0;
        }

        .field {
            display: flex;
            flex-direction: column;
            gap: 4px;
            margin-bottom: 12px;
        }

        .field > span {
            font-size: 14px;
            color: var(--kit-muted-text, #5c4631);
        }

        textarea {
            box-sizing: border-box;
            width: 100%;
            min-height: 160px;
            padding: 10px;
            border: 2px solid var(--kit-accent, #6b4423);
            border-radius: 8px;
            font: inherit;
            color: inherit;
            resize: vertical;
        }

        .error {
            color: var(--kit-error, #a4262c);
            font-weight: bold;
        }

        button {
            min-height: 44px;
            padding: 0 20px;
            border: 2px solid var(--kit-accent, #6b4423);
            border-radius: 8px;
            background: var(--kit-accent, #6b4423);
            color: var(--kit-on-accent, #ffffff);
            font: inherit;
            font-weight: bold;
            cursor: pointer;
        }

        button:disabled {
            opacity: 0.6;
            cursor: default;
        }

        :is(button, input, textarea):focus-visible {
            outline: 3px solid var(--kit-focus, #1a5fd0);
            outline-offset: 2px;
        }
    `,
    state({inputs}) {
        return {
            kind: 'idea' as FeedbackKind,
            message: readDraft(inputs.draftStorageKey),
            status: 'idle' as 'idle' | 'sending' | 'sent',
            error: undefined as string | undefined,
            /** The last send failed, so the button offers a retry. */
            failed: false,
        };
    },
    render({state, inputs, updateState}) {
        if (state.status === 'sent') {
            return html`
                <h2>Send feedback</h2>
                <p role="status">Thank you. Your feedback has been sent.</p>
                <button
                    type="button"
                    ${listen('click', () => {
                        updateState({
                            status: 'idle',
                            message: '',
                            error: undefined,
                            failed: false,
                        });
                    })}
                >
                    Send another
                </button>
            `;
        }

        const sending = state.status === 'sending';

        async function submit() {
            if (!state.message.trim()) {
                updateState({
                    error: 'Please write a message first.',
                });
                return;
            }
            updateState({
                status: 'sending',
                error: undefined,
            });
            const result = await inputs.send({
                kind: state.kind,
                message: state.message,
            });
            if (result.ok) {
                writeDraft({
                    key: inputs.draftStorageKey,
                    value: '',
                });
                updateState({
                    status: 'sent',
                    message: '',
                    failed: false,
                });
            } else {
                /** The draft stays exactly as typed so the same button can retry. */
                updateState({
                    status: 'idle',
                    error: result.message,
                    failed: true,
                });
            }
        }

        return html`
            <h2>Send feedback</h2>
            <p>Suggest a change or report a problem. It goes straight to Benjamin's task list.</p>

            <fieldset>
                <legend>What kind of note is this?</legend>
                <div class="kinds">
                    ${feedbackKinds.map((kind) => {
                        return html`
                            <label>
                                <input
                                    type="radio"
                                    name="kind"
                                    value=${kind}
                                    .checked=${state.kind === kind}
                                    ${listen('change', () => {
                                        updateState({
                                            kind,
                                        });
                                    })}
                                />
                                ${kindLabels[kind]}
                            </label>
                        `;
                    })}
                </div>
            </fieldset>

            <label class="field">
                <span>Your message</span>
                <textarea
                    maxlength=${feedbackLimits.message}
                    .value=${state.message}
                    ${listen('input', (event) => {
                        const message = (event.target as HTMLTextAreaElement).value;
                        writeDraft({
                            key: inputs.draftStorageKey,
                            value: message,
                        });
                        updateState({
                            message,
                            error: undefined,
                        });
                    })}
                ></textarea>
            </label>

            ${state.error ? html` <p class="error" role="alert">${state.error}</p> ` : nothing}

            <button type="button" ?disabled=${sending} ${listen('click', submit)}>
                ${sending ? 'Sending...' : state.failed ? 'Retry' : 'Send'}
            </button>
        `;
    },
});
