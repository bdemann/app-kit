import type {DiagnosticDetails} from './diagnostic-log.js';

/**
 * Details for a `js-error` log line: what kind of failure, its name, the first line of the message
 * cut short, and where it happened. Messages can echo user text, so they are kept short; the file
 * has its origin stripped (only the file name stays, never a full URL).
 */

export const maxJsErrorMessageLength = 80;

function firstLineShort(text: string): string {
    const line = (text.split(/\r?\n/, 1)[0] as string).trim();
    return line.length > maxJsErrorMessageLength
        ? `${line.slice(0, maxJsErrorMessageLength - 1)}…`
        : line;
}

/** `https://host/assets/app-1.js?x#y` becomes `app-1.js`; unreadable input gives undefined. */
export function stripOrigin(filename: string | undefined): string | undefined {
    const path = (filename || '').split(/[?#]/, 1).join('');
    const name = path.slice(path.lastIndexOf('/') + 1);
    return name || undefined;
}

export function jsErrorDetails({
    kind,
    name,
    message,
    filename,
    line,
}: {
    kind: 'error' | 'rejection';
    name?: string | undefined;
    message?: string | undefined;
    filename?: string | undefined;
    line?: number | undefined;
}): DiagnosticDetails {
    const file = stripOrigin(filename);
    return {
        kind,
        name: name || 'unknown',
        msg: firstLineShort(message || ''),
        at: file ? (line ? `${file}:${line}` : file) : undefined,
    };
}

/** Name, message and (for Error objects) the first stack location of anything that was thrown. */
export function describeThrown(thrown: unknown): {
    name: string;
    message: string;
    filename?: string;
    line?: number;
} {
    if (thrown instanceof Error) {
        const match = /(?:\(|@|\s)((?:https?:\/\/|\/)[^\s()]+?):(\d+):\d+\)?\s*$/m.exec(
            (thrown.stack ?? '').split('\n').slice(1).join('\n'),
        );
        return {
            name: thrown.name,
            message: thrown.message,
            ...(match
                ? {
                      filename: match[1] as string,
                      line: Number(match[2]),
                  }
                : {}),
        };
    }
    return {
        name: typeof thrown,
        message: typeof thrown === 'string' ? thrown : '',
    };
}
