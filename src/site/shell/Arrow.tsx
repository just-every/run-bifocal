/** The page's right arrow, drawn because neither face's Latin subset carries "→". It sits on the text's x-height
 * center, scales with the type and inherits its color. */
export const Arrow = ({ className = 'arrow' }: { className?: string }) =>
  <svg className={className} viewBox="0 0 20 16" aria-hidden="true" focusable="false"><path d="M1.5 8h15M11 2.5 16.5 8 11 13.5" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="square" strokeLinejoin="miter" /></svg>
