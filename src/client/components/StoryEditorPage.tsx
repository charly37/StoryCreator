import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  Box, Container, Typography, Paper, TextField, Button, Alert, Snackbar,
  CircularProgress, Select, MenuItem, FormControl, InputLabel, Divider,
} from '@mui/material';
import AutoAwesomeIcon from '@mui/icons-material/AutoAwesome';
import { useTranslation } from 'react-i18next';
import { LANGUAGES, getLanguageName } from '../utils/languages';
import { AppUser } from '../App';

interface StoryEditorPageProps {
  user: AppUser;
}

const LEVELS = ['beginner', 'intermediate', 'advanced'] as const;

const StoryEditorPage: React.FC<StoryEditorPageProps> = ({ user }) => {
  const { id } = useParams<{ id?: string }>();
  const navigate = useNavigate();
  const { t } = useTranslation();

  const [titleLang1, setTitleLang1] = useState('');
  const [nativeLanguage, setNativeLanguage] = useState('');
  const [learningLanguage, setLearningLanguage] = useState('');
  const [level, setLevel] = useState<'beginner' | 'intermediate' | 'advanced'>('beginner');
  const [topic, setTopic] = useState('');
  const [seed, setSeed] = useState('');
  const [targetPages, setTargetPages] = useState(1);

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
        setTargetPages(data.targetPages || 1);
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
        targetPages,
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
          setError(createData.message || t('editor.saveError'));
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
          setError(updateData.message || t('editor.saveError'));
          return;
        }
      }

      // Call the generate endpoint
      const genRes = await fetch(`/api/stories/${storyId}/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ seed, targetPages }),
      });
      const genData = await genRes.json();
      if (!genRes.ok) {
        setError(genData.message || t('editor.generateError'));
        return;
      }

      setSnackbar(t('editor.generateSuccess'));
      navigate('/stories/mine');
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
          <TextField
            label={t('editor.targetPages')}
            type="number"
            value={targetPages}
            onChange={(e) => setTargetPages(Math.min(10, Math.max(1, parseInt(e.target.value, 10) || 1)))}
            slotProps={{ htmlInput: { min: 1, max: 10 } }}
            sx={{ width: 180 }}
            helperText={`≈ ${targetPages * 12} sentences`}
          />
        </Paper>

        {/* Actions */}
        <Box sx={{ display: 'flex', gap: 2, alignItems: 'center' }}>
          <Button
            variant="contained"
            size="large"
            startIcon={generating ? <CircularProgress size={18} color="inherit" /> : <AutoAwesomeIcon />}
            onClick={handleGenerate}
            disabled={generating}
          >
            {generating ? t('editor.generating') : t('editor.generateStory')}
          </Button>
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

