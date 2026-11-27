import Image from 'next/image';

/**
 * Suntec City brand marks (logo taken from sunteccity.com.sg/imgs/logo.png).
 * Product name stays "Suntec+ Play & Win" (Suntec+ is the loyalty programme).
 */

/** The Suntec City sphere on its own: headers, sidebars, small spaces. */
export function BrandMark({ size = 32, className }: { size?: number; className?: string }) {
  return <Image src="/brand/suntec-city-mark.png" alt="" width={size} height={size} className={className} priority />;
}

/** Product name in brand colours: navy text with the orange "+". */
export function ProductName({ className }: { className?: string }) {
  return (
    <span className={className}>
      <span className="text-brand-navy">Suntec</span>
      <span className="text-primary">+</span> <span className="text-brand-navy">Play &amp; Win</span>
    </span>
  );
}

/** Inline lockup: sphere + product name. */
export function BrandInline({ size = 32, subtitle, className }: { size?: number; subtitle?: string; className?: string }) {
  return (
    <span className={`inline-flex items-center gap-2 ${className ?? ''}`}>
      <BrandMark size={size} />
      <span className="leading-tight">
        <ProductName className="font-bold" />
        {subtitle && <span className="block text-xs font-medium text-text-muted">{subtitle}</span>}
      </span>
    </span>
  );
}

/** Stacked lockup for sign-in pages: full Suntec City logo, product name, subtitle. */
export function BrandHero({ subtitle, logoWidth = 150 }: { subtitle?: string; logoWidth?: number }) {
  return (
    <div className="mb-6 text-center">
      <Image
        src="/brand/suntec-city-logo.png"
        alt="Suntec City"
        width={logoWidth}
        height={Math.round((logoWidth * 275) / 441)}
        className="mx-auto"
        priority
      />
      <h1 className="mt-4 text-2xl font-bold">
        <ProductName />
      </h1>
      {subtitle && <p className="mt-1 text-sm text-text-muted">{subtitle}</p>}
    </div>
  );
}
