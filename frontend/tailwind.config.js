/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        base: '#070A11',
        panel: '#0D131E',
        raised: '#131C2A',
        hover: '#182334',
        line: '#1D2838',
        lineSoft: '#161F2D',
        ink: '#E9EFF9',
        muted: '#8497B1',
        dim: '#596C85',
        signal: '#4C8EFF',
        signalDim: '#1D3558',
        agent: '#8B7BF7',
        ok: '#2FD4A0',
        warn: '#F6B43C',
        danger: '#FF5C6C',
        data: '#22D3EE'
      },
      fontFamily: {
        sans: [
          'system-ui',
          '-apple-system',
          'Segoe UI',
          'Roboto',
          'Helvetica Neue',
          'Arial',
          'sans-serif'
        ],
        mono: ['ui-monospace', 'SFMono-Regular', 'SF Mono', 'Menlo', 'Consolas', 'monospace']
      },
      fontSize: {
        '2xs': ['0.6875rem', { lineHeight: '1rem' }]
      },
      boxShadow: {
        panel: '0 1px 0 0 rgba(255,255,255,0.03) inset, 0 12px 32px -18px rgba(0,0,0,0.9)',
        drawer: '-24px 0 60px -24px rgba(0,0,0,0.85)'
      },
      keyframes: {
        pulseRing: {
          '0%': { transform: 'scale(0.85)', opacity: '0.9' },
          '70%': { transform: 'scale(1.6)', opacity: '0' },
          '100%': { transform: 'scale(1.6)', opacity: '0' }
        },
        sweep: {
          '0%': { transform: 'translateX(-100%)' },
          '100%': { transform: 'translateX(320%)' }
        },
        riseIn: {
          from: { opacity: '0', transform: 'translateY(6px)' },
          to: { opacity: '1', transform: 'translateY(0)' }
        }
      },
      animation: {
        pulseRing: 'pulseRing 1.8s cubic-bezier(0.2, 0.7, 0.4, 1) infinite',
        sweep: 'sweep 1.6s ease-in-out infinite',
        riseIn: 'riseIn 260ms ease-out both'
      }
    }
  },
  plugins: []
};
