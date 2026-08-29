/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono', 'ui-monospace', 'monospace']
      },
      colors: {
        brand: {
          DEFAULT: 'var(--accent)',
          soft: 'var(--accent)',
          muted: 'var(--accent)',
          dim: 'var(--accent-soft)'
        },
        surface: {
          0: 'var(--surface-0)',
          1: 'var(--surface-1)',
          2: 'var(--surface-2)',
          3: 'var(--surface-3)'
        },
        ink: {
          DEFAULT: 'var(--ink)',
          muted: 'var(--ink-muted)',
          soft: 'var(--ink-soft)',
          faint: 'var(--ink-faint)'
        },
        line: 'var(--line)',
        success: 'var(--success)',
        danger: 'var(--danger)'
      },
      boxShadow: {
        tooltip: 'var(--tooltip-shadow)',
        panel: '0 0 0 1px var(--line)',
        dropdown: 'var(--shadow-dropdown)'
      },
      transitionDuration: {
        panel: '220ms'
      }
    }
  },
  plugins: []
}
