export default function BrandPage() {
  const options = [
    {
      id: 'A',
      name: 'Bold S — Rounded',
      desc: 'A custom "S" mark — category-agnostic, strong at any size',
      icon: (size: number) => (
        <svg width={size} height={size} viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg">
          <rect width="40" height="40" rx={size * 0.25} fill="#E17055"/>
          <path d="M26 13.5C26 13.5 24.5 11 20 11C15.5 11 13 13.5 13 16.5C13 22.5 27 21 27 26.5C27 29.5 24.5 29 20 29C15.5 29 14 26.5 14 26.5" stroke="white" strokeWidth="3" strokeLinecap="round"/>
        </svg>
      ),
      wordmark: (
        <span style={{ fontWeight: 800, fontSize: 18, letterSpacing: '-0.03em', color: '#1D2324', fontFamily: 'system-ui' }}>
          supermarket<span style={{ color: '#E17055' }}>.ie</span>
        </span>
      ),
    },
    {
      id: 'B',
      name: 'Shopping Bag — Minimal',
      desc: 'Clean geometric bag. Universal commerce, no food associations',
      icon: (size: number) => (
        <svg width={size} height={size} viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg">
          <rect width="40" height="40" rx={size * 0.25} fill="#1D2324"/>
          <path d="M12 15H28L26 31H14L12 15Z" fill="white" fillOpacity="0.15" stroke="white" strokeWidth="2" strokeLinejoin="round"/>
          <path d="M15 15V13C15 10.8 16.8 9 19 9H21C23.2 9 25 10.8 25 13V15" stroke="white" strokeWidth="2" strokeLinecap="round"/>
          <path d="M17 22H23" stroke="#E17055" strokeWidth="2.5" strokeLinecap="round"/>
        </svg>
      ),
      wordmark: (
        <span style={{ fontWeight: 800, fontSize: 18, letterSpacing: '-0.03em', color: '#1D2324', fontFamily: 'system-ui' }}>
          supermarket<span style={{ color: '#E17055' }}>.ie</span>
        </span>
      ),
    },
    {
      id: 'C',
      name: 'Location Pin + Store',
      desc: 'Local discovery — find what\'s near you. Scales across all categories',
      icon: (size: number) => (
        <svg width={size} height={size} viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg">
          <rect width="40" height="40" rx={size * 0.25} fill="#E17055"/>
          <path d="M20 8C15.6 8 12 11.6 12 16C12 22 20 32 20 32C20 32 28 22 28 16C28 11.6 24.4 8 20 8Z" fill="white"/>
          <circle cx="20" cy="16" r="3.5" fill="#E17055"/>
        </svg>
      ),
      wordmark: (
        <span style={{ fontWeight: 800, fontSize: 18, letterSpacing: '-0.03em', color: '#1D2324', fontFamily: 'system-ui' }}>
          supermarket<span style={{ color: '#E17055' }}>.ie</span>
        </span>
      ),
    },
    {
      id: 'D',
      name: 'SM Monogram',
      desc: 'Bold two-letter mark. Distinct, scalable, works at 16px',
      icon: (size: number) => (
        <svg width={size} height={size} viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg">
          <rect width="40" height="40" rx={size * 0.25} fill="#E17055"/>
          <text x="20" y="27" textAnchor="middle" fill="white"
            style={{ fontSize: 17, fontWeight: 800, fontFamily: 'system-ui', letterSpacing: '-0.5px' }}>
            sm
          </text>
        </svg>
      ),
      wordmark: (
        <span style={{ fontWeight: 800, fontSize: 18, letterSpacing: '-0.03em', color: '#1D2324', fontFamily: 'system-ui' }}>
          supermarket<span style={{ color: '#E17055' }}>.ie</span>
        </span>
      ),
    },
    {
      id: 'E',
      name: 'Wordmark Only',
      desc: 'The name does the work. Clean, modern, no icon needed',
      icon: (size: number) => (
        <svg width={size} height={size} viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg">
          <rect width="40" height="40" rx={size * 0.25} fill="#E17055"/>
          <text x="20" y="26" textAnchor="middle" fill="white"
            style={{ fontSize: 13, fontWeight: 800, fontFamily: 'system-ui' }}>
            SM.ie
          </text>
        </svg>
      ),
      wordmark: (
        <span style={{ fontWeight: 800, fontSize: 20, letterSpacing: '-0.04em', color: '#1D2324', fontFamily: 'system-ui' }}>
          supermarket<span style={{ color: '#E17055' }}>.ie</span>
        </span>
      ),
    },
  ];

  const faviconSizes = [64, 32, 16];
  const navSize = 36;
  const cardSize = 80;

  return (
    <div style={{ minHeight: '100vh', background: '#FFFBF7', fontFamily: 'system-ui, sans-serif', padding: '32px 24px' }}>
      <div style={{ maxWidth: 900, margin: '0 auto' }}>
        <a href="/" style={{ color: '#636E72', fontSize: 14, textDecoration: 'none', display: 'block', marginBottom: 32 }}>← Back to site</a>
        <h1 style={{ fontSize: 28, fontWeight: 800, color: '#1D2324', marginBottom: 4 }}>Brand options</h1>
        <p style={{ color: '#636E72', marginBottom: 48, fontSize: 15 }}>Each option shown at nav size, card size, and favicon sizes (64px → 32px → 16px). The 16px test is the one that matters most.</p>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 32 }}>
          {options.map(opt => (
            <div key={opt.id} style={{ background: 'white', border: '1px solid #E8E2DC', borderRadius: 20, padding: 28 }}>
              {/* Header */}
              <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 24 }}>
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
                    <span style={{ background: '#FEF3E2', color: '#E17055', fontWeight: 700, fontSize: 12, padding: '2px 8px', borderRadius: 20 }}>Option {opt.id}</span>
                    <span style={{ fontWeight: 700, fontSize: 16, color: '#1D2324' }}>{opt.name}</span>
                  </div>
                  <p style={{ color: '#636E72', fontSize: 13, margin: 0 }}>{opt.desc}</p>
                </div>
              </div>

              {/* Nav preview */}
              <div style={{ marginBottom: 20 }}>
                <div style={{ fontSize: 11, fontWeight: 600, color: '#B2BEC3', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 10 }}>In the nav bar</div>
                <div style={{ background: 'white', border: '1px solid #E8E2DC', borderRadius: 12, padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 10 }}>
                  {opt.icon(navSize)}
                  {opt.wordmark}
                </div>
                {/* Dark nav variant */}
                <div style={{ background: '#1D2324', border: '1px solid #2D3436', borderRadius: 12, padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 10, marginTop: 8 }}>
                  {opt.icon(navSize)}
                  <span style={{ fontWeight: 800, fontSize: 18, letterSpacing: '-0.03em', color: 'white', fontFamily: 'system-ui' }}>
                    supermarket<span style={{ color: '#E17055' }}>.ie</span>
                  </span>
                </div>
              </div>

              {/* Card / app icon */}
              <div style={{ marginBottom: 20 }}>
                <div style={{ fontSize: 11, fontWeight: 600, color: '#B2BEC3', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 10 }}>App icon / OG image</div>
                <div style={{ display: 'flex', gap: 16, alignItems: 'flex-end' }}>
                  {opt.icon(cardSize)}
                </div>
              </div>

              {/* Favicon test — THE important one */}
              <div style={{ background: '#F5F0EB', borderRadius: 12, padding: 16 }}>
                <div style={{ fontSize: 11, fontWeight: 600, color: '#B2BEC3', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 12 }}>🔍 Favicon test — real sizes</div>
                <div style={{ display: 'flex', gap: 24, alignItems: 'flex-end' }}>
                  {faviconSizes.map(size => (
                    <div key={size} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
                      {opt.icon(size)}
                      <span style={{ fontSize: 11, color: '#B2BEC3' }}>{size}px</span>
                    </div>
                  ))}
                  {/* Browser tab simulation */}
                  <div style={{ marginLeft: 16 }}>
                    <div style={{ fontSize: 11, fontWeight: 600, color: '#B2BEC3', marginBottom: 6 }}>Browser tab</div>
                    <div style={{ background: '#E8E2DC', borderRadius: '8px 8px 0 0', padding: '6px 12px', display: 'flex', alignItems: 'center', gap: 6, width: 180 }}>
                      {opt.icon(16)}
                      <span style={{ fontSize: 11, color: '#636E72', overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>supermarket.ie</span>
                      <span style={{ marginLeft: 'auto', color: '#B2BEC3', fontSize: 11 }}>×</span>
                    </div>
                    <div style={{ background: 'white', height: 20, borderRadius: '0 0 4px 4px', border: '1px solid #E8E2DC' }}></div>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>

        <div style={{ marginTop: 48, padding: 24, background: 'white', borderRadius: 16, border: '1px solid #E8E2DC' }}>
          <h2 style={{ fontWeight: 700, fontSize: 16, color: '#1D2324', marginBottom: 8 }}>Recommendation</h2>
          <p style={{ color: '#636E72', fontSize: 14, lineHeight: 1.6, margin: 0 }}>
            For a platform expanding beyond groceries into electronics, pharma and restaurants — <strong>Option C (pin)</strong> or <strong>Option D (SM monogram)</strong> survive best at 16px and work across all categories. The pin communicates "local discovery" which is exactly what supermarket.ie is becoming. The monogram is the safest at tiny sizes.
          </p>
        </div>
      </div>
    </div>
  );
}
