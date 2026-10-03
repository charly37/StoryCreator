import React from 'react';
import { useNavigate } from 'react-router-dom';
import { Box, Container, Alert, AlertTitle, Button } from '@mui/material';
import { useTranslation } from 'react-i18next';

/**
 * Shown when a user without the `canCreateStories` permission tries to reach the
 * new-story editor. Editing existing stories is unaffected by the permission.
 */
const CreatorAccessNotice: React.FC = () => {
  const navigate = useNavigate();
  const { t } = useTranslation();

  return (
    <Box sx={{ pt: 10, pb: 8, bgcolor: 'background.default', minHeight: '100vh' }}>
      <Container maxWidth="md">
        <Alert severity="info">
          <AlertTitle>{t('creatorAccess.title')}</AlertTitle>
          {t('creatorAccess.message')}
          <Box sx={{ mt: 2 }}>
            <Button variant="outlined" size="small" onClick={() => navigate('/my-stories')}>
              {t('common.myStories')}
            </Button>
          </Box>
        </Alert>
      </Container>
    </Box>
  );
};

export default CreatorAccessNotice;
