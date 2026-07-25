export const A = () => <div dir="ltr">hard-coded → gap</div>;
export const B = ({ dir }: { dir: string }) => <div dir={dir}>dynamic → fine</div>;
export const styles = `
  .panel { direction: ltr; }
`; // direction:ltr in CSS-in-JS → gap
export const sel = `[dir="ltr"] .panel { color: red; }`; // an RTL-aware selector, not a hard-code
