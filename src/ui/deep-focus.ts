const focusableSelector =
    'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** The focused element, looking through shadow roots. */
export function deepActiveElement(): HTMLElement | undefined {
    let active: Element | null = document.activeElement;
    while (active?.shadowRoot?.activeElement) {
        active = active.shadowRoot.activeElement;
    }
    return active instanceof HTMLElement ? active : undefined;
}

/** Every focusable element under the given nodes, in tab order, looking through shadow roots. */
export function collectFocusable(roots: ReadonlyArray<Node>): HTMLElement[] {
    const found: HTMLElement[] = [];
    function visit(node: Node) {
        if (!(node instanceof HTMLElement)) {
            return;
        }
        if (node.matches(focusableSelector)) {
            found.push(node);
        }
        if (node.shadowRoot) {
            [...node.shadowRoot.children].forEach(visit);
        }
        [...node.children].forEach(visit);
    }
    roots.forEach(visit);
    return found;
}
