import { defineConsultaAutofill } from "./component.js";

const FIELD_ELEMENT_NAME = "consulta-autofill-field";
const FORWARDED_ATTRIBUTES = ["project-id", "endpoint", "target-form", "document-type", "label"] as const;

const styleText = `
  :host { --consulta-autofill-field-control-padding: 3.25rem; position: relative; display: block; }
  ::slotted(input), ::slotted(textarea), ::slotted(select) { box-sizing: border-box; padding-inline-end: var(--consulta-autofill-field-control-padding); }
  .trigger { position: absolute; z-index: 1; inset-block-start: 50%; inset-inline-end: .3rem; margin-block-start: -1.225rem; }
`;

// Keeps the package importable from SSR/build tooling. Instances are only
// constructed by the browser's Custom Elements registry.
const HTMLElementBase: typeof HTMLElement =
  typeof HTMLElement === "undefined" ? (class {} as unknown as typeof HTMLElement) : HTMLElement;

/**
 * A drop-in field wrapper that places the Consulta camera trigger inside a
 * slotted native form control. The actual input stays in the partner's light
 * DOM, so native validation and framework bindings continue to work.
 */
export class ConsultaAutofillFieldElement extends HTMLElementBase {
  static get observedAttributes(): string[] {
    return [...FORWARDED_ATTRIBUTES];
  }

  private readonly shadow = this.attachShadow({ mode: "open" });
  private trigger: HTMLElement | null = null;

  connectedCallback(): void {
    this.render();
  }

  attributeChangedCallback(name: string, previous: string | null, current: string | null): void {
    if (previous === current || !FORWARDED_ATTRIBUTES.includes(name as (typeof FORWARDED_ATTRIBUTES)[number])) return;
    this.syncAttribute(name);
  }

  private render(): void {
    this.shadow.replaceChildren();
    const style = document.createElement("style");
    style.textContent = styleText;
    const slot = document.createElement("slot");
    const trigger = document.createElement("consulta-autofill");
    trigger.className = "trigger";
    trigger.setAttribute("trigger-variant", "icon");
    this.trigger = trigger;
    this.syncAttributes();
    this.shadow.append(style, slot, trigger);
  }

  private syncAttributes(): void {
    for (const name of FORWARDED_ATTRIBUTES) this.syncAttribute(name);
  }

  private syncAttribute(name: string): void {
    if (!this.trigger || !FORWARDED_ATTRIBUTES.includes(name as (typeof FORWARDED_ATTRIBUTES)[number])) return;
    const value = this.getAttribute(name);
    if (value === null) this.trigger.removeAttribute(name);
    else this.trigger.setAttribute(name, value);
  }
}

export function defineConsultaAutofillField(): void {
  if (typeof window === "undefined" || customElements.get(FIELD_ELEMENT_NAME)) return;
  defineConsultaAutofill();
  customElements.define(FIELD_ELEMENT_NAME, ConsultaAutofillFieldElement);
}
