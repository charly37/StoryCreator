import React, { useState, useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useNavigate } from 'react-router-dom';
import { ThemeProvider, createTheme } from '@mui/material/styles';
import { CssBaseline, CircularProgress, Box } from '@mui/material';
import { useTranslation } from 'react-i18next';
import Header from './components/Header';
import LandingPage from './components/LandingPage';
import StoriesPage from './components/StoriesPage';
import StoryReadPage from './components/StoryReadPage';
import StoryEditorPage from './components/StoryEditorPage';
import LoginPage from './components/LoginPage';
import RegisterPage from './components/RegisterPage';
import ProfilePage from './components/ProfilePage';
import StoryPreviewPage from './components/StoryPreviewPage';
import StoryReviewPage from './components/StoryReviewPage';

const theme = createTheme({
  palette: {
    mode: 'light',
    primary: { main: '#2563eb' },
    secondary: { main: '#7c3aed' },
    background: { default: '#f8fafc' },
  },
  typography: {
    fontFamily: '"Roboto", "Helvetica", "Arial", sans-serif',
    h3: { fontWeight: 700 },
    h4: { fontWeight: 700 },
    h5: { fontWeight: 600 },
  },
  components: {
    MuiButton: {
      styleOverrides: {
        root: { textTransform: 'none', borderRadius: 8, fontWeight: 500 },
      },
    },
    MuiCard: { styleOverrides: { root: { borderRadius: 12 } } },
    MuiPaper: { styleOverrides: { root: { borderRadius: 12 } } },
  },
});

export interface AppUser {
  id: string;
  username: string;
  email?: string;
  uiLanguage?: 'en' | 'fr';
  createdAt?: string;
}

const AppContent: React.FC = () => {
  const navigate = useNavigate();
  const { i18n } = useTranslation();
  const [user, setUser] = useState<AppUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => { checkAuth(); }, []);

  useEffect(() => {
    if (user?.uiLanguage) i18n.changeLanguage(user.uiLanguage);
  }, [user?.uiLanguage, i18n]);

  const checkAuth = async () => {
    try {
      const res = await fetch('/api/auth/check-auth');
      const data = await res.json();
      if (data.authenticated && data.user) setUser(data.user);
    } catch (err) {
      console.error('Auth check failed:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleLogout = async () => {
    try {
      await fetch('/api/auth/logout', { method: 'POST' });
      setUser(null);
      navigate('/');
    } catch (err) {
      console.error('Logout failed:', err);
    }
  };

  if (loading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '100vh' }}>
        <CircularProgress />
      </Box>
    );
  }

  return (
    <>
      <Header user={user} onLogout={handleLogout} />
      <Box sx={{ minHeight: '100vh' }}>
        <Routes>
          <Route path="/" element={<LandingPage user={user} />} />
          <Route path="/stories" element={<StoriesPage />} />
          <Route path="/stories/:id" element={<StoryReadPage />} />
          <Route
            path="/editor"
            element={user ? <StoryEditorPage user={user} /> : <Navigate to="/login" replace />}
          />
          <Route
            path="/editor/:id"
            element={user ? <StoryEditorPage user={user} /> : <Navigate to="/login" replace />}
          />
          <Route
            path="/login"
            element={<LoginPage onLoginSuccess={(u) => { setUser(u); navigate('/'); }} />}
          />
          <Route
            path="/register"
            element={<RegisterPage onRegisterSuccess={(u) => { setUser(u); navigate('/'); }} />}
          />
          <Route
            path="/profile"
            element={user ? <ProfilePage user={user} /> : <Navigate to="/login" replace />}
          />
          <Route
            path="/preview/:id"
            element={user ? <StoryPreviewPage /> : <Navigate to="/login" replace />}
          />
          <Route
            path="/review/:id"
            element={user ? <StoryReviewPage /> : <Navigate to="/login" replace />}
          />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Box>
    </>
  );
};

const App: React.FC = () => (
  <ThemeProvider theme={theme}>
    <CssBaseline />
    <BrowserRouter>
      <AppContent />
    </BrowserRouter>
  </ThemeProvider>
);

export default App;
