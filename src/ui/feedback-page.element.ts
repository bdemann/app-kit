import {css, defineElement, html, listen, nothing} from 'element-vir';
import {
    feedbackKinds,
    feedbackLimits,
    isDiagnosticsAttached,
    looksLikeEmail,
    trimOldestLines,
    type FeedbackKind,
} from '../data/feedback.js';

/**
 * What the page hands to the host's `send`. Page and version are attached by the host. The
 * optional fields are only present when the matching page input is turned on.
 */
export type FeedbackDraft = {
    kind: FeedbackKind;
    message: string;
    /** With `contactFields`: trimmed, possibly empty. */
    name?: string | undefined;
    /** With `contactFields`: trimmed, possibly empty, and valid when non-empty. */
    email?: string | undefined;
    /** With `honeypot`: whatever is in the hidden field (a bot fills it). */
    website?: string | undefined;
    /** With `diagnostics` checked: the info lines from `collect()`. */
    diagnosticsInfo?: string | undefined;
    /** With `diagnostics` checked: the log from `collect()`, oldest lines trimmed to the limit. */
    diagnosticsLog?: string | undefined;
};

/** Diagnostics the page can attach, and how. */
export type FeedbackDiagnosticsInput = {
    /** Default "Attach diagnostic logs". */
    label?: string | undefined;
    /**
     * One muted sentence shown under the checkbox row (not inside the label) and tied to the checkbox
     * with `aria-describedby`. Keeps the label short on a narrow phone. Nothing is shown without it.
     */
    note?: string | undefined;
    /** Kinds that start with the box checked. Default only `problem`. */
    defaultKinds?: ReadonlyArray<FeedbackKind> | undefined;
    /** Called on each render, so the "What will be sent" preview is exactly what is attached. */
    collect: () => {info: string; log: string};
};

/** Starting values, applied once when the element is created. */
export type FeedbackPrefill = {
    kind?: FeedbackKind | undefined;
    /** Wins over a stored draft. */
    message?: string | undefined;
    /** Whether diagnostics start attached, whatever the kind. */
    attachDiagnostics?: boolean | undefined;
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

function readContact(key: string | undefined): {name: string; email: string} {
    const empty = {
        name: '',
        email: '',
    };
    if (!key) {
        return empty;
    }
    try {
        const parsed: unknown = JSON.parse(globalThis.localStorage.getItem(key) ?? 'null');
        const record = (typeof parsed === 'object' && parsed ? parsed : {}) as Record<
            string,
            unknown
        >;
        return {
            name: typeof record['name'] === 'string' ? record['name'] : '',
            email: typeof record['email'] === 'string' ? record['email'] : '',
        };
    } catch {
        return empty;
    }
}

function writeContact({
    key,
    name,
    email,
}: Readonly<{key: string | undefined; name: string; email: string}>): void {
    if (!key) {
        return;
    }
    try {
        globalThis.localStorage.setItem(
            key,
            JSON.stringify({
                name,
                email,
            }),
        );
    } catch {
        /** Storage is unavailable: the contact details are just not remembered. */
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
    /** Replaces the sentence under the heading. */
    intro?: string | undefined;
    /** Shows optional "Name" and "Email" fields; an invalid email blocks sending. */
    contactFields?: boolean | undefined;
    /** LocalStorage key that remembers the name and email between visits. */
    contactStorageKey?: string | undefined;
    /** Shows an "attach diagnostic logs" checkbox with a "What will be sent" preview. */
    diagnostics?: FeedbackDiagnosticsInput | undefined;
    /** Starting values, applied once when the element is created. */
    prefill?: FeedbackPrefill | undefined;
    /** Renders a visually hidden "Website" field that only bots fill in. */
    honeypot?: boolean | undefined;
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

        /** Every text control shares one explicit background so none falls back to the browser's. */
        textarea,
        input[type='text'],
        input[type='email'],
        pre {
            background: var(--kit-field, var(--kit-surface, #ffffff));
            color: var(--kit-text, #2b2118);
        }

        textarea,
        input[type='text'],
        input[type='email'] {
            font: inherit;
        }

        textarea::placeholder,
        input::placeholder {
            color: var(--kit-muted-text, #5c4631);
            opacity: 1;
        }

        textarea {
            box-sizing: border-box;
            width: 100%;
            min-height: 160px;
            padding: 10px;
            border: 2px solid var(--kit-accent, #6b4423);
            border-radius: 8px;
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

        input[type='text'],
        input[type='email'] {
            box-sizing: border-box;
            width: 100%;
            min-height: 44px;
            padding: 0 10px;
            border: 2px solid var(--kit-accent, #6b4423);
            border-radius: 8px;
        }

        .hint {
            font-size: 14px;
            color: var(--kit-muted-text, #5c4631);
        }

        .attach {
            display: flex;
            align-items: center;
            gap: 10px;
            min-height: 44px;
            margin-bottom: 4px;
            cursor: pointer;
        }

        .attach input {
            width: 22px;
            height: 22px;
            margin: 0;
            accent-color: var(--kit-accent, #6b4423);
        }

        .attach-note {
            /** Lines up with the label text: checkbox width (22px) plus the row gap (10px). */
            margin: 0 0 4px 32px;
            font-size: 14px;
            color: var(--kit-muted-text, #5c4631);
        }

        details {
            margin-bottom: 12px;
        }

        summary {
            display: flex;
            align-items: center;
            min-height: 44px;
            font-size: 14px;
            color: var(--kit-muted-text, #5c4631);
            cursor: pointer;
        }

        pre {
            max-height: 240px;
            overflow: auto;
            margin: 4px 0 0;
            padding: 10px;
            border: 1px solid var(--kit-border, #b9a27f);
            border-radius: 8px;
            font-size: 12px;
            white-space: pre-wrap;
            overflow-wrap: anywhere;
            color: var(--kit-muted-text, #5c4631);
        }

        /** Honeypot: off the page and out of the accessibility tree, but still in the DOM. */
        .trap {
            position: absolute;
            width: 1px;
            height: 1px;
            overflow: hidden;
            clip-path: inset(50%);
            white-space: nowrap;
        }

        .field-error {
            margin: 0;
            font-size: 14px;
            color: var(--kit-error, #a4262c);
            font-weight: bold;
        }

        :is(button, input, textarea, summary):focus-visible {
            outline: 3px solid var(--kit-focus, #1a5fd0);
            outline-offset: 2px;
        }
    `,
    state({inputs}) {
        const contact = inputs.contactFields
            ? readContact(inputs.contactStorageKey)
            : {
                  name: '',
                  email: '',
              };
        return {
            kind: inputs.prefill?.kind ?? ('idea' as FeedbackKind),
            /** A prefill message beats a stored draft. */
            message: inputs.prefill?.message ?? readDraft(inputs.draftStorageKey),
            name: contact.name,
            email: contact.email,
            website: '',
            /** Undefined until the person touches the box; then their choice wins. */
            attachChoice: inputs.prefill?.attachDiagnostics as boolean | undefined,
            emailError: undefined as string | undefined,
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
                            website: '',
                            error: undefined,
                            emailError: undefined,
                            failed: false,
                        });
                    })}
                >
                    Send another
                </button>
            `;
        }

        const sending = state.status === 'sending';
        const attach =
            !!inputs.diagnostics &&
            isDiagnosticsAttached({
                kind: state.kind,
                userChoice: state.attachChoice,
                defaultKinds: inputs.diagnostics.defaultKinds,
            });
        /** Collected on render so the preview is exactly what would be sent. */
        const collected = attach ? inputs.diagnostics?.collect() : undefined;
        const report = collected && {
            info: collected.info.slice(0, feedbackLimits.diagnosticsInfo),
            log: trimOldestLines({
                text: collected.log,
                max: feedbackLimits.diagnosticsLog,
            }),
        };

        async function submit() {
            if (!state.message.trim()) {
                updateState({
                    error: 'Please write a message first.',
                });
                return;
            }
            const name = state.name.trim();
            const email = state.email.trim();
            if (inputs.contactFields && email && !looksLikeEmail(email)) {
                updateState({
                    emailError: 'That email address does not look right.',
                });
                return;
            }
            if (inputs.contactFields) {
                writeContact({
                    key: inputs.contactStorageKey,
                    name,
                    email,
                });
            }
            updateState({
                status: 'sending',
                error: undefined,
            });
            const result = await inputs.send({
                kind: state.kind,
                message: state.message,
                ...(inputs.contactFields
                    ? {
                          name,
                          email,
                      }
                    : {}),
                ...(inputs.honeypot
                    ? {
                          website: state.website,
                      }
                    : {}),
                ...(report
                    ? {
                          diagnosticsInfo: report.info,
                          diagnosticsLog: report.log,
                      }
                    : {}),
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
            <p>
                ${inputs.intro ??
                "Suggest a change or report a problem. It goes straight to Benjamin's task list."}
            </p>

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

            ${inputs.contactFields
                ? html`
                      <label class="field">
                          <span>Name (optional)</span>
                          <input
                              type="text"
                              maxlength=${feedbackLimits.name}
                              autocomplete="name"
                              .value=${state.name}
                              ${listen('input', (event) => {
                                  updateState({
                                      name: (event.target as HTMLInputElement).value,
                                  });
                              })}
                          />
                      </label>

                      <label class="field">
                          <span>Email (optional, if you'd like a reply)</span>
                          <input
                              type="email"
                              maxlength=${feedbackLimits.email}
                              autocomplete="email"
                              aria-invalid=${state.emailError ? 'true' : 'false'}
                              .value=${state.email}
                              ${listen('input', (event) => {
                                  updateState({
                                      email: (event.target as HTMLInputElement).value,
                                      emailError: undefined,
                                  });
                              })}
                          />
                          ${state.emailError
                              ? html` <p class="field-error" role="alert">${state.emailError}</p> `
                              : nothing}
                      </label>
                  `
                : nothing}
            ${inputs.diagnostics
                ? html`
                      <label class="attach">
                          <input
                              type="checkbox"
                              .checked=${attach}
                              aria-describedby=${inputs.diagnostics.note ? 'attach-note' : nothing}
                              ${listen('change', (event) => {
                                  updateState({
                                      attachChoice: (event.target as HTMLInputElement).checked,
                                  });
                              })}
                          />
                          ${inputs.diagnostics.label ?? 'Attach diagnostic logs'}
                      </label>
                      ${inputs.diagnostics.note
                          ? html`
                                <p class="attach-note" id="attach-note">
                                    ${inputs.diagnostics.note}
                                </p>
                            `
                          : nothing}
                      ${report
                          ? html`
                                <details>
                                    <summary>What will be sent</summary>
                                    <pre>
${[report.info, report.log].filter(Boolean).join('\n\n')}</pre
                                    >
                                </details>
                            `
                          : nothing}
                  `
                : nothing}
            ${inputs.honeypot
                ? html`
                      <div class="trap" aria-hidden="true">
                          <label>
                              Website
                              <input
                                  type="text"
                                  tabindex="-1"
                                  autocomplete="off"
                                  .value=${state.website}
                                  ${listen('input', (event) => {
                                      updateState({
                                          website: (event.target as HTMLInputElement).value,
                                      });
                                  })}
                              />
                          </label>
                      </div>
                  `
                : nothing}
            ${state.error ? html` <p class="error" role="alert">${state.error}</p> ` : nothing}

            <button type="button" ?disabled=${sending} ${listen('click', submit)}>
                ${sending ? 'Sending...' : state.failed ? 'Retry' : 'Send'}
            </button>
        `;
    },
});
