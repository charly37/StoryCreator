import React from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Container, Box, Typography, Paper, Grid, Divider, Link, Alert, Button,
} from '@mui/material';
import InfoIcon from '@mui/icons-material/Info';
import AutoStoriesIcon from '@mui/icons-material/AutoStories';
import TranslateIcon from '@mui/icons-material/Translate';
import WarningAmberIcon from '@mui/icons-material/WarningAmber';
import CodeIcon from '@mui/icons-material/Code';
import GitHubIcon from '@mui/icons-material/GitHub';
import FavoriteIcon from '@mui/icons-material/Favorite';
import AutoAwesomeIcon from '@mui/icons-material/AutoAwesome';
import SchoolIcon from '@mui/icons-material/School';
import { useTranslation } from 'react-i18next';

const AboutPage: React.FC = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();

  return (
    <Box sx={{ pt: 10, pb: 6, bgcolor: 'background.default', minHeight: '100vh' }}>
      <Container maxWidth="lg">
        <Box sx={{ py: 6 }}>
          {/* Header */}
          <Box sx={{ textAlign: 'center', mb: 6 }}>
            <InfoIcon sx={{ fontSize: 64, color: 'primary.main', mb: 2 }} />
            <Typography variant="h3" component="h1" gutterBottom sx={{ fontWeight: 700 }}>
              {t('about.title')}
            </Typography>
            <Typography variant="h6" color="text.secondary" sx={{ maxWidth: '700px', mx: 'auto' }}>
              {t('about.subtitle')}
            </Typography>
          </Box>

          {/* What is StoryCreator */}
          <Paper elevation={2} sx={{ p: 4, mb: 4 }}>
            <Typography variant="h4" gutterBottom sx={{ fontWeight: 600, mb: 2 }}>
              {t('about.purposeTitle')}
            </Typography>
            <Typography variant="body1" color="text.secondary" sx={{ mb: 2 }}>
              {t('about.purposeText')}
            </Typography>

            {/* Personal project / stability notice */}
            <Alert severity="warning" icon={<WarningAmberIcon />} sx={{ mt: 3 }}>
              <Typography variant="subtitle2" sx={{ fontWeight: 600, mb: 0.5 }}>
                {t('about.personalProjectTitle')}
              </Typography>
              <Typography variant="body2" sx={{ mb: 1 }}>
                {t('about.personalProjectText')}
              </Typography>
              <Typography variant="caption" sx={{ fontStyle: 'italic' }}>
                {t('about.personalProjectNote')}
              </Typography>
            </Alert>
          </Paper>

          {/* Reading + writing features */}
          <Grid container spacing={3} sx={{ mb: 4 }}>
            <Grid size={{ xs: 12, md: 6 }}>
              <Paper elevation={2} sx={{ p: 4, height: '100%' }}>
                <Box sx={{ display: 'flex', alignItems: 'center', mb: 2 }}>
                  <TranslateIcon sx={{ fontSize: 32, color: 'primary.main', mr: 2 }} />
                  <Typography variant="h5" sx={{ fontWeight: 600 }}>
                    {t('about.readingTitle')}
                  </Typography>
                </Box>
                <Typography variant="body1" color="text.secondary">
                  {t('about.readingText')}
                </Typography>
              </Paper>
            </Grid>

            <Grid size={{ xs: 12, md: 6 }}>
              <Paper elevation={2} sx={{ p: 4, height: '100%' }}>
                <Box sx={{ display: 'flex', alignItems: 'center', mb: 2 }}>
                  <AutoStoriesIcon sx={{ fontSize: 32, color: 'secondary.main', mr: 2 }} />
                  <Typography variant="h5" sx={{ fontWeight: 600 }}>
                    {t('about.writerAccessTitle')}
                  </Typography>
                </Box>
                <Typography variant="body1" color="text.secondary" sx={{ mb: 2 }}>
                  {t('about.writerAccessText')}
                </Typography>
                <Alert severity="warning" icon={<AutoAwesomeIcon />} sx={{ py: 0.5 }}>
                  {t('about.writerAccessNote')}
                </Alert>
              </Paper>
            </Grid>

            <Grid size={{ xs: 12, md: 6 }}>
              <Paper elevation={2} sx={{ p: 4, height: '100%' }}>
                <Box sx={{ display: 'flex', alignItems: 'center', mb: 2 }}>
                  <SchoolIcon sx={{ fontSize: 32, color: 'primary.main', mr: 2 }} />
                  <Typography variant="h5" sx={{ fontWeight: 600 }}>
                    {t('about.otherWebsiteTitle')}
                  </Typography>
                </Box>
                <Typography variant="body1" color="text.secondary" sx={{ mb: 2 }}>
                  {t('about.otherWebsiteText')}
                </Typography>
                <Link
                  href="https://dialecthub.net/"
                  target="_blank"
                  rel="noopener noreferrer"
                  sx={{ fontWeight: 600 }}
                >
                  https://dialecthub.net/
                </Link>
              </Paper>
            </Grid>
          </Grid>

          {/* Open source */}
          <Paper elevation={2} sx={{ p: 4, mb: 4 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', mb: 2 }}>
              <CodeIcon sx={{ fontSize: 32, color: 'primary.main', mr: 2 }} />
              <Typography variant="h4" sx={{ fontWeight: 600 }}>
                {t('about.openSourceTitle')}
              </Typography>
            </Box>
            <Typography variant="body1" color="text.secondary" sx={{ mb: 2 }}>
              {t('about.openSourceText')}
            </Typography>

            <Box sx={{ mt: 3, p: 2, bgcolor: 'background.paper', borderRadius: 2, border: '1px solid', borderColor: 'divider' }}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
                <GitHubIcon sx={{ fontSize: 24 }} />
                <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>
                  GitHub Repository:
                </Typography>
              </Box>
              <Link
                href="https://github.com/charly37/StoryCreator"
                target="_blank"
                rel="noopener noreferrer"
                sx={{ fontSize: '1.1rem', display: 'block', mb: 2, wordBreak: 'break-all' }}
              >
                https://github.com/charly37/StoryCreator
              </Link>

              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1, mt: 2 }}>
                <Box sx={{ display: 'flex', alignItems: 'center' }}>
                  <FavoriteIcon sx={{ fontSize: 18, color: 'error.main', mr: 1 }} />
                  <Typography variant="body2" color="text.secondary">
                    {t('about.githubStar')}
                  </Typography>
                </Box>
                <Box sx={{ display: 'flex', alignItems: 'center' }}>
                  <InfoIcon sx={{ fontSize: 18, color: 'info.main', mr: 1 }} />
                  <Typography variant="body2" color="text.secondary">
                    {t('about.githubIssues')}
                  </Typography>
                </Box>
              </Box>
            </Box>
          </Paper>

          {/* Get started */}
          <Box sx={{ mt: 6, textAlign: 'center' }}>
            <Typography variant="h4" gutterBottom sx={{ fontWeight: 600 }}>
              {t('about.getStartedTitle')}
            </Typography>
            <Typography variant="body1" color="text.secondary" sx={{ mb: 3 }}>
              {t('about.getStartedText')}
            </Typography>
            <Box sx={{ display: 'flex', gap: 2, justifyContent: 'center', flexWrap: 'wrap' }}>
              <Button variant="contained" onClick={() => navigate('/stories')}>
                {t('common.stories')}
              </Button>
              <Button variant="outlined" onClick={() => navigate('/')}>
                {t('common.home')}
              </Button>
            </Box>
          </Box>

          {/* Version */}
          <Box sx={{ mt: 4, textAlign: 'center' }}>
            <Divider sx={{ mb: 2 }} />
            <Typography variant="caption" color="text.disabled">
              {t('about.versionLabel')}: {APP_VERSION}
            </Typography>
          </Box>
        </Box>
      </Container>
    </Box>
  );
};

export default AboutPage;
