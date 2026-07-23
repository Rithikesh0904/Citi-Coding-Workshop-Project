import { Navigate, Route, BrowserRouter as Router, Routes } from 'react-router-dom';
import { CssBaseline, ThemeProvider } from '@mui/material';
import { LocalizationProvider } from '@mui/x-date-pickers/LocalizationProvider';
import { AdapterDayjs } from '@mui/x-date-pickers/AdapterDayjs';
import { AuthProvider, useAuth } from './context/AuthContext';
import Layout from './components/Layout';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import Projects from './pages/Projects';
import Forecast from './pages/Forecast';
import People from './pages/People';
import Dependencies from './pages/Dependencies';
import Users from './pages/Users';
import theme from './theme';

/**
 * Unauthenticated visitors go to sign-in rather than seeing an error.
 * `permission` additionally gates a route by role -- typing the URL directly
 * must not reach a page the role cannot use.
 */
function Protected({ children, permission }) {
  const { isAuthenticated, can } = useAuth();
  if (!isAuthenticated) return <Navigate to="/login" replace />;
  if (permission && !can(permission)) return <Navigate to="/" replace />;
  return <Layout>{children}</Layout>;
}

export default function App() {
  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      {/* Supplies the date engine to every picker in the tree. Without it the
          pickers throw on render. */}
      <LocalizationProvider dateAdapter={AdapterDayjs}>
        <AuthProvider>
          <Router>
            <Routes>
              <Route path="/login" element={<Login />} />
              <Route path="/" element={<Protected><Dashboard /></Protected>} />
              <Route path="/projects" element={<Protected><Projects /></Protected>} />
              <Route path="/forecast" element={<Protected><Forecast /></Protected>} />
              <Route path="/people" element={<Protected><People /></Protected>} />
              <Route path="/dependencies" element={<Protected><Dependencies /></Protected>} />
              <Route path="/users" element={<Protected permission="manage_users"><Users /></Protected>} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </Router>
        </AuthProvider>
      </LocalizationProvider>
    </ThemeProvider>
  );
}
