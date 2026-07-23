import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Box, Card, CardContent, Grid, LinearProgress, Stack, Table, TableBody, TableCell,
  TableHead, TableRow, Typography,
} from '@mui/material';
import { Bar, BarChart, Cell, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { getDashboard, getForecast, getInsights, getScores } from '../api/client';
import {
  AllocationRow, ErrorState, Loading, MetricCard, PageHeader, ScoreBar, SignalChip, SlipBar, StatusChip,
} from '../components/Common';
import { STATUS } from '../theme';

const money = (n) => `${Math.round(Number(n || 0) / 1000)}k`;
const SEVERITY_TONE = { high: STATUS.critical, medium: STATUS.watch, low: STATUS.neutral };

export default function Dashboard() {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [updatedAt, setUpdatedAt] = useState(null);
  const timer = useRef(null);

  const load = useCallback(async () => {
    try {
      const [dashboard, scores, insights, forecast] = await Promise.all([
        getDashboard(), getScores(), getInsights(), getForecast(),
      ]);
      setData({ ...dashboard, scores: scores.items, insights: insights.items, forecast: forecast.items });
      setUpdatedAt(new Date());
      setError(null);
    } catch (err) {
      setError(err);
    }
  }, []);

  useEffect(() => {
    load();
    // Polling stands in for a push channel: Lambda Function URLs cannot hold a
    // persistent connection. Refreshing only while the tab is visible avoids
    // burning requests on a backgrounded window.
    const tick = () => { if (!document.hidden) load(); };
    timer.current = setInterval(tick, 30000);
    document.addEventListener('visibilitychange', tick);
    return () => {
      clearInterval(timer.current);
      document.removeEventListener('visibilitychange', tick);
    };
  }, [load]);

  if (error) return <ErrorState error={error} onRetry={load} />;
  if (!data) return <Loading rows={4} />;

  const { summary, projects, budgets, over_allocated: overAllocated, scores, insights, forecast } = data;

  const budgetChart = budgets
    .filter((b) => b.consumed_pct != null)
    .map((b) => ({ code: b.project_code, pct: Number(b.consumed_pct) }))
    .sort((a, b) => b.pct - a.pct);

  const forecastById = Object.fromEntries(forecast.map((f) => [String(f.id), f]));

  // One row per person, showing their worst moment rather than every date on
  // which they happened to be over capacity.
  const peakByPerson = Object.values(
    overAllocated.reduce((acc, row) => {
      const key = String(row.user_id);
      if (!acc[key] || row.total_pct > acc[key].total_pct) acc[key] = row;
      return acc;
    }, {}),
  );

  const forecastLate = forecast.filter((f) => f.forecast_variance_days > 14).length;

  return (
    <Box sx={{ maxWidth: 1400 }}>
      <PageHeader
        title="Portfolio"
        subtitle="Where delivery stands across every active project"
        action={(
          <Typography variant="caption" className="mono" color="text.secondary" aria-live="polite">
            updated {updatedAt?.toLocaleTimeString()}
          </Typography>
        )}
      />

      <Grid container spacing={2} sx={{ mb: 3 }}>
        <Grid item xs={6} md={3}>
          <MetricCard label="Active projects" value={summary.active_projects}
            sub={`${summary.total_projects} in the portfolio`} />
        </Grid>
        <Grid item xs={6} md={3}>
          <MetricCard label="Forecast late" value={forecastLate}
            sub="projected past their end date"
            color={forecastLate > 0 ? STATUS.critical : STATUS.healthy} />
        </Grid>
        <Grid item xs={6} md={3}>
          <MetricCard label="Over-allocated" value={summary.over_allocated_people}
            sub="people committed beyond capacity"
            color={summary.over_allocated_people > 0 ? STATUS.at_risk : STATUS.healthy} />
        </Grid>
        <Grid item xs={6} md={3}>
          <MetricCard label="Budget consumed"
            value={`${Math.round((summary.total_consumed / summary.total_planned) * 100)}%`}
            sub={`${money(summary.total_consumed)} of ${money(summary.total_planned)}`} />
        </Grid>
      </Grid>

      <Grid container spacing={2}>
        <Grid item xs={12} lg={7}>
          <Card>
            <CardContent>
              <Typography variant="overline" component="div">Delivery forecast</Typography>
              <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                The marker is the planned end date. Anything past it is projected overrun.
              </Typography>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>Project</TableCell>
                    <TableCell width={116}>Actual / expected</TableCell>
                    <TableCell width="45%">Planned vs forecast</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {projects.filter((p) => forecastById[String(p.id)]).map((p) => {
                    const f = forecastById[String(p.id)];
                    return (
                      <TableRow key={p.id}>
                        <TableCell>
                          <Typography variant="body2" className="mono">{p.code}</Typography>
                          <Typography variant="caption" color="text.secondary">{p.name}</Typography>
                        </TableCell>
                        <TableCell>
                          <Typography variant="caption" className="mono">
                            {f.pct_complete}% / {f.expected_pct_complete ?? '—'}%
                          </Typography>
                          <LinearProgress variant="determinate" value={Number(f.pct_complete)}
                            aria-label={`${p.code} is ${f.pct_complete} percent complete`}
                            sx={{ height: 4, borderRadius: 2, mt: 0.5, bgcolor: 'rgba(139,148,167,0.15)' }} />
                        </TableCell>
                        <TableCell>
                          <SlipBar plannedDays={f.planned_duration}
                            forecastDays={f.forecast_duration_days}
                            variance={f.forecast_variance_days} />
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </Grid>

        <Grid item xs={12} lg={5}>
          <Card sx={{ height: '100%' }}>
            <CardContent>
              <Typography variant="overline" component="div">What needs attention</Typography>
              <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                {insights.length} findings from the reporting views
              </Typography>
              <Stack spacing={1.5} sx={{ maxHeight: 420, overflowY: 'auto' }}>
                {insights.map((finding, i) => (
                  <Box key={i} sx={{ borderLeft: `3px solid ${SEVERITY_TONE[finding.severity]}`, pl: 1.5, py: 0.5 }}>
                    <Typography variant="body2" sx={{ fontWeight: 500 }}>{finding.title}</Typography>
                    <Typography variant="caption" color="text.secondary">{finding.detail}</Typography>
                  </Box>
                ))}
              </Stack>
            </CardContent>
          </Card>
        </Grid>

        <Grid item xs={12} lg={7}>
          <Card>
            <CardContent>
              <Typography variant="overline" component="div">Budget consumed</Typography>
              <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                Percentage of planned spend used. The line is 100%.
              </Typography>
              <Box sx={{ height: 260 }} data-testid="budget-chart">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={budgetChart} layout="vertical" margin={{ left: 8, right: 24 }}>
                    <XAxis type="number" domain={[0, 'dataMax']} stroke="#8B94A7" fontSize={11} />
                    <YAxis type="category" dataKey="code" width={70} stroke="#8B94A7" fontSize={11} tickLine={false} />
                    <Tooltip
                      contentStyle={{ background: '#1A1F2B', border: '1px solid rgba(139,148,167,0.3)', borderRadius: 8 }}
                      formatter={(v) => [`${v}%`, 'consumed']} />
                    <ReferenceLine x={100} stroke="#E8EBF0" strokeDasharray="3 3" />
                    <Bar dataKey="pct" radius={[0, 4, 4, 0]}>
                      {budgetChart.map((entry) => (
                        <Cell key={entry.code}
                          fill={entry.pct > 100 ? STATUS.critical : entry.pct > 85 ? STATUS.watch : STATUS.healthy} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </Box>
            </CardContent>
          </Card>
        </Grid>

        <Grid item xs={12} lg={5}>
          <Card sx={{ height: '100%' }} data-testid="over-allocated">
            <CardContent>
              <Typography variant="overline" component="div">Over-allocated people</Typography>
              <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                Peak commitment across overlapping projects
              </Typography>
              <Stack spacing={2}>
                {peakByPerson.map((person) => (
                  <AllocationRow key={person.user_id} name={person.full_name}
                    pct={person.total_pct} projects={person.concurrent_projects} excess={person.excess_pct} />
                ))}
              </Stack>
            </CardContent>
          </Card>
        </Grid>

        <Grid item xs={12}>
          <Card data-testid="at-risk-table">
            <CardContent>
              <Typography variant="overline" component="div">Project status</Typography>
              <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                Signals combine deliverable state with the velocity forecast
              </Typography>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>Code</TableCell>
                    <TableCell>Project</TableCell>
                    <TableCell>State</TableCell>
                    <TableCell align="right">Deliverables</TableCell>
                    <TableCell>Signals</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {projects.map((p) => {
                    const f = forecastById[String(p.id)];
                    const slip = f?.forecast_variance_days;
                    const closed = ['completed', 'cancelled'].includes(p.status);
                    // A project is only "on track" when neither the deliverable
                    // signals nor the velocity forecast say otherwise.
                    const clean = !closed && p.risk && !p.risk.at_risk && !(slip > 14);
                    return (
                      <TableRow key={p.id} hover>
                        <TableCell className="mono">{p.code}</TableCell>
                        <TableCell>{p.name}</TableCell>
                        <TableCell><StatusChip status={p.status} /></TableCell>
                        <TableCell align="right" className="mono">
                          {p.completed_count}/{p.deliverable_count}
                        </TableCell>
                        <TableCell>
                          <Stack direction="row" spacing={0.5} flexWrap="wrap" useFlexGap>
                            {closed && <SignalChip label="closed" tone="neutral" />}
                            {!closed && p.risk?.overdue_deliverables > 0 && (
                              <SignalChip label={`${p.risk.overdue_deliverables} overdue`} tone="critical" />
                            )}
                            {!closed && p.risk?.blocked_deliverables > 0 && (
                              <SignalChip label={`${p.risk.blocked_deliverables} blocked`} tone="critical" />
                            )}
                            {!closed && p.risk?.deliverables_past_project_end > 0 && (
                              <SignalChip label={`${p.risk.deliverables_past_project_end} past end date`} tone="at_risk" />
                            )}
                            {!closed && slip > 14 && (
                              <SignalChip label={`forecast +${slip}d`} tone={slip > 60 ? 'critical' : 'at_risk'} />
                            )}
                            {clean && <SignalChip label="on track" tone="healthy" />}
                          </Stack>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </Grid>

        <Grid item xs={12}>
          <Typography variant="overline" component="div" sx={{ mb: 1 }}>
            Health scores · lowest first, every score broken into its parts
          </Typography>
          <Grid container spacing={2}>
            {scores.map((score) => (
              <Grid item xs={12} sm={6} md={4} lg={3} key={score.project_id}>
                <ScoreBar score={score} />
              </Grid>
            ))}
          </Grid>
        </Grid>
      </Grid>
    </Box>
  );
}
