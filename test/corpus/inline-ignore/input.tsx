export const A = () => <div className="ml-4" />; // daleel-ignore  (whole line suppressed)
// daleel-ignore-next-line
export const B = () => <div className="pr-2" />;
export const C = () => (
  // daleel-ignore FONT
  <div className="pl-3" style={{ fontFamily: 'Inter, sans-serif' }} />
);
export const D = () => <div className="mr-1" />; // a real, un-ignored gap
