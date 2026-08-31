import React, { useState } from 'react';
import { Link as RouterLink } from 'react-router-dom';
import {
  Container, Box, Paper, Typography, TextField,
  Button, Alert, CircularProgress, Link,
} from '@mui/material';
import { useTranslation } from 'react-i18next';
import { AppUser } from '../App';

interface LoginPageProps {
  onLoginSuccess: (user: AppUser) => void;
}

const LoginPage: React.FC<LoginPageProps> = ({ onLoginSuccess }) => {
  const { t } = useTranslation();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.message || 'Login failed');
      } else {
        onLoginSuccess(data.user);
      }
    } catch {
      setError('Network error. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Box sx={{ pt: 12, pb: 6, bgcolor: 'background.default', minHeight: '100vh' }}>
      <Container maxWidth="xs">
        <Paper elevation={3} sx={{ p: 4 }}>
          <Typography variant="h5" sx={{ fontWeight: 700 }} gutterBottom>
            {t('auth.loginTitle')}
          </Typography>
          {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
          <Box component="form" onSubmit={handleSubmit}>
            <TextField
              fullWidth label={t('auth.email')} type="email"
              value={email} onChange={(e) => setEmail(e.target.value)}
              required autoComplete="email" sx={{ mb: 2 }}
            />
            <TextField
              fullWidth label={t('auth.password')} type="password"
              value={password} onChange={(e) => setPassword(e.target.value)}
              required autoComplete="current-password" sx={{ mb: 3 }}
            />
            <Button fullWidth variant="contained" type="submit" disabled={loading} size="large">
              {loading ? <CircularProgress size={24} color="inherit" /> : t('auth.signIn')}
            </Button>
          </Box>
          <Typography variant="body2" sx={{ mt: 2, textAlign: 'center' }}>
            {t('auth.noAccount')}{' '}
            <Link component={RouterLink} to="/register">{t('auth.signUp')}</Link>
          </Typography>
        </Paper>
      </Container>
    </Box>
  );
};

export default LoginPage;
