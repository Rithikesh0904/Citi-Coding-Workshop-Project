import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert, Box, Button, Card, CardContent, Dialog, DialogActions, DialogContent, DialogTitle,
  MenuItem, Snackbar, Stack, TextField, Typography,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import SubdirectoryArrowRightIcon from '@mui/icons-material/SubdirectoryArrowRight';
import { createDependency, getDeliverables, getDependencies } from '../api/client';
import { EmptyState, ErrorState, Loading, PageHeader, StatusChip } from '../components/Common';
import { useAuth } from '../context/AuthContext';
import { STATUS } from '../theme';

export default function Dependencies() {
  const { can } = useAuth();
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [deliverables, setDeliverables] = useState([]);
  const [dialog, setDialog] = useState(null);
  const [formError, setFormError] = useState(null);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState(null);

  const load = useCallback(async () => {
    try {
      setData(await getDependencies());
      setError(null);
    } catch (err) {
      setError(err);
    }
  }, []);

  useEffect(() => {
    load();
    getDeliverables().then((d) => setDeliverables(d.items)).catch(() => {});
  }, [load]);

  const save = async () => {
    if (!dialog.predecessor_id || !dialog.successor_id) {
      setFormError('Choose both a blocker and the work it blocks');
      return;
    }
    setSaving(true);
    try {
      await createDependency(dialog);
      setDialog(null);
      setToast({ severity: 'success', message: 'Dependency added' });
      load();
    } catch (err) {
      // The database trigger rejects cycles; the message explains why.
      setFormError(err.message);
    } finally {
      setSaving(false);
    }
  };

  // Group the flattened chain rows into one tree per root deliverable.
  const chains = useMemo(() => {
    const groups = {};
    (data?.chain || []).forEach((row) => {
      groups[row.root_id] = groups[row.root_id] || { name: row.root_name, links: [] };
      groups[row.root_id].links.push(row);
    });
    Object.values(groups).forEach((g) => g.links.sort((a, b) => a.depth - b.depth));
    return groups;
  }, [data]);

  if (error) return <ErrorState error={error} onRetry={load} />;
  if (!data) return <Loading rows={3} />;

  return (
    <Box sx={{ maxWidth: 1100 }}>
      <PageHeader
        title="Dependency chains"
        subtitle="What each piece of work blocks, followed all the way downstream"
        action={can('create') && (
          <Button variant="contained" startIcon={<AddIcon />}
            onClick={() => { setFormError(null); setDialog({ predecessor_id: '', successor_id: '', dep_type: 'finish_to_start' }); }}
            data-testid="new-dependency">
            Add dependency
          </Button>
        )}
      />

      {Object.keys(chains).length === 0 && (
        <EmptyState title="No dependencies recorded"
          hint="Add one to see how delays propagate through the plan." />
      )}

      <Stack spacing={2}>
        {Object.entries(chains).map(([rootId, chain]) => (
          <Card key={rootId}>
            <CardContent>
              <Typography variant="h6" gutterBottom>{chain.name}</Typography>
              <Typography variant="caption" color="text.secondary">
                blocks {chain.links.length} downstream {chain.links.length === 1 ? 'item' : 'items'}
              </Typography>
              <Stack spacing={0.5} sx={{ mt: 2 }}>
                {chain.links.map((link) => (
                  <Box
                    key={`${link.descendant_id}-${link.depth}`}
                    sx={{
                      display: 'flex', alignItems: 'center', gap: 1.5,
                      ml: (link.depth - 1) * 3,
                      py: 0.75, pl: 1.5,
                      borderLeft: `2px solid ${link.descendant_status === 'blocked' ? STATUS.critical : 'rgba(139,148,167,0.25)'}`,
                    }}
                  >
                    <SubdirectoryArrowRightIcon fontSize="small" sx={{ color: 'text.secondary' }} />
                    <Typography variant="body2" sx={{ flexGrow: 1 }}>{link.descendant_name}</Typography>
                    <Typography variant="caption" className="mono" color="text.secondary">
                      depth {link.depth}
                    </Typography>
                    <StatusChip status={link.descendant_status} />
                  </Box>
                ))}
              </Stack>
            </CardContent>
          </Card>
        ))}
      </Stack>

      <Dialog open={Boolean(dialog)} onClose={() => setDialog(null)} maxWidth="sm" fullWidth>
        <DialogTitle>Add dependency</DialogTitle>
        <DialogContent>
          {formError && <Alert severity="error" role="alert" sx={{ mb: 2 }}>{formError}</Alert>}
          <Stack spacing={2} sx={{ mt: 1 }}>
            <TextField select label="This must finish first" required fullWidth
              value={dialog?.predecessor_id ?? ''}
              onChange={(e) => setDialog((d) => ({ ...d, predecessor_id: e.target.value }))}
              data-testid="dependency-predecessor">
              {deliverables.map((d) => (
                <MenuItem key={d.id} value={d.id}>{d.project_code} · {d.name}</MenuItem>
              ))}
            </TextField>
            <TextField select label="Before this can start" required fullWidth
              value={dialog?.successor_id ?? ''}
              onChange={(e) => setDialog((d) => ({ ...d, successor_id: e.target.value }))}
              data-testid="dependency-successor">
              {deliverables.map((d) => (
                <MenuItem key={d.id} value={d.id}>{d.project_code} · {d.name}</MenuItem>
              ))}
            </TextField>
            <Typography variant="caption" color="text.secondary">
              Circular chains are rejected. If A already depends on B, B cannot be made to
              depend on A.
            </Typography>
          </Stack>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={() => setDialog(null)} disabled={saving}>Cancel</Button>
          <Button variant="contained" onClick={save} disabled={saving} data-testid="save-dependency">
            {saving ? 'Saving' : 'Add dependency'}
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
