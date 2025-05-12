import { html } from 'htm/preact';

/**
 * @param {{
 *   name: string,
 *   label: string,
 *   class: string,
 * }} props
 */
export function Icon({
  name,
  label,
  'class': className,
  ...additionalProps
}) {
  const imgUrl = `/images/${name}.svg#icon`;
  return html`
    <svg
      class=${`icon icon-${name} ${className || ''}`}
      role="img"
      aria-label=${label}
    >
      ${label && html`<title>${label}</title>`}
      <use href=${imgUrl}></use>
    </svg>
  `;
}