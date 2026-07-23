import { useCallback, useEffect, useState } from 'react';
import {
  Alert, Box, Button, Card, CardContent, Grid, Table, TableBody, TableCell, TableHead,
  TableRow, Typography,
} from '@mui/material';
import RefreshIcon from '@mui/icons-material/Refresh';
import { getForecast, getScores, refreshPortfolio } from '../api/client';
import { ErrorState, Loading, PageHeader, ScoreBar, SignalChip, SlipBar } from '../components/Common';
import { useAuth } from '../context/AuthContext';
import { toDisplay } from '../utils/date';

const VERDICT_TONE = { late: 'critical', at_risk: 'at_risk', on_track: 'healthy', no_data: 'neutral' };

export default function Forecast() {
  const { can } = useAuth();
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const [forecast, scores] = await Promise.all([getForecast(), getScores()]);
      setData({ ...forecast, scores: scores.items });
      setError(null);
    } catch (err) {
      setError(err);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const rebuild = async () => {
    setBusy(true);
    try {
      await refreshPortfolio();
      await load();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  if (error) return <ErrorState error={error} onRetry={load} />;
  if (!data) return <Loading rows={3} />;

  return (
    <Box sx={{ maxWidth: 1400 }}>
      <PageHeader
        title="Forecast"
        subtitle="Projected completion dates from observed delivery velocity"
        action={can('update') && (
          <Button variant="outlined" startIcon={<RefreshIcon />} onClick={rebuild} disabled={busy}>
            {busy ? 'Rebuilding' : 'Rebuild summary'}
          </Button>
        )}
      />

      {/* State the model and its limits up front rather than presenting the
          numbers as though they were certain. */}
      <Alert severity="info" sx={{ mb: 3 }}>
        <strong>Model: {data.model}.</strong> {data.assumption}
      </Alert>

      <Card sx={{ mb: 3 }}>
        <CardContent>
          <Typography variant="overline" component="div">Projected delivery</Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            The marker is the planned end date. Everything past it is projected overrun.
          </Typography>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Project</TableCell>
                <TableCell align="right">Actual</TableCell>
                <TableCell align="right">Expected</TableCell>
                <TableCell>Planned vs forecast</TableCell>
                <TableCell>Planned end</TableCell>
                <TableCell>Forecast end</TableCell>
                <TableCell>Verdict</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {data.items.map((row) => (
                <TableRow key={row.id} hover>
                  <TableCell>
                    <Typography variant="body2" className="mono">{row.code}</Typography>
                    <Typography variant="caption" color="text.secondary">{row.name}</Typography>
                  </TableCell>
                  <TableCell align="right" className="mono">{row.pct_complete}%</TableCell>
                  <TableCell align="right" className="mono">{row.expected_pct_complete ?? '—'}%</TableCell>
                  <TableCell width="26%">
                    <SlipBar plannedDays={row.planned_duration} forecastDays={row.forecast_duration_days}
                      variance={row.forecast_variance_days} />
                  </TableCell>
                  <TableCell className="mono" sx={{ fontSize: '0.75rem' }}>
                    {toDisplay(row.planned_end_date)}
                  </TableCell>
                  <TableCell className="mono" sx={{ fontSize: '0.75rem' }}>
                    {toDisplay(row.forecast_end_date)}
                  </TableCell>
                  <TableCell>
                    <SignalChip label={row.verdict.replace(/_/g, ' ')} tone={VERDICT_TONE[row.verdict]} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card sx={{ mb: 3 }}>
        <CardContent>
          <Typography variant="overline" component="div">Why each project is where it is</Typography>
          <Box component="ul" sx={{ pl: 2, m: 0, mt: 1 }}>
            {data.items.map((row) => (
              <Typography key={row.id} component="li" variant="body2" sx={{ mb: 0.75 }}>
                <strong className="mono">{row.code}</strong> — {row.explanation}
              </Typography>
            ))}
          </Box>
        </CardContent>
      </Card>

      <Typography variant="overline" component="div" sx={{ mb: 1 }}>
        Health scores · lowest first
      </Typography>
      <Grid container spacing={2}>
        {data.scores.map((score) => (
          <Grid item xs={12} sm={6} md={4} lg={3} key={score.project_id}>
            <ScoreBar score={score} />
          </Grid>
        ))}
      </Grid>
    </Box>
  );
}
