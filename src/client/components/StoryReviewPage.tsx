import React, { useEffect, useState, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  Box, Container, Typography, Paper, Button, CircularProgress,
  Alert, TextField, IconButton, Tooltip, Divider, Snackbar,
  Select, MenuItem, FormControl, InputLabel,
  Accordion, AccordionSummary, AccordionDetails,
} from '@mui/material';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import RateReviewIcon from '@mui/icons-material/RateReview';
import CommentIcon from '@mui/icons-material/Comment';
import CommentOutlinedIcon from '@mui/icons-material/CommentOutlined';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import AutoAwesomeIcon from '@mui/icons-material/AutoAwesome';
import SaveIcon from '@mui/icons-material/Save';
import WarningAmberIcon from '@mui/icons-material/WarningAmber';
import AddIcon from '@mui/icons-material/Add';
import { useTranslation } from 'react-i18next';
import { LANGUAGES, getLanguageName } from '../utils/languages';

interface Sentence { lang1: string; lang2: string; }
interface Chapter { seed: string; targetSentences: number; sentences: Sentence[]; }

interface Story {
  _id: string;
  title: { lang1: string; lang2: string };
  chapters: Chapter[];
  nativeLanguage: string;
  learningLanguage: string;
  level: 'beginner' | 'intermediate' | 'advanced';
  topic: string;
  seed: string;
  generating: boolean;
  approved: boolean;
  sentenceCount: number;
}

const LEVELS = ['beginner', 'intermediate', 'advanced'] as const;

const StoryReviewPage: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { t } = useTranslation();

  const [story, setStory] = useState<Story | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [snackbar, setSnackbar] = useState('');

  // Editable metadata fields
  const [titleLang1, setTitleLang1] = useState('');
  const [nativeLanguage, setNativeLanguage] = useState('');
  const [learningLanguage, setLearningLanguage] = useState('');
  const [level, setLevel] = useState<'beginner' | 'intermediate' | 'advanced'>('beginner');
  const [topic, setTopic] = useState('');

  // Per-chapter editable seeds and feedback; keyed by chapter index
  const [chapterSeeds, setChapterSeeds] = useState<Record<number, string>>({});
  const [chapterFeedbacks, setChapterFeedbacks] = useState<Record<number, string>>({});
  const [chapterTargets, setChapterTargets] = useState<Record<number, number>>({});

  // Sentence-level annotations; keyed by "chapterIndex-sentenceIndex"
  const [annotations, setAnnotations] = useState<Record<string, string>>({});
  const [openAnnotations, setOpenAnnotations] = useState<Set<string>>(new Set());

  // Story-level general feedback for sentence patches
  const [generalFeedback, setGeneralFeedback] = useState('');

  const [saving, setSaving] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [approving, setApproving] = useState(false);
  // track which chapter is being regenerated
  const [regeneratingChapter, setRegeneratingChapter] = useState<number | null>(null);

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

  // Populate editable fields once when the story first loads
  useEffect(() => {
    if (!story) return;
    setTitleLang1(story.title.lang1);
    setNativeLanguage(story.nativeLanguage);
    setLearningLanguage(story.learningLanguage);
    setLevel(story.level);
    setTopic(story.topic);
    const seeds: Record<number, string> = {};
    const targets: Record<number, number> = {};
    story.chapters.forEach((c, i) => { seeds[i] = c.seed; targets[i] = c.targetSentences; });
    setChapterSeeds(seeds);
    setChapterTargets(targets);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [story?._id]);

  // Poll while generating
  useEffect(() => {
    if (!story?.generating) return;
    const interval = setInterval(fetchStory, 5000);
    return () => clearInterval(interval);
  }, [story?.generating, fetchStory]);

  const saveMetadata = async (): Promise<boolean> => {
    if (!story) return false;
    const chapters = story.chapters.map((_, i) => ({
      seed: chapterSeeds[i] ?? '',
      targetSentences: chapterTargets[i] ?? 12,
    }));
    const res = await fetch(`/api/stories/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: { lang1: titleLang1, lang2: story.title.lang2 },
        nativeLanguage,
        learningLanguage,
        level,
        topic,
        chapters,
      }),
    });
    if (!res.ok) {
      const data = await res.json();
      setError(data.message || t('editor.saveError'));
      return false;
    }
    return true;
  };

  const handleSaveMetadata = async () => {
    setSaving(true);
    try {
      if (await saveMetadata()) setSnackbar(t('editor.saved'));
    } finally {
      setSaving(false);
    }
  };

  const toggleAnnotation = (key: string) => {
    setOpenAnnotations((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
        setAnnotations((a) => { const n = { ...a }; delete n[key]; return n; });
      } else {
        next.add(key);
      }
      return next;
    });
  };

  const hasAnyFeedback = generalFeedback.trim() !== '' ||
    Object.values(annotations).some((v) => v.trim() !== '');

  const handleApplyFeedback = async () => {
    if (!story || !id) return;
    const activeAnnotations = Object.entries(annotations)
      .filter(([, v]) => v.trim())
      .map(([k, v]) => {
        const [ci, si] = k.split('-').map(Number);
        return { chapterIndex: ci, sentenceIndex: si, feedback: v.trim() };
      });
    if (activeAnnotations.length === 0 && !generalFeedback.trim()) return;

    // Fall back to first 5 sentences of chapter 0 when only general feedback given
    const annotationsToSend = activeAnnotations.length > 0
      ? activeAnnotations
      : (story.chapters[0]?.sentences ?? []).slice(0, 5).map((_, i) => ({ chapterIndex: 0, sentenceIndex: i, feedback: '' }));

    setSubmitting(true);
    try {
      if (!(await saveMetadata())) return;
      const res = await fetch(`/api/stories/${id}/review`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ generalFeedback: generalFeedback.trim(), annotations: annotationsToSend }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.message || t('review.applyError')); return; }
      navigate('/profile');
    } catch {
      setError(t('review.applyError'));
    } finally {
      setSubmitting(false);
    }
  };

  const handleRegenerateChapter = async (chapterIndex: number) => {
    if (!story || !id) return;
    setRegeneratingChapter(chapterIndex);
    try {
      if (!(await saveMetadata())) return;
      const res = await fetch(`/api/stories/${id}/regenerate-chapter`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chapterIndex,
          generalFeedback: chapterFeedbacks[chapterIndex]?.trim() ?? '',
        }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.message || t('review.applyError')); return; }
      navigate('/profile');
    } catch {
      setError(t('review.applyError'));
    } finally {
      setRegeneratingChapter(null);
    }
  };

  const handleApprove = async () => {
    if (!story || !id) return;
    setApproving(true);
    try {
      if (!(await saveMetadata())) return;
      const res = await fetch(`/api/stories/${id}/approve`, { method: 'POST' });
      const data = await res.json();
      if (!res.ok) { setError(data.message || t('review.approveError')); return; }
      setSnackbar(t('review.approveSuccess'));
      navigate('/profile');
    } catch {
      setError(t('review.approveError'));
    } finally {
      setApproving(false);
    }
  };

  const busy = saving || submitting || approving || (story?.generating ?? false) || regeneratingChapter !== null;

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

        <Box sx={{ display: 'flex', alignItems: 'center', mb: 3 }}>
          <Button startIcon={<ArrowBackIcon />} onClick={() => navigate('/profile')}>
            {t('common.profile')}
          </Button>
          <Typography variant="h5" sx={{ fontWeight: 700, ml: 2 }}>
            <RateReviewIcon sx={{ verticalAlign: 'middle', mr: 1, color: 'primary.main' }} />
            {t('review.title')}
          </Typography>
        </Box>

        {error && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError('')}>{error}</Alert>}

        {story.generating && (
          <Alert severity="info" icon={<AutoAwesomeIcon />} sx={{ mb: 3 }}>
            {t('review.generatingBanner')}
          </Alert>
        )}

        {/* ── Editable story metadata ── */}
        <Paper elevation={2} sx={{ p: 3, mb: 3 }}>
          <Typography variant="subtitle2" sx={{ fontWeight: 600, mb: 2 }}>
            {t('editor.storyDetails')}
          </Typography>

          <TextField
            label={t('editor.titleIn', { lang: getLanguageName(nativeLanguage) || '…' })}
            value={titleLang1}
            onChange={(e) => setTitleLang1(e.target.value)}
            fullWidth disabled={busy} sx={{ mb: 2 }}
          />

          <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap', mb: 2 }}>
            <FormControl sx={{ minWidth: 180, flex: 1 }}>
              <InputLabel>{t('editor.nativeLanguage')}</InputLabel>
              <Select value={nativeLanguage} label={t('editor.nativeLanguage')}
                onChange={(e) => setNativeLanguage(e.target.value)} disabled={busy}>
                {LANGUAGES.map((l) => <MenuItem key={l.code} value={l.code}>{l.name} — {l.nativeName}</MenuItem>)}
              </Select>
            </FormControl>
            <FormControl sx={{ minWidth: 180, flex: 1 }}>
              <InputLabel>{t('editor.learningLanguage')}</InputLabel>
              <Select value={learningLanguage} label={t('editor.learningLanguage')}
                onChange={(e) => setLearningLanguage(e.target.value)} disabled={busy}>
                {LANGUAGES.map((l) => <MenuItem key={l.code} value={l.code}>{l.name} — {l.nativeName}</MenuItem>)}
              </Select>
            </FormControl>
          </Box>

          <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap', mb: 2 }}>
            <FormControl sx={{ minWidth: 160 }}>
              <InputLabel>{t('editor.level')}</InputLabel>
              <Select value={level} label={t('editor.level')}
                onChange={(e) => setLevel(e.target.value as typeof level)} disabled={busy}>
                {LEVELS.map((lv) => <MenuItem key={lv} value={lv}>{t(`levels.${lv}`)}</MenuItem>)}
              </Select>
            </FormControl>
            <TextField label={t('editor.topic')} value={topic}
              onChange={(e) => setTopic(e.target.value)} disabled={busy} sx={{ flex: 1, minWidth: 160 }} />
          </Box>

          {/* Seed is read-only — changing the premise requires a new story */}
          <TextField
            label={t('editor.seedSection')} value={story.seed}
            multiline minRows={2} fullWidth disabled
            helperText={t('review.seedReadOnly')} sx={{ mb: 2 }}
          />

          <Box sx={{ display: 'flex', justifyContent: 'flex-end' }}>
            <Button variant="outlined"
              startIcon={saving ? <CircularProgress size={16} /> : <SaveIcon />}
              onClick={handleSaveMetadata} disabled={busy}>
              {saving ? t('common.loading') : t('editor.saveChanges')}
            </Button>
          </Box>
        </Paper>

        {/* ── Story-level general feedback ── */}
        <Paper elevation={2} sx={{ p: 3, mb: 3 }}>
          <Typography variant="subtitle2" sx={{ fontWeight: 600, mb: 1 }}>
            {t('review.generalFeedback')}
          </Typography>
          <TextField
            multiline minRows={2} maxRows={6} fullWidth
            placeholder={t('review.generalFeedbackPlaceholder')}
            value={generalFeedback}
            onChange={(e) => setGeneralFeedback(e.target.value)}
            disabled={busy}
          />
        </Paper>

        {/* ── Chapter accordions ── */}
        {story.chapters.map((chapter, ci) => (
          <Accordion key={ci} defaultExpanded={story.chapters.length === 1} sx={{ mb: 2 }}>
            <AccordionSummary expandIcon={<ExpandMoreIcon />}>
              <Typography sx={{ fontWeight: 600 }}>
                {t('review.chapterN', { n: ci + 1 })}
                {chapter.seed ? ` — ${chapter.seed.slice(0, 60)}${chapter.seed.length > 60 ? '…' : ''}` : ''}
              </Typography>
            </AccordionSummary>
            <AccordionDetails>
              {/* Chapter seed + target sentences */}
              <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap', mb: 2 }}>
                <TextField
                  label={t('review.chapterSeed')}
                  value={chapterSeeds[ci] ?? ''}
                  onChange={(e) => setChapterSeeds((prev) => ({ ...prev, [ci]: e.target.value }))}
                  multiline minRows={2} disabled={busy} sx={{ flex: 1, minWidth: 200 }}
                />
                <TextField
                  label={t('review.targetSentences')}
                  type="number"
                  value={chapterTargets[ci] ?? chapter.targetSentences}
                  onChange={(e) => setChapterTargets((prev) => ({ ...prev, [ci]: Math.min(100, Math.max(1, parseInt(e.target.value, 10) || 12)) }))}
                  disabled={busy}
                  slotProps={{ htmlInput: { min: 1, max: 100 } }}
                  sx={{ width: 140 }}
                />
              </Box>

              {/* Chapter-level feedback + regenerate */}
              <TextField
                label={t('review.chapterFeedback')}
                placeholder={t('review.chapterFeedbackPlaceholder')}
                value={chapterFeedbacks[ci] ?? ''}
                onChange={(e) => setChapterFeedbacks((prev) => ({ ...prev, [ci]: e.target.value }))}
                multiline minRows={2} fullWidth disabled={busy} sx={{ mb: 1 }}
              />
              <Alert severity="warning" icon={<WarningAmberIcon />} sx={{ mb: 2, py: 0.5 }}>
                {t('review.regenerateChapterWarning')}
              </Alert>
              <Box sx={{ display: 'flex', justifyContent: 'flex-end', mb: 2 }}>
                <Button
                  variant="outlined"
                  color="warning"
                  startIcon={regeneratingChapter === ci ? <CircularProgress size={16} /> : <AutoAwesomeIcon />}
                  onClick={() => handleRegenerateChapter(ci)}
                  disabled={busy}
                >
                  {regeneratingChapter === ci ? t('review.applying') : t('review.regenerateChapter')}
                </Button>
              </Box>

              <Divider sx={{ mb: 2 }} />

              {/* Sentence list */}
              <Typography variant="caption" color="text.secondary" sx={{ mb: 1, display: 'block' }}>
                {t('review.chapterSentences', { count: chapter.sentences.length })}
              </Typography>
              {chapter.sentences.map((sentence, si) => {
                const key = `${ci}-${si}`;
                const hasAnnotation = !!annotations[key]?.trim();
                const isOpen = openAnnotations.has(key);
                return (
                  <Box key={si}>
                    {si > 0 && <Divider sx={{ my: 1 }} />}
                    <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1 }}>
                      <Typography variant="caption" color="text.secondary" sx={{ mt: 0.5, minWidth: 28, fontWeight: 600 }}>
                        {si + 1}.
                      </Typography>
                      <Box sx={{ flexGrow: 1 }}>
                        <Typography variant="body1" sx={{ lineHeight: 1.7 }}>{sentence.lang1}</Typography>
                        {isOpen && (
                          <TextField
                            size="small" fullWidth autoFocus
                            placeholder={t('review.annotationPlaceholder')}
                            value={annotations[key] ?? ''}
                            onChange={(e) => setAnnotations((prev) => ({ ...prev, [key]: e.target.value }))}
                            disabled={busy} sx={{ mt: 1 }}
                          />
                        )}
                      </Box>
                      <Tooltip title={isOpen ? t('review.removeNote') : t('review.addNote')}>
                        <span>
                          <IconButton size="small" color={hasAnnotation ? 'primary' : 'default'}
                            onClick={() => toggleAnnotation(key)} disabled={busy}>
                            {hasAnnotation || isOpen ? <CommentIcon fontSize="small" /> : <CommentOutlinedIcon fontSize="small" />}
                          </IconButton>
                        </span>
                      </Tooltip>
                    </Box>
                  </Box>
                );
              })}
            </AccordionDetails>
          </Accordion>
        ))}

        {/* Add chapter button */}
        {story.chapters.length < 10 && (
          <Box sx={{ display: 'flex', justifyContent: 'center', mb: 3 }}>
            <Button
              variant="outlined"
              startIcon={<AddIcon />}
              onClick={async () => {
                if (!story || !id) return;
                const newChapters = [
                  ...story.chapters.map((_, i) => ({
                    seed: chapterSeeds[i] ?? '',
                    targetSentences: chapterTargets[i] ?? 12,
                  })),
                  { seed: '', targetSentences: 12 },
                ];
                setSaving(true);
                try {
                  const res = await fetch(`/api/stories/${id}`, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ chapters: newChapters, targetChapters: newChapters.length }),
                  });
                  if (res.ok) await fetchStory();
                  else setError((await res.json()).message || t('editor.saveError'));
                } finally {
                  setSaving(false);
                }
              }}
              disabled={busy}
            >
              {t('editor.addChapter')}
            </Button>
          </Box>
        )}

        {/* ── Action buttons ── */}
        <Box sx={{ display: 'flex', gap: 2, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
          <Button variant="outlined"
            startIcon={submitting ? <CircularProgress size={16} /> : <AutoAwesomeIcon />}
            onClick={handleApplyFeedback} disabled={!hasAnyFeedback || busy}>
            {submitting ? t('review.applying') : t('review.applyFeedback')}
          </Button>
          <Button variant="contained" color="success"
            startIcon={approving ? <CircularProgress size={16} /> : <CheckCircleIcon />}
            onClick={handleApprove} disabled={story.sentenceCount === 0 || busy}>
            {approving ? t('review.approving') : t('review.approve')}
          </Button>
        </Box>
      </Container>

      <Snackbar open={!!snackbar} autoHideDuration={3000}
        onClose={() => setSnackbar('')} message={snackbar} />
    </Box>
  );
};

export default StoryReviewPage;
