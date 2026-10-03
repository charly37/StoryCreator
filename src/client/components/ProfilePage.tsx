import React from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Box, Container, Typography, Paper, Avatar, Divider, Chip, Button,
} from '@mui/material';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import { useTranslation } from 'react-i18next';
import { getLanguageName } from '../utils/languages';
import { AppUser } from '../App';

const ProfilePage: React.FC<{ user: AppUser }> = ({ user }) => {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();

  const memberSince = user.createdAt
    ? new Date(user.createdAt).toLocaleDateString(i18n.language, {
        year: 'numeric', month: 'long', day: 'numeric',
      })
    : '—';

  const rows: Array<{ label: string; value: React.ReactNode }> = [
    { label: t('profile.username'), value: user.username },
    { label: t('profile.email'), value: user.email || '—' },
    { label: t('profile.memberSince'), value: memberSince },
    {
      label: t('profile.uiLanguage'),
      value: user.uiLanguage ? getLanguageName(user.uiLanguage) : '—',
    },
    {
      label: t('profile.creatorAccess'),
      value: (
        <Chip
          size="small"
          color={user.canCreateStories ? 'success' : 'default'}
          variant={user.canCreateStories ? 'filled' : 'outlined'}
          label={user.canCreateStories ? t('profile.granted') : t('profile.notGranted')}
        />
      ),
    },
  ];

  return (
    <Box sx={{ pt: 10, pb: 6, bgcolor: 'background.default', minHeight: '100vh' }}>
      <Container maxWidth="sm">
        <Button startIcon={<ArrowBackIcon />} onClick={() => navigate('/my-stories')} sx={{ mb: 2 }}>
          {t('common.myStories')}
        </Button>

        <Paper elevation={2} sx={{ p: 3 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 3 }}>
            <Avatar sx={{ bgcolor: 'primary.main', width: 56, height: 56, fontSize: '1.5rem' }}>
              {user.username.charAt(0).toUpperCase()}
            </Avatar>
            <Box>
              <Typography variant="h5" sx={{ fontWeight: 700 }}>{t('profile.title')}</Typography>
              <Typography variant="body2" color="text.secondary">@{user.username}</Typography>
            </Box>
          </Box>

          <Divider sx={{ mb: 2 }} />

          {rows.map((row, i) => (
            <Box key={row.label}>
              {i > 0 && <Divider sx={{ my: 1.5 }} />}
              <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 2 }}>
                <Typography variant="body2" color="text.secondary">{row.label}</Typography>
                <Typography variant="body1" sx={{ fontWeight: 500, textAlign: 'right' }}>{row.value}</Typography>
              </Box>
            </Box>
          ))}
        </Paper>
      </Container>
    </Box>
  );
};

export default ProfilePage;
