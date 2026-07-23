import {
  Alert, Box, Card, CardContent, Chip, LinearProgress, Skeleton, Stack, Tooltip, Typography,
} from '@mui/material';
import { STATE_COLOR, STATUS, bandColor } from '../theme';

export function StatusChip({ status, size = 'small' }) {
  const color = STATE_COLOR[status] ?? STATUS.neutral;
  return (
    <Chip
      size={size}
      label={String(status).replace(/_/g, ' ')}
      sx={{ bgcolor: `${color}22`, color, border: `1px solid ${color}55`, fontWeight: 500 }}
    />
  );
}

/** A signal chip drawn from the shared status spectrum. */
export function SignalChip({ label, tone = 'neutral' }) {
  const color = STATUS[tone] ?? STATUS.neutral;
  return (
    <Chip size="small" label={label} sx={{ bgcolor: `${color}22`, color, border: `1px solid ${color}44` }} />
  );
}

/**
 * SIGNATURE ELEMENT -- the slip bar.
 *
 * The planned end date is a fixed white marker. Forecast overrun extends past
 * it in the risk colour, so slippage is something you see rather than read.
 */
export function SlipBar({ plannedDays, forecastDays, variance, height = 26 }) {
  if (!forecastDays || !plannedDays) {
    return (
      <Typography variant="caption" color="text.secondary" className="mono">
        no forecast — needs measurable progress
      </Typography>
    );
  }

  const total = Math.max(plannedDays, forecastDays);
  const plannedPct = (plannedDays / total) * 100;
  const overrunPct = Math.max(0, ((forecastDays - plannedDays) / total) * 100);
  const late = variance > 0;
  const overrunColor = variance > 60 ? STATUS.critical : STATUS.at_risk;

  return (
    <Tooltip
      title={late
        ? `Planned ${plannedDays} days, forecast ${forecastDays} days — ${variance} days over`
        : `Forecast ${forecastDays} days, ${Math.abs(variance)} days inside plan`}
    >
      <Box component = "span" sx={{ display: 'flex', alignItems: 'center', height, width: '100%' }}>
        <Box sx={{ width: `${plannedPct}%`, height: 10, bgcolor: 'rgba(139,148,167,0.35)', borderRadius: '5px 0 0 5px' }} />
        <Box sx={{ width: '2px', height, bgcolor: '#E8EBF0', flexShrink: 0 }} />
        {overrunPct > 0 && (
          <Box sx={{ width: `${overrunPct}%`, height: 10, bgcolor: overrunColor, borderRadius: '0 5px 5px 0' }} />
        )}
        <Typography
          className="mono" variant="caption"
          sx={{ ml: 1.5, color: late ? overrunColor : STATUS.healthy, whiteSpace: 'nowrap' }}
        >
          {late ? `+${variance}d` : `${variance}d`}
        </Typography>
      </Box>
    </Tooltip>
  );
}

export function MetricCard({ label, value, sub, color = 'text.primary' }) {
  return (
    <Card sx={{ height: '100%' }}>
      <CardContent>
        <Typography variant="overline" component="div">{label}</Typography>
        <Typography className="mono" sx={{ fontSize: '2rem', fontWeight: 600, color, lineHeight: 1.2 }}>
          {value}
        </Typography>
        {sub && <Typography variant="caption" color="text.secondary">{sub}</Typography>}
      </CardContent>
    </Card>
  );
}

/**
 * Health score with its full breakdown.
 *
 * Layout note: an explicit flex spacer is used instead of space-between,
 * which was collapsing and letting the project code run into the score.
 */
export function ScoreBar({ score }) {
  const color = bandColor(score.band);
  return (
    <Card sx={{ height: '100%' }}>
      <CardContent>
        <Box sx={{ display: 'flex', alignItems: 'baseline', width: '100%', mb: 0.5 }}>
          <Typography variant="h6" className="mono">{score.code}</Typography>
          <Box sx={{ flexGrow: 1, minWidth: 12 }} />
          <Typography className="mono" sx={{ fontSize: '1.6rem', fontWeight: 600, color }}>
            {score.score}
          </Typography>
        </Box>

        <Typography variant="body2" color="text.secondary" noWrap sx={{ mb: 1 }}>
          {score.name}
        </Typography>

        <Chip
          size="small"
          label={score.band.replace(/_/g, ' ')}
          sx={{ bgcolor: `${color}22`, color, border: `1px solid ${color}55`, mb: 2 }}
        />

        <Stack spacing={1.25}>
          {Object.entries(score.components).map(([factor, value]) => (
            <Box key={factor}>
              <Box sx={{ display: 'flex', alignItems: 'baseline', width: '100%' }}>
                <Typography variant="caption" color="text.secondary">{factor}</Typography>
                <Typography variant="caption" color="text.secondary" sx={{ ml: 0.75, opacity: 0.55 }}>
                  ×{score.weights[factor]}%
                </Typography>
                <Box sx={{ flexGrow: 1, minWidth: 8 }} />
                <Typography variant="caption" className="mono">{value}</Typography>
              </Box>
              <LinearProgress
                variant="determinate"
                value={value}
                aria-label={`${factor} scores ${value} out of 100`}
                sx={{
                  height: 4, borderRadius: 2, mt: 0.5, bgcolor: 'rgba(139,148,167,0.15)',
                  '& .MuiLinearProgress-bar': {
                    bgcolor: bandColor(value >= 80 ? 'healthy' : value >= 60 ? 'watch' : value >= 40 ? 'at_risk' : 'critical'),
                  },
                }}
              />
            </Box>
          ))}
        </Stack>
      </CardContent>
    </Card>
  );
}

/** A person's peak allocation. Same explicit-spacer fix. */
export function AllocationRow({ name, pct, projects, excess }) {
  return (
    <Box>
      <Box sx={{ display: 'flex', alignItems: 'baseline', width: '100%' }}>
        <Typography variant="body2">{name}</Typography>
        <Box sx={{ flexGrow: 1, minWidth: 12 }} />
        <Typography variant="body2" className="mono" sx={{ color: STATUS.critical }}>{pct}%</Typography>
      </Box>
      <LinearProgress
        variant="determinate"
        value={Math.min(100, (pct / 150) * 100)}
        aria-label={`${name} allocated ${pct} percent of capacity`}
        sx={{
          height: 6, borderRadius: 3, mt: 0.5, bgcolor: 'rgba(139,148,167,0.15)',
          '& .MuiLinearProgress-bar': { bgcolor: STATUS.critical },
        }}
      />
      <Typography variant="caption" color="text.secondary">
        across {projects} projects · {excess}% beyond capacity
      </Typography>
    </Box>
  );
}

export function Loading({ rows = 3, height = 90 }) {
  return (
    <Stack spacing={2} aria-busy="true" aria-live="polite">
      {Array.from({ length: rows }).map((_, i) => <Skeleton key={i} variant="rounded" height={height} />)}
    </Stack>
  );
}

export function ErrorState({ error, onRetry }) {
  return (
    <Alert
      severity="error"
      role="alert"
      action={onRetry && (
        <Typography
          component="button" onClick={onRetry}
          sx={{ background: 'none', border: 0, color: 'inherit', cursor: 'pointer', textDecoration: 'underline' }}
        >
          Try again
        </Typography>
      )}
    >
      {error?.message || 'Something went wrong'}
      {error?.details?.length > 0 && (
        <Box component="ul" sx={{ m: 0, mt: 1, pl: 2 }}>
          {error.details.map((d) => <li key={d}>{d}</li>)}
        </Box>
      )}
    </Alert>
  );
}

export function EmptyState({ title, hint }) {
  return (
    <Box sx={{ textAlign: 'center', py: 6, color: 'text.secondary' }}>
      <Typography variant="h6" gutterBottom>{title}</Typography>
      {hint && <Typography variant="body2">{hint}</Typography>}
    </Box>
  );
}

/** Page heading with an optional action aligned right. */
export function PageHeader({ title, subtitle, action }) {
  return (
    <Box sx={{ display: 'flex', alignItems: 'flex-end', mb: 3, gap: 2, flexWrap: 'wrap' }}>
      <Box>
        <Typography variant="h1">{title}</Typography>
        {subtitle && <Typography variant="body2" color="text.secondary">{subtitle}</Typography>}
      </Box>
      <Box sx={{ flexGrow: 1 }} />
      {action}
    </Box>
  );
}
