import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  Box, Container, Typography, Paper, Button, Chip, CircularProgress,
  Alert, LinearProgress, IconButton, Tooltip,
} from '@mui/material';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import ArrowBackIosNewIcon from '@mui/icons-material/ArrowBackIosNew';
import ArrowForwardIosIcon from '@mui/icons-material/ArrowForwardIos';
import VisibilityIcon from '@mui/icons-material/Visibility';
import VisibilityOffIcon from '@mui/icons-material/VisibilityOff';
import AutoStoriesIcon from '@mui/icons-material/AutoStories';
import { useTranslation } from 'react-i18next';
import { getLanguageName } from '../utils/languages';

interface Sentence {
  lang1: string;
  lang2: string;
}

interface Story {
  _id: string;
  title: { lang1: string; lang2: string };
  sentences: Sentence[];
  nativeLanguage: string;
  learningLanguage: string;
  level: 'beginner' | 'intermediate' | 'advanced';
  topic: string;
  authorName: string;
}

const LEVEL_COLOR: Record<string, 'success' | 'warning' | 'error'> = {
  beginner: 'success',
  intermediate: 'warning',
  advanced: 'error',
};

const StoryReadPage: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { t } = useTranslation();

  const [story, setStory] = useState<Story | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [currentIndex, setCurrentIndex] = useState(0);
  // tracks which sentences have their translation revealed
  const [revealed, setRevealed] = useState<Set<number>>(new Set());
  const [allRevealed, setAllRevealed] = useState(false);

  useEffect(() => {
    if (!id) return;
    fetch(`/api/stories/${id}`)
      .then((res) => {
        if (res.status === 404 || res.status === 403) throw new Error('not-found');
        if (!res.ok) throw new Error('error');
        return res.json();
      })
      .then((data) => setStory(data))
      .catch((err) => setError(err.message === 'not-found' ? 'not-found' : 'error'))
      .finally(() => setLoading(false));
  }, [id]);

  if (loading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '100vh' }}>
        <CircularProgress />
      </Box>
    );
  }

  if (error) {
    return (
      <Box sx={{ pt: 12, pb: 6 }}>
        <Container maxWidth="md">
          <Button startIcon={<ArrowBackIcon />} onClick={() => navigate('/stories')} sx={{ mb: 2 }}>
            {t('reader.backToStories')}
          </Button>
          <Alert severity={error === 'not-found' ? 'info' : 'error'}>
            {t(error === 'not-found' ? 'reader.notFoundMessage' : 'reader.notFound')}
          </Alert>
        </Container>
      </Box>
    );
  }

  if (!story) return null;

  const total = story.sentences.length;
  const sentence = story.sentences[currentIndex];
  const isRevealed = revealed.has(currentIndex);

  const toggleReveal = (index: number) => {
    setRevealed((prev) => {
      const next = new Set(prev);
      next.has(index) ? next.delete(index) : next.add(index);
      return next;
    });
  };

  const toggleAll = () => {
    if (allRevealed) {
      setRevealed(new Set());
    } else {
      setRevealed(new Set(story.sentences.map((_, i) => i)));
    }
    setAllRevealed((v) => !v);
  };

  return (
    <Box sx={{ pt: 10, pb: 6, bgcolor: 'background.default', minHeight: '100vh' }}>
      <Container maxWidth="md">
        <Button startIcon={<ArrowBackIcon />} onClick={() => navigate('/stories')} sx={{ mb: 3 }}>
          {t('reader.backToStories')}
        </Button>

        {/* Story header */}
        <Paper elevation={2} sx={{ p: 3, mb: 3, borderLeft: '4px solid', borderColor: 'primary.main' }}>
          <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 2 }}>
            <AutoStoriesIcon sx={{ fontSize: 40, color: 'primary.main', mt: 0.5, flexShrink: 0 }} />
            <Box sx={{ flexGrow: 1 }}>
              <Box sx={{ display: 'flex', gap: 1, mb: 1, flexWrap: 'wrap' }}>
                <Chip label={t(`levels.${story.level}`)} color={LEVEL_COLOR[story.level] ?? 'default'} size="small" />
                <Chip
                  label={`${getLanguageName(story.nativeLanguage)} → ${getLanguageName(story.learningLanguage)}`}
                  size="small" variant="outlined"
                />
                {story.topic && <Chip label={story.topic} size="small" variant="outlined" />}
              </Box>
              <Typography variant="h5" sx={{ fontWeight: 700 }}>{story.title.lang2 || story.title.lang1}</Typography>
              {story.title.lang2 && (
                <Typography variant="subtitle1" color="text.secondary" sx={{ fontStyle: 'italic' }}>
                  {story.title.lang1}
                </Typography>
              )}
              <Typography variant="caption" color="text.secondary">
                {t('stories.by')} {story.authorName} · {t('stories.sentences', { count: total })}
              </Typography>
            </Box>
          </Box>
        </Paper>

        {/* Progress bar */}
        <Box sx={{ mb: 2 }}>
          <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.5 }}>
            <Typography variant="caption" color="text.secondary">
              {t('reader.sentence', { current: currentIndex + 1, total })}
            </Typography>
            <Button size="small" onClick={toggleAll} startIcon={allRevealed ? <VisibilityOffIcon /> : <VisibilityIcon />}>
              {allRevealed ? t('reader.hideAll') : t('reader.showAll')}
            </Button>
          </Box>
          <LinearProgress variant="determinate" value={((currentIndex + 1) / total) * 100} sx={{ borderRadius: 2 }} />
        </Box>

        {/* Sentence card */}
        {total > 0 && sentence && (
          <Paper elevation={2} sx={{ p: 3, mb: 2, minHeight: 140 }}>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <Box sx={{ flexGrow: 1 }}>
                {/* Learning language (lang2) shown prominently */}
                <Typography variant="body1" sx={{ fontSize: '1.15rem', fontWeight: 600, lineHeight: 1.6, mb: 1.5 }}>
                  {sentence.lang2}
                </Typography>

                {/* Native language (lang1) revealed on toggle */}
                {isRevealed && (
                  <Typography variant="body2" color="text.secondary" sx={{ fontStyle: 'italic', lineHeight: 1.6 }}>
                    {sentence.lang1}
                  </Typography>
                )}
              </Box>
              <Tooltip title={isRevealed ? t('reader.hideTranslation') : t('reader.showTranslation')}>
                <IconButton onClick={() => toggleReveal(currentIndex)} color={isRevealed ? 'primary' : 'default'}>
                  {isRevealed ? <VisibilityOffIcon /> : <VisibilityIcon />}
                </IconButton>
              </Tooltip>
            </Box>
          </Paper>
        )}

        {/* Navigation */}
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <Button
            startIcon={<ArrowBackIosNewIcon />}
            onClick={() => setCurrentIndex((i) => Math.max(0, i - 1))}
            disabled={currentIndex === 0}
          >
            {t('reader.previous')}
          </Button>
          <Typography variant="body2" color="text.secondary">
            {currentIndex + 1} / {total}
          </Typography>
          <Button
            endIcon={<ArrowForwardIosIcon />}
            onClick={() => setCurrentIndex((i) => Math.min(total - 1, i + 1))}
            disabled={currentIndex === total - 1}
          >
            {t('reader.next')}
          </Button>
        </Box>
      </Container>
    </Box>
  );
};

export default StoryReadPage;
