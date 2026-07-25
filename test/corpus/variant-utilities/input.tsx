// Variant-prefixed physical utilities must be caught; logical ones must not.
export const A = () => (
  <div className="md:ml-4 hover:pr-2 rtl:text-left dark:md:mr-2 !pl-3">
    <span className="ms-4 me-2 ps-1 pe-1 text-start rounded-s-lg">safe</span>
  </div>
);
