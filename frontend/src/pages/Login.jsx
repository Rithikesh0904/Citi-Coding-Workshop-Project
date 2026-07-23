import { useState } from 'react';
import {
  Alert, Box, Button, Card, CardContent, CircularProgress, IconButton,
  InputAdornment, Link, Stack, TextField, Typography,
} from '@mui/material';
import VisibilityIcon from '@mui/icons-material/VisibilityOutlined';
import VisibilityOffIcon from '@mui/icons-material/VisibilityOffOutlined';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import { useNavigate } from 'react-router-dom';
import { forgotPassword, register, resetPassword } from '../api/client';
import { useAuth } from '../context/AuthContext';

/**
 * Four modes in one card, so the user never loses their place by navigating
 * away: sign in, sign up, request a reset, and enter a new password.
 *
 * Sign-up deliberately has no role field. The server hardcodes the role to
 * viewer and ignores anything sent, so registration cannot be used to grant
 * permissions -- only an administrator can do that.
 */

const COPY = {
  login: { title: 'Sign in', action: 'Sign in', busy: 'Signing in' },
  register: { title: 'Create account', action: 'Create account', busy: 'Creating' },
  forgot: { title: 'Reset password', action: 'Send reset token', busy: 'Sending' },
  reset: { title: 'Choose a new password', action: 'Update password', busy: 'Updating' },
};

export default function Login() {
  const [mode, setMode] = useState('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [fullName, setFullName] = useState('');
  const [token, setToken] = useState('');
  const [showPassword, setShowPassword] = useState(false);

  const [fieldErrors, setFieldErrors] = useState({});
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
  const [busy, setBusy] = useState(false);

  const { signIn } = useAuth();
  const navigate = useNavigate();

  const switchTo = (next) => {
    setMode(next);
    setFieldErrors({});
    setError(null);
    if (next !== 'reset') setNotice(null);
    setPassword('');
    setConfirm('');
    setShowPassword(false);
  };

  const validate = () => {
    const problems = {};
    const needsEmail = mode !== 'reset';
    const needsPassword = mode !== 'forgot';

    if (needsEmail) {
      if (!email.trim()) problems.email = 'Email is required';
      else if (!/^\S+@\S+\.\S+$/.test(email)) problems.email = 'Enter a valid email address';
      else if (mode === 'register' && !email.trim().toLowerCase().endsWith('@acme.com')) {
        problems.email = 'Sign-up is limited to acme.com addresses';
      }
    }
    if (mode === 'register' && !fullName.trim()) problems.fullName = 'Full name is required';
    if (mode === 'reset' && !token.trim()) problems.token = 'Paste the reset token';

    if (needsPassword) {
      if (!password) problems.password = 'Password is required';
      else if (mode !== 'login' && password.length < 8) {
        problems.password = 'At least 8 characters';
      }
      if (mode !== 'login' && confirm !== password) {
        problems.confirm = 'Passwords do not match';
      }
    }

    setFieldErrors(problems);
    return Object.keys(problems).length === 0;
  };

  const submit = async () => {
    setError(null);
    if (!validate()) return;
    setBusy(true);
    try {
      if (mode === 'login') {
        await signIn(email.trim(), password);
        navigate('/');
        return;
      }

      if (mode === 'register') {
        await register({ email: email.trim(), password, full_name: fullName.trim() });
        setNotice({
          severity: 'success',
          text: 'Account created with read-only access. Sign in below — an administrator '
              + 'can grant further permissions.',
        });
        switchTo('login');
        return;
      }

      if (mode === 'forgot') {
        const result = await forgotPassword(email.trim());
        setNotice(result.reset_token
          ? {
              severity: 'info',
              text: `Reset token (valid ${result.expires_in_minutes} minutes). `
                  + 'No mail service is provisioned, so it is shown here rather than emailed.',
              token: result.reset_token,
            }
          : { severity: 'info', text: result.message });
        setToken(result.reset_token || '');
        switchTo('reset');
        return;
      }

      await resetPassword(token.trim(), password);
      setNotice({ severity: 'success', text: 'Password updated. Sign in with it now.' });
      switchTo('login');
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const passwordAdornment = {
    endAdornment: (
      <InputAdornment position="end">
        <IconButton
          onClick={() => setShowPassword((v) => !v)}
          edge="end"
          size="small"
          tabIndex={-1}
          aria-label={showPassword ? 'Hide password' : 'Show password'}
          data-testid="toggle-password"
        >
          {showPassword ? <VisibilityOffIcon fontSize="small" /> : <VisibilityIcon fontSize="small" />}
        </IconButton>
      </InputAdornment>
    ),
  };

  return (
    <Box sx={{ minHeight: '100vh', display: 'grid', placeItems: 'center', bgcolor: 'background.default', p: 2 }}>
      <Card sx={{ width: '100%', maxWidth: 420 }}>
        <CardContent sx={{ p: 4 }}>
          <Typography variant="h1" sx={{ mb: 0.5 }}>ACME</Typography>
          <Typography variant="overline" component="div" sx={{ mb: 3 }}>
            {COPY[mode].title}
          </Typography>

          {notice && (
            <Alert severity={notice.severity} sx={{ mb: 2 }} onClose={() => setNotice(null)}>
              {notice.text}
              {notice.token && (
                <Box
                  className="mono"
                  sx={{
                    mt: 1, p: 1, borderRadius: 1, fontSize: '0.7rem',
                    bgcolor: 'rgba(139,148,167,0.15)', wordBreak: 'break-all',
                  }}
                >
                  {notice.token}
                </Box>
              )}
            </Alert>
          )}

          <Stack spacing={2} component="form" onSubmit={(e) => { e.preventDefault(); submit(); }}>
            {mode === 'register' && (
              <TextField
                label="Full name" required value={fullName} fullWidth disabled={busy}
                onChange={(e) => setFullName(e.target.value)}
                error={Boolean(fieldErrors.fullName)} helperText={fieldErrors.fullName}
                slotProps={{ htmlInput: { 'data-testid': 'full-name' } }}
              />
            )}

            {mode !== 'reset' && (
              <TextField
                label="Email" type="email" required value={email} fullWidth disabled={busy}
                autoComplete="username"
                onChange={(e) => setEmail(e.target.value)}
                error={Boolean(fieldErrors.email)}
                helperText={fieldErrors.email
                  || (mode === 'register' ? 'Must be an acme.com address' : '')}
                slotProps={{ htmlInput: { 'data-testid': 'email' } }}
              />
            )}

            {mode === 'reset' && (
              <TextField
                label="Reset token" required value={token} fullWidth disabled={busy} multiline
                onChange={(e) => setToken(e.target.value)}
                error={Boolean(fieldErrors.token)} helperText={fieldErrors.token}
                slotProps={{ htmlInput: { 'data-testid': 'reset-token' } }}
              />
            )}

            {mode !== 'forgot' && (
              <TextField
                label={mode === 'login' ? 'Password' : 'New password'}
                type={showPassword ? 'text' : 'password'}
                required value={password} fullWidth disabled={busy}
                autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                onChange={(e) => setPassword(e.target.value)}
                error={Boolean(fieldErrors.password)}
                helperText={fieldErrors.password || (mode !== 'login' ? 'At least 8 characters' : '')}
                slotProps={{ input: passwordAdornment, htmlInput: { 'data-testid': 'password' } }}
              />
            )}

            {(mode === 'register' || mode === 'reset') && (
              <TextField
                label="Confirm password"
                type={showPassword ? 'text' : 'password'}
                required value={confirm} fullWidth disabled={busy}
                autoComplete="new-password"
                onChange={(e) => setConfirm(e.target.value)}
                error={Boolean(fieldErrors.confirm)} helperText={fieldErrors.confirm}
                slotProps={{ htmlInput: { 'data-testid': 'confirm-password' } }}
              />
            )}

            {mode === 'login' && (
              <Box sx={{ display: 'flex' }}>
                <Box sx={{ flexGrow: 1 }} />
                <Link component="button" type="button" variant="body2" underline="hover"
                  onClick={() => switchTo('forgot')} data-testid="forgot-password">
                  Forgot password?
                </Link>
              </Box>
            )}

            {error && <Alert severity="error" role="alert">{error}</Alert>}

            <Button
              type="submit" variant="contained" size="large" disabled={busy}
              data-testid="submit"
              startIcon={busy ? <CircularProgress size={16} color="inherit" /> : null}
            >
              {busy ? COPY[mode].busy : COPY[mode].action}
            </Button>
          </Stack>

          <Box sx={{ mt: 3, textAlign: 'center' }}>
            {mode === 'login' && (
              <Typography variant="body2" color="text.secondary">
                Don&apos;t have an account?{' '}
                <Link component="button" type="button" underline="hover"
                  onClick={() => switchTo('register')} data-testid="go-register">
                  Sign up
                </Link>
              </Typography>
            )}
            {mode !== 'login' && (
              <Link component="button" type="button" variant="body2" underline="hover"
                onClick={() => switchTo('login')} data-testid="back-to-login"
                sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.5 }}>
                <ArrowBackIcon fontSize="inherit" /> Back to sign in
              </Link>
           )}
          </Box>
        </CardContent>
      </Card>
    </Box>
  );
}
 