import { createTheme } from '@mui/material/styles';

/**
 * Design system for the ACME delivery console.
 *
 * Core rule: saturated colour is reserved for delivery status. Surfaces and
 * text stay neutral so that a red bar always means "this project is in
 * trouble" and never "this is a decorative heading". Interactive elements use
 * a cool blue that sits deliberately outside the status spectrum, so
 * "clickable" is never mistaken for "at risk".
 *
 * Numbers are set in a monospaced face. Budget and percentage columns need
 * their digits to align vertically to be scannable.
 */

export const STATUS = {
  healthy: '#3FB68B',
  watch: '#E0A33E',
  at_risk: '#E2703A',
  critical: '#D9455F',
  neutral: '#8B94A7',
};

// Deliverable and project lifecycle states mapped onto the same spectrum, so
// a colour means the same thing everywhere in the application.
export const STATE_COLOR = {
  completed: STATUS.healthy,
  active: STATUS.healthy,
  in_progress: '#5B8DEF',
  in_review: '#5B8DEF',
  planning: STATUS.neutral,
  not_started: STATUS.neutral,
  on_hold: STATUS.watch,
  blocked: STATUS.critical,
  cancelled: STATUS.neutral,
};

export const bandColor = (band) => STATUS[band] ?? STATUS.neutral;

const theme = createTheme({
  palette: {
    mode: 'dark',
    background: { default: '#12151C', paper: '#1A1F2B' },
    primary: { main: '#5B8DEF', contrastText: '#0B0E14' },
    secondary: { main: '#8B94A7' },
    success: { main: STATUS.healthy },
    warning: { main: STATUS.watch },
    error: { main: STATUS.critical },
    info: { main: '#5B8DEF' },
    divider: 'rgba(139, 148, 167, 0.18)',
    text: { primary: '#E8EBF0', secondary: '#8B94A7' },
  },

  shape: { borderRadius: 10 },

  typography: {
    fontFamily: '"Inter", system-ui, sans-serif',
    h1: { fontFamily: '"Space Grotesk", sans-serif', fontWeight: 600, fontSize: '2rem', letterSpacing: '-0.02em' },
    h2: { fontFamily: '"Space Grotesk", sans-serif', fontWeight: 600, fontSize: '1.5rem', letterSpacing: '-0.015em' },
    h3: { fontFamily: '"Space Grotesk", sans-serif', fontWeight: 600, fontSize: '1.2rem' },
    h6: { fontFamily: '"Space Grotesk", sans-serif', fontWeight: 600, letterSpacing: '-0.01em' },
    // Eyebrow labels above metrics and section headings.
    overline: {
      fontFamily: '"JetBrains Mono", monospace',
      fontSize: '0.68rem',
      letterSpacing: '0.12em',
      fontWeight: 500,
      color: '#8B94A7',
    },
    button: { textTransform: 'none', fontWeight: 500 },
  },

  components: {
    MuiCssBaseline: {
      styleOverrides: {
        // Respect the operating system's reduced-motion preference.
        '@media (prefers-reduced-motion: reduce)': {
          '*': { animationDuration: '0.01ms !important', transitionDuration: '0.01ms !important' },
        },
        // Keyboard focus must always be visible.
        ':focus-visible': { outline: '2px solid #5B8DEF', outlineOffset: '2px' },
        '.mono': { fontFamily: '"JetBrains Mono", monospace', fontVariantNumeric: 'tabular-nums' },
      },
    },
    MuiPaper: {
      styleOverrides: {
        root: { backgroundImage: 'none', border: '1px solid rgba(139,148,167,0.14)' },
      },
    },
    MuiCard: { defaultProps: { elevation: 0 } },
    MuiChip: {
      styleOverrides: {
        root: { fontFamily: '"JetBrains Mono", monospace', fontSize: '0.7rem', letterSpacing: '0.03em' },
      },
    },
    MuiButton: { defaultProps: { disableElevation: true } },
    MuiTableCell: {
      styleOverrides: {
        head: {
          fontFamily: '"JetBrains Mono", monospace',
          fontSize: '0.68rem',
          letterSpacing: '0.1em',
          textTransform: 'uppercase',
          color: '#8B94A7',
          borderBottom: '1px solid rgba(139,148,167,0.2)',
        },
        body: { borderBottom: '1px solid rgba(139,148,167,0.08)' },
      },
    },
  },
});

export default theme;
