import React, { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Box, Container, Typography, Card, CardContent, CardActions, Button,
  Chip, CircularProgress, Alert, Dialog, DialogTitle, DialogContent,
  DialogContentText, DialogActions, Snackbar, Tab, Tabs, Tooltip,
} from '@mui/material';
import DeleteIcon from '@mui/icons-material/Delete';
import AddIcon from '@mui/icons-material/Add';
import AutoAwesomeIcon from '@mui/icons-material/AutoAwesome';
import AutoStoriesIcon from '@mui/icons-material/AutoStories';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import RateReviewIcon from '@mui/icons-material/RateReview';
import { useTranslation } from 'react-i18next';
import { getLanguageName } from '../utils/languages';
import { getAIModelLabel } from '../utils/aiModels';
import { formatSeedPreview } from '../utils/seedPreview';
import { formatRelativeDate } from '../utils/relativeDate';
import { cloneStory } from '../utils/cloneStory';
import { AppUser } from '../App';

interface StoryCard {
  _id: string;
  title: { lang1: string; lang2: string };
  nativeLanguage: string;
  learningLanguage: string;
  level: string;
  aiModel?: string;
  sentenceCount: number;
  published: boolean;
  generating: boolean;
  isAIGenerated: boolean;
  seed: string;
  aiCallCount: number;
  updatedAt: string;
}

const LEVEL_COLOR: Record<string, 'success' | 'warning' | 'error'> = {
  beginner: 'success',
  intermediate: 'warning',
  advanced: 'error',
};

const MyStoriesPage: React.FC<{ user: AppUser }> = ({ user }) => {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();

  const [stories, setStories] = useState<StoryCard[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [tab, setTab] = useState(0);
  const [deleteTarget, setDeleteTarget] = useState<StoryCard | null>(null);
  const [snackbar, setSnackbar] = useState('');
  const [cloningId, setCloningId] = useState<string | null>(null);

  const fetchStories = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/stories/mine');
      if (!res.ok) throw new Error('Failed to fetch');
      setStories(await res.json());
    } catch {
      setError('Failed to load stories.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchStories(); }, [fetchStories]);

  // Poll every 5s while any story is still being generated
  useEffect(() => {
    if (!stories.some((s) => s.generating)) return;
    const interval = setInterval(fetchStories, 5000);
    return () => clearInterval(interval);
  }, [stories, fetchStories]);

  const handleDelete = async () => {
    if (!deleteTarget) return;
    try {
      await fetch(`/api/stories/${deleteTarget._id}`, { method: 'DELETE' });
      setStories((prev) => prev.filter((s) => s._id !== deleteTarget._id));
      setSnackbar(t('myStories.deleteSuccess'));
    } catch {
      setError('Failed to delete story.');
    } finally {
      setDeleteTarget(null);
    }
  };

  const handleClone = async (story: StoryCard) => {
    setCloningId(story._id);
    try {
      const result = await cloneStory(story._id);
      if (!result.ok || !result.id) {
        setError(
          result.code === 'CREATOR_ACCESS_REQUIRED'
            ? t('editor.noCreatorAccessError')
            : result.message || t('common.cloneError')
        );
        return;
      }
      navigate(`/editor/${result.id}`);
    } finally {
      setCloningId(null);
    }
  };

  const handleTogglePublish = async (story: StoryCard) => {
    try {
      const res = await fetch(`/api/stories/${story._id}/publish`, { method: 'POST' });
      const data = await res.json();
      if (!res.ok) {
        setError(data.message || 'Failed to update');
        return;
      }
      setStories((prev) =>
        prev.map((s) => (s._id === story._id ? { ...s, published: data.published } : s))
      );
      setSnackbar(data.published ? t('myStories.publishSuccess') : t('myStories.unpublishSuccess'));
    } catch {
      setError('Failed to update story.');
    }
  };

  const filtered = stories.filter((s) => {
    if (tab === 1) return !s.published;
    if (tab === 2) return s.published;
    return true;
  });

  return (
    <Box sx={{ pt: 10, pb: 6, bgcolor: 'background.default', minHeight: '100vh' }}>
      <Container maxWidth="md">
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
          <Box>
            <Typography variant="h4" sx={{ fontWeight: 700 }}>{t('myStories.title')}</Typography>
            <Typography variant="body2" color="text.secondary">{user.username}</Typography>
          </Box>
          <Tooltip title={user.canCreateStories ? '' : t('creatorAccess.tooltip')}>
            <span>
              <Button
                variant="contained"
                startIcon={<AddIcon />}
                onClick={() => navigate('/editor')}
                disabled={!user.canCreateStories}
              >
                {t('common.writeStory')}
              </Button>
            </span>
          </Tooltip>
        </Box>

        {!user.canCreateStories && (
          <Alert severity="info" sx={{ mb: 2 }}>{t('creatorAccess.message')}</Alert>
        )}

        {error && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError('')}>{error}</Alert>}

        <Tabs value={tab} onChange={(_, v) => setTab(v)} sx={{ mb: 3 }}>
          <Tab label={t('myStories.all')} />
          <Tab label={t('myStories.drafts')} />
          <Tab label={t('myStories.published')} />
        </Tabs>

        {loading ? (
          <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}>
            <CircularProgress />
          </Box>
        ) : filtered.length === 0 ? (
          <Box sx={{ textAlign: 'center', py: 6 }}>
            <Typography color="text.secondary" gutterBottom>{t('myStories.noStories')}</Typography>
            <Tooltip title={user.canCreateStories ? '' : t('creatorAccess.tooltip')}>
              <span>
                <Button
                  variant="contained"
                  onClick={() => navigate('/editor')}
                  disabled={!user.canCreateStories}
                  sx={{ mt: 1 }}
                >
                  {t('myStories.writeFirst')}
                </Button>
              </span>
            </Tooltip>
          </Box>
        ) : (
          filtered.map((story) => (
            <Card key={story._id} elevation={2} sx={{ mb: 2 }}>
              <CardContent>
                <Box sx={{ display: 'flex', gap: 1, mb: 1, flexWrap: 'wrap' }}>
                  <Chip label={t(`levels.${story.level}`)} color={LEVEL_COLOR[story.level] ?? 'default'} size="small" />
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
                  <Chip
                    label={story.published ? t('editor.published') : t('editor.draft')}
                    color={story.published ? 'success' : 'default'}
                    size="small"
                    variant={story.published ? 'filled' : 'outlined'}
                  />
                  {story.generating && (
                    <Chip
                      icon={<AutoAwesomeIcon fontSize="small" />}
                      label={t('myStories.generating')}
                      color="secondary"
                      size="small"
                      variant="outlined"
                    />
                  )}
                </Box>
                <Typography variant="h6" sx={{ fontWeight: 600 }}>{story.title.lang1}</Typography>
                <Typography
                  variant="body2"
                  color="text.secondary"
                  sx={{
                    mt: 0.5,
                    mb: 0.5,
                    display: '-webkit-box',
                    WebkitLineClamp: 2,
                    WebkitBoxOrient: 'vertical',
                    overflow: 'hidden',
                  }}
                >
                  {formatSeedPreview(story.seed) || t('stories.seedUnavailable')}
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  {t('myStories.sentences', { count: story.sentenceCount })} · {t('stories.updatedAgo', { when: formatRelativeDate(story.updatedAt, i18n.language) })}{((story.aiCallCount ?? 0) > 0 || story.isAIGenerated) ? ` · ${t('stories.aiCalls', { count: Math.max(story.aiCallCount ?? 0, story.isAIGenerated ? 1 : 0) })}` : ''}
                </Typography>
              </CardContent>
              <CardActions sx={{ px: 2, pb: 2, gap: 1, flexWrap: 'wrap' }}>
                <Button
                  size="small" startIcon={<AutoStoriesIcon />}
                  onClick={() => navigate(`/preview/${story._id}`)}
                  disabled={story.sentenceCount === 0}
                >
                  {t('myStories.read')}
                </Button>
                {/* seed is the fallback for stories generated before isAIGenerated was added */}
                {(story.isAIGenerated || !!story.seed) && (
                  <Button
                  size="small" startIcon={<RateReviewIcon />}
                  onClick={() => navigate(`/review/${story._id}`)}
                  disabled={story.sentenceCount === 0 || story.generating}
                >
                  {t('myStories.review')}
                </Button>
                )}
                <Button
                  size="small"
                  color={story.published ? 'warning' : 'success'}
                  onClick={() => handleTogglePublish(story)}
                >
                  {story.published ? t('common.unpublish') : t('common.publish')}
                </Button>
                <Tooltip title={user.canCreateStories ? '' : t('creatorAccess.tooltip')}>
                  <span>
                    <Button
                      size="small" startIcon={<ContentCopyIcon />}
                      onClick={() => handleClone(story)}
                      disabled={!user.canCreateStories || story.generating || cloningId === story._id}
                    >
                      {t('common.clone')}
                    </Button>
                  </span>
                </Tooltip>
                <Button
                  size="small" color="error" startIcon={<DeleteIcon />}
                  onClick={() => setDeleteTarget(story)}
                  sx={{ ml: 'auto' }}
                >
                  {t('common.delete')}
                </Button>
              </CardActions>
            </Card>
          ))
        )}
      </Container>

      {/* Delete confirmation */}
      <Dialog open={!!deleteTarget} onClose={() => setDeleteTarget(null)}>
        <DialogTitle>{t('common.delete')}</DialogTitle>
        <DialogContent>
          <DialogContentText>
            {t('myStories.deleteConfirm', { title: deleteTarget?.title.lang1 ?? '' })}
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeleteTarget(null)}>{t('common.cancel')}</Button>
          <Button onClick={handleDelete} color="error" variant="contained">{t('common.delete')}</Button>
        </DialogActions>
      </Dialog>

      <Snackbar
        open={!!snackbar}
        autoHideDuration={3000}
        onClose={() => setSnackbar('')}
        message={snackbar}
      />
    </Box>
  );
};

export default MyStoriesPage;
