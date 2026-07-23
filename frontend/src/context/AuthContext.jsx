import { createContext, useCallback, useContext, useMemo, useState } from 'react';
import * as api from '../api/client';

/**
 * Authentication state and permission checks.
 *
 * PERMISSIONS mirrors backend/_shared/security.py exactly. The frontend copy
 * exists only to hide controls a user cannot use -- the server re-checks every
 * write, so this is a usability aid, never a security boundary.
 */

const PERMISSIONS = {
  admin: ['read', 'create', 'update', 'delete', 'manage_users'],
  manager: ['read', 'create', 'update', 'delete'],
  contributor: ['read', 'create', 'update'],
  viewer: ['read'],
};

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(() => api.tokens.user);

  const signIn = useCallback(async (email, password) => {
    const data = await api.login(email, password);
    setUser(data.user);
    return data.user;
  }, []);

  const signOut = useCallback(() => {
    api.logout();
    setUser(null);
  }, []);

  const can = useCallback(
    (action) => Boolean(user && PERMISSIONS[user.role]?.includes(action)),
    [user],
  );

  const value = useMemo(
    () => ({ user, signIn, signOut, can, isAuthenticated: Boolean(user) }),
    [user, signIn, signOut, can],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used inside AuthProvider');
  return context;
}
