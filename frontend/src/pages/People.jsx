import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert, Box, Button, Card, CardContent, Dialog, DialogActions, DialogContent, DialogTitle,
  Grid, IconButton, MenuItem, Snackbar, Stack, Table, TableBody, TableCell, TableHead,
  TableRow, TextField, Tooltip, Typography,
} from '@mui/material';
import { DatePicker } from '@mui/x-date-pickers/DatePicker';
import dayjs from 'dayjs';
import AddIcon from '@mui/icons-material/Add';
import DeleteIcon from '@mui/icons-material/DeleteOutlined';
import { createAllocation, deleteAllocation, getAllocations, getProjects, getUsers } from '../api/client';
import { AllocationRow, EmptyState, ErrorState, Loading, PageHeader } from '../components/Common';
import { useAuth } from '../context/AuthContext';
import { DISPLAY_FORMAT, toDisplay } from '../utils/date';

const BLANK = { user_id: '', project_id: '', allocation_pct: 50, start_date: '', end_date: '' };

export default function People() {
  const { can } = useAuth();
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [people, setPeople] = useState([]);
  const [projects, setProjects] = useState([]);
  const [dialog, setDialog] = useState(null);
  const [fieldErrors, setFieldErrors] = useState({});
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState(null);

  const load = useCallback(async () => {
    try {
      setData(await getAllocations());
      setError(null);
    } catch (err) {
      setError(err);
    }
  }, []);

  useEffect(() => {
    load();
    getUsers().then((u) => setPeople(u.items)).catch(() => {});
    getProjects().then((p) => setProjects(p.items)).catch(() => {});
  }, [load]);

  const setValue = (field, value) => setDialog((d) => ({ ...d, [field]: value }));

  // Pickers return dayjs; state stays ISO so the API contract is unchanged.
  const setDate = (field, value) =>
    setValue(field, value && value.isValid() ? value.format('YYYY-MM-DD') : '');

  const asDate = (iso) => (iso ? dayjs(iso) : null);

  const validate = () => {
    const problems = {};
    if (!dialog.user_id) problems.user_id = 'Choose a person';
    if (!dialog.project_id) problems.project_id = 'Choose a project';
    if (!dialog.start_date) problems.start_date = 'Start date is required';
    if (!dialog.end_date) problems.end_date = 'End date is required';
    else if (dialog.start_date && dialog.end_date < dialog.start_date) {
      problems.end_date = 'End date cannot be before the start date';
    }
    const pct = Number(dialog.allocation_pct);
    if (!(pct >= 1 && pct <= 100)) problems.allocation_pct = 'Must be between 1 and 100';
    setFieldErrors(problems);
    return Object.keys(problems).length === 0;
  };

  const save = async () => {
    if (!validate()) return;
    setSaving(true);
    try {
      const created = await createAllocation({ ...dialog, allocation_pct: Number(dialog.allocation_pct) });
      setDialog(null);
      // Over-allocation is permitted but reported, so the warning is shown as a
      // caution rather than treated as a failure.
      setToast(created.warning
        ? { severity: 'warning', message: created.warning }
        : { severity: 'success', message: 'Allocation added' });
      load();
    } catch (err) {
      setFieldErrors({ _form: err.details?.length ? err.details.join('. ') : err.message });
    } finally {
      setSaving(false);
    }
  };

  const remove = async (id) => {
    try {
      await deleteAllocation(id);
      setToast({ severity: 'success', message: 'Allocation removed' });
      load();
    } catch (err) {
      setToast({ severity: 'error', message: err.message });
    }
  };

  // Collapse the per-date rows into one peak figure per person.
  const peaks = useMemo(() => Object.values(
    (data?.over_allocated || []).reduce((acc, row) => {
      const key = String(row.user_id);
      if (!acc[key] || row.total_pct > acc[key].total_pct) acc[key] = row;
      return acc;
    }, {}),
  ), [data]);

  const byPerson = useMemo(() => {
    const groups = {};
    (data?.items || []).forEach((row) => {
      groups[row.full_name] = groups[row.full_name] || [];
      groups[row.full_name].push(row);
    });
    return groups;
  }, [data]);

  if (error) return <ErrorState error={error} onRetry={load} />;
  if (!data) return <Loading rows={3} />;

  return (
    <Box sx={{ maxWidth: 1400 }}>
      <PageHeader
        title="People"
        subtitle="Who is committed to what, and who is committed beyond capacity"
        action={can('create') && (
          <Button variant="contained" startIcon={<AddIcon />}
            onClick={() => { setFieldErrors({}); setDialog({ ...BLANK }); }} data-testid="new-allocation">
            Add allocation
          </Button>
        )}
      />

      <Grid container spacing={2} sx={{ mb: 3 }}>
        <Grid item xs={12} md={5}>
          <Card sx={{ height: '100%' }} data-testid="over-allocated">
            <CardContent>
              <Typography variant="overline" component="div">Over capacity</Typography>
              <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                Peak simultaneous commitment. Anything above 100% is capacity that does not exist.
              </Typography>
              {peaks.length === 0
                ? <EmptyState title="Nobody is over-allocated" hint="Every person is within capacity." />
                : (
                  <Stack spacing={2}>
                    {peaks.map((p) => (
                      <AllocationRow key={p.user_id} name={p.full_name} pct={p.total_pct}
                        projects={p.concurrent_projects} excess={p.excess_pct} />
                    ))}
                  </Stack>
                )}
            </CardContent>
          </Card>
        </Grid>

        <Grid item xs={12} md={7}>
          <Card sx={{ height: '100%' }}>
            <CardContent>
              <Typography variant="overline" component="div">All allocations</Typography>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>Person</TableCell>
                    <TableCell>Project</TableCell>
                    <TableCell align="right">Share</TableCell>
                    <TableCell align="right">Hours/wk</TableCell>
                    <TableCell>Window</TableCell>
                    {can('delete') && <TableCell />}
                  </TableRow>
                </TableHead>
                <TableBody>
                  {Object.entries(byPerson).map(([name, allocations]) =>
                    allocations.map((row, i) => (
                      <TableRow key={row.id} hover>
                        <TableCell>{i === 0 ? name : ''}</TableCell>
                        <TableCell className="mono">{row.project_code}</TableCell>
                        <TableCell align="right" className="mono">{row.allocation_pct}%</TableCell>
                        <TableCell align="right" className="mono">{row.allocated_hours_per_week}</TableCell>
                        <TableCell className="mono" sx={{ fontSize: '0.7rem' }}>
                          {toDisplay(row.start_date)} → {toDisplay(row.end_date)}
                        </TableCell>
                        {can('delete') && (
                          <TableCell align="right">
                            <Tooltip title="Remove allocation">
                              <IconButton size="small" aria-label={`Remove ${name} from ${row.project_code}`}
                                onClick={() => remove(row.id)}>
                                <DeleteIcon fontSize="small" />
                              </IconButton>
                            </Tooltip>
                          </TableCell>
                        )}
                      </TableRow>
                    )))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </Grid>
      </Grid>

      <Dialog open={Boolean(dialog)} onClose={() => setDialog(null)} maxWidth="sm" fullWidth>
        <DialogTitle>Add allocation</DialogTitle>
        <DialogContent>
          {fieldErrors._form && <Alert severity="error" role="alert" sx={{ mb: 2 }}>{fieldErrors._form}</Alert>}
          <Stack spacing={2} sx={{ mt: 1 }}>
            <TextField select label="Person" required value={dialog?.user_id ?? ''} fullWidth
              onChange={(e) => setValue('user_id', e.target.value)}
              error={Boolean(fieldErrors.user_id)} helperText={fieldErrors.user_id}
              data-testid="allocation-person">
              {people.map((p) => (
                <MenuItem key={p.id} value={p.id}>{p.full_name} · {p.role}</MenuItem>
              ))}
            </TextField>
            <TextField select label="Project" required value={dialog?.project_id ?? ''} fullWidth
              onChange={(e) => setValue('project_id', e.target.value)}
              error={Boolean(fieldErrors.project_id)} helperText={fieldErrors.project_id}
              data-testid="allocation-project">
              {projects.map((p) => (
                <MenuItem key={p.id} value={p.id}>{p.code} · {p.name}</MenuItem>
              ))}
            </TextField>
            <TextField label="Share of capacity (%)" type="number" required value={dialog?.allocation_pct ?? 50}
              onChange={(e) => setValue('allocation_pct', e.target.value)}
              error={Boolean(fieldErrors.allocation_pct)} helperText={fieldErrors.allocation_pct} fullWidth />
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
              <DatePicker
                label="From"
                format={DISPLAY_FORMAT}
                value={asDate(dialog?.start_date)}
                onChange={(d) => setDate('start_date', d)}
                slotProps={{
                  textField: {
                    required: true, fullWidth: true,
                    error: Boolean(fieldErrors.start_date),
                    helperText: fieldErrors.start_date || 'dd/mm/yyyy',
                    inputProps: { 'data-testid': 'allocation-start' },
                  },
                }}
              />
              <DatePicker
                label="Until"
                format={DISPLAY_FORMAT}
                value={asDate(dialog?.end_date)}
                onChange={(d) => setDate('end_date', d)}
                minDate={asDate(dialog?.start_date) || undefined}
                slotProps={{
                  textField: {
                    required: true, fullWidth: true,
                    error: Boolean(fieldErrors.end_date),
                    helperText: fieldErrors.end_date || 'dd/mm/yyyy',
                    inputProps: { 'data-testid': 'allocation-end' },
                  },
                }}
              />
            </Stack>
          </Stack>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={() => setDialog(null)} disabled={saving}>Cancel</Button>
          <Button variant="contained" onClick={save} disabled={saving} data-testid="save-allocation">
            {saving ? 'Saving' : 'Add allocation'}
          </Button>
        </DialogActions>
      </Dialog>

      <Snackbar open={Boolean(toast)} autoHideDuration={6000} onClose={() => setToast(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}>
        <Alert severity={toast?.severity} onClose={() => setToast(null)}>{toast?.message}</Alert>
      </Snackbar>
    </Box>
  );
}
