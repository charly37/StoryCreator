import React, { useState } from 'react';
import { Link as RouterLink } from 'react-router-dom';
import {
  Container, Box, Paper, Typography, TextField, Button, Alert,
  CircularProgress, Link, Select, MenuItem, FormControl, InputLabel,
} from '@mui/material';
import { useTranslation } from 'react-i18next';
import { AppUser } from '../App';

interface RegisterPageProps {
  onRegisterSuccess: (user: AppUser) => void;
}

const RegisterPage: React.FC<RegisterPageProps> = ({ onRegisterSuccess }) => {
  const { t } = useTranslation();
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [uiLanguage, setUiLanguage] = useState<'en' | 'fr'>('en');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (password.length < 6) {
      setError(t('auth.atLeastChars', { count: 6 }));
      return;
    }
    setLoading(true);
    try {
      const res = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, email, password, uiLanguage }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.message || 'Registration failed');
      } else {
        onRegisterSuccess(data.user);
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
            {t('auth.registerTitle')}
          </Typography>
          {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
          <Box component="form" onSubmit={handleSubmit}>
            <TextField
              fullWidth label={t('auth.username')}
              value={username} onChange={(e) => setUsername(e.target.value)}
              required autoComplete="username" sx={{ mb: 2 }}
            />
            <TextField
              fullWidth label={t('auth.email')} type="email"
              value={email} onChange={(e) => setEmail(e.target.value)}
              required autoComplete="email" sx={{ mb: 2 }}
            />
            <TextField
              fullWidth label={t('auth.password')} type="password"
              value={password} onChange={(e) => setPassword(e.target.value)}
              helperText={t('auth.atLeastChars', { count: 6 })}
              required autoComplete="new-password" sx={{ mb: 2 }}
            />
            <FormControl fullWidth sx={{ mb: 3 }}>
              <InputLabel>{t('auth.uiLanguage')}</InputLabel>
              <Select
                value={uiLanguage}
                label={t('auth.uiLanguage')}
                onChange={(e) => setUiLanguage(e.target.value as 'en' | 'fr')}
              >
                <MenuItem value="en">English</MenuItem>
                <MenuItem value="fr">Français</MenuItem>
              </Select>
            </FormControl>
            <Button fullWidth variant="contained" type="submit" disabled={loading} size="large">
              {loading ? <CircularProgress size={24} color="inherit" /> : t('auth.signUp')}
            </Button>
          </Box>
          <Typography variant="body2" sx={{ mt: 2, textAlign: 'center' }}>
            {t('auth.hasAccount')}{' '}
            <Link component={RouterLink} to="/login">{t('auth.signIn')}</Link>
          </Typography>
        </Paper>
      </Container>
    </Box>
  );
};

export default RegisterPage;
