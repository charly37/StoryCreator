import React, { useEffect, useState, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  Box, Container, Typography, Paper, Button, CircularProgress,
  Alert, TextField, IconButton, Tooltip, Divider, Snackbar,
  Select, MenuItem, FormControl, InputLabel,
  Accordion, AccordionSummary, AccordionDetails,
  Dialog, DialogTitle, DialogContent, DialogContentText, DialogActions,
} from '@mui/material';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import RateReviewIcon from '@mui/icons-material/RateReview';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import AutoAwesomeIcon from '@mui/icons-material/AutoAwesome';
import SaveIcon from '@mui/icons-material/Save';
import WarningAmberIcon from '@mui/icons-material/WarningAmber';
import AddIcon from '@mui/icons-material/Add';
import DeleteIcon from '@mui/icons-material/Delete';
import GroupsIcon from '@mui/icons-material/Groups';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import RestartAltIcon from '@mui/icons-material/RestartAlt';
import { useTranslation } from 'react-i18next';
import { LANGUAGES, getLanguageName } from '../utils/languages';
import { AI_MODELS, DEFAULT_AI_MODEL } from '../utils/aiModels';
import { cloneStory } from '../utils/cloneStory';
import { AppUser } from '../App';

interface Sentence { lang1: string; lang2: string; }
interface Chapter { title: { lang1: string; lang2: string }; seed: string; targetSentences: number; sentences: Sentence[]; }
interface Character { name: string; role: string; description: string; appearance: string; }

interface Story {
  _id: string;
  title: { lang1: string; lang2: string };
  chapters: Chapter[];
  characters: Character[];
  nativeLanguage: string;
  learningLanguage: string;
  level: 'beginner' | 'intermediate' | 'advanced';
  topic: string;
  seed: string;
  aiModel: string;
  aiGuideline: string;
  published: boolean;
  generating: boolean;
  sentenceCount: number;
}

const LEVELS = ['beginner', 'intermediate', 'advanced'] as const;
const MAX_CHARACTERS = 20;

const StoryReviewPage: React.FC<{ user: AppUser }> = ({ user }) => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { t } = useTranslation();

  const [story, setStory] = useState<Story | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [snackbar, setSnackbar] = useState('');
  const [cloning, setCloning] = useState(false);

  // Editable metadata fields
  const [titleLang1, setTitleLang1] = useState('');
  const [nativeLanguage, setNativeLanguage] = useState('');
  const [learningLanguage, setLearningLanguage] = useState('');
  const [level, setLevel] = useState<'beginner' | 'intermediate' | 'advanced'>('beginner');
  const [topic, setTopic] = useState('');
  const [seed, setSeed] = useState('');
  const [characters, setCharacters] = useState<Character[]>([]);
  const [aiGuideline, setAiGuideline] = useState('');

  // Per-chapter editable titles, premises and feedback; keyed by chapter index
  const [chapterTitles, setChapterTitles] = useState<Record<number, { lang1: string; lang2: string }>>({});
  const [chapterSeeds, setChapterSeeds] = useState<Record<number, string>>({});
  const [chapterFeedbacks, setChapterFeedbacks] = useState<Record<number, string>>({});
  const [chapterTargets, setChapterTargets] = useState<Record<number, number>>({});

  const [saving, setSaving] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [aiModel, setAiModel] = useState(DEFAULT_AI_MODEL);
  // track which chapter is being regenerated
  const [regeneratingChapter, setRegeneratingChapter] = useState<number | null>(null);
  const [regenerateAllOpen, setRegenerateAllOpen] = useState(false);
  const [regeneratingAll, setRegeneratingAll] = useState(false);
  const [deleteChapterIndex, setDeleteChapterIndex] = useState<number | null>(null);
  const [deletingChapter, setDeletingChapter] = useState<number | null>(null);

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

  const handleClone = async () => {
    if (!id) return;
    setCloning(true);
    setError('');
    const result = await cloneStory(id);
    setCloning(false);
    if (!result.ok || !result.id) {
      setError(
        result.code === 'CREATOR_ACCESS_REQUIRED'
          ? t('editor.noCreatorAccessError')
          : result.message || t('common.cloneError')
      );
      return;
    }
    navigate(`/editor/${result.id}`);
  };

  // Populate editable fields once when the story first loads
  useEffect(() => {
    if (!story) return;
    setTitleLang1(story.title.lang1);
    setNativeLanguage(story.nativeLanguage);
    setLearningLanguage(story.learningLanguage);
    setLevel(story.level);
    setTopic(story.topic);
    setSeed(story.seed || '');
    if (story.aiModel) setAiModel(story.aiModel);
    setAiGuideline(story.aiGuideline || '');
    const seeds: Record<number, string> = {};
    const targets: Record<number, number> = {};
    const titles: Record<number, { lang1: string; lang2: string }> = {};
    story.chapters.forEach((c, i) => {
      seeds[i] = c.seed;
      targets[i] = c.targetSentences;
      titles[i] = { lang1: c.title?.lang1 || '', lang2: c.title?.lang2 || '' };
    });
    setChapterSeeds(seeds);
    setChapterTargets(targets);
    setChapterTitles(titles);
    setCharacters(
      Array.isArray(story.characters)
        ? story.characters.map((c) => ({
            name: c.name || '',
            role: c.role || '',
            description: c.description || '',
            appearance: c.appearance || '',
          }))
        : []
    );
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
      title: chapterTitles[i] ?? { lang1: '', lang2: '' },
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
        seed,
        aiModel,
        aiGuideline,
        chapters,
        characters,
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
          model: aiModel,
        }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.message || t('review.applyError')); return; }
      navigate('/my-stories');
    } catch {
      setError(t('review.applyError'));
    } finally {
      setRegeneratingChapter(null);
    }
  };

  const handleInsertChapter = async (index: number) => {
    if (!story || !id) return;
    setSaving(true);
    try {
      // Persist any in-progress title/premise edits before inserting.
      if (!(await saveMetadata())) return;
      const res = await fetch(`/api/stories/${id}/chapters`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ index }),
      });
      if (!res.ok) {
        setError((await res.json()).message || t('editor.saveError'));
        return;
      }
      await fetchStory();
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteChapter = async (index: number) => {
    if (!story || !id) return;
    setDeleteChapterIndex(null);
    setDeletingChapter(index);
    try {
      // Persist any in-progress edits first so the index maps correctly.
      if (!(await saveMetadata())) return;
      const res = await fetch(`/api/stories/${id}/chapters/${index}`, { method: 'DELETE' });
      if (!res.ok) {
        setError((await res.json()).message || t('editor.saveError'));
        return;
      }
      await fetchStory();
    } finally {
      setDeletingChapter(null);
    }
  };

  const handleRegenerateAll = async () => {
    if (!story || !id) return;
    setRegenerateAllOpen(false);
    setRegeneratingAll(true);
    try {
      if (!(await saveMetadata())) return;
      const res = await fetch(`/api/stories/${id}/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: aiModel }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.message || t('editor.generateError')); return; }
      setSnackbar(t('editor.generateQueued'));
      navigate('/my-stories');
    } catch {
      setError(t('editor.generateError'));
    } finally {
      setRegeneratingAll(false);
    }
  };

  const handleTogglePublish = async () => {
    if (!story || !id) return;
    setPublishing(true);
    try {
      if (!(await saveMetadata())) return;
      const res = await fetch(`/api/stories/${id}/publish`, { method: 'POST' });
      const data = await res.json();
      if (!res.ok) { setError(data.message || t('review.publishError')); return; }
      setSnackbar(data.published ? t('myStories.publishSuccess') : t('myStories.unpublishSuccess'));
      navigate('/my-stories');
    } catch {
      setError(t('review.publishError'));
    } finally {
      setPublishing(false);
    }
  };

  const busy = saving || publishing || regeneratingAll || (story?.generating ?? false) || regeneratingChapter !== null || deletingChapter !== null;

  // Reader-facing chapter heading: prefer the source/native-language title so the
  // collapsed chapter tile stays readable for learners while they are working from
  // the language they already know.
  const chapterHeading = (ci: number): string => {
    const text = chapterTitles[ci]?.lang1 || chapterTitles[ci]?.lang2 || '';
    return text.length > 60 ? `${text.slice(0, 60)}…` : text;
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
          <Button startIcon={<ArrowBackIcon />} onClick={() => navigate('/my-stories')} sx={{ mb: 2 }}>
            {t('common.myStories')}
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
          <Button startIcon={<ArrowBackIcon />} onClick={() => navigate('/my-stories')}>
            {t('common.myStories')}
          </Button>
          <Typography variant="h5" sx={{ fontWeight: 700, ml: 2 }}>
            <RateReviewIcon sx={{ verticalAlign: 'middle', mr: 1, color: 'primary.main' }} />
            {t('review.title')}
          </Typography>
          <Tooltip title={user.canCreateStories ? '' : t('creatorAccess.tooltip')}>
            <span style={{ marginLeft: 'auto' }}>
              <Button
                variant="outlined"
                startIcon={<ContentCopyIcon />}
                onClick={handleClone}
                disabled={!user.canCreateStories || cloning}
              >
                {t('common.clone')}
              </Button>
            </span>
          </Tooltip>
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

          {/* Story seed — editable; applies on the next chapter or full-story regeneration */}
          <TextField
            label={t('editor.seedSection')} value={seed}
            onChange={(e) => setSeed(e.target.value)}
            multiline minRows={2} fullWidth disabled={busy}
            sx={{ mb: 1 }}
          />
          <Alert severity="warning" icon={<WarningAmberIcon />} sx={{ mb: 2, py: 0.5 }}>
            {t('review.seedHint')}
          </Alert>

        </Paper>

        {/* ── Editable story characters ── */}
        <Paper elevation={2} sx={{ p: 3, mb: 3 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
            <GroupsIcon color="secondary" fontSize="small" />
            <Typography variant="subtitle2" sx={{ fontWeight: 600 }}>
              {t('editor.charactersSection')}
            </Typography>
          </Box>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            {t('review.charactersHint')}
          </Typography>

          {characters.length === 0 && (
            <Typography variant="caption" color="text.secondary" sx={{ mb: 2, display: 'block' }}>
              {t('editor.charactersEmpty')}
            </Typography>
          )}

          {characters.map((character, i) => (
            <Box key={i} sx={{ mb: 2, p: 2, border: '1px solid', borderColor: 'divider', borderRadius: 2 }}>
              <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1 }}>
                <Typography variant="subtitle2" sx={{ fontWeight: 600 }}>
                  {t('editor.characterN', { n: i + 1 })}
                </Typography>
                <IconButton
                  size="small"
                  color="error"
                  onClick={() => setCharacters((prev) => prev.filter((_, idx) => idx !== i))}
                  disabled={busy}
                >
                  <DeleteIcon fontSize="small" />
                </IconButton>
              </Box>
              <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap', mb: 2 }}>
                <TextField
                  label={t('editor.characterName')}
                  value={character.name}
                  onChange={(e) => setCharacters((prev) => prev.map((c, idx) => idx === i ? { ...c, name: e.target.value } : c))}
                  disabled={busy} sx={{ flex: 1, minWidth: 200 }}
                />
                <TextField
                  label={t('editor.characterRole')}
                  placeholder={t('editor.characterRolePlaceholder')}
                  value={character.role}
                  onChange={(e) => setCharacters((prev) => prev.map((c, idx) => idx === i ? { ...c, role: e.target.value } : c))}
                  disabled={busy} sx={{ flex: 1, minWidth: 200 }}
                />
              </Box>
              <TextField
                label={t('editor.characterDescription')}
                placeholder={t('editor.characterDescriptionPlaceholder')}
                value={character.description}
                onChange={(e) => setCharacters((prev) => prev.map((c, idx) => idx === i ? { ...c, description: e.target.value } : c))}
                multiline minRows={2} fullWidth disabled={busy} sx={{ mb: 2 }}
              />
              <TextField
                label={t('editor.characterAppearance')}
                placeholder={t('editor.characterAppearancePlaceholder')}
                value={character.appearance}
                onChange={(e) => setCharacters((prev) => prev.map((c, idx) => idx === i ? { ...c, appearance: e.target.value } : c))}
                multiline minRows={2} fullWidth disabled={busy}
              />
            </Box>
          ))}

          <Button
            size="small"
            startIcon={<AddIcon />}
            onClick={() => setCharacters((prev) => [...prev, { name: '', role: '', description: '', appearance: '' }])}
            disabled={busy || characters.length >= MAX_CHARACTERS}
          >
            {t('editor.addCharacter')}
          </Button>
        </Paper>

        {/* ── AI Generator Settings ── */}
        <Paper elevation={2} sx={{ p: 3, mb: 3 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
            <AutoAwesomeIcon color="secondary" fontSize="small" />
            <Typography variant="subtitle2" sx={{ fontWeight: 600 }}>
              {t('editor.aiSettings')}
            </Typography>
          </Box>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            {t('editor.aiModelHint')}
          </Typography>
          <TextField
            label={t('editor.aiGuideline')}
            placeholder={t('editor.aiGuidelinePlaceholder')}
            helperText={t('editor.aiGuidelineHint')}
            value={aiGuideline}
            onChange={(e) => setAiGuideline(e.target.value)}
            multiline
            minRows={3}
            fullWidth
            disabled={busy}
            sx={{ mb: 2 }}
          />
          <FormControl sx={{ minWidth: 260 }}>
            <InputLabel>{t('editor.aiModel')}</InputLabel>
            <Select
              value={aiModel}
              label={t('editor.aiModel')}
              onChange={(e) => setAiModel(e.target.value)}
              disabled={busy}
            >
              {AI_MODELS.map((m) => (
                <MenuItem key={m.id} value={m.id}>
                  {m.label} — {m.description}
                </MenuItem>
              ))}
            </Select>
          </FormControl>
        </Paper>

        {/* ── Chapter accordions ── */}
        {story.chapters.map((chapter, ci) => (
          <Accordion key={ci} defaultExpanded={story.chapters.length === 1} sx={{ mb: 2 }}>
            <AccordionSummary expandIcon={<ExpandMoreIcon />}>
              <Typography sx={{ fontWeight: 600 }}>
                {t('review.chapterN', { n: ci + 1 })}
                {chapterHeading(ci) ? ` — ${chapterHeading(ci)}` : ''}
              </Typography>
            </AccordionSummary>
            <AccordionDetails>
              {/* Reader-facing chapter title (bilingual) */}
              <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap', mb: 2 }}>
                <TextField
                  label={`${t('review.chapterTitle')} — ${getLanguageName(nativeLanguage) || '—'}`}
                  value={chapterTitles[ci]?.lang1 ?? ''}
                  onChange={(e) => setChapterTitles((prev) => ({ ...prev, [ci]: { lang1: e.target.value, lang2: prev[ci]?.lang2 ?? '' } }))}
                  disabled={busy} sx={{ flex: 1, minWidth: 200 }}
                />
                <TextField
                  label={`${t('review.chapterTitle')} — ${getLanguageName(learningLanguage) || '—'}`}
                  value={chapterTitles[ci]?.lang2 ?? ''}
                  onChange={(e) => setChapterTitles((prev) => ({ ...prev, [ci]: { lang1: prev[ci]?.lang1 ?? '', lang2: e.target.value } }))}
                  disabled={busy} sx={{ flex: 1, minWidth: 200 }}
                />
              </Box>
              {/* Chapter premise + target sentences */}
              <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap', mb: 2 }}>
                <TextField
                  label={t('review.chapterSeed')}
                  helperText={t('review.chapterSeedHint')}
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
              {chapter.sentences.map((sentence, si) => (
                <Box key={si}>
                  {si > 0 && <Divider sx={{ my: 1 }} />}
                  <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1 }}>
                    <Typography variant="caption" color="text.secondary" sx={{ mt: 0.5, minWidth: 28, fontWeight: 600 }}>
                      {si + 1}.
                    </Typography>
                    <Box sx={{ flexGrow: 1 }}>
                      <Typography variant="body1" sx={{ lineHeight: 1.7 }}>{sentence.lang1}</Typography>
                    </Box>
                  </Box>
                </Box>
              ))}

              {/* Insert / delete this chapter */}
              <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mt: 2, gap: 1 }}>
                <Button
                  size="small"
                  color="error"
                  startIcon={deletingChapter === ci ? <CircularProgress size={14} /> : <DeleteIcon />}
                  onClick={() => setDeleteChapterIndex(ci)}
                  disabled={busy || story.chapters.length <= 1}
                >
                  {t('review.deleteChapter')}
                </Button>
                <Button
                  size="small"
                  startIcon={<AddIcon />}
                  onClick={() => handleInsertChapter(ci + 1)}
                  disabled={busy || story.chapters.length >= 10}
                >
                  {t('review.insertChapterBelow')}
                </Button>
              </Box>
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
                    title: chapterTitles[i] ?? { lang1: '', lang2: '' },
                    seed: chapterSeeds[i] ?? '',
                    targetSentences: chapterTargets[i] ?? 12,
                  })),
                  { title: { lang1: '', lang2: '' }, seed: '', targetSentences: 12 },
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
          <Tooltip title={user.canCreateStories ? '' : t('creatorAccess.tooltip')}>
            <span style={{ marginRight: 'auto' }}>
              <Button variant="outlined" color="warning"
                startIcon={regeneratingAll ? <CircularProgress size={16} /> : <RestartAltIcon />}
                onClick={() => setRegenerateAllOpen(true)}
                disabled={busy || !user.canCreateStories}>
                {regeneratingAll ? t('review.regeneratingAll') : t('review.regenerateAll')}
              </Button>
            </span>
          </Tooltip>
          <Button variant="outlined"
            startIcon={saving ? <CircularProgress size={16} /> : <SaveIcon />}
            onClick={handleSaveMetadata}
            disabled={busy}
          >
            {saving ? t('common.loading') : t('editor.saveChanges')}
          </Button>
          <Button variant="contained" color={story.published ? 'warning' : 'success'}
            startIcon={publishing ? <CircularProgress size={16} /> : <CheckCircleIcon />}
            onClick={handleTogglePublish}
            disabled={(!story.published && story.sentenceCount === 0) || busy}
          >
            {publishing
              ? (story.published ? t('review.unpublishing') : t('review.publishing'))
              : (story.published ? t('common.unpublish') : t('common.publish'))}
          </Button>
        </Box>
      </Container>

      {/* Full regeneration confirmation */}
      <Dialog open={regenerateAllOpen} onClose={() => setRegenerateAllOpen(false)}>
        <DialogTitle>{t('review.regenerateAllConfirmTitle')}</DialogTitle>
        <DialogContent>
          <Alert severity="warning" icon={<WarningAmberIcon />} sx={{ mb: 2 }}>{t('review.regenerateAllWarning')}</Alert>
          <DialogContentText>{t('review.regenerateAllConfirmBody')}</DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setRegenerateAllOpen(false)}>{t('common.cancel')}</Button>
          <Button onClick={handleRegenerateAll} color="warning" variant="contained">
            {t('review.regenerateAllConfirm')}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Delete chapter confirmation */}
      <Dialog open={deleteChapterIndex !== null} onClose={() => setDeleteChapterIndex(null)}>
        <DialogTitle>{t('review.deleteChapterConfirmTitle', { n: (deleteChapterIndex ?? 0) + 1 })}</DialogTitle>
        <DialogContent>
          <DialogContentText>{t('review.deleteChapterConfirmBody')}</DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeleteChapterIndex(null)}>{t('common.cancel')}</Button>
          <Button
            onClick={() => deleteChapterIndex !== null && handleDeleteChapter(deleteChapterIndex)}
            color="error"
            variant="contained"
          >
            {t('review.deleteChapterConfirm')}
          </Button>
        </DialogActions>
      </Dialog>

      <Snackbar open={!!snackbar} autoHideDuration={3000}
        onClose={() => setSnackbar('')} message={snackbar} />
    </Box>
  );
};

export default StoryReviewPage;
