import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  Box, Container, Typography, Paper, TextField, Button, Alert, Snackbar,
  CircularProgress, Select, MenuItem, FormControl, InputLabel, Divider,
  IconButton, Tooltip,
} from '@mui/material';
import AutoAwesomeIcon from '@mui/icons-material/AutoAwesome';
import AddIcon from '@mui/icons-material/Add';
import DeleteIcon from '@mui/icons-material/Delete';
import GroupsIcon from '@mui/icons-material/Groups';
import { useTranslation } from 'react-i18next';
import { LANGUAGES, getLanguageName } from '../utils/languages';
import { AppUser } from '../App';

interface StoryEditorPageProps {
  user: AppUser;
}

interface ChapterSpec {
  seed: string;
  targetSentences: number;
}

interface Character {
  name: string;
  role: string;
  description: string;
  appearance: string;
}

const LEVELS = ['beginner', 'intermediate', 'advanced'] as const;
const DEFAULT_SENTENCES = 12;
const MAX_CHAPTERS = 10;
const MAX_CHARACTERS = 20;

const StoryEditorPage: React.FC<StoryEditorPageProps> = ({ user }) => {
  const { id } = useParams<{ id?: string }>();
  const navigate = useNavigate();
  const { t } = useTranslation();
  const canCreate = !!user.canCreateStories;

  const [titleLang1, setTitleLang1] = useState('');
  const [nativeLanguage, setNativeLanguage] = useState('');
  const [learningLanguage, setLearningLanguage] = useState('');
  const [level, setLevel] = useState<'beginner' | 'intermediate' | 'advanced'>('beginner');
  const [topic, setTopic] = useState('');
  const [seed, setSeed] = useState('');
  const [chapterSpecs, setChapterSpecs] = useState<ChapterSpec[]>([{ seed: '', targetSentences: DEFAULT_SENTENCES }]);
  const [characters, setCharacters] = useState<Character[]>([]);

  const [loading, setLoading] = useState(!!id);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState('');
  const [langError, setLangError] = useState('');
  const [snackbar, setSnackbar] = useState('');

  useEffect(() => {
    if (!id) return;
    fetch(`/api/stories/${id}`)
      .then((res) => res.json())
      .then((data) => {
        setTitleLang1(data.title?.lang1 || '');
        setNativeLanguage(data.nativeLanguage || '');
        setLearningLanguage(data.learningLanguage || '');
        setLevel(data.level || 'beginner');
        setTopic(data.topic || '');
        setSeed(data.seed || '');
        setCharacters(
          Array.isArray(data.characters)
            ? data.characters.map((c: Partial<Character>) => ({
                name: c.name || '',
                role: c.role || '',
                description: c.description || '',
                appearance: c.appearance || '',
              }))
            : []
        );
        const loadedChapters = Array.isArray(data.chapters) && data.chapters.length > 0
          ? data.chapters.map((c: ChapterSpec) => ({ seed: c.seed || '', targetSentences: c.targetSentences || DEFAULT_SENTENCES }))
          : [{ seed: '', targetSentences: DEFAULT_SENTENCES }];
        setChapterSpecs(loadedChapters);
      })
      .catch(() => setError('Failed to load story'))
      .finally(() => setLoading(false));
  }, [id]);

  const validateLanguages = (native: string, learning: string) => {
    if (native && learning && native === learning) {
      setLangError(t('editor.sameLanguageError'));
      return false;
    }
    setLangError('');
    return true;
  };

  const validate = () => {
    if (!nativeLanguage || !learningLanguage) {
      setError('Please select both languages.');
      return false;
    }
    if (!validateLanguages(nativeLanguage, learningLanguage)) return false;
    if (!titleLang1.trim()) {
      setError('Please fill in the story title.');
      return false;
    }
    if (!seed.trim()) {
      setError('Please write your story seed before generating.');
      return false;
    }
    return true;
  };

  const handleGenerate = async () => {
    if (!canCreate) {
      setError(t('editor.noCreatorAccessError'));
      return;
    }
    if (!validate()) return;
    setGenerating(true);
    setError('');

    try {
      // Create or update the draft first so we have an ID
      const metaPayload = {
        title: { lang1: titleLang1, lang2: '' },
        nativeLanguage,
        learningLanguage,
        level,
        topic,
        seed,
        characters,
        targetChapters: chapterSpecs.length,
        chapters: chapterSpecs,
      };

      let storyId = id;
      if (!storyId) {
        const createRes = await fetch('/api/stories', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(metaPayload),
        });
        const createData = await createRes.json();
        if (!createRes.ok) {
          const denied = createData.code === 'CREATOR_ACCESS_REQUIRED';
          setError(denied ? t('editor.noCreatorAccessError') : createData.message || t('editor.saveError'));
          return;
        }
        storyId = createData._id;
      } else {
        const updateRes = await fetch(`/api/stories/${storyId}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(metaPayload),
        });
        if (!updateRes.ok) {
          const updateData = await updateRes.json();
          const denied = updateData.code === 'CREATOR_ACCESS_REQUIRED';
          setError(denied ? t('editor.noCreatorAccessError') : updateData.message || t('editor.saveError'));
          return;
        }
      }

      // Generate — story.seed and story.chapters are already saved by PUT/POST above
      const genRes = await fetch(`/api/stories/${storyId}/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      const genData = await genRes.json();
      if (!genRes.ok) {
        const denied = genData.code === 'CREATOR_ACCESS_REQUIRED';
        setError(denied ? t('editor.noCreatorAccessError') : genData.message || t('editor.generateError'));
        return;
      }

      setSnackbar(t('editor.generateQueued'));
      navigate('/my-stories');
    } catch {
      setError(t('editor.generateError'));
    } finally {
      setGenerating(false);
    }
  };

  if (loading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '100vh' }}>
        <CircularProgress />
      </Box>
    );
  }

  const nativeLangName = nativeLanguage ? getLanguageName(nativeLanguage) : '…';

  return (
    <Box sx={{ pt: 10, pb: 8, bgcolor: 'background.default', minHeight: '100vh' }}>
      <Container maxWidth="md">
        <Typography variant="h4" sx={{ fontWeight: 700, mb: 3 }}>
          {t('editor.createTitle')}
        </Typography>

        {!canCreate && (
          <Alert severity="info" sx={{ mb: 2 }}>{t('editor.noCreatorAccessError')}</Alert>
        )}

        {error && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError('')}>{error}</Alert>}

        {/* Languages */}
        <Paper elevation={2} sx={{ p: 3, mb: 3 }}>
          <Typography variant="h6" gutterBottom sx={{ fontWeight: 600 }}>
            {t('common.language')}
          </Typography>
          <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
            <FormControl sx={{ minWidth: 200, flex: 1 }} error={!!langError}>
              <InputLabel>{t('editor.nativeLanguage')}</InputLabel>
              <Select
                value={nativeLanguage}
                label={t('editor.nativeLanguage')}
                onChange={(e) => {
                  setNativeLanguage(e.target.value);
                  validateLanguages(e.target.value, learningLanguage);
                }}
              >
                <MenuItem value=""><em>{t('editor.selectLanguage')}</em></MenuItem>
                {LANGUAGES.map((l) => (
                  <MenuItem key={l.code} value={l.code}>{l.name} — {l.nativeName}</MenuItem>
                ))}
              </Select>
            </FormControl>
            <FormControl sx={{ minWidth: 200, flex: 1 }} error={!!langError}>
              <InputLabel>{t('editor.learningLanguage')}</InputLabel>
              <Select
                value={learningLanguage}
                label={t('editor.learningLanguage')}
                onChange={(e) => {
                  setLearningLanguage(e.target.value);
                  validateLanguages(nativeLanguage, e.target.value);
                }}
              >
                <MenuItem value=""><em>{t('editor.selectLanguage')}</em></MenuItem>
                {LANGUAGES.map((l) => (
                  <MenuItem key={l.code} value={l.code}>{l.name} — {l.nativeName}</MenuItem>
                ))}
              </Select>
            </FormControl>
          </Box>
          {langError && (
            <Typography color="error" variant="caption" sx={{ mt: 0.5, display: 'block' }}>
              {langError}
            </Typography>
          )}
        </Paper>

        {/* Story metadata */}
        <Paper elevation={2} sx={{ p: 3, mb: 3 }}>
          <Typography variant="h6" gutterBottom sx={{ fontWeight: 600 }}>
            {t('editor.storyDetails')}
          </Typography>
          <TextField
            label={t('editor.titleIn', { lang: nativeLangName })}
            value={titleLang1}
            onChange={(e) => setTitleLang1(e.target.value)}
            fullWidth required sx={{ mb: 2 }}
          />
          <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
            <TextField
              label={t('editor.topic')}
              placeholder={t('editor.topicPlaceholder')}
              value={topic}
              onChange={(e) => setTopic(e.target.value)}
              sx={{ flex: 1, minWidth: 200 }}
            />
            <FormControl sx={{ minWidth: 180 }}>
              <InputLabel>{t('editor.level')}</InputLabel>
              <Select
                value={level}
                label={t('editor.level')}
                onChange={(e) => setLevel(e.target.value as typeof level)}
              >
                {LEVELS.map((lv) => (
                  <MenuItem key={lv} value={lv}>{t(`levels.${lv}`)}</MenuItem>
                ))}
              </Select>
            </FormControl>
          </Box>
        </Paper>

        {/* Story characters */}
        <Paper elevation={2} sx={{ p: 3, mb: 3 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
            <GroupsIcon color="secondary" fontSize="small" />
            <Typography variant="h6" sx={{ fontWeight: 600 }}>
              {t('editor.charactersSection')}
            </Typography>
          </Box>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            {t('editor.charactersHint')}
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
                >
                  <DeleteIcon fontSize="small" />
                </IconButton>
              </Box>
              <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap', mb: 2 }}>
                <TextField
                  label={t('editor.characterName')}
                  value={character.name}
                  onChange={(e) => setCharacters((prev) => prev.map((c, idx) => idx === i ? { ...c, name: e.target.value } : c))}
                  sx={{ flex: 1, minWidth: 200 }}
                />
                <TextField
                  label={t('editor.characterRole')}
                  placeholder={t('editor.characterRolePlaceholder')}
                  value={character.role}
                  onChange={(e) => setCharacters((prev) => prev.map((c, idx) => idx === i ? { ...c, role: e.target.value } : c))}
                  sx={{ flex: 1, minWidth: 200 }}
                />
              </Box>
              <TextField
                label={t('editor.characterDescription')}
                placeholder={t('editor.characterDescriptionPlaceholder')}
                value={character.description}
                onChange={(e) => setCharacters((prev) => prev.map((c, idx) => idx === i ? { ...c, description: e.target.value } : c))}
                multiline minRows={2} fullWidth sx={{ mb: 2 }}
              />
              <TextField
                label={t('editor.characterAppearance')}
                placeholder={t('editor.characterAppearancePlaceholder')}
                value={character.appearance}
                onChange={(e) => setCharacters((prev) => prev.map((c, idx) => idx === i ? { ...c, appearance: e.target.value } : c))}
                multiline minRows={2} fullWidth
              />
            </Box>
          ))}

          <Button
            size="small"
            startIcon={<AddIcon />}
            onClick={() => setCharacters((prev) => [...prev, { name: '', role: '', description: '', appearance: '' }])}
            disabled={characters.length >= MAX_CHARACTERS}
          >
            {t('editor.addCharacter')}
          </Button>
        </Paper>

        {/* Seed section */}
        <Paper elevation={2} sx={{ p: 3, mb: 3 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
            <AutoAwesomeIcon color="secondary" fontSize="small" />
            <Typography variant="h6" sx={{ fontWeight: 600 }}>
              {t('editor.seedSection')}
            </Typography>
          </Box>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            {t('editor.seedPlaceholder')}
          </Typography>
          <TextField
            label={t('editor.seedLabel', { lang: nativeLangName })}
            value={seed}
            onChange={(e) => setSeed(e.target.value)}
            multiline minRows={4}
            fullWidth required sx={{ mb: 3 }}
          />
          <Divider sx={{ mb: 3 }} />

          {/* Chapter list */}
          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
            <Typography variant="subtitle2" sx={{ fontWeight: 600 }}>
              {t('editor.chapters')} ({chapterSpecs.length})
            </Typography>
            <Button
              size="small"
              startIcon={<AddIcon />}
              onClick={() => setChapterSpecs((prev) => [...prev, { seed: '', targetSentences: DEFAULT_SENTENCES }])}
              disabled={chapterSpecs.length >= MAX_CHAPTERS}
            >
              {t('editor.addChapter')}
            </Button>
          </Box>

          {chapterSpecs.map((chapter, i) => (
            <Box key={i} sx={{ mb: 2, p: 2, border: '1px solid', borderColor: 'divider', borderRadius: 2 }}>
              <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1 }}>
                <Typography variant="subtitle2" sx={{ fontWeight: 600 }}>
                  {t('editor.chapterN', { n: i + 1 })}
                </Typography>
                {chapterSpecs.length > 1 && (
                  <IconButton
                    size="small"
                    color="error"
                    onClick={() => setChapterSpecs((prev) => prev.filter((_, idx) => idx !== i))}
                  >
                    <DeleteIcon fontSize="small" />
                  </IconButton>
                )}
              </Box>
              <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap', alignItems: 'flex-start' }}>
                <TextField
                  label={t('editor.chapterSeed')}
                  placeholder={t('editor.chapterSeedPlaceholder')}
                  value={chapter.seed}
                  onChange={(e) => setChapterSpecs((prev) => prev.map((c, idx) => idx === i ? { ...c, seed: e.target.value } : c))}
                  multiline
                  minRows={2}
                  sx={{ flex: 1, minWidth: 200 }}
                />
                <TextField
                  label={t('editor.targetSentences')}
                  type="number"
                  value={chapter.targetSentences}
                  onChange={(e) => setChapterSpecs((prev) => prev.map((c, idx) => idx === i ? { ...c, targetSentences: Math.min(100, Math.max(1, parseInt(e.target.value, 10) || DEFAULT_SENTENCES)) } : c))}
                  slotProps={{ htmlInput: { min: 1, max: 100 } }}
                  sx={{ width: 130 }}
                />
              </Box>
            </Box>
          ))}

          <Typography variant="caption" color="text.secondary">
            {t('editor.totalSentences', { count: chapterSpecs.reduce((s, c) => s + c.targetSentences, 0) })}
          </Typography>
        </Paper>

        {/* Actions */}
        <Box sx={{ display: 'flex', gap: 2, alignItems: 'center' }}>
          <Tooltip title={canCreate ? '' : t('creatorAccess.tooltip')}>
            <span>
              <Button
                variant="contained"
                size="large"
                startIcon={generating ? <CircularProgress size={18} color="inherit" /> : <AutoAwesomeIcon />}
                onClick={handleGenerate}
                disabled={generating || !canCreate}
              >
                {generating ? t('editor.generating') : t('editor.generateStory')}
              </Button>
            </span>
          </Tooltip>
          <Button variant="text" onClick={() => navigate(-1)} disabled={generating}>
            {t('common.cancel')}
          </Button>
        </Box>
      </Container>

      <Snackbar
        open={!!snackbar}
        autoHideDuration={4000}
        onClose={() => setSnackbar('')}
        message={snackbar}
      />
    </Box>
  );
};

export default StoryEditorPage;

