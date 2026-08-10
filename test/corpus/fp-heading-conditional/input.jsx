// Headings in mutually-exclusive conditional branches must not read as a skip.
export const Card = ({ hero, showSub }) => (
  <article>
    {hero ? <h1>عنوان</h1> : <h3>عنوان</h3>}
    <p>نص</p>
    {showSub && <h4>عنوان فرعي</h4>}
  </article>
);
