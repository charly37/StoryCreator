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
}

interface HeaderProps {
  user: User | null;
  onLogout: () => void;
}

const Header: React.FC<HeaderProps> = ({ user, onLogout }) => {
  const navigate = useNavigate();
  const { t, i18n } = useTranslation();
  const [anchorEl, setAnchorEl] = useState<null | HTMLElement>(null);

  const toggleLanguage = () => {
    const next = i18n.language === 'en' ? 'fr' : 'en';
    i18n.changeLanguage(next);
    localStorage.setItem('preferredLanguage', next);
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

        <Tooltip title={t('common.language')}>
          <Button
            size="small"
            variant="outlined"
            onClick={toggleLanguage}
            sx={{ mx: 1, minWidth: 48, fontWeight: 700 }}
          >
            {i18n.language === 'en' ? 'FR' : 'EN'}
          </Button>
        </Tooltip>

        {user ? (
          <>
            <Button
              variant="contained"
              startIcon={<CreateIcon />}
              onClick={() => navigate('/editor')}
              sx={{ mr: 1 }}
            >
              {t('common.writeStory')}
            </Button>
            <Tooltip title={user.username}>
              <IconButton onClick={(e) => setAnchorEl(e.currentTarget)} size="small">
                <Avatar sx={{ bgcolor: 'primary.main', width: 34, height: 34, fontSize: '0.9rem' }}>
                  {user.username.charAt(0).toUpperCase()}
                </Avatar>
              </IconButton>
            </Tooltip>
            <Menu anchorEl={anchorEl} open={Boolean(anchorEl)} onClose={() => setAnchorEl(null)}>
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
