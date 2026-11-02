import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Box, Container, Typography, Button, Grid, Card, CardContent,
  CardActions, Chip, CircularProgress, Tooltip,
  Dialog, DialogActions, DialogContent, DialogContentText, DialogTitle,
} from '@mui/material';
import AutoStoriesIcon from '@mui/icons-material/AutoStories';
import EditIcon from '@mui/icons-material/Edit';
import AutoAwesomeIcon from '@mui/icons-material/AutoAwesome';
import { useTranslation } from 'react-i18next';
import { getLanguageName } from '../utils/languages';
import { getAIModelLabel } from '../utils/aiModels';
import { formatSeedPreview } from '../utils/seedPreview';
import { formatRelativeDate } from '../utils/relativeDate';
import { AppUser } from '../App';

interface StoryCard {
  _id: string;
  title: { lang1: string; lang2: string };
  nativeLanguage: string;
  learningLanguage: string;
  level: string;
  aiModel?: string;
  aiReasoningEffort?: string;
  isAIGenerated: boolean;
  seed: string;
  authorName: string;
  creationSource?: 'ui' | 'api';
  createdViaApiKeyName?: string;
  sentenceCount: number;
  aiCallCount: number;
  updatedAt: string;
}

const LEVEL_COLOR: Record<string, 'success' | 'warning' | 'error'> = {
  beginner: 'success',
  intermediate: 'warning',
  advanced: 'error',
};

/** Remembered so the launch announcement is shown once per browser. */
const WIZARD_INTRO_KEY = 'storyCreator.wizardIntroSeen';

const LandingPage: React.FC<{ user: AppUser | null }> = ({ user }) => {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const [stories, setStories] = useState<StoryCard[]>([]);
  const [loading, setLoading] = useState(true);
  const [wizardIntroOpen, setWizardIntroOpen] = useState(false);

  useEffect(() => {
    fetch('/api/stories?page=1')
      .then((res) => res.json())
      .then((data) => setStories(data.stories || []))
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  // Announce the step-by-step flow once, and only to accounts that can create
  // stories and have not used it yet.
  useEffect(() => {
    if (!user?.canCreateStories) return;
    try {
      if (localStorage.getItem(WIZARD_INTRO_KEY) === '1') return;
    } catch {
      return;
    }

    let cancelled = false;
    fetch('/api/stories/mine')
      .then((res) => (res.ok ? res.json() : []))
      .then((data: Array<{ generationMode?: string }>) => {
        if (cancelled) return;
        const alreadyUsed = Array.isArray(data) && data.some((s) => s.generationMode === 'staged');
        if (alreadyUsed) {
          try {
            localStorage.setItem(WIZARD_INTRO_KEY, '1');
          } catch {
            // Storage unavailable — nothing to remember.
          }
          return;
        }
        setWizardIntroOpen(true);
      })
      // A failed request must not suppress the announcement.
      .catch(() => {
        if (!cancelled) setWizardIntroOpen(true);
      });

    return () => {
      cancelled = true;
    };
  }, [user?.canCreateStories]);

  const dismissWizardIntro = () => {
    try {
      localStorage.setItem(WIZARD_INTRO_KEY, '1');
    } catch {
      // Private mode: the dialog simply shows again next visit.
    }
    setWizardIntroOpen(false);
  };

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
                  variant="outlined" size="large" startIcon={<AutoAwesomeIcon />}
                  onClick={() => navigate('/create')}
                  disabled={!user.canCreateStories}
                  sx={{ borderColor: 'white', color: 'white', '&:hover': { bgcolor: 'rgba(255,255,255,0.1)' } }}
                >
                  {t('landing.startWriting')}
                  <Chip
                    label={t('landing.newTag')}
                    color="secondary"
                    size="small"
                    sx={{ ml: 1, height: 18, fontSize: 10 }}
                  />
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
        {user?.canCreateStories && (
          <Button
            size="small"
            startIcon={<EditIcon fontSize="small" />}
            onClick={() => navigate('/editor')}
            sx={{ mt: 2, color: 'rgba(255,255,255,0.85)', '&:hover': { color: 'white' } }}
          >
            {t('landing.quickCreate')}
          </Button>
        )}
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
                    startIcon={<AutoAwesomeIcon />}
                    onClick={() => navigate('/create')}
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
                            ? t('stories.aiModelTag', { model: getAIModelLabel(story.aiModel, story.aiReasoningEffort) })
                            : t('stories.manualTag')
                        }
                        size="small"
                        color={story.isAIGenerated ? 'info' : 'default'}
                        variant="outlined"
                      />
                      {story.creationSource === 'api' && story.createdViaApiKeyName && (
                        <Chip
                          label={t('stories.apiSourceTag', { keyName: story.createdViaApiKeyName })}
                          size="small"
                          color="secondary"
                          variant="outlined"
                        />
                      )}
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
                      {t('stories.by')} {story.authorName} · {t('stories.sentences', { count: story.sentenceCount })} · {t('stories.updatedAgo', { when: formatRelativeDate(story.updatedAt, i18n.language) })}{((story.aiCallCount ?? 0) > 0 || story.isAIGenerated) ? ` · ${t('stories.aiCalls', { count: Math.max(story.aiCallCount ?? 0, story.isAIGenerated ? 1 : 0) })}` : ''}
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

      {wizardIntroOpen && (
        <Dialog open onClose={dismissWizardIntro} maxWidth="sm" fullWidth>
          <DialogTitle>{t('landing.wizardIntro.title')}</DialogTitle>
          <DialogContent>
            <DialogContentText sx={{ mb: 2 }}>{t('landing.wizardIntro.body')}</DialogContentText>
            <Box component="ul" sx={{ m: 0, pl: 2.5 }}>
              <li>
                <Typography variant="body2">{t('landing.wizardIntro.point1')}</Typography>
              </li>
              <li>
                <Typography variant="body2">{t('landing.wizardIntro.point2')}</Typography>
              </li>
              <li>
                <Typography variant="body2">{t('landing.wizardIntro.point3')}</Typography>
              </li>
            </Box>
          </DialogContent>
          <DialogActions>
            <Button
              onClick={() => {
                dismissWizardIntro();
                navigate('/editor');
              }}
            >
              {t('landing.wizardIntro.classic')}
            </Button>
            <Button
              variant="contained"
              startIcon={<AutoAwesomeIcon />}
              onClick={() => {
                dismissWizardIntro();
                navigate('/create');
              }}
            >
              {t('landing.wizardIntro.tryIt')}
            </Button>
          </DialogActions>
        </Dialog>
      )}
    </Box>
  );
};

export default LandingPage;
