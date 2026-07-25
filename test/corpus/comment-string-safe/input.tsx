// ml-4 mentioned in this line comment must NOT be flagged.
/* nor pr-2 inside this block comment, nor text-left */
export function Note() {
  const doc = 'use ml-4 here'; // a plain string mentioning ml-4 — not a class
  const help = `the pl-2 utility flips in RTL`; // template string, not a class
  return <p className="ml-4">{doc}{help}</p>; // only THIS ml-4 is a real gap
}
