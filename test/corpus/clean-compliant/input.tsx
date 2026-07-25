// A fully DGA-compliant component must produce zero findings (no false positives).
export const Panel = ({ dir, lang }: { dir: string; lang: string }) => (
  <div dir={dir} className="ms-4 pe-2 ps-1 text-start rounded-s-lg border-e"
       style={{ marginInlineStart: 8, fontFamily: 'IBM Plex Sans Arabic, sans-serif' }}>
    <img src="/logo.png" alt="الشعار" />
    <span className="space-y-2 divide-y inset-x-0 rounded-lg">محتوى</span>
  </div>
);
