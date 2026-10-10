import { useState } from 'react';
import { ArrowUpRight, Check, Copy, Circle } from 'lucide-react';
import { Badge, Button, Card, Tooltip } from '@orbit/ui';
import { toast } from 'sonner';

export const palette = [
  {
    name: 'Midnight',
    token: '--background',
    hex: '#0D0F15',
    className: 'swatch-midnight',
    use: 'Canvas',
  },
  {
    name: 'Charcoal',
    token: '--surface',
    hex: '#14171F',
    className: 'swatch-charcoal',
    use: 'Surfaces',
  },
  {
    name: 'Electric violet',
    token: '--primary',
    hex: '#A99AFF',
    className: 'swatch-violet',
    use: 'Primary accent',
  },
  {
    name: 'Soft indigo',
    token: '--primary-strong',
    hex: '#8671F5',
    className: 'swatch-indigo',
    use: 'Emphasis',
  },
  {
    name: 'Glacier cyan',
    token: '--cyan',
    hex: '#76D7E5',
    className: 'swatch-cyan',
    use: 'Highlights',
  },
];
export async function copyTokens() {
  try {
    const computed = getComputedStyle(document.documentElement);
    const tokens = palette
      .map(({ token }) => `  ${token}: ${computed.getPropertyValue(token).trim()};`)
      .join('\n');
    await navigator.clipboard.writeText(`:root {\n${tokens}\n}`);
    toast.success('Theme tokens copied', {
      description: 'The palette for your current appearance is ready to paste.',
    });
  } catch {
    toast.error('Clipboard unavailable', {
      description: 'Your browser did not allow clipboard access.',
    });
  }
}

export function OrbitArtwork() {
  return (
    <div className="orbit-art" aria-hidden="true">
      <div className="art-grid" />
      <div className="art-glow" />
      <svg viewBox="0 0 500 260" fill="none">
        <defs>
          <linearGradient id="orbit-line" x1="90" y1="200" x2="370" y2="60">
            <stop stopColor="#7763de" stopOpacity=".2" />
            <stop offset=".5" stopColor="#c8bcff" />
            <stop offset="1" stopColor="#69d8e7" stopOpacity=".35" />
          </linearGradient>
          <radialGradient id="orbit-core">
            <stop stopColor="#dbd3ff" />
            <stop offset=".65" stopColor="#9b83f7" />
            <stop offset="1" stopColor="#5842b7" />
          </radialGradient>
        </defs>
        <ellipse
          cx="264"
          cy="127"
          rx="145"
          ry="48"
          transform="rotate(-29 264 127)"
          stroke="url(#orbit-line)"
          strokeWidth="1.3"
        />
        <ellipse
          cx="264"
          cy="127"
          rx="113"
          ry="78"
          transform="rotate(28 264 127)"
          stroke="url(#orbit-line)"
          strokeWidth=".8"
        />
        <ellipse
          cx="264"
          cy="127"
          rx="61"
          ry="107"
          transform="rotate(-30 264 127)"
          stroke="url(#orbit-line)"
          strokeWidth=".8"
        />
        <circle cx="264" cy="127" r="30" fill="url(#orbit-core)" />
        <circle cx="385" cy="58" r="5" fill="#aa9afa" />
        <circle cx="160" cy="162" r="3" fill="#7bd9e4" />
        <circle cx="242" cy="26" r="2" fill="#c5bafa" />
        <path d="M415 115h10m-5-5v10M104 76h8m-4-4v8" stroke="#a79bcd" strokeOpacity=".6" />
      </svg>
      <span className="art-caption">ONE SYSTEM. INFINITE POSSIBILITIES.</span>
    </div>
  );
}

export function ColorSection() {
  const [copied, setCopied] = useState('');
  return (
    <section id="colors" tabIndex={-1} className="lab-section">
      <div className="section-heading">
        <div>
          <p className="eyebrow">01 / COLOR</p>
          <h2>
            A palette with purpose<span>.</span>
          </h2>
          <p>Quiet foundations. A little electricity where it matters.</p>
        </div>
        <Badge>Semantic tokens</Badge>
      </div>
      <div className="palette-grid">
        {palette.map((color) => (
          <button
            key={color.name}
            className="color-card"
            aria-label={`Copy ${color.name} color token`}
            onClick={async () => {
              try {
                const value = getComputedStyle(document.documentElement)
                  .getPropertyValue(color.token)
                  .trim();
                await navigator.clipboard.writeText(`${color.token}: ${value}`);
                setCopied(color.name);
                toast.success(`${color.name} token copied`);
              } catch {
                toast.error('Clipboard unavailable');
              }
            }}
          >
            <div className={`color-swatch ${color.className}`}>
              <span>{color.use}</span>
              {copied === color.name ? <Check size={13} /> : <Copy size={13} />}
            </div>
            <div className="color-info">
              <strong>{color.name}</strong>
              <code>{color.token}</code>
            </div>
          </button>
        ))}
      </div>
      <p className="token-note">
        Swatches adapt to your theme. Click any color to copy its current value.
      </p>
    </section>
  );
}

export function TypographySection() {
  return (
    <section id="typography" tabIndex={-1} className="lab-section">
      <div className="section-heading">
        <div>
          <p className="eyebrow">02 / TYPOGRAPHY</p>
          <h2>
            Clarity, in every character<span>.</span>
          </h2>
          <p>Inter Variable. A considered hierarchy, from headlines to fine print.</p>
        </div>
        <Tooltip content="The font is served locally, without a third-party font request.">
          <Badge>Self-hosted font</Badge>
        </Tooltip>
      </div>
      <div className="type-grid">
        <Card className="type-specimen">
          <div className="specimen-label">
            <span>INTER VARIABLE</span>
            <span>100 — 900</span>
          </div>
          <div className="specimen-aa">
            Aa<span>.</span>
          </div>
          <p className="specimen-alphabet">
            ABCDEFGHIJKLMNOPQRSTUVWXYZ
            <br />
            abcdefghijklmnopqrstuvwxyz
            <br />
            0123456789 & @ # ! ?
          </p>
          <div className="specimen-footer">
            <Circle size={10} />
            <span>Made for interfaces. Built for readability.</span>
          </div>
        </Card>
        <Card className="type-scale">
          <div>
            <span className="type-display">Make room for great work.</span>
            <code>Display · 32 / 600</code>
          </div>
          <div>
            <span className="type-heading">Everything in its orbit.</span>
            <code>Heading · 22 / 550</code>
          </div>
          <div>
            <span className="type-body">A thoughtful system makes complex work feel simple.</span>
            <code>Body · 14 / 400</code>
          </div>
          <div>
            <span className="type-caption">SMALL DETAILS. LASTING DIFFERENCE.</span>
            <code>Caption · 10 / 600</code>
          </div>
        </Card>
      </div>
    </section>
  );
}

export function FoundationIntro() {
  return (
    <Card className="intro-card">
      <div>
        <div className="intro-symbol">✧</div>
        <p className="eyebrow">THE ORBIT DESIGN LANGUAGE</p>
        <h2>
          One language.
          <br />
          Every surface.
        </h2>
        <p>
          A shared foundation for focused work. Consistent tokens, accessible components, and
          interactions that feel effortless.
        </p>
        <Button variant="ghost" size="small" asChild>
          <a href="#components">
            Explore the components <ArrowUpRight />
          </a>
        </Button>
      </div>
      <div className="intro-details">
        <div>
          <span className="detail-number">01</span>
          <div>
            <strong>Thoughtfully composed</strong>
            <p>One scale for color, type, spacing, and motion.</p>
          </div>
        </div>
        <div>
          <span className="detail-number">02</span>
          <div>
            <strong>Accessible by design</strong>
            <p>Keyboard-first controls and clear focus states.</p>
          </div>
        </div>
        <div>
          <span className="detail-number">03</span>
          <div>
            <strong>Ready for both worlds</strong>
            <p>Dark and light. Desktop and mobile.</p>
          </div>
        </div>
      </div>
    </Card>
  );
}
