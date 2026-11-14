import React, { useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import {
  AppBar, Toolbar, Typography, Button, IconButton, Box, Divider, Tooltip,
  Menu, MenuItem, Avatar, SwipeableDrawer, List, ListItem, ListItemButton,
  ListItemIcon, ListItemText, ToggleButton, ToggleButtonGroup,
} from '@mui/material';
import AutoStoriesIcon from '@mui/icons-material/AutoStories';
import CreateIcon from '@mui/icons-material/Create';
import HomeIcon from '@mui/icons-material/Home';
import MenuBookIcon from '@mui/icons-material/MenuBook';
import InfoIcon from '@mui/icons-material/Info';
import LibraryBooksIcon from '@mui/icons-material/LibraryBooks';
import PersonIcon from '@mui/icons-material/Person';
import LogoutIcon from '@mui/icons-material/Logout';
import MenuIcon from '@mui/icons-material/Menu';
import CloseIcon from '@mui/icons-material/Close';
import LanguageIcon from '@mui/icons-material/Language';
import { useTranslation } from 'react-i18next';

interface User {
  id: string;
  username: string;
  email?: string;
  canCreateStories?: boolean;
  uiLanguage?: 'en' | 'fr';
}

interface HeaderProps {
  user: User | null;
  onLogout: () => void;
  onUserUpdate?: (user: User) => void;
}

interface NavItem {
  label: string;
  icon: React.ReactNode;
  path: string;
}

const Header: React.FC<HeaderProps> = ({ user, onLogout, onUserUpdate }) => {
  const navigate = useNavigate();
  const { t, i18n } = useTranslation();
  const location = useLocation();
  const [anchorEl, setAnchorEl] = useState<null | HTMLElement>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);

  // Normalize trailing slashes so '/about/' still matches '/about'.
  const currentPath = location.pathname.replace(/\/+$/, '') || '/';
  const isActive = (path: string) =>
    currentPath === path || (path !== '/' && currentPath.startsWith(`${path}/`));

  // Current UI language: the account preference wins when logged in, else the i18n detector.
  const currentLanguage: 'en' | 'fr' =
    user?.uiLanguage ?? (i18n.language?.startsWith('fr') ? 'fr' : 'en');

  const changeLanguage = async (next: 'en' | 'fr') => {
    if (next === currentLanguage) return;
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

  const toggleLanguage = () => changeLanguage(currentLanguage === 'en' ? 'fr' : 'en');

  const handleDrawerClose = () => setDrawerOpen(false);

  // Close the drawer before navigating so the destination is visible immediately.
  const handleNavigation = (path: string) => {
    handleDrawerClose();
    navigate(path);
  };

  // Single source of truth for the page links shown in the header and the drawer.
  const navItems: NavItem[] = [
    { label: t('common.home'), icon: <HomeIcon />, path: '/' },
    { label: t('common.stories'), icon: <MenuBookIcon />, path: '/stories' },
    { label: t('common.about'), icon: <InfoIcon />, path: '/about' },
  ];

  const accountItems: NavItem[] = user
    ? [
        { label: t('common.myStories'), icon: <LibraryBooksIcon />, path: '/my-stories' },
        { label: t('common.writeStory'), icon: <CreateIcon />, path: '/editor' },
        { label: t('common.profile'), icon: <PersonIcon />, path: '/profile' },
      ]
    : [];

  const renderNavRow = (item: NavItem) => {
    const active = isActive(item.path);
    const disabled = item.path === '/editor' && !user?.canCreateStories;

    return (
      <ListItem key={item.path} disablePadding>
        <Tooltip title={disabled ? t('creatorAccess.tooltip') : ''} placement="right">
          <span style={{ display: 'block', width: '100%' }}>
            <ListItemButton
              onClick={() => handleNavigation(item.path)}
              disabled={disabled}
              selected={active}
              aria-current={active ? 'page' : undefined}
              sx={{
                minHeight: 48,
                px: 2.5,
                mx: 1,
                borderRadius: 1,
                '&.Mui-selected, &.Mui-selected:hover': { bgcolor: 'rgba(37, 99, 235, 0.12)' },
                '& .MuiListItemText-primary': { fontWeight: active ? 600 : 400 },
              }}
            >
              <ListItemIcon sx={{ minWidth: 40, color: active ? 'primary.main' : 'text.secondary' }}>
                {item.icon}
              </ListItemIcon>
              <ListItemText primary={item.label} />
            </ListItemButton>
          </span>
        </Tooltip>
      </ListItem>
    );
  };

  const drawerContent = (
    <Box sx={{ width: 280 }} role="presentation">
      <Box sx={{ p: 2, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <AutoStoriesIcon sx={{ color: 'primary.main' }} />
          <Typography variant="h6" sx={{ fontWeight: 700, color: 'primary.main' }}>
            {t('common.appTitle')}
          </Typography>
        </Box>
        <IconButton onClick={handleDrawerClose} edge="end" aria-label={t('common.closeMenu')}>
          <CloseIcon />
        </IconButton>
      </Box>
      <Divider />

      <List sx={{ pt: 2 }}>
        {navItems.map(renderNavRow)}

        {accountItems.length > 0 && <Divider sx={{ my: 2 }} />}
        {accountItems.map(renderNavRow)}

        <Divider sx={{ my: 2 }} />

        <ListItem sx={{ px: 2.5, flexDirection: 'column', alignItems: 'flex-start' }}>
          <Box sx={{ display: 'flex', alignItems: 'center', mb: 1 }}>
            <LanguageIcon color="action" sx={{ mr: 1 }} />
            <Typography variant="body2" color="text.secondary">
              {t('common.language')}
            </Typography>
          </Box>
          <ToggleButtonGroup
            value={currentLanguage}
            exclusive
            onChange={(_, value: 'en' | 'fr' | null) => { if (value) changeLanguage(value); }}
            aria-label={t('common.language')}
            size="small"
            fullWidth
            sx={{ width: '100%' }}
          >
            <ToggleButton value="en">EN</ToggleButton>
            <ToggleButton value="fr">FR</ToggleButton>
          </ToggleButtonGroup>
        </ListItem>

        <Divider sx={{ my: 2 }} />

        {user ? (
          <>
            <ListItem disablePadding>
              <ListItemButton
                onClick={() => handleNavigation('/profile')}
                sx={{ minHeight: 48, px: 2.5, mx: 1, borderRadius: 1 }}
              >
                <ListItemIcon sx={{ minWidth: 40 }}>
                  <PersonIcon />
                </ListItemIcon>
                <ListItemText primary={user.username} secondary={user.email} />
              </ListItemButton>
            </ListItem>
            <ListItem disablePadding>
              <ListItemButton
                onClick={() => { handleDrawerClose(); onLogout(); }}
                sx={{ minHeight: 48, px: 2.5, mx: 1, borderRadius: 1 }}
              >
                <ListItemIcon sx={{ minWidth: 40 }}>
                  <LogoutIcon color="error" />
                </ListItemIcon>
                <ListItemText primary={t('common.logout')} />
              </ListItemButton>
            </ListItem>
          </>
        ) : (
          <Box sx={{ px: 2.5, pb: 2, display: 'flex', flexDirection: 'column', gap: 1 }}>
            <Button fullWidth variant="outlined" onClick={() => handleNavigation('/login')}>
              {t('common.login')}
            </Button>
            <Button fullWidth variant="contained" onClick={() => handleNavigation('/register')}>
              {t('common.register')}
            </Button>
          </Box>
        )}
      </List>
    </Box>
  );

  return (
    <AppBar position="fixed" elevation={1} sx={{ bgcolor: 'white', color: 'text.primary' }}>
      <Toolbar sx={{ minHeight: { xs: 56, sm: 64 }, gap: { md: 0.5 } }}>
        <IconButton
          color="inherit"
          edge="start"
          aria-label={t('common.openMenu')}
          onClick={() => setDrawerOpen(true)}
          sx={{ mr: 1, display: { xs: 'inline-flex', md: 'none' } }}
        >
          <MenuIcon />
        </IconButton>

        <Box
          onClick={() => navigate('/')}
          sx={{ display: 'flex', alignItems: 'center', cursor: 'pointer', flexShrink: 0 }}
        >
          <AutoStoriesIcon sx={{ mr: 1, color: 'primary.main' }} />
          <Typography
            variant="h6"
            noWrap
            sx={{ color: 'primary.main', fontWeight: 700, fontSize: { xs: '1rem', sm: '1.25rem' } }}
          >
            {t('common.appTitle')}
          </Typography>
        </Box>

        <Box sx={{ flexGrow: 1 }} />

        {/* Desktop navigation — hidden on mobile, where the drawer takes over */}
        <Box
          sx={{
            display: { xs: 'none', md: 'flex' },
            alignItems: 'center',
            gap: 1,
            flexShrink: 0,
          }}
        >
          {navItems.map((item) => (
            <Button key={item.path} color="inherit" onClick={() => navigate(item.path)}>
              {item.label}
            </Button>
          ))}

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
            </>
          ) : (
            <>
              <Button color="inherit" onClick={() => navigate('/login')}>{t('common.login')}</Button>
              <Button variant="contained" onClick={() => navigate('/register')} sx={{ ml: 1 }}>
                {t('common.register')}
              </Button>
            </>
          )}
        </Box>

        {/* Mobile: avatar keeps account actions one tap away without opening the drawer */}
        {user && (
          <IconButton
            onClick={(e) => setAnchorEl(e.currentTarget)}
            size="small"
            aria-label={t('common.profile')}
            sx={{ ml: 1, display: { xs: 'inline-flex', md: 'none' } }}
          >
            <Avatar sx={{ bgcolor: 'primary.main', width: 34, height: 34, fontSize: '0.9rem' }}>
              {user.username.charAt(0).toUpperCase()}
            </Avatar>
          </IconButton>
        )}
      </Toolbar>

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

      <SwipeableDrawer
        anchor="left"
        open={drawerOpen}
        onClose={handleDrawerClose}
        onOpen={() => setDrawerOpen(true)}
        sx={{
          display: { xs: 'block', md: 'none' },
          '& .MuiDrawer-paper': { boxSizing: 'border-box', width: 280 },
        }}
      >
        {drawerContent}
      </SwipeableDrawer>
    </AppBar>
  );
};

export default Header;
