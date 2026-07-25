import Image from 'next/image';
export const A = () => <img src="/a.png" />;              // missing alt → gap
export const B = () => <img src="/b.png" alt="ok" />;      // fine
export const C = () => <Image src="/c.png" />;             // missing alt → gap
export const D = (rest: any) => <img {...rest} />;         // spread → unverifiable, skip
export const Doc = () => (
  <html>                                                   {/* missing lang → gap */}
    <body>hi</body>
  </html>
);
export const DocOk = ({ lang }: { lang: string }) => <html lang={lang}><body>hi</body></html>;
