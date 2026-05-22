import { ImageResponse } from 'next/og';

export const alt = 'supermarket.ie — Your AI grocery agent for Ireland';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

export default function Image() {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'flex-start',
          justifyContent: 'center',
          background: '#1D2324',
          padding: '80px',
          position: 'relative',
          overflow: 'hidden',
        }}
      >
        {/* Green accent blob top-right */}
        <div
          style={{
            position: 'absolute',
            top: -200,
            right: -200,
            width: 700,
            height: 700,
            borderRadius: '50%',
            background: 'radial-gradient(circle, rgba(0,106,53,0.4) 0%, transparent 70%)',
            display: 'flex',
          }}
        />
        {/* Subtle bottom-left accent */}
        <div
          style={{
            position: 'absolute',
            bottom: -150,
            left: -100,
            width: 500,
            height: 500,
            borderRadius: '50%',
            background: 'radial-gradient(circle, rgba(107,254,156,0.12) 0%, transparent 70%)',
            display: 'flex',
          }}
        />

        {/* Domain pill */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            background: 'rgba(107,254,156,0.15)',
            border: '1px solid rgba(107,254,156,0.3)',
            borderRadius: 100,
            padding: '8px 20px',
            marginBottom: 40,
          }}
        >
          <span style={{ color: '#6BFE9C', fontSize: 20, fontWeight: 600, letterSpacing: 1 }}>
            supermarket.ie
          </span>
        </div>

        {/* Headline */}
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            fontSize: 72,
            fontWeight: 800,
            color: '#F9F6F5',
            lineHeight: 1.1,
            maxWidth: 900,
            marginBottom: 32,
          }}
        >
          <span>Your AI grocery agent</span>
          <span style={{ color: '#6BFE9C' }}>for Ireland</span>
        </div>

        {/* Subtitle */}
        <div
          style={{
            display: 'flex',
            fontSize: 28,
            color: 'rgba(249,246,245,0.65)',
            maxWidth: 700,
            lineHeight: 1.4,
            marginBottom: 56,
          }}
        >
          Tracks prices across Tesco, Dunnes, SuperValu &amp; Aldi.
          Builds your weekly shop automatically.
        </div>

        {/* Stores row */}
        <div style={{ display: 'flex', gap: 16 }}>
          {['Tesco', 'Dunnes', 'SuperValu', 'Aldi'].map((store) => (
            <div
              key={store}
              style={{
                display: 'flex',
                background: 'rgba(255,255,255,0.08)',
                border: '1px solid rgba(255,255,255,0.12)',
                borderRadius: 12,
                padding: '10px 20px',
                color: 'rgba(249,246,245,0.75)',
                fontSize: 18,
                fontWeight: 500,
              }}
            >
              {store}
            </div>
          ))}
        </div>
      </div>
    ),
    { ...size },
  );
}
