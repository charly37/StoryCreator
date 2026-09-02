import React, { useEffect, useState, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  Box, Container, Typography, Paper, Button, Chip, CircularProgress,
  Alert, TextField, IconButton, Tooltip, Divider, Snackbar,
} from '@mui/material';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import RateReviewIcon from '@mui/icons-material/RateReview';
import CommentIcon from '@mui/icons-material/Comment';
import CommentOutlinedIcon from '@mui/icons-material/CommentOutlined';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import AutoAwesomeIcon from '@mui/icons-material/AutoAwesome';
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
  generating: boolean;
  approved: boolean;
  sentenceCount: number;
}

const LEVEL_COLOR: Record<string, 'success' | 'warning' | 'error'> = {
  beginner: 'success',
  intermediate: 'warning',
  advanced: 'error',
};

const StoryReviewPage: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { t } = useTranslation();

  const [story, setStory] = useState<Story | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [snackbar, setSnackbar] = useState('');

  // Feedback state — reset on each new load
  const [generalFeedback, setGeneralFeedback] = useState('');
  // sentenceIndex → annotation text; only entries with non-empty strings are active
  const [annotations, setAnnotations] = useState<Record<number, string>>({});
  // tracks which sentence rows have their annotation field open
  const [openAnnotations, setOpenAnnotations] = useState<Set<number>>(new Set());

  const [submitting, setSubmitting] = useState(false);
  const [approving, setApproving] = useState(false);

  const fetchStory = useCallback(async () => {
    if (!id) return;
    try {
      const res = await fetch(`/api/stories/${id}`);
      if (!res.ok) throw new Error('error');
      setStory(await res.json());
    } catch {
      setError('Failed to load story.');
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => { fetchStory(); }, [fetchStory]);

  // Poll while generating
  useEffect(() => {
    if (!story?.generating) return;
    const interval = setInterval(fetchStory, 5000);
    return () => clearInterval(interval);
  }, [story?.generating, fetchStory]);

  const toggleAnnotation = (index: number) => {
    setOpenAnnotations((prev) => {
      const next = new Set(prev);
      if (next.has(index)) {
        next.delete(index);
        // clear the annotation text when closing
        setAnnotations((a) => { const n = { ...a }; delete n[index]; return n; });
      } else {
        next.add(index);
      }
      return next;
    });
  };

  const setAnnotation = (index: number, value: string) => {
    setAnnotations((prev) => ({ ...prev, [index]: value }));
  };

  const hasAnyFeedback = generalFeedback.trim() !== '' ||
    Object.values(annotations).some((v) => v.trim() !== '');

  const handleApplyFeedback = async () => {
    if (!story || !id) return;

    const activeAnnotations = Object.entries(annotations)
      .filter(([, v]) => v.trim() !== '')
      .map(([k, v]) => ({ sentenceIndex: parseInt(k, 10), feedback: v.trim() }));

    if (activeAnnotations.length === 0 && !generalFeedback.trim()) return;

    // If only general feedback with no sentence annotations, use all sentences as targets
    const annotationsToSend = activeAnnotations.length > 0
      ? activeAnnotations
      : story.sentences.map((_, i) => ({ sentenceIndex: i, feedback: '' })).slice(0, 5);

    setSubmitting(true);
    try {
      const res = await fetch(`/api/stories/${id}/review`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ generalFeedback: generalFeedback.trim(), annotations: annotationsToSend }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.message || t('review.applyError'));
        return;
      }
      navigate('/profile');
    } catch {
      setError(t('review.applyError'));
    } finally {
      setSubmitting(false);
    }
  };

  const handleApprove = async () => {
    if (!story || !id) return;
    setApproving(true);
    try {
      const res = await fetch(`/api/stories/${id}/approve`, { method: 'POST' });
      const data = await res.json();
      if (!res.ok) {
        setError(data.message || t('review.approveError'));
        return;
      }
      setSnackbar(t('review.approveSuccess'));
      navigate('/profile');
    } catch {
      setError(t('review.approveError'));
    } finally {
      setApproving(false);
    }
  };

  if (loading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '100vh' }}>
        <CircularProgress />
      </Box>
    );
  }

  if (error && !story) {
    return (
      <Box sx={{ pt: 12, pb: 6 }}>
        <Container maxWidth="md">
          <Button startIcon={<ArrowBackIcon />} onClick={() => navigate('/profile')} sx={{ mb: 2 }}>
            {t('common.profile')}
          </Button>
          <Alert severity="error">{error}</Alert>
        </Container>
      </Box>
    );
  }

  if (!story) return null;

  return (
    <Box sx={{ pt: 10, pb: 8, bgcolor: 'background.default', minHeight: '100vh' }}>
      <Container maxWidth="md">
        {/* Header row */}
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
          <Button startIcon={<ArrowBackIcon />} onClick={() => navigate('/profile')}>
            {t('common.profile')}
          </Button>
          <Box sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
            <Chip label={t(`levels.${story.level}`)} color={LEVEL_COLOR[story.level] ?? 'default'} size="small" />
            <Chip
              label={`${getLanguageName(story.nativeLanguage)} → ${getLanguageName(story.learningLanguage)}`}
              size="small" variant="outlined"
            />
          </Box>
        </Box>

        <Typography variant="h5" sx={{ fontWeight: 700, mb: 0.5 }}>
          <RateReviewIcon sx={{ verticalAlign: 'middle', mr: 1, color: 'primary.main' }} />
          {t('review.title')}
        </Typography>
        <Typography variant="subtitle1" color="text.secondary" sx={{ mb: 3 }}>
          {story.title.lang1}
        </Typography>

        {error && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError('')}>{error}</Alert>}

        {/* Generating banner */}
        {story.generating && (
          <Alert
            severity="info"
            icon={<AutoAwesomeIcon />}
            sx={{ mb: 3 }}
          >
            {t('review.generatingBanner')}
          </Alert>
        )}

        {/* General feedback */}
        <Paper elevation={2} sx={{ p: 3, mb: 3 }}>
          <Typography variant="subtitle2" sx={{ fontWeight: 600, mb: 1 }}>
            {t('review.generalFeedback')}
          </Typography>
          <TextField
            multiline
            minRows={2}
            maxRows={6}
            fullWidth
            placeholder={t('review.generalFeedbackPlaceholder')}
            value={generalFeedback}
            onChange={(e) => setGeneralFeedback(e.target.value)}
            disabled={story.generating || submitting}
          />
        </Paper>

        {/* Sentence list */}
        <Paper elevation={2} sx={{ p: 3, mb: 3 }}>
          <Typography variant="subtitle2" sx={{ fontWeight: 600, mb: 2 }}>
            {t('review.sentences')} ({story.sentences.length})
          </Typography>

          {story.sentences.map((sentence, index) => {
            const hasAnnotation = !!annotations[index]?.trim();
            const isOpen = openAnnotations.has(index);

            return (
              <Box key={index}>
                {index > 0 && <Divider sx={{ my: 1.5 }} />}
                <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1 }}>
                  <Typography variant="caption" color="text.secondary" sx={{ mt: 0.5, minWidth: 28, fontWeight: 600 }}>
                    {index + 1}.
                  </Typography>
                  <Box sx={{ flexGrow: 1 }}>
                    <Typography variant="body1" sx={{ lineHeight: 1.7 }}>
                      {sentence.lang1}
                    </Typography>
                    {isOpen && (
                      <TextField
                        size="small"
                        fullWidth
                        placeholder={t('review.annotationPlaceholder')}
                        value={annotations[index] ?? ''}
                        onChange={(e) => setAnnotation(index, e.target.value)}
                        disabled={story.generating || submitting}
                        sx={{ mt: 1 }}
                        autoFocus
                      />
                    )}
                  </Box>
                  <Tooltip title={isOpen ? t('review.removeNote') : t('review.addNote')}>
                    <span>
                      <IconButton
                        size="small"
                        color={hasAnnotation ? 'primary' : 'default'}
                        onClick={() => toggleAnnotation(index)}
                        disabled={story.generating || submitting}
                      >
                        {hasAnnotation || isOpen ? <CommentIcon fontSize="small" /> : <CommentOutlinedIcon fontSize="small" />}
                      </IconButton>
                    </span>
                  </Tooltip>
                </Box>
              </Box>
            );
          })}
        </Paper>

        {/* Action buttons */}
        <Box sx={{ display: 'flex', gap: 2, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
          <Button
            variant="outlined"
            startIcon={submitting ? <CircularProgress size={16} /> : <AutoAwesomeIcon />}
            onClick={handleApplyFeedback}
            disabled={!hasAnyFeedback || story.generating || submitting || approving}
          >
            {submitting ? t('review.applying') : t('review.applyFeedback')}
          </Button>
          <Button
            variant="contained"
            color="success"
            startIcon={approving ? <CircularProgress size={16} /> : <CheckCircleIcon />}
            onClick={handleApprove}
            disabled={story.sentenceCount === 0 || story.generating || submitting || approving}
          >
            {approving ? t('review.approving') : t('review.approve')}
          </Button>
        </Box>
      </Container>

      <Snackbar
        open={!!snackbar}
        autoHideDuration={3000}
        onClose={() => setSnackbar('')}
        message={snackbar}
      />
    </Box>
  );
};

export default StoryReviewPage;
