/**
 * The phase contract of the three transaction modals, in queryable form.
 *
 * Every modal renders the flow's own view (progress, frozen preview, result,
 * error) ahead of the form in the scroll area, and hides the form in every
 * phase where it has nothing to contribute. That invariant is what four
 * consecutive "I can't see it" bugs came down to, so the three modal test
 * suites assert it phase by phase — through these queries, so the selector and
 * the ordering rule are defined once.
 *
 * Test-only: nothing in the app imports this.
 */
export const TRANSACTION_FORM_SECTIONS = '[data-testid="transaction-form-sections"]';

/** The wrapper holding every editable section of a transaction modal. */
export function formSections(): HTMLElement {
  const element = document.querySelector<HTMLElement>(TRANSACTION_FORM_SECTIONS);
  if (!element) throw new Error(`No element matched ${TRANSACTION_FORM_SECTIONS}`);
  return element;
}

export function formSectionsHidden(): boolean {
  return formSections().hasAttribute("hidden");
}

/** Whether the flow's own view sits ahead of the form, where it cannot be missed. */
export function precedesFormSections(element: Element): boolean {
  const position = element.compareDocumentPosition(formSections());
  return Boolean(position & Node.DOCUMENT_POSITION_FOLLOWING);
}
