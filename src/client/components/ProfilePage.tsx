import React, { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Box, Container, Typography, Card, CardContent, CardActions, Button,
  Chip, CircularProgress, Alert, Dialog, DialogTitle, DialogContent,
  DialogContentText, DialogActions, Snackbar, Tab, Tabs,
} from '@mui/material';
import EditIcon from '@mui/icons-material/Edit';
import DeleteIcon from '@mui/icons-material/Delete';
import AddIcon from '@mui/icons-material/Add';
import { useTranslation } from 'react-i18next';
import { getLanguageName } from '../utils/languages';
import { AppUser } from '../App';

interface StoryCard {
  _id: string;
  title: { lang1: string; lang2: string };
  nativeLanguage: string;
  learningLanguage: string;
  level: string;
  topic: string;
  sentenceCount: number;
  published: boolean;
}

const LEVEL_COLOR: Record<string, 'success' | 'warning' | 'error'> = {
  beginner: 'success',
  intermediate: 'warning',
  advanced: 'error',
};

const ProfilePage: React.FC<{ user: AppUser }> = ({ user }) => {
  const { t } = useTranslation();
  const navigate = useNavigate();

  const [stories, setStories] = useState<StoryCard[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [tab, setTab] = useState(0);
  const [deleteTarget, setDeleteTarget] = useState<StoryCard | null>(null);
  const [snackbar, setSnackbar] = useState('');

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

  const handleDelete = async () => {
    if (!deleteTarget) return;
    try {
      await fetch(`/api/stories/${deleteTarget._id}`, { method: 'DELETE' });
      setStories((prev) => prev.filter((s) => s._id !== deleteTarget._id));
      setSnackbar(t('profile.deleteSuccess'));
    } catch {
      setError('Failed to delete story.');
    } finally {
      setDeleteTarget(null);
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
      setSnackbar(data.published ? t('profile.publishSuccess') : t('profile.unpublishSuccess'));
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
            <Typography variant="h4" sx={{ fontWeight: 700 }}>{t('profile.title')}</Typography>
            <Typography variant="body2" color="text.secondary">{user.username}</Typography>
          </Box>
          <Button variant="contained" startIcon={<AddIcon />} onClick={() => navigate('/editor')}>
            {t('common.writeStory')}
          </Button>
        </Box>

        {error && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError('')}>{error}</Alert>}

        <Tabs value={tab} onChange={(_, v) => setTab(v)} sx={{ mb: 3 }}>
          <Tab label={t('profile.all')} />
          <Tab label={t('profile.drafts')} />
          <Tab label={t('profile.published')} />
        </Tabs>

        {loading ? (
          <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}>
            <CircularProgress />
          </Box>
        ) : filtered.length === 0 ? (
          <Box sx={{ textAlign: 'center', py: 6 }}>
            <Typography color="text.secondary" gutterBottom>{t('profile.noStories')}</Typography>
            <Button variant="contained" onClick={() => navigate('/editor')} sx={{ mt: 1 }}>
              {t('profile.writeFirst')}
            </Button>
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
                    label={story.published ? t('editor.published') : t('editor.draft')}
                    color={story.published ? 'success' : 'default'}
                    size="small"
                    variant={story.published ? 'filled' : 'outlined'}
                  />
                </Box>
                <Typography variant="h6" sx={{ fontWeight: 600 }}>{story.title.lang1}</Typography>
                <Typography variant="body2" color="text.secondary" sx={{ fontStyle: 'italic' }}>
                  {story.title.lang2}
                </Typography>
                {story.topic && (
                  <Typography variant="caption" color="text.secondary" sx={{ mt: 0.5, display: 'block' }}>
                    {story.topic}
                  </Typography>
                )}
                <Typography variant="caption" color="text.secondary">
                  {t('profile.sentences', { count: story.sentenceCount })}
                </Typography>
              </CardContent>
              <CardActions sx={{ px: 2, pb: 2, gap: 1 }}>
                <Button
                  size="small" startIcon={<EditIcon />}
                  onClick={() => navigate(`/editor/${story._id}`)}
                >
                  {t('common.edit')}
                </Button>
                <Button
                  size="small"
                  color={story.published ? 'warning' : 'success'}
                  onClick={() => handleTogglePublish(story)}
                >
                  {story.published ? t('common.unpublish') : t('common.publish')}
                </Button>
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
            {t('profile.deleteConfirm', { title: deleteTarget?.title.lang1 ?? '' })}
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

export default ProfilePage;
