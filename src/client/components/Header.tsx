import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  AppBar, Toolbar, Typography, Button, IconButton, Box,
  Menu, MenuItem, Avatar, Divider, Tooltip,
} from '@mui/material';
import AutoStoriesIcon from '@mui/icons-material/AutoStories';
import CreateIcon from '@mui/icons-material/Create';
import { useTranslation } from 'react-i18next';

interface User {
  id: string;
  username: string;
  canCreateStories?: boolean;
  uiLanguage?: 'en' | 'fr';
}

interface HeaderProps {
  user: User | null;
  onLogout: () => void;
  onUserUpdate?: (user: User) => void;
}

const Header: React.FC<HeaderProps> = ({ user, onLogout, onUserUpdate }) => {
  const navigate = useNavigate();
  const { t, i18n } = useTranslation();
  const [anchorEl, setAnchorEl] = useState<null | HTMLElement>(null);

  // Current UI language: the account preference wins when logged in, else the i18n detector.
  const currentLanguage: 'en' | 'fr' =
    user?.uiLanguage ?? (i18n.language?.startsWith('fr') ? 'fr' : 'en');

  const toggleLanguage = async () => {
    const next = currentLanguage === 'en' ? 'fr' : 'en';
    i18n.changeLanguage(next);
    localStorage.setItem('preferredLanguage', next);

    // Persist to the account so the Profile page and future sessions stay in sync.
    if (user) {
      onUserUpdate?.({ ...user, uiLanguage: next });
      try {
        await fetch('/api/auth/update-language', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ uiLanguage: next }),
        });
      } catch (error) {
        console.error('Failed to update language preference:', error);
      }
    }
  };

  return (
    <AppBar position="fixed" elevation={1} sx={{ bgcolor: 'white', color: 'text.primary' }}>
      <Toolbar>
        <AutoStoriesIcon sx={{ mr: 1, color: 'primary.main' }} />
        <Typography
          variant="h6"
          sx={{ flexGrow: 1, cursor: 'pointer', color: 'primary.main', fontWeight: 700 }}
          onClick={() => navigate('/')}
        >
          {t('common.appTitle')}
        </Typography>

        <Button color="inherit" onClick={() => navigate('/stories')}>
          {t('common.stories')}
        </Button>

        <Button color="inherit" onClick={() => navigate('/about')}>
          {t('common.about')}
        </Button>

        <Tooltip title={t('common.switchLanguage')}>
          <Button
            size="small"
            variant="outlined"
            onClick={toggleLanguage}
            sx={{ mx: 1, minWidth: 48, fontWeight: 700 }}
          >
            {currentLanguage === 'en' ? 'EN' : 'FR'}
          </Button>
        </Tooltip>

        {user ? (
          <>
            <Tooltip title={user.canCreateStories ? '' : t('creatorAccess.tooltip')}>
              <span>
                <Button
                  variant="contained"
                  startIcon={<CreateIcon />}
                  onClick={() => navigate('/editor')}
                  disabled={!user.canCreateStories}
                  sx={{ mr: 1 }}
                >
                  {t('common.writeStory')}
                </Button>
              </span>
            </Tooltip>
            <Tooltip title={user.username}>
              <IconButton onClick={(e) => setAnchorEl(e.currentTarget)} size="small">
                <Avatar sx={{ bgcolor: 'primary.main', width: 34, height: 34, fontSize: '0.9rem' }}>
                  {user.username.charAt(0).toUpperCase()}
                </Avatar>
              </IconButton>
            </Tooltip>
            <Menu anchorEl={anchorEl} open={Boolean(anchorEl)} onClose={() => setAnchorEl(null)}>
              <MenuItem onClick={() => { setAnchorEl(null); navigate('/my-stories'); }}>
                {t('common.myStories')}
              </MenuItem>
              <MenuItem onClick={() => { setAnchorEl(null); navigate('/profile'); }}>
                {t('common.profile')}
              </MenuItem>
              <Divider />
              <MenuItem onClick={() => { setAnchorEl(null); onLogout(); }}>
                {t('common.logout')}
              </MenuItem>
            </Menu>
          </>
        ) : (
          <>
            <Button color="inherit" onClick={() => navigate('/login')}>{t('common.login')}</Button>
            <Button variant="contained" onClick={() => navigate('/register')} sx={{ ml: 1 }}>
              {t('common.register')}
            </Button>
          </>
        )}
      </Toolbar>
    </AppBar>
  );
};

export default Header;
