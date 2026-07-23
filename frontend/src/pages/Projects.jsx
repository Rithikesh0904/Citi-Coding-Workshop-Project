import { useCallback, useEffect, useState } from 'react';
import {
  Box, Button, Card, CardContent, Dialog, DialogActions, DialogContent, DialogTitle,
  IconButton, MenuItem, Snackbar, Alert, Stack, Table, TableBody, TableCell, TableHead,
  TableRow, TextField, Tooltip, Typography,
} from '@mui/material';
import { DatePicker } from '@mui/x-date-pickers/DatePicker';
import dayjs from 'dayjs';
import AddIcon from '@mui/icons-material/Add';
import DeleteIcon from '@mui/icons-material/DeleteOutlined';
import EditIcon from '@mui/icons-material/EditOutlined';
import {
  createProject, deleteProject, getDepartments, getProjects, getUsers, updateProject,
} from '../api/client';
import { EmptyState, ErrorState, Loading, PageHeader, StatusChip } from '../components/Common';
import { useAuth } from '../context/AuthContext';
import { DISPLAY_FORMAT, toDisplay } from '../utils/date';

const STATUSES = ['planning', 'active', 'on_hold', 'completed', 'cancelled'];

const BLANK = {
  code: '', name: '', description: '', department_id: '', manager_id: '',
  status: 'planning', start_date: '', planned_end_date: '', planned_budget: '',
};

export default function Projects() {
  const { can } = useAuth();
  const [rows, setRows] = useState(null);
  const [error, setError] = useState(null);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [departments, setDepartments] = useState([]);
  const [managers, setManagers] = useState([]);

  const [dialog, setDialog] = useState(null);
  const [fieldErrors, setFieldErrors] = useState({});
  const [saving, setSaving] = useState(false);
  const [confirm, setConfirm] = useState(null);
  const [toast, setToast] = useState(null);

  const load = useCallback(async () => {
    try {
      const data = await getProjects({ q: search, status });
      setRows(data.items);
      setError(null);
    } catch (err) {
      setError(err);
    }
  }, [search, status]);

  // Debounced so typing in the search box does not fire a request per keystroke.
  useEffect(() => {
    const handle = setTimeout(load, 300);
    return () => clearTimeout(handle);
  }, [load]);

  useEffect(() => {
    getDepartments().then((d) => setDepartments(d.items)).catch(() => {});
    getUsers().then((u) => setManagers(u.items.filter((x) => ['admin', 'manager'].includes(x.role))))
      .catch(() => {});
  }, []);

  const openCreate = () => { setFieldErrors({}); setDialog({ mode: 'create', values: { ...BLANK } }); };

  const openEdit = (row) => {
    setFieldErrors({});
    setDialog({
      mode: 'edit',
      id: row.id,
      values: {
        code: row.code, name: row.name, description: row.description || '',
        department_id: row.department_id || '', manager_id: row.manager_id || '',
        status: row.status,
        start_date: (row.start_date || '').slice(0, 10),
        planned_end_date: (row.planned_end_date || '').slice(0, 10),
        planned_budget: row.planned_budget ?? '',
      },
    });
  };

  const setValue = (field, value) =>
    setDialog((d) => ({ ...d, values: { ...d.values, [field]: value } }));

  // Pickers hand back a dayjs object; state stays ISO so the API contract and
  // the comparisons below are unaffected by the display format.
  const setDate = (field, value) =>
    setValue(field, value && value.isValid() ? value.format('YYYY-MM-DD') : '');

  const validate = (v) => {
    const problems = {};
    if (!v.code.trim()) problems.code = 'Code is required';
    if (!v.name.trim()) problems.name = 'Name is required';
    if (!v.department_id) problems.department_id = 'Choose a department';
    if (!v.manager_id) problems.manager_id = 'Choose a manager';
    if (!v.start_date) problems.start_date = 'Start date is required';
    if (!v.planned_end_date) problems.planned_end_date = 'Planned end date is required';
    else if (v.start_date && v.planned_end_date < v.start_date) {
      problems.planned_end_date = 'End date cannot be before the start date';
    }
    if (v.planned_budget !== '' && Number(v.planned_budget) < 0) {
      problems.planned_budget = 'Budget cannot be negative';
    }
    setFieldErrors(problems);
    return Object.keys(problems).length === 0;
  };

  const save = async () => {
    const { values, mode, id } = dialog;
    if (!validate(values)) return;
    setSaving(true);
    try {
      const payload = { ...values, planned_budget: Number(values.planned_budget || 0) };
      if (mode === 'create') await createProject(payload);
      else await updateProject(id, payload);
      setDialog(null);
      setToast({ severity: 'success', message: mode === 'create' ? 'Project created' : 'Project saved' });
      load();
    } catch (err) {
      setFieldErrors({ _form: err.details?.length ? err.details.join('. ') : err.message });
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    try {
      await deleteProject(confirm.id);
      setToast({ severity: 'success', message: `${confirm.code} deleted` });
      setConfirm(null);
      load();
    } catch (err) {
      setToast({ severity: 'error', message: err.message });
      setConfirm(null);
    }
  };

  const asDate = (iso) => (iso ? dayjs(iso) : null);

  return (
    <Box sx={{ maxWidth: 1400 }}>
      <PageHeader
        title="Projects"
        subtitle="Create, update and retire projects across every department"
        action={can('create') && (
          <Button variant="contained" startIcon={<AddIcon />} onClick={openCreate} data-testid="new-project">
            New project
          </Button>
        )}
      />

      <Card sx={{ mb: 2 }}>
        <CardContent>
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
            <TextField
              label="Search by name or code" value={search} size="small" fullWidth
              onChange={(e) => setSearch(e.target.value)}
              slotProps={{ htmlInput: { 'data-testid': 'project-search' } }}
            />
            <TextField
              select label="Status" value={status} size="small" sx={{ minWidth: 180 }}
              onChange={(e) => setStatus(e.target.value)}
            >
              <MenuItem value="">All statuses</MenuItem>
              {STATUSES.map((s) => (
                <MenuItem key={s} value={s}>{s.replace(/_/g, ' ')}</MenuItem>
              ))}
            </TextField>
          </Stack>
        </CardContent>
      </Card>

      {error && <ErrorState error={error} onRetry={load} />}
      {!error && !rows && <Loading rows={3} height={60} />}

      {rows?.length === 0 && (
        <EmptyState
          title="No projects match those filters"
          hint={can('create') ? 'Clear the search, or create a project.' : 'Try clearing the search.'}
        />
      )}

      {rows?.length > 0 && (
        <Card>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Code</TableCell>
                <TableCell>Project</TableCell>
                <TableCell>Department</TableCell>
                <TableCell>Manager</TableCell>
                <TableCell>Status</TableCell>
                <TableCell>Planned end</TableCell>
                <TableCell align="right">Progress</TableCell>
                <TableCell align="right">Actions</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {rows.map((row) => (
                <TableRow key={row.id} hover>
                  <TableCell className="mono">{row.code}</TableCell>
                  <TableCell>{row.name}</TableCell>
                  <TableCell>{row.department}</TableCell>
                  <TableCell>{row.manager}</TableCell>
                  <TableCell><StatusChip status={row.status} /></TableCell>
                  <TableCell className="mono" sx={{ fontSize: '0.75rem' }}>
                    {toDisplay(row.planned_end_date)}
                  </TableCell>
                  <TableCell align="right" className="mono">{row.avg_percent_complete}%</TableCell>
                  <TableCell align="right">
                    {can('update') && (
                      <Tooltip title="Edit">
                        <IconButton size="small" onClick={() => openEdit(row)}
                          aria-label={`Edit ${row.code}`} data-testid={`edit-${row.code}`}>
                          <EditIcon fontSize="small" />
                        </IconButton>
                      </Tooltip>
                    )}
                    {can('delete') && (
                      <Tooltip title="Delete">
                        <IconButton size="small" onClick={() => setConfirm(row)}
                          aria-label={`Delete ${row.code}`} data-testid={`delete-${row.code}`}>
                          <DeleteIcon fontSize="small" />
                        </IconButton>
                      </Tooltip>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}

      <Dialog open={Boolean(dialog)} onClose={() => setDialog(null)} maxWidth="sm" fullWidth>
        <DialogTitle>{dialog?.mode === 'create' ? 'New project' : `Edit ${dialog?.values.code}`}</DialogTitle>
        <DialogContent>
          {fieldErrors._form && <Alert severity="error" role="alert" sx={{ mb: 2 }}>{fieldErrors._form}</Alert>}
          <Stack spacing={2} sx={{ mt: 1 }}>
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
              <TextField label="Code" required value={dialog?.values.code ?? ''} fullWidth
                onChange={(e) => setValue('code', e.target.value)}
                error={Boolean(fieldErrors.code)} helperText={fieldErrors.code}
                slotProps={{ htmlInput: { 'data-testid': 'project-code' } }} />
              <TextField label="Name" required value={dialog?.values.name ?? ''} fullWidth
                onChange={(e) => setValue('name', e.target.value)}
                error={Boolean(fieldErrors.name)} helperText={fieldErrors.name}
                slotProps={{ htmlInput: { 'data-testid': 'project-name' } }} />
            </Stack>

            <TextField label="Description" multiline rows={2} value={dialog?.values.description ?? ''}
              onChange={(e) => setValue('description', e.target.value)} fullWidth />

            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
              <TextField select label="Department" required value={dialog?.values.department_id ?? ''} fullWidth
                onChange={(e) => setValue('department_id', e.target.value)}
                error={Boolean(fieldErrors.department_id)} helperText={fieldErrors.department_id}
                data-testid="project-department">
                {departments.map((d) => <MenuItem key={d.id} value={d.id}>{d.name}</MenuItem>)}
              </TextField>
              <TextField select label="Manager" required value={dialog?.values.manager_id ?? ''} fullWidth
                onChange={(e) => setValue('manager_id', e.target.value)}
                error={Boolean(fieldErrors.manager_id)} helperText={fieldErrors.manager_id}
                data-testid="project-manager">
                {managers.map((m) => <MenuItem key={m.id} value={m.id}>{m.full_name}</MenuItem>)}
              </TextField>
            </Stack>

            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
              <DatePicker
                label="Start date"
                format={DISPLAY_FORMAT}
                value={asDate(dialog?.values.start_date)}
                onChange={(d) => setDate('start_date', d)}
                slotProps={{
                  textField: {
                    required: true, fullWidth: true,
                    error: Boolean(fieldErrors.start_date),
                    helperText: fieldErrors.start_date || 'dd/mm/yyyy',
                    inputProps: { 'data-testid': 'project-start' },
                  },
                }}
              />
              <DatePicker
                label="Planned end"
                format={DISPLAY_FORMAT}
                value={asDate(dialog?.values.planned_end_date)}
                onChange={(d) => setDate('planned_end_date', d)}
                minDate={asDate(dialog?.values.start_date) || undefined}
                slotProps={{
                  textField: {
                    required: true, fullWidth: true,
                    error: Boolean(fieldErrors.planned_end_date),
                    helperText: fieldErrors.planned_end_date || 'dd/mm/yyyy',
                    inputProps: { 'data-testid': 'project-end' },
                  },
                }}
              />
            </Stack>

            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
              <TextField select label="Status" value={dialog?.values.status ?? 'planning'} fullWidth
                onChange={(e) => setValue('status', e.target.value)}>
                {STATUSES.map((s) => <MenuItem key={s} value={s}>{s.replace(/_/g, ' ')}</MenuItem>)}
              </TextField>
              <TextField label="Planned budget" type="number" fullWidth
                value={dialog?.values.planned_budget ?? ''}
                onChange={(e) => setValue('planned_budget', e.target.value)}
                error={Boolean(fieldErrors.planned_budget)} helperText={fieldErrors.planned_budget} />
            </Stack>
          </Stack>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={() => setDialog(null)} disabled={saving}>Cancel</Button>
          <Button variant="contained" onClick={save} disabled={saving} data-testid="save-project">
            {saving ? 'Saving' : 'Save project'}
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog open={Boolean(confirm)} onClose={() => setConfirm(null)}>
        <DialogTitle>Delete {confirm?.code}?</DialogTitle>
        <DialogContent>
          <Typography variant="body2">
            This removes {confirm?.name} and all of its deliverables, allocations and budget
            lines. It cannot be undone.
          </Typography>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={() => setConfirm(null)}>Keep it</Button>
          <Button color="error" variant="contained" onClick={remove} data-testid="confirm-delete">
            Delete project
          </Button>
        </DialogActions>
      </Dialog>

      <Snackbar open={Boolean(toast)} autoHideDuration={4000} onClose={() => setToast(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}>
        <Alert severity={toast?.severity} onClose={() => setToast(null)}>{toast?.message}</Alert>
      </Snackbar>
    </Box>
  );
}
