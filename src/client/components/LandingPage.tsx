import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Box, Container, Typography, Button, Grid, Card, CardContent,
  CardActions, Chip, CircularProgress, Tooltip,
} from '@mui/material';
import AutoStoriesIcon from '@mui/icons-material/AutoStories';
import EditIcon from '@mui/icons-material/Edit';
import { useTranslation } from 'react-i18next';
import { getLanguageName } from '../utils/languages';
import { getAIModelLabel } from '../utils/aiModels';
import { formatSeedPreview } from '../utils/seedPreview';
import { AppUser } from '../App';

interface StoryCard {
  _id: string;
  title: { lang1: string; lang2: string };
  nativeLanguage: string;
  learningLanguage: string;
  level: string;
  aiModel?: string;
  isAIGenerated: boolean;
  seed: string;
  authorName: string;
  sentenceCount: number;
}

const LEVEL_COLOR: Record<string, 'success' | 'warning' | 'error'> = {
  beginner: 'success',
  intermediate: 'warning',
  advanced: 'error',
};

const LandingPage: React.FC<{ user: AppUser | null }> = ({ user }) => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [stories, setStories] = useState<StoryCard[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/stories?page=1')
      .then((res) => res.json())
      .then((data) => setStories(data.stories || []))
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  return (
    <Box sx={{ pt: 8, bgcolor: 'background.default', minHeight: '100vh' }}>
      {/* Hero */}
      <Box
        sx={{
          background: 'linear-gradient(135deg, #1e40af 0%, #7c3aed 100%)',
          color: 'white',
          py: 10,
          px: 2,
          textAlign: 'center',
        }}
      >
        <AutoStoriesIcon sx={{ fontSize: 60, mb: 2, opacity: 0.9 }} />
        <Typography variant="h3" sx={{ fontWeight: 800 }} gutterBottom>
          {t('landing.hero.title')}
        </Typography>
        <Typography variant="h6" sx={{ mb: 4, opacity: 0.85, maxWidth: 600, mx: 'auto' }}>
          {t('landing.hero.subtitle')}
        </Typography>
        <Box sx={{ display: 'flex', gap: 2, justifyContent: 'center', flexWrap: 'wrap' }}>
          <Button
            variant="contained" size="large"
            onClick={() => navigate('/stories')}
            sx={{ bgcolor: 'white', color: 'primary.main', '&:hover': { bgcolor: '#e0eaff' } }}
          >
            {t('landing.browseStories')}
          </Button>
          {user ? (
            <Tooltip title={user.canCreateStories ? '' : t('creatorAccess.tooltip')}>
              <span>
                <Button
                  variant="outlined" size="large" startIcon={<EditIcon />}
                  onClick={() => navigate('/editor')}
                  disabled={!user.canCreateStories}
                  sx={{ borderColor: 'white', color: 'white', '&:hover': { bgcolor: 'rgba(255,255,255,0.1)' } }}
                >
                  {t('landing.startWriting')}
                </Button>
              </span>
            </Tooltip>
          ) : (
            <Button
              variant="outlined" size="large"
              onClick={() => navigate('/register')}
              sx={{ borderColor: 'white', color: 'white', '&:hover': { bgcolor: 'rgba(255,255,255,0.1)' } }}
            >
              {t('common.register')}
            </Button>
          )}
        </Box>
      </Box>

      {/* Recent stories grid */}
      <Container maxWidth="lg" sx={{ py: 6 }}>
        <Typography variant="h5" sx={{ fontWeight: 700 }} gutterBottom>
          {t('landing.featuredStories')}
        </Typography>

        {loading ? (
          <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}>
            <CircularProgress />
          </Box>
        ) : stories.length === 0 ? (
          <Box sx={{ textAlign: 'center', py: 6 }}>
            <Typography color="text.secondary" gutterBottom>{t('landing.noStories')}</Typography>
            {user && (
              <Tooltip title={user.canCreateStories ? '' : t('creatorAccess.tooltip')}>
                <span>
                  <Button
                    variant="contained"
                    onClick={() => navigate('/editor')}
                    disabled={!user.canCreateStories}
                    sx={{ mt: 2 }}
                  >
                    {t('landing.startWriting')}
                  </Button>
                </span>
              </Tooltip>
            )}
          </Box>
        ) : (
          <Grid container spacing={3}>
            {stories.slice(0, 6).map((story) => (
              <Grid size={{ xs: 12, sm: 6, md: 4 }} key={story._id}>
                <Card elevation={2} sx={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
                  <CardContent sx={{ flexGrow: 1 }}>
                    <Box sx={{ display: 'flex', gap: 1, mb: 1.5, flexWrap: 'wrap' }}>
                      <Chip
                        label={t(`levels.${story.level}`)}
                        color={LEVEL_COLOR[story.level] ?? 'default'}
                        size="small"
                      />
                      <Chip
                        label={`${getLanguageName(story.nativeLanguage)} → ${getLanguageName(story.learningLanguage)}`}
                        size="small" variant="outlined"
                      />
                      <Chip
                        label={
                          story.isAIGenerated
                            ? t('stories.aiModelTag', { model: getAIModelLabel(story.aiModel) })
                            : t('stories.manualTag')
                        }
                        size="small"
                        color={story.isAIGenerated ? 'info' : 'default'}
                        variant="outlined"
                      />
                    </Box>
                    <Typography variant="h6" sx={{ fontWeight: 600 }} gutterBottom noWrap>
                      {story.title.lang1}
                    </Typography>
                    <Typography
                      variant="body2"
                      color="text.secondary"
                      sx={{
                        mt: 0.5,
                        display: '-webkit-box',
                        WebkitLineClamp: 2,
                        WebkitBoxOrient: 'vertical',
                        overflow: 'hidden',
                      }}
                    >
                      {formatSeedPreview(story.seed) || t('stories.seedUnavailable')}
                    </Typography>
                  </CardContent>
                  <CardActions sx={{ px: 2, pb: 2 }}>
                    <Typography variant="caption" color="text.secondary" sx={{ flexGrow: 1 }}>
                      {t('stories.by')} {story.authorName} · {t('stories.sentences', { count: story.sentenceCount })}
                    </Typography>
                    <Button size="small" variant="outlined" onClick={() => navigate(`/stories/${story._id}`)}>
                      {t('stories.readStory')}
                    </Button>
                  </CardActions>
                </Card>
              </Grid>
            ))}
          </Grid>
        )}

        {!user && (
          <Box sx={{ textAlign: 'center', mt: 5, p: 3, bgcolor: 'grey.100', borderRadius: 3 }}>
            <Typography variant="body1" gutterBottom sx={{ fontWeight: 500 }}>
              {t('landing.writeCta')}
            </Typography>
            <Button variant="contained" onClick={() => navigate('/login')} sx={{ mr: 1 }}>
              {t('common.login')}
            </Button>
            <Button variant="outlined" onClick={() => navigate('/register')}>
              {t('common.register')}
            </Button>
          </Box>
        )}
      </Container>
    </Box>
  );
};

export default LandingPage;
