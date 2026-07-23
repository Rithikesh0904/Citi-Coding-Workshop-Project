import { useCallback, useEffect, useState } from 'react';
import {
  Alert, Box, Button, Card, CardContent, Chip, Dialog, DialogActions, DialogContent,
  DialogTitle, IconButton, MenuItem, Snackbar, Stack, Switch, Table, TableBody, TableCell,
  TableHead, TableRow, TextField, Tooltip, Typography,
} from '@mui/material';
import PersonAddIcon from '@mui/icons-material/PersonAddAlt';
import BlockIcon from '@mui/icons-material/Block';
import EditIcon from '@mui/icons-material/EditOutlined';
import { createUser, deleteUser, getUsers, updateUser } from '../api/client';
import { EmptyState, ErrorState, Loading, PageHeader } from '../components/Common';
import { useAuth } from '../context/AuthContext';
import { STATUS } from '../theme';

const ROLES = ['admin', 'manager', 'contributor', 'viewer'];

const ROLE_SUMMARY = {
  admin: 'Everything, including managing users and roles',
  manager: 'Everything except managing users',
  contributor: 'Create and update, but never delete',
  viewer: 'Read only',
};

const ROLE_TONE = {
  admin: STATUS.critical,
  manager: STATUS.at_risk,
  contributor: '#5B8DEF',
  viewer: STATUS.neutral,
};

const BLANK = {
  email: '', password: '', full_name: '', role: 'viewer',
  capacity_hours: 40, cost_rate: '',
};

export default function Users() {
  const { user: me, can } = useAuth();
  const [rows, setRows] = useState(null);
  const [error, setError] = useState(null);
  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState('');

  const [dialog, setDialog] = useState(null);
  const [fieldErrors, setFieldErrors] = useState({});
  const [saving, setSaving] = useState(false);
  const [confirm, setConfirm] = useState(null);
  const [toast, setToast] = useState(null);

  const load = useCallback(async () => {
    try {
      const data = await getUsers({ q: search, role: roleFilter });
      setRows(data.items);
      setError(null);
    } catch (err) {
      setError(err);
    }
  }, [search, roleFilter]);

  useEffect(() => {
    const handle = setTimeout(load, 300);
    return () => clearTimeout(handle);
  }, [load]);

  const setValue = (field, value) =>
    setDialog((d) => ({ ...d, values: { ...d.values, [field]: value } }));

  const openCreate = () => { setFieldErrors({}); setDialog({ mode: 'create', values: { ...BLANK } }); };

  const openEdit = (row) => {
    setFieldErrors({});
    setDialog({
      mode: 'edit',
      id: row.id,
      isSelf: String(row.id) === String(me.id),
      values: {
        email: row.email, password: '', full_name: row.full_name, role: row.role,
        capacity_hours: row.capacity_hours ?? 40, cost_rate: row.cost_rate ?? '',
      },
    });
  };

  const validate = (v, mode) => {
    const problems = {};
    if (!v.email.trim()) problems.email = 'Email is required';
    else if (!/^\S+@\S+\.\S+$/.test(v.email)) problems.email = 'Enter a valid email address';
    if (!v.full_name.trim()) problems.full_name = 'Full name is required';
    if (!ROLES.includes(v.role)) problems.role = 'Choose a role';
    // Password is mandatory on create, optional on edit (blank leaves it alone).
    if (mode === 'create' && v.password.length < 8) {
      problems.password = 'At least 8 characters';
    } else if (mode === 'edit' && v.password && v.password.length < 8) {
      problems.password = 'At least 8 characters, or leave blank to keep the current one';
    }
    if (Number(v.capacity_hours) <= 0) problems.capacity_hours = 'Must be greater than zero';
    if (v.cost_rate !== '' && Number(v.cost_rate) < 0) problems.cost_rate = 'Cannot be negative';
    setFieldErrors(problems);
    return Object.keys(problems).length === 0;
  };

  const save = async () => {
    const { values, mode, id, isSelf } = dialog;
    if (!validate(values, mode)) return;
    setSaving(true);
    try {
      const payload = {
        email: values.email.trim(),
        full_name: values.full_name.trim(),
        capacity_hours: Number(values.capacity_hours),
        cost_rate: values.cost_rate === '' ? null : Number(values.cost_rate),
      };
      // The server refuses a self role change; not sending it avoids a
      // confusing 400 when nothing else was edited.
      if (!isSelf) payload.role = values.role;
      if (values.password) payload.password = values.password;

      if (mode === 'create') await createUser({ ...payload, role: values.role, password: values.password });
      else await updateUser(id, payload);

      setDialog(null);
      setToast({ severity: 'success', message: mode === 'create' ? 'User created' : 'User saved' });
      load();
    } catch (err) {
      setFieldErrors({ _form: err.details?.length ? err.details.join('. ') : err.message });
    } finally {
      setSaving(false);
    }
  };

  const deactivate = async () => {
    try {
      await deleteUser(confirm.id);
      setToast({ severity: 'success', message: `${confirm.full_name} deactivated` });
      setConfirm(null);
      load();
    } catch (err) {
      setToast({ severity: 'error', message: err.message });
      setConfirm(null);
    }
  };

  const reactivate = async (row) => {
    try {
      await updateUser(row.id, { is_active: true });
      setToast({ severity: 'success', message: `${row.full_name} reactivated` });
      load();
    } catch (err) {
      setToast({ severity: 'error', message: err.message });
    }
  };

  // Belt and braces: the route already guards this, but a direct URL should
  // never render the page for a non-admin.
  if (!can('manage_users')) {
    return (
      <Alert severity="warning" role="alert">
        Managing users requires the admin role.
      </Alert>
    );
  }

  return (
    <Box sx={{ maxWidth: 1200 }}>
      <PageHeader
        title="Users"
        subtitle="Accounts, roles and capacity"
        action={(
          <Button variant="contained" startIcon={<PersonAddIcon />} onClick={openCreate}
            data-testid="new-user">
            New user
          </Button>
        )}
      />

      <Card sx={{ mb: 2 }}>
        <CardContent>
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
            <TextField label="Search by name or email" value={search} size="small" fullWidth
              onChange={(e) => setSearch(e.target.value)}
              slotProps={{ htmlInput: { 'data-testid': 'user-search' } }} />
            <TextField select label="Role" value={roleFilter} size="small" sx={{ minWidth: 200 }}
              onChange={(e) => setRoleFilter(e.target.value)}>
              <MenuItem value="">All roles</MenuItem>
              {ROLES.map((r) => <MenuItem key={r} value={r}>{r}</MenuItem>)}
            </TextField>
          </Stack>
        </CardContent>
      </Card>

      {error && <ErrorState error={error} onRetry={load} />}
      {!error && !rows && <Loading rows={3} height={56} />}
      {rows?.length === 0 && <EmptyState title="No users match those filters" />}

      {rows?.length > 0 && (
        <Card>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Name</TableCell>
                <TableCell>Email</TableCell>
                <TableCell>Role</TableCell>
                <TableCell align="right">Capacity</TableCell>
                <TableCell align="right">Rate</TableCell>
                <TableCell>Status</TableCell>
                <TableCell align="right">Actions</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {rows.map((row) => {
                const isSelf = String(row.id) === String(me.id);
                return (
                  <TableRow key={row.id} hover sx={{ opacity: row.is_active ? 1 : 0.5 }}>
                    <TableCell>
                      {row.full_name}
                      {isSelf && (
                        <Chip size="small" label="you" sx={{ ml: 1, height: 18 }} variant="outlined" />
                      )}
                    </TableCell>
                    <TableCell className="mono" sx={{ fontSize: '0.75rem' }}>{row.email}</TableCell>
                    <TableCell>
                      <Chip size="small" label={row.role}
                        sx={{
                          bgcolor: `${ROLE_TONE[row.role]}22`,
                          color: ROLE_TONE[row.role],
                          border: `1px solid ${ROLE_TONE[row.role]}55`,
                        }} />
                    </TableCell>
                    <TableCell align="right" className="mono">{row.capacity_hours}h</TableCell>
                    <TableCell align="right" className="mono">
                      {row.cost_rate ? `${row.cost_rate}` : '—'}
                    </TableCell>
                    <TableCell>
                      <Switch size="small" checked={row.is_active} disabled={isSelf}
                        inputProps={{ 'aria-label': `${row.full_name} is ${row.is_active ? 'active' : 'inactive'}` }}
                        onChange={() => (row.is_active ? setConfirm(row) : reactivate(row))} />
                    </TableCell>
                    <TableCell align="right">
                      <Tooltip title="Edit">
                        <IconButton size="small" onClick={() => openEdit(row)}
                          aria-label={`Edit ${row.full_name}`} data-testid={`edit-user-${row.email}`}>
                          <EditIcon fontSize="small" />
                        </IconButton>
                      </Tooltip>
                      <Tooltip title={isSelf ? 'You cannot deactivate your own account' : 'Deactivate'}>
                        {/* A span keeps the tooltip working on a disabled button. */}
                        <span>
                          <IconButton size="small" disabled={isSelf || !row.is_active}
                            onClick={() => setConfirm(row)}
                            aria-label={`Deactivate ${row.full_name}`}
                            data-testid={`deactivate-${row.email}`}>
                            <BlockIcon fontSize="small" />
                          </IconButton>
                        </span>
                      </Tooltip>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </Card>
      )}

      <Card sx={{ mt: 2 }}>
        <CardContent>
          <Typography variant="overline" component="div" sx={{ mb: 1 }}>What each role can do</Typography>
          <Stack spacing={0.75}>
            {ROLES.map((r) => (
              <Box key={r} sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
                <Chip size="small" label={r} sx={{ minWidth: 92, bgcolor: `${ROLE_TONE[r]}22`, color: ROLE_TONE[r] }} />
                <Typography variant="body2" color="text.secondary">{ROLE_SUMMARY[r]}</Typography>
              </Box>
            ))}
          </Stack>
        </CardContent>
      </Card>

      <Dialog open={Boolean(dialog)} onClose={() => setDialog(null)} maxWidth="sm" fullWidth>
        <DialogTitle>{dialog?.mode === 'create' ? 'New user' : `Edit ${dialog?.values.full_name}`}</DialogTitle>
        <DialogContent>
          {fieldErrors._form && <Alert severity="error" role="alert" sx={{ mb: 2 }}>{fieldErrors._form}</Alert>}
          {dialog?.isSelf && (
            <Alert severity="info" sx={{ mb: 2 }}>
              This is your own account. Your role cannot be changed here — an admin demoting
              themselves could leave the system with no administrator.
            </Alert>
          )}
          <Stack spacing={2} sx={{ mt: 1 }}>
            <TextField label="Full name" required value={dialog?.values.full_name ?? ''} fullWidth
              onChange={(e) => setValue('full_name', e.target.value)}
              error={Boolean(fieldErrors.full_name)} helperText={fieldErrors.full_name}
              slotProps={{ htmlInput: { 'data-testid': 'user-name' } }} />

            <TextField label="Email" type="email" required value={dialog?.values.email ?? ''} fullWidth
              onChange={(e) => setValue('email', e.target.value)}
              error={Boolean(fieldErrors.email)} helperText={fieldErrors.email}
              slotProps={{ htmlInput: { 'data-testid': 'user-email' } }} />

            <TextField
              label={dialog?.mode === 'create' ? 'Password' : 'New password'}
              type="password" required={dialog?.mode === 'create'}
              value={dialog?.values.password ?? ''} fullWidth
              onChange={(e) => setValue('password', e.target.value)}
              error={Boolean(fieldErrors.password)}
              helperText={fieldErrors.password
                || (dialog?.mode === 'edit' ? 'Leave blank to keep the current password' : 'At least 8 characters')}
              slotProps={{ htmlInput: { 'data-testid': 'user-password' } }} />

            <TextField select label="Role" required value={dialog?.values.role ?? 'viewer'} fullWidth
              disabled={dialog?.isSelf}
              onChange={(e) => setValue('role', e.target.value)}
              error={Boolean(fieldErrors.role)}
              helperText={fieldErrors.role || ROLE_SUMMARY[dialog?.values.role]}
              data-testid="user-role">
              {ROLES.map((r) => <MenuItem key={r} value={r}>{r}</MenuItem>)}
            </TextField>

            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
              <TextField label="Capacity (hours/week)" type="number" fullWidth
                value={dialog?.values.capacity_hours ?? 40}
                onChange={(e) => setValue('capacity_hours', e.target.value)}
                error={Boolean(fieldErrors.capacity_hours)} helperText={fieldErrors.capacity_hours} />
              <TextField label="Cost rate (per hour)" type="number" fullWidth
                value={dialog?.values.cost_rate ?? ''}
                onChange={(e) => setValue('cost_rate', e.target.value)}
                error={Boolean(fieldErrors.cost_rate)} helperText={fieldErrors.cost_rate || 'Optional'} />
            </Stack>
          </Stack>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={() => setDialog(null)} disabled={saving}>Cancel</Button>
          <Button variant="contained" onClick={save} disabled={saving} data-testid="save-user">
            {saving ? 'Saving' : 'Save user'}
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog open={Boolean(confirm)} onClose={() => setConfirm(null)}>
        <DialogTitle>Deactivate {confirm?.full_name}?</DialogTitle>
        <DialogContent>
          <Typography variant="body2">
            They will no longer be able to sign in. The account is kept rather than deleted,
            because projects reference their manager and allocations reference the person —
            removing the row would either destroy that history or fail outright. You can
            reactivate them at any time.
          </Typography>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={() => setConfirm(null)}>Cancel</Button>
          <Button color="error" variant="contained" onClick={deactivate} data-testid="confirm-deactivate">
            Deactivate
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
