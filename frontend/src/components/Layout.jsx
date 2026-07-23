import {
  AppBar, Avatar, Box, BottomNavigation, BottomNavigationAction, Chip, Divider, Drawer,
  IconButton, List, ListItemButton, ListItemIcon, ListItemText, Stack, Toolbar, Tooltip, Typography,
} from '@mui/material';
import AssignmentIcon from '@mui/icons-material/Assignment';
import DashboardIcon from '@mui/icons-material/SpaceDashboard';
import GroupsIcon from '@mui/icons-material/Groups';
import HubIcon from '@mui/icons-material/Hub';
import LogoutIcon from '@mui/icons-material/Logout';
import ManageAccountsIcon from '@mui/icons-material/ManageAccounts';
import TimelineIcon from '@mui/icons-material/Timeline';
import { useMediaQuery } from 'react-responsive';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

// `permission` gates the item. Undefined means everyone signed in can see it.
const NAV = [
  { to: '/', label: 'Overview', icon: <DashboardIcon /> },
  { to: '/projects', label: 'Projects', icon: <AssignmentIcon /> },
  { to: '/forecast', label: 'Forecast', icon: <TimelineIcon /> },
  { to: '/people', label: 'People', icon: <GroupsIcon /> },
  { to: '/dependencies', label: 'Chains', icon: <HubIcon /> },
  { to: '/users', label: 'Users', icon: <ManageAccountsIcon />, permission: 'manage_users' },
];

const RAIL_WIDTH = 216;

export default function Layout({ children }) {
  // react-responsive drives the layout switch. Below 900px the side rail is
  // replaced by a bottom bar that is reachable with a thumb.
  const isCompact = useMediaQuery({ maxWidth: 900 });
  const { user, signOut, can } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const items = NAV.filter((item) => !item.permission || can(item.permission));

  const handleSignOut = () => {
    signOut();
    navigate('/login');
  };

  const activeIndex = Math.max(0, items.findIndex((n) => n.to === location.pathname));

  return (
    <Box sx={{ display: 'flex', minHeight: '100vh', bgcolor: 'background.default' }}>
      {/* Keyboard users can jump straight past the navigation. */}
      <Box
        component="a"
        href="#main"
        sx={{
          position: 'absolute', left: -9999, top: 8, zIndex: 2000,
          '&:focus': { left: 8, bgcolor: 'primary.main', color: '#0B0E14', px: 2, py: 1, borderRadius: 1 },
        }}
      >
        Skip to content
      </Box>

      {!isCompact && (
        <Drawer
          variant="permanent"
          data-testid="side-drawer"
          sx={{
            width: RAIL_WIDTH,
            '& .MuiDrawer-paper': {
              width: RAIL_WIDTH, boxSizing: 'border-box',
              bgcolor: 'background.paper', borderRight: '1px solid rgba(139,148,167,0.14)',
            },
          }}
        >
          <Box sx={{ px: 2.5, py: 3 }}>
            <Typography variant="h3" sx={{ letterSpacing: '-0.02em' }}>ACME</Typography>
            <Typography variant="overline">Delivery console</Typography>
          </Box>
          <Divider />
          <List component="nav" sx={{ px: 1, pt: 1 }}>
            {items.map((item) => (
              <ListItemButton
                key={item.to}
                component={Link}
                to={item.to}
                selected={location.pathname === item.to}
                sx={{ borderRadius: 1.5, mb: 0.5 }}
              >
                <ListItemIcon sx={{ minWidth: 38, color: 'inherit' }}>{item.icon}</ListItemIcon>
                <ListItemText primaryTypographyProps={{ fontSize: 14 }} primary={item.label} />
              </ListItemButton>
            ))}
          </List>
        </Drawer>
      )}

      <Box sx={{ flexGrow: 1, minWidth: 0 }}>
        <AppBar
          position="sticky"
          elevation={0}
          sx={{ bgcolor: 'background.default', borderBottom: '1px solid rgba(139,148,167,0.14)' }}
        >
          <Toolbar sx={{ gap: 2 }}>
            {isCompact && <Typography variant="h3">ACME</Typography>}
            <Box sx={{ flexGrow: 1 }} />
            {user && (
              <Stack direction="row" spacing={1.5} alignItems="center">
                <Chip size="small" label={user.role} sx={{ textTransform: 'uppercase' }} />
                <Tooltip title={user.full_name}>
                  <Avatar sx={{ width: 30, height: 30, fontSize: 13, bgcolor: 'primary.main', color: '#0B0E14' }}>
                    {user.full_name?.split(' ').map((n) => n[0]).join('').slice(0, 2)}
                  </Avatar>
                </Tooltip>
                <IconButton onClick={handleSignOut} aria-label="Sign out" size="small">
                  <LogoutIcon fontSize="small" />
                </IconButton>
              </Stack>
            )}
          </Toolbar>
        </AppBar>

        <Box component="main" id="main" sx={{ p: { xs: 2, md: 3 }, pb: isCompact ? 10 : 3 }}>
          {children}
        </Box>
      </Box>

      {isCompact && (
        <BottomNavigation
          data-testid="bottom-nav"
          value={activeIndex}
          showLabels
          sx={{
            position: 'fixed', bottom: 0, left: 0, right: 0, zIndex: 1200,
            bgcolor: 'background.paper', borderTop: '1px solid rgba(139,148,167,0.14)',
          }}
        >
          {items.map((item) => (
            <BottomNavigationAction key={item.to} component={Link} to={item.to}
              label={item.label} icon={item.icon} />
          ))}
        </BottomNavigation>
      )}
    </Box>
  );
}
