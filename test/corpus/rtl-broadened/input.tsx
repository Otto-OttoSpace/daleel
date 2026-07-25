// Broadened RTL coverage: space-x, divide-x, inset, corners, scroll-*, arbitrary.
export const Grid = () => (
  <div className="space-x-4 divide-x left-0 right-full rounded-l-lg border-r-2 scroll-ml-2 [margin-left:3px]">
    <span className="space-x-reverse divide-x-reverse inset-x-2 rounded-lg border-blue-500">safe</span>
  </div>
);
