import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Container,
  Divider,
  FormControl,
  FormHelperText,
  IconButton,
  InputLabel,
  LinearProgress,
  MenuItem,
  Paper,
  Select,
  Snackbar,
  Step,
  StepLabel,
  Stepper,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import AutoAwesomeIcon from '@mui/icons-material/AutoAwesome';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import DeleteIcon from '@mui/icons-material/Delete';
import GroupsIcon from '@mui/icons-material/Groups';
import MenuBookIcon from '@mui/icons-material/MenuBook';
import RateReviewIcon from '@mui/icons-material/RateReview';
import RestartAltIcon from '@mui/icons-material/RestartAlt';
import { useTranslation } from 'react-i18next';
import { LANGUAGES, getLanguageName } from '../utils/languages';
import {
  STAGED_AI_MODELS,
  DEFAULT_AI_MODEL,
  getAIModelLabel,
  effortForRequest,
} from '../utils/aiModels';
import { AppUser } from '../App';
import AiEffortSelect from './AiEffortSelect';

interface StoryCreateWizardPageProps {
  user: AppUser;
}

interface Character {
  name: string;
  role: string;
  description: string;
  appearance: string;
}

interface ChapterEdits {
  title: { lang1: string; lang2: string };
  seed: string;
  targetSentences: number;
}

interface WizardChapter extends ChapterEdits {
  sentences: Array<{ lang1: string; lang2: string }>;
  recap?: string;
  issues?: string[];
}

type WizardStage = 'setup' | 'outline' | 'chapters' | 'validation' | 'ready';

interface WizardStory {
  _id: string;
  title: { lang1: string; lang2: string };
  chapters: WizardChapter[];
  characters: Character[];
  nativeLanguage: string;
  learningLanguage: string;
  level: string;
  labels?: string[];
  seed: string;
  aiModel?: string;
  outlineAiModel?: string;
  /** '' or missing means the provider default thinking level. */
  aiReasoningEffort?: string;
  outlineReasoningEffort?: string;
  aiGuideline?: string;
  outline?: { synopsis?: { lang1?: string; lang2?: string }; approvedAt?: string };
  stage?: WizardStage;
  generationMode?: 'quick' | 'staged';
  validationMode?: '' | 'basic' | 'ai_review';
  jobProgress?: { stage?: string; done?: number; total?: number; currentLabel?: string };
  generating: boolean;
  generationError?: string;
  sentenceCount?: number;
  published: boolean;
}

const LEVELS = ['beginner', 'intermediate', 'advanced'] as const;
const DEFAULT_SENTENCES = 12;
const MAX_CHAPTERS = 10;
const MAX_CHARACTERS = 20;
const POLL_INTERVAL_MS = 5000;

const parseLabels = (value: string): string[] => {
  const seen = new Set<string>();
  return value
    .split(',')
    .map((label) => label.trim())
    .filter((label) => {
      if (!label) return false;
      const key = label.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
};

const StoryCreateWizardPage: React.FC<StoryCreateWizardPageProps> = ({ user }) => {
  const { id } = useParams<{ id?: string }>();
  const navigate = useNavigate();
  const { t } = useTranslation();
  const canCreate = !!user.canCreateStories;

  // --- setup form (step 1) ---
  const [nativeLanguage, setNativeLanguage] = useState('');
  const [learningLanguage, setLearningLanguage] = useState('');
  const [level, setLevel] = useState<'beginner' | 'intermediate' | 'advanced'>('beginner');
  const [labelsInput, setLabelsInput] = useState('');
  const [seed, setSeed] = useState('');
  const [chapterCount, setChapterCount] = useState(3);
  const [sentencesPerChapter, setSentencesPerChapter] = useState(DEFAULT_SENTENCES);
  const [characters, setCharacters] = useState<Character[]>([]);
  const [aiModel, setAiModel] = useState(DEFAULT_AI_MODEL);
  const [outlineAiModel, setOutlineAiModel] = useState(DEFAULT_AI_MODEL);
  /** '' = provider default; only sent when the author picks a level. */
  const [aiEffort, setAiEffort] = useState('');
  const [outlineEffort, setOutlineEffort] = useState('');
  const [aiGuideline, setAiGuideline] = useState('');
  /** null = inherit the planning model chosen in step 1 (snapshot in the select). */
  const [reviewModel, setReviewModel] = useState<string | null>(null);
  const [reviewEffort, setReviewEffort] = useState<string | null>(null);

  // --- loaded story (steps 2-4) ---
  const [story, setStory] = useState<WizardStory | null>(null);
  const [loading, setLoading] = useState(!!id);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [snackbar, setSnackbar] = useState('');

  // --- editable outline mirrors (hydrated when a job completes) ---
  const [synopsisLang1, setSynopsisLang1] = useState('');
  const [synopsisLang2, setSynopsisLang2] = useState('');
  const [chapterEdits, setChapterEdits] = useState<ChapterEdits[]>([]);
  const [feedback, setFeedback] = useState('');
  const hydratedKey = useRef('');

  const fetchStory = useCallback(async () => {
    if (!id) return;
    try {
      const res = await fetch(`/api/stories/${id}`);
      if (!res.ok) {
        setError(t('wizard.errors.loadFailed'));
        return;
      }
      setStory(await res.json());
    } catch {
      setError(t('wizard.errors.loadFailed'));
    }
  }, [id, t]);

  useEffect(() => {
    if (!id) return;
    setLoading(true);
    fetchStory().finally(() => setLoading(false));
  }, [id, fetchStory]);

  // Poll while a stage is running (outline / chapters / validation).
  useEffect(() => {
    if (!story?.generating) return;
    const interval = setInterval(fetchStory, POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [story?.generating, fetchStory]);

  // Hydrate the editable mirrors whenever a stage finishes (or on first load),
  // never while the user could be typing mid-job.
  useEffect(() => {
    if (!story) return;
    const key = `${story._id}|${story.generating}|${story.stage}|${story.chapters.length}|${
      story.outline?.approvedAt ?? ''
    }`;
    if (hydratedKey.current === key) return;
    hydratedKey.current = key;

    setNativeLanguage((prev) => prev || story.nativeLanguage);
    setLearningLanguage((prev) => prev || story.learningLanguage);
    setLevel((prev) =>
      story.level === 'beginner' || story.level === 'intermediate' || story.level === 'advanced'
        ? story.level
        : prev
    );
    setLabelsInput((prev) => prev || (story.labels ?? []).join(', '));
    setSeed((prev) => prev || story.seed);
    setCharacters((prev) => (prev.length > 0 ? prev : story.characters ?? []));
    setAiModel((prev) => (prev === DEFAULT_AI_MODEL && story.aiModel ? story.aiModel : prev));
    setOutlineAiModel((prev) =>
      prev === DEFAULT_AI_MODEL && story.outlineAiModel ? story.outlineAiModel : prev
    );
    setAiEffort((prev) => prev || story.aiReasoningEffort || '');
    setOutlineEffort((prev) => prev || story.outlineReasoningEffort || '');
    setAiGuideline((prev) => prev || story.aiGuideline || '');
    setSynopsisLang1(story.outline?.synopsis?.lang1 ?? '');
    setSynopsisLang2(story.outline?.synopsis?.lang2 ?? '');
    setChapterEdits(
      story.chapters.map((chapter) => ({
        title: { lang1: chapter.title?.lang1 ?? '', lang2: chapter.title?.lang2 ?? '' },
        seed: chapter.seed ?? '',
        targetSentences: chapter.targetSentences ?? DEFAULT_SENTENCES,
      }))
    );
  }, [story]);

  const stage: WizardStage = story?.stage ?? 'setup';
  const hasSynopsis = !!(synopsisLang1.trim() || synopsisLang2.trim());
  const effectiveReviewModel = reviewModel ?? outlineAiModel;
  const effectiveReviewEffort = reviewEffort ?? outlineEffort;
  const progressDone = story?.jobProgress?.done ?? 0;
  const progressTotal = story?.jobProgress?.total ?? 0;
  const totalIssues = useMemo(
    () => (story?.chapters ?? []).reduce((sum, chapter) => sum + (chapter.issues?.length ?? 0), 0),
    [story?.chapters]
  );

  const activeStep = !story ? 0 : stage === 'ready' ? 3 : stage === 'chapters' || stage === 'validation' ? 2 : 1;

  const request = async (url: string, init?: RequestInit) => {
    const res = await fetch(url, {
      ...init,
      headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
    });
    const data = await res.json().catch(() => ({}));
    return { ok: res.ok, status: res.status, data } as {
      ok: boolean;
      status: number;
      data: Record<string, unknown> & { message?: string; code?: string };
    };
  };

  const reportFailure = (data: { message?: string; code?: string }, fallback: string) => {
    if (data.code === 'CREATOR_ACCESS_REQUIRED') {
      setError(t('editor.noCreatorAccessError'));
      return;
    }
    setError(data.message || fallback);
  };

  // --- step 1: create the draft and plan the outline ---
  const handleCreateDraft = async () => {
    if (!canCreate) {
      setError(t('editor.noCreatorAccessError'));
      return;
    }
    if (!nativeLanguage || !learningLanguage) {
      setError(t('wizard.errors.languagesRequired'));
      return;
    }
    if (nativeLanguage === learningLanguage) {
      setError(t('editor.sameLanguageError'));
      return;
    }
    if (!seed.trim()) {
      setError(t('wizard.errors.seedRequired'));
      return;
    }

    setBusy(true);
    setError('');
    try {
      const chapters = Array.from({ length: chapterCount }, () => ({
        title: { lang1: '', lang2: '' },
        seed: '',
        targetSentences: sentencesPerChapter,
      }));
      const created = await request('/api/stories', {
        method: 'POST',
        body: JSON.stringify({
          nativeLanguage,
          learningLanguage,
          level,
          labels: parseLabels(labelsInput),
          seed,
          characters,
          outlineAiModel,
          outlineReasoningEffort: effortForRequest(outlineAiModel, outlineEffort),
          aiGuideline,
          targetChapters: chapterCount,
          chapters,
          generationMode: 'staged',
          synopsis: { lang1: '', lang2: '' },
        }),
      });
      if (!created.ok) {
        reportFailure(created.data, t('editor.saveError'));
        return;
      }

      const storyId = String(created.data._id);
      const started = await request(`/api/stories/${storyId}/outline`, {
        method: 'POST',
        body: JSON.stringify({
          model: outlineAiModel,
          effort: effortForRequest(outlineAiModel, outlineEffort),
        }),
      });
      if (!started.ok) {
        reportFailure(started.data, t('wizard.errors.outlineFailed'));
      }
      navigate(`/create/${storyId}`);
    } catch {
      setError(t('wizard.errors.generic'));
    } finally {
      setBusy(false);
    }
  };

  // --- shared: persist outline edits before any stage transition ---
  const saveOutlineEdits = async (): Promise<boolean> => {
    if (!story) return false;
    const res = await request(`/api/stories/${story._id}`, {
      method: 'PUT',
      body: JSON.stringify({
        synopsis: { lang1: synopsisLang1, lang2: synopsisLang2 },
        chapters: chapterEdits,
        characters,
        seed,
        aiModel,
        outlineAiModel,
        aiReasoningEffort: effortForRequest(aiModel, aiEffort),
        outlineReasoningEffort: effortForRequest(outlineAiModel, outlineEffort),
        aiGuideline,
        labels: parseLabels(labelsInput),
      }),
    });
    if (!res.ok) {
      reportFailure(res.data, t('editor.saveError'));
      return false;
    }
    return true;
  };

  const handleGenerateOutline = async (withFeedback: boolean) => {
    if (!story) return;
    setBusy(true);
    setError('');
    try {
      if (!(await saveOutlineEdits())) return;
      const res = await request(`/api/stories/${story._id}/outline`, {
        method: 'POST',
        body: JSON.stringify({
          model: outlineAiModel,
          effort: effortForRequest(outlineAiModel, outlineEffort),
          ...(withFeedback && feedback.trim() ? { feedback: feedback.trim() } : {}),
        }),
      });
      if (!res.ok) {
        reportFailure(res.data, t('wizard.errors.outlineFailed'));
        return;
      }
      setFeedback('');
      await fetchStory();
    } catch {
      setError(t('wizard.errors.generic'));
    } finally {
      setBusy(false);
    }
  };

  const handleApproveOutline = async () => {
    if (!story) return;
    setBusy(true);
    setError('');
    try {
      if (!(await saveOutlineEdits())) return;
      const res = await request(`/api/stories/${story._id}/generate-chapters`, {
        method: 'POST',
        body: JSON.stringify({ model: aiModel, effort: effortForRequest(aiModel, aiEffort) }),
      });
      if (!res.ok) {
        reportFailure(res.data, t('wizard.errors.chaptersFailed'));
        return;
      }
      await fetchStory();
    } catch {
      setError(t('wizard.errors.generic'));
    } finally {
      setBusy(false);
    }
  };

  const handleValidation = async (mode: 'none' | 'basic' | 'ai_review') => {
    if (!story) return;
    setBusy(true);
    setError('');
    try {
      const selectedModel = mode === 'ai_review' ? effectiveReviewModel : aiModel;
      const selectedEffort = mode === 'ai_review' ? effectiveReviewEffort : aiEffort;
      // The review select can inherit the planning level; only forward it when the
      // chosen model allows a free choice, so a stale value cannot be rejected.
      const res = await request(`/api/stories/${story._id}/validate`, {
        method: 'POST',
        body: JSON.stringify({
          mode,
          model: selectedModel,
          effort: effortForRequest(selectedModel, selectedEffort),
        }),
      });
      if (!res.ok) {
        reportFailure(res.data, t('wizard.errors.validationFailed'));
        return;
      }
      await fetchStory();
    } catch {
      setError(t('wizard.errors.generic'));
    } finally {
      setBusy(false);
    }
  };

  const handleResetOutline = async () => {
    if (!story) return;
    setBusy(true);
    try {
      const res = await request(`/api/stories/${story._id}/reset-outline`, { method: 'POST' });
      if (!res.ok) {
        reportFailure(res.data, t('wizard.errors.generic'));
        return;
      }
      await fetchStory();
    } finally {
      setBusy(false);
    }
  };

  const handleTogglePublish = async () => {
    if (!story) return;
    setBusy(true);
    try {
      const res = await request(`/api/stories/${story._id}/publish`, { method: 'POST' });
      if (!res.ok) {
        reportFailure(res.data, t('editor.saveError'));
        return;
      }
      setSnackbar(res.data.message ? String(res.data.message) : t('editor.saved'));
      await fetchStory();
    } finally {
      setBusy(false);
    }
  };

  const updateChapter = (index: number, patch: Partial<ChapterEdits>) => {
    setChapterEdits((prev) => prev.map((chapter, i) => (i === index ? { ...chapter, ...patch } : chapter)));
  };

  const updateCharacter = (index: number, patch: Partial<Character>) => {
    setCharacters((prev) => prev.map((character, i) => (i === index ? { ...character, ...patch } : character)));
  };

  if (loading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', pt: { xs: 9, sm: 12 }, pb: 8 }}>
        <CircularProgress />
      </Box>
    );
  }

  const steps = [
    t('wizard.steps.setup'),
    t('wizard.steps.outline'),
    t('wizard.steps.chapters'),
    t('wizard.steps.done'),
  ];

  return (
    <Container maxWidth="md" sx={{ pt: { xs: 9, md: 10 }, pb: 8 }}>
      <Typography variant="h4" gutterBottom>
        {t('wizard.title')}
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
        {t('wizard.subtitle')}
      </Typography>

      <Stepper
        activeStep={activeStep}
        alternativeLabel
        sx={{
          mb: 3,
          '& .MuiStepLabel-label': { fontSize: { xs: '0.7rem', sm: '0.875rem' }, mt: { xs: 0.5, sm: 1 } },
        }}
      >
        {steps.map((label) => (
          <Step key={label}>
            <StepLabel>{label}</StepLabel>
          </Step>
        ))}
      </Stepper>

      {!canCreate && <Alert severity="info" sx={{ mb: 2 }}>{t('editor.noCreatorAccessError')}</Alert>}
      {error && (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError('')}>
          {error}
        </Alert>
      )}
      {story?.generationError && (
        <Alert severity="warning" sx={{ mb: 2 }} onClose={() => undefined}>
          {story.generationError}
        </Alert>
      )}

      {/* ---------------- Step 1: setup ---------------- */}
      {activeStep === 0 && (
        <Paper elevation={2} sx={{ p: { xs: 2, sm: 3 }, mb: 3 }}>
          <Typography variant="h6" gutterBottom>
            {t('wizard.setup.title')}
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            {t('wizard.setup.hint')}
          </Typography>

          <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap', mb: 2 }}>
            <FormControl sx={{ minWidth: { xs: '100%', sm: 220 } }}>
              <InputLabel id="wizard-native">{t('editor.nativeLanguage')}</InputLabel>
              <Select
                labelId="wizard-native"
                label={t('editor.nativeLanguage')}
                value={nativeLanguage}
                onChange={(event) => setNativeLanguage(String(event.target.value))}
              >
                {LANGUAGES.map((language) => (
                  <MenuItem key={language.code} value={language.code}>
                    {language.name}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
            <FormControl sx={{ minWidth: { xs: '100%', sm: 220 } }}>
              <InputLabel id="wizard-learning">{t('editor.learningLanguage')}</InputLabel>
              <Select
                labelId="wizard-learning"
                label={t('editor.learningLanguage')}
                value={learningLanguage}
                onChange={(event) => setLearningLanguage(String(event.target.value))}
              >
                {LANGUAGES.map((language) => (
                  <MenuItem key={language.code} value={language.code}>
                    {language.name}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
            <FormControl sx={{ minWidth: { xs: '100%', sm: 180 } }}>
              <InputLabel id="wizard-level">{t('editor.level')}</InputLabel>
              <Select
                labelId="wizard-level"
                label={t('editor.level')}
                value={level}
                onChange={(event) => setLevel(event.target.value as typeof level)}
              >
                {LEVELS.map((value) => (
                  <MenuItem key={value} value={value}>
                    {t(`levels.${value}`)}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
          </Box>

          <TextField
            fullWidth
            label={t('editor.labels')}
            placeholder={t('editor.labelsPlaceholder')}
            value={labelsInput}
            onChange={(event) => setLabelsInput(event.target.value)}
            helperText={t('wizard.setup.labelsHint')}
            sx={{ mb: 2 }}
          />

          <TextField
            fullWidth
            required
            multiline
            minRows={3}
            label={t('editor.seedLabel', {
              lang: getLanguageName(nativeLanguage) || t('wizard.setup.yourLanguage'),
            })}
            placeholder={t('editor.seedPlaceholder')}
            value={seed}
            onChange={(event) => setSeed(event.target.value)}
            helperText={t('wizard.setup.seedHint')}
            sx={{ mb: 2 }}
          />

          <TextField
            fullWidth
            label={t('editor.aiGuideline')}
            placeholder={t('editor.aiGuidelinePlaceholder')}
            helperText={t('editor.aiGuidelineHint')}
            value={aiGuideline}
            onChange={(event) => setAiGuideline(event.target.value)}
            sx={{ mb: 2 }}
          />

          <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap', mb: 2 }}>
            <TextField
              type="number"
              label={t('wizard.setup.chapterCount')}
              value={chapterCount}
              onChange={(event) => setChapterCount(Math.min(MAX_CHAPTERS, Math.max(1, parseInt(event.target.value, 10) || 1)))}
              slotProps={{ htmlInput: { min: 1, max: MAX_CHAPTERS } }}
              sx={{ width: { xs: '100%', sm: 180 } }}
            />
            <TextField
              type="number"
              label={t('editor.targetSentences')}
              value={sentencesPerChapter}
              onChange={(event) => setSentencesPerChapter(Math.min(100, Math.max(1, parseInt(event.target.value, 10) || DEFAULT_SENTENCES)))}
              slotProps={{ htmlInput: { min: 1, max: 100 } }}
              sx={{ width: { xs: '100%', sm: 180 } }}
            />
          </Box>

          <Divider sx={{ my: 2 }} />

          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
            <GroupsIcon fontSize="small" color="action" />
            <Typography variant="subtitle2" sx={{ fontWeight: 600 }}>
              {t('editor.charactersSection')}
            </Typography>
          </Box>
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 2 }}>
            {t('editor.charactersHint')}
          </Typography>
          {characters.map((character, index) => (
            <Box key={index} sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 2, p: 2, mb: 2 }}>
              <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1 }}>
                <Typography variant="caption" sx={{ fontWeight: 600 }}>
                  {t('editor.characterN', { n: index + 1 })}
                </Typography>
                <IconButton
                  size="small"
                  color="error"
                  onClick={() => setCharacters((prev) => prev.filter((_, i) => i !== index))}
                >
                  <DeleteIcon fontSize="small" />
                </IconButton>
              </Box>
              <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap', mb: 1 }}>
                <TextField
                  size="small"
                  label={t('editor.characterName')}
                  value={character.name}
                  onChange={(event) => updateCharacter(index, { name: event.target.value })}
                  sx={{ flex: '1 1 200px' }}
                />
                <TextField
                  size="small"
                  label={t('editor.characterRole')}
                  placeholder={t('editor.characterRolePlaceholder')}
                  value={character.role}
                  onChange={(event) => updateCharacter(index, { role: event.target.value })}
                  sx={{ flex: '1 1 200px' }}
                />
              </Box>
              <TextField
                size="small"
                fullWidth
                multiline
                minRows={2}
                label={t('editor.characterDescription')}
                placeholder={t('editor.characterDescriptionPlaceholder')}
                value={character.description}
                onChange={(event) => updateCharacter(index, { description: event.target.value })}
                sx={{ mb: 1 }}
              />
              <TextField
                size="small"
                fullWidth
                label={t('editor.characterAppearance')}
                placeholder={t('editor.characterAppearancePlaceholder')}
                value={character.appearance}
                onChange={(event) => updateCharacter(index, { appearance: event.target.value })}
              />
            </Box>
          ))}
          <Button
            size="small"
            startIcon={<AddIcon />}
            disabled={characters.length >= MAX_CHARACTERS}
            onClick={() => setCharacters((prev) => [...prev, { name: '', role: '', description: '', appearance: '' }])}
          >
            {t('editor.addCharacter')}
          </Button>

          <Divider sx={{ my: 2 }} />

          <Typography variant="subtitle2" sx={{ fontWeight: 600, mb: 1 }}>
            {t('editor.aiSettings')}
          </Typography>
          <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap', mb: 2 }}>
            <FormControl sx={{ minWidth: { xs: '100%', sm: 280 } }}>
              <InputLabel id="wizard-outline-model">{t('wizard.setup.outlineModel')}</InputLabel>
              <Select
                labelId="wizard-outline-model"
                label={t('wizard.setup.outlineModel')}
                value={outlineAiModel}
                onChange={(event) => {
                  setOutlineAiModel(String(event.target.value));
                  setOutlineEffort('');
                }}
              >
                {STAGED_AI_MODELS.map((model) => (
                  <MenuItem key={model.id} value={model.id}>
                    {model.label}
                  </MenuItem>
                ))}
              </Select>
              <FormHelperText>{t('wizard.setup.outlineModelHint')}</FormHelperText>
            </FormControl>
            <AiEffortSelect
              id="wizard-outline-effort"
              label={t('wizard.setup.thinking')}
              modelId={outlineAiModel}
              value={outlineEffort}
              onChange={setOutlineEffort}
            />
          </Box>

          <Box sx={{ display: 'flex', flexDirection: { xs: 'column', sm: 'row' }, gap: 2, mt: 3 }}>
            <Tooltip title={canCreate ? '' : t('creatorAccess.tooltip')}>
              <span>
                <Button
                  variant="contained"
                  size="large"
                  startIcon={busy ? <CircularProgress size={18} color="inherit" /> : <AutoAwesomeIcon />}
                  onClick={handleCreateDraft}
                  disabled={busy || !canCreate}
                  sx={{ width: { xs: '100%', sm: 'auto' } }}
                >
                  {t('wizard.setup.createDraft')}
                </Button>
              </span>
            </Tooltip>
            <Button
              variant="text"
              onClick={() => navigate(-1)}
              disabled={busy}
              sx={{ width: { xs: '100%', sm: 'auto' } }}
            >
              {t('common.cancel')}
            </Button>
          </Box>
        </Paper>
      )}

      {/* ---------------- Step 2: outline ---------------- */}
      {activeStep === 1 && story && (
        <Paper elevation={2} sx={{ p: { xs: 2, sm: 3 }, mb: 3 }}>
          <Typography variant="h6" gutterBottom>
            {t('wizard.outline.title')}
          </Typography>

          {story.generating ? (
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, py: 3 }}>
              <CircularProgress size={22} />
              <Typography variant="body2" color="text.secondary">
                {story.jobProgress?.currentLabel || t('wizard.outline.planning')}
              </Typography>
            </Box>
          ) : (
            <>
              {!hasSynopsis && (
                <Alert severity="info" sx={{ mb: 2 }}>
                  {t('wizard.outline.empty')}
                </Alert>
              )}

              <TextField
                fullWidth
                multiline
                minRows={3}
                label={t('wizard.outline.synopsis', {
                  lang: getLanguageName(nativeLanguage) || t('wizard.setup.yourLanguage'),
                })}
                value={synopsisLang1}
                onChange={(event) => setSynopsisLang1(event.target.value)}
                helperText={t('wizard.outline.synopsisHint')}
                sx={{ mb: 2 }}
                disabled={busy}
              />
              <TextField
                fullWidth
                multiline
                minRows={2}
                label={t('wizard.outline.synopsis', {
                  lang: getLanguageName(learningLanguage) || t('wizard.setup.learningLanguageFallback'),
                })}
                value={synopsisLang2}
                onChange={(event) => setSynopsisLang2(event.target.value)}
                sx={{ mb: 3 }}
                disabled={busy}
              />

              <Typography variant="subtitle2" sx={{ fontWeight: 600, mb: 1 }}>
                {t('editor.chapters')} ({chapterEdits.length})
              </Typography>
              {chapterEdits.map((chapter, index) => (
                <Box key={index} sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 2, p: 2, mb: 2 }}>
                  <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1 }}>
                    <Typography variant="caption" sx={{ fontWeight: 600 }}>
                      {t('editor.chapterN', { n: index + 1 })}
                    </Typography>
                    {chapterEdits.length > 1 && (
                      <IconButton
                        size="small"
                        color="error"
                        disabled={busy}
                        onClick={() => setChapterEdits((prev) => prev.filter((_, i) => i !== index))}
                      >
                        <DeleteIcon fontSize="small" />
                      </IconButton>
                    )}
                  </Box>
                  <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap', mb: 1 }}>
                    <TextField
                      size="small"
                      label={`${t('editor.chapterTitle')} · ${getLanguageName(nativeLanguage)}`}
                      value={chapter.title.lang1}
                      onChange={(event) => updateChapter(index, { title: { ...chapter.title, lang1: event.target.value } })}
                      sx={{ flex: '1 1 220px' }}
                      disabled={busy}
                    />
                    <TextField
                      size="small"
                      label={`${t('editor.chapterTitle')} · ${getLanguageName(learningLanguage)}`}
                      value={chapter.title.lang2}
                      onChange={(event) => updateChapter(index, { title: { ...chapter.title, lang2: event.target.value } })}
                      sx={{ flex: '1 1 220px' }}
                      disabled={busy}
                    />
                  </Box>
                  <TextField
                    size="small"
                    fullWidth
                    multiline
                    minRows={2}
                    label={t('editor.chapterSeed')}
                    placeholder={t('editor.chapterSeedPlaceholder')}
                    value={chapter.seed}
                    onChange={(event) => updateChapter(index, { seed: event.target.value })}
                    helperText={t('editor.chapterSeedHint')}
                    sx={{ mb: 1 }}
                    disabled={busy}
                  />
                  <TextField
                    size="small"
                    type="number"
                    label={t('editor.targetSentences')}
                    value={chapter.targetSentences}
                    onChange={(event) =>
                      updateChapter(index, {
                        targetSentences: Math.min(100, Math.max(1, parseInt(event.target.value, 10) || DEFAULT_SENTENCES)),
                      })
                    }
                    slotProps={{ htmlInput: { min: 1, max: 100 } }}
                    sx={{ width: { xs: '100%', sm: 140 } }}
                    disabled={busy}
                  />
                </Box>
              ))}

              <Box sx={{ display: 'flex', gap: 1, mb: 2 }}>
                <Button
                  size="small"
                  startIcon={<AddIcon />}
                  disabled={busy || chapterEdits.length >= MAX_CHAPTERS}
                  onClick={() =>
                    setChapterEdits((prev) => [
                      ...prev,
                      { title: { lang1: '', lang2: '' }, seed: '', targetSentences: sentencesPerChapter },
                    ])
                  }
                >
                  {t('editor.addChapter')}
                </Button>
              </Box>

              <Divider sx={{ my: 2 }} />

              <TextField
                fullWidth
                multiline
                minRows={2}
                label={t('wizard.outline.feedbackLabel')}
                placeholder={t('wizard.outline.feedbackPlaceholder')}
                value={feedback}
                onChange={(event) => setFeedback(event.target.value)}
                sx={{ mb: 2 }}
                disabled={busy}
              />

              <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
                {!hasSynopsis ? (
                  <Button
                    variant="contained"
                    startIcon={busy ? <CircularProgress size={18} color="inherit" /> : <AutoAwesomeIcon />}
                    onClick={() => handleGenerateOutline(false)}
                    disabled={busy}
                  >
                    {t('wizard.outline.generate')}
                  </Button>
                ) : (
                  <Button
                    variant="outlined"
                    startIcon={<AutoAwesomeIcon />}
                    onClick={() => handleGenerateOutline(true)}
                    disabled={busy}
                  >
                    {t('wizard.outline.adjust')}
                  </Button>
                )}
              </Box>

              <Divider sx={{ my: 2 }} />

              <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap', alignItems: 'flex-start' }}>
                <FormControl sx={{ minWidth: { xs: '100%', sm: 260 } }}>
                  <InputLabel id="wizard-writing-model">{t('wizard.outline.writingModel')}</InputLabel>
                  <Select
                    labelId="wizard-writing-model"
                    label={t('wizard.outline.writingModel')}
                    value={aiModel}
                    onChange={(event) => {
                      setAiModel(String(event.target.value));
                      setAiEffort('');
                    }}
                    disabled={busy}
                  >
                    {STAGED_AI_MODELS.map((model) => (
                      <MenuItem key={model.id} value={model.id}>
                        {model.label}
                      </MenuItem>
                    ))}
                  </Select>
                  <FormHelperText>{t('wizard.outline.writingModelHint')}</FormHelperText>
                </FormControl>
                <AiEffortSelect
                  id="wizard-writing-effort"
                  label={t('wizard.outline.thinking')}
                  modelId={aiModel}
                  value={aiEffort}
                  onChange={setAiEffort}
                  disabled={busy}
                />
                <Button
                  variant="contained"
                  color="success"
                  startIcon={<CheckCircleIcon />}
                  onClick={handleApproveOutline}
                  disabled={busy || !hasSynopsis}
                  sx={{ mt: 1 }}
                >
                  {t('wizard.outline.approve')}
                </Button>
              </Box>
            </>
          )}
        </Paper>
      )}

      {/* ---------------- Step 3: chapters + validation offer ---------------- */}
      {activeStep === 2 && story && (
        <Paper elevation={2} sx={{ p: { xs: 2, sm: 3 }, mb: 3 }}>
          <Typography variant="h6" gutterBottom>
            {t('wizard.chapters.title')}
          </Typography>

          {story.generating && (
            <Box sx={{ mb: 2 }}>
              <LinearProgress
                variant={progressTotal > 0 ? 'determinate' : 'indeterminate'}
                value={progressTotal > 0 ? (progressDone / progressTotal) * 100 : undefined}
                sx={{ mb: 1 }}
              />
              <Typography variant="body2" color="text.secondary">
                {story.jobProgress?.currentLabel ||
                  t('wizard.chapters.progress', { done: progressDone, total: progressTotal })}
              </Typography>
            </Box>
          )}

          {story.chapters.map((chapter, index) => (
            <Box
              key={index}
              sx={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 1, py: 0.5, borderBottom: '1px solid', borderColor: 'divider' }}
            >
              {chapter.sentences?.length > 0 ? (
                <CheckCircleIcon fontSize="small" color="success" />
              ) : story.generating ? (
                <CircularProgress size={14} />
              ) : (
                <Chip size="small" label={t('wizard.chapters.pending')} />
              )}
              <Typography variant="body2" sx={{ flexGrow: 1 }}>
                {t('editor.chapterN', { n: index + 1 })} — {chapter.title?.lang1 || chapter.title?.lang2 || chapter.seed.slice(0, 40)}
              </Typography>
              <Typography variant="caption" color="text.secondary">
                {t('wizard.chapters.sentenceCount', { count: chapter.sentences?.length ?? 0 })}
              </Typography>
              {(chapter.issues?.length ?? 0) > 0 && (
                <Chip size="small" color="warning" label={t('wizard.chapters.issues', { count: chapter.issues?.length ?? 0 })} />
              )}
            </Box>
          ))}

          {!story.generating && stage === 'validation' && (
            <>
              <Divider sx={{ my: 2 }} />
              <Typography variant="subtitle1" sx={{ fontWeight: 600 }} gutterBottom>
                {t('wizard.validation.title')}
              </Typography>
              <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                {t('wizard.validation.hint')}
              </Typography>
              <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap', alignItems: 'flex-start' }}>
                <Button variant="outlined" onClick={() => handleValidation('none')} disabled={busy} sx={{ mt: 1 }}>
                  {t('wizard.validation.none')}
                </Button>
                <Button variant="outlined" onClick={() => handleValidation('basic')} disabled={busy} sx={{ mt: 1 }}>
                  {t('wizard.validation.basic')}
                </Button>
                <FormControl sx={{ minWidth: { xs: '100%', sm: 240 } }}>
                  <InputLabel id="wizard-review-model">{t('wizard.validation.reviewModel')}</InputLabel>
                  <Select
                    labelId="wizard-review-model"
                    label={t('wizard.validation.reviewModel')}
                    value={effectiveReviewModel}
                    onChange={(event) => {
                      setReviewModel(String(event.target.value));
                      setReviewEffort('');
                    }}
                    disabled={busy}
                  >
                    {STAGED_AI_MODELS.map((model) => (
                      <MenuItem key={model.id} value={model.id}>
                        {model.label}
                      </MenuItem>
                    ))}
                  </Select>
                </FormControl>
                <AiEffortSelect
                  id="wizard-review-effort"
                  label={t('wizard.validation.thinking')}
                  modelId={effectiveReviewModel}
                  value={effectiveReviewEffort}
                  onChange={setReviewEffort}
                  disabled={busy}
                  minWidth={170}
                />
                <Button variant="contained" onClick={() => handleValidation('ai_review')} disabled={busy} sx={{ mt: 1 }}>
                  {t('wizard.validation.aiReview', { count: story.chapters.length })}
                </Button>
              </Box>
              <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>
                {t('wizard.validation.costHint', {
                  model: getAIModelLabel(effectiveReviewModel, effectiveReviewEffort),
                })}
              </Typography>
              <Alert severity="info" sx={{ mt: 2 }}>
                <Typography variant="caption" component="div" sx={{ fontWeight: 600, mb: 0.5 }}>
                  {t('wizard.validation.findingsTitle')}
                </Typography>
                <Typography variant="caption" component="div">
                  {t('wizard.validation.findingsHint')}
                </Typography>
              </Alert>
            </>
          )}

          {!story.generating && (
            <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap', mt: 3 }}>
              {stage !== 'ready' && stage !== 'validation' && (
                <Button variant="contained" onClick={handleApproveOutline} disabled={busy}>
                  {t('wizard.outline.approve')}
                </Button>
              )}
              <Button variant="text" startIcon={<RestartAltIcon />} onClick={handleResetOutline} disabled={busy}>
                {t('wizard.done.backToOutline')}
              </Button>
            </Box>
          )}
        </Paper>
      )}

      {/* ---------------- Step 4: done ---------------- */}
      {activeStep === 3 && story && (
        <Paper elevation={2} sx={{ p: { xs: 2, sm: 3 } }}>
          <Typography variant="h6" gutterBottom>
            {t('wizard.done.title')}
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            {t('wizard.done.summary', {
              chapters: story.chapters.length,
              sentences: story.sentenceCount ?? 0,
            })}
          </Typography>
          {totalIssues > 0 && (
            <Alert severity="warning" sx={{ mb: 2 }}>
              {t('wizard.done.issues', { count: totalIssues })}
            </Alert>
          )}

          <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
            <Button variant="contained" startIcon={<RateReviewIcon />} onClick={() => navigate(`/review/${story._id}`)}>
              {t('wizard.done.review')}
            </Button>
            <Button variant="outlined" startIcon={<MenuBookIcon />} onClick={() => navigate(`/preview/${story._id}`)}>
              {t('wizard.done.preview')}
            </Button>
            <Button
              variant={story.published ? 'outlined' : 'contained'}
              color={story.published ? 'warning' : 'success'}
              onClick={handleTogglePublish}
              disabled={busy || (!story.published && (story.sentenceCount ?? 0) === 0)}
            >
              {story.published ? t('wizard.done.unpublish') : t('wizard.done.publish')}
            </Button>
            <Button variant="text" startIcon={<RestartAltIcon />} onClick={handleResetOutline} disabled={busy}>
              {t('wizard.done.backToOutline')}
            </Button>
          </Box>
        </Paper>
      )}

      <Snackbar
        open={!!snackbar}
        autoHideDuration={4000}
        onClose={() => setSnackbar('')}
        message={snackbar}
      />
    </Container>
  );
};

export default StoryCreateWizardPage;
