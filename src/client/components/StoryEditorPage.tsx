import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  Box, Container, Typography, Paper, TextField, Button, Alert, Snackbar,
  CircularProgress, Select, MenuItem, FormControl, InputLabel, Divider,
  IconButton, Chip, FormControlLabel, Switch, Tooltip,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import DeleteIcon from '@mui/icons-material/Delete';
import AutoAwesomeIcon from '@mui/icons-material/AutoAwesome';
import { useTranslation } from 'react-i18next';
import { LANGUAGES, getLanguageName } from '../utils/languages';
import { AppUser } from '../App';

interface Sentence {
  lang1: string;
  lang2: string;
}

interface StoryEditorPageProps {
  user: AppUser;
}

const LEVELS = ['beginner', 'intermediate', 'advanced'] as const;

const StoryEditorPage: React.FC<StoryEditorPageProps> = ({ user }) => {
  const { id } = useParams<{ id?: string }>();
  const navigate = useNavigate();
  const { t } = useTranslation();

  const [titleLang1, setTitleLang1] = useState('');
  const [titleLang2, setTitleLang2] = useState('');
  const [nativeLanguage, setNativeLanguage] = useState('');
  const [learningLanguage, setLearningLanguage] = useState('');
  const [level, setLevel] = useState<'beginner' | 'intermediate' | 'advanced'>('beginner');
  const [topic, setTopic] = useState('');
  const [sentences, setSentences] = useState<Sentence[]>([{ lang1: '', lang2: '' }]);
  const [published, setPublished] = useState(false);
  const [savedId, setSavedId] = useState<string | null>(id || null);

  const [loading, setLoading] = useState(!!id);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [snackbar, setSnackbar] = useState('');
  const [aiSnackbar, setAiSnackbar] = useState(false);
  const [langError, setLangError] = useState('');

  // Load existing story when editing
  useEffect(() => {
    if (!id) return;
    fetch(`/api/stories/${id}`)
      .then((res) => res.json())
      .then((data) => {
        setTitleLang1(data.title?.lang1 || '');
        setTitleLang2(data.title?.lang2 || '');
        setNativeLanguage(data.nativeLanguage || '');
        setLearningLanguage(data.learningLanguage || '');
        setLevel(data.level || 'beginner');
        setTopic(data.topic || '');
        setSentences(data.sentences?.length > 0 ? data.sentences : [{ lang1: '', lang2: '' }]);
        setPublished(data.published || false);
        setSavedId(data._id);
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

  const handleSave = async (publish?: boolean) => {
    if (!nativeLanguage || !learningLanguage) {
      setError('Please select both languages.');
      return;
    }
    if (!validateLanguages(nativeLanguage, learningLanguage)) return;
    if (!titleLang1 || !titleLang2) {
      setError('Please fill in the title in both languages.');
      return;
    }

    setSaving(true);
    setError('');

    const payload = {
      title: { lang1: titleLang1, lang2: titleLang2 },
      sentences: sentences.filter((s) => s.lang1.trim() || s.lang2.trim()),
      nativeLanguage,
      learningLanguage,
      level,
      topic,
    };

    try {
      let res: Response;
      if (savedId) {
        res = await fetch(`/api/stories/${savedId}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
      } else {
        res = await fetch('/api/stories', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
      }

      const data = await res.json();
      if (!res.ok) {
        setError(data.message || t('editor.saveError'));
        return;
      }

      const newId: string = data._id;
      setSavedId(newId);

      // Optionally toggle publish state
      if (publish !== undefined && publish !== data.published) {
        await fetch(`/api/stories/${newId}/publish`, { method: 'POST' });
        setPublished(publish);
      } else {
        setPublished(data.published);
      }

      setSnackbar(t('editor.saved'));
      if (!savedId) navigate(`/editor/${newId}`, { replace: true });
    } catch {
      setError(t('editor.saveError'));
    } finally {
      setSaving(false);
    }
  };

  const handlePublishToggle = async () => {
    if (!savedId) return;
    const res = await fetch(`/api/stories/${savedId}/publish`, { method: 'POST' });
    const data = await res.json();
    if (res.ok) {
      setPublished(data.published);
      setSnackbar(data.published ? t('profile.publishSuccess') : t('profile.unpublishSuccess'));
    }
  };

  const addSentence = () => setSentences((prev) => [...prev, { lang1: '', lang2: '' }]);

  const removeSentence = (index: number) =>
    setSentences((prev) => prev.filter((_, i) => i !== index));

  const updateSentence = (index: number, field: 'lang1' | 'lang2', value: string) =>
    setSentences((prev) => prev.map((s, i) => (i === index ? { ...s, [field]: value } : s)));

  if (loading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '100vh' }}>
        <CircularProgress />
      </Box>
    );
  }

  return (
    <Box sx={{ pt: 10, pb: 8, bgcolor: 'background.default', minHeight: '100vh' }}>
      <Container maxWidth="md">
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
          <Typography variant="h4" sx={{ fontWeight: 700 }}>
            {id ? t('editor.editTitle') : t('editor.createTitle')}
          </Typography>
          {savedId && (
            <Chip
              label={published ? t('editor.published') : t('editor.draft')}
              color={published ? 'success' : 'default'}
              variant={published ? 'filled' : 'outlined'}
            />
          )}
        </Box>

        {error && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError('')}>{error}</Alert>}

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
          {langError && <Typography color="error" variant="caption" sx={{ mt: 0.5, display: 'block' }}>{langError}</Typography>}
        </Paper>

        <Paper elevation={2} sx={{ p: 3, mb: 3 }}>
          <Typography variant="h6" gutterBottom sx={{ fontWeight: 600 }}>
            {t('stories.title')}
          </Typography>
          <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
            <TextField
              label={t('editor.titleIn', { lang: nativeLanguage ? getLanguageName(nativeLanguage) : '…' })}
              value={titleLang1} onChange={(e) => setTitleLang1(e.target.value)}
              sx={{ flex: 1, minWidth: 200 }} required
            />
            <TextField
              label={t('editor.titleIn', { lang: learningLanguage ? getLanguageName(learningLanguage) : '…' })}
              value={titleLang2} onChange={(e) => setTitleLang2(e.target.value)}
              sx={{ flex: 1, minWidth: 200 }} required
            />
          </Box>

          <Box sx={{ display: 'flex', gap: 2, mt: 2, flexWrap: 'wrap' }}>
            <TextField
              label={t('editor.topic')}
              placeholder={t('editor.topicPlaceholder')}
              value={topic} onChange={(e) => setTopic(e.target.value)}
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

        {/* Sentences */}
        <Paper elevation={2} sx={{ p: 3, mb: 3 }}>
          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
            <Typography variant="h6" sx={{ fontWeight: 600 }}>{t('editor.sentences')}</Typography>
            <Tooltip title={t('editor.comingSoon')}>
              <span>
                <Button
                  startIcon={<AutoAwesomeIcon />}
                  variant="outlined"
                  color="secondary"
                  size="small"
                  onClick={() => setAiSnackbar(true)}
                >
                  {t('editor.generateWithAI')}
                </Button>
              </span>
            </Tooltip>
          </Box>

          {sentences.map((sentence, index) => (
            <Box key={index}>
              {index > 0 && <Divider sx={{ my: 2 }} />}
              <Box sx={{ display: 'flex', gap: 1, alignItems: 'flex-start' }}>
                <Typography
                  variant="caption"
                  sx={{
                    mt: 2, minWidth: 28, fontWeight: 700,
                    color: 'primary.main', textAlign: 'center',
                  }}
                >
                  {index + 1}
                </Typography>
                <Box sx={{ flexGrow: 1, display: 'flex', gap: 2, flexWrap: 'wrap' }}>
                  <TextField
                    label={t('editor.lang1Placeholder', { lang: nativeLanguage ? getLanguageName(nativeLanguage) : 'Lang 1' })}
                    value={sentence.lang1}
                    onChange={(e) => updateSentence(index, 'lang1', e.target.value)}
                    multiline minRows={2} sx={{ flex: 1, minWidth: 200 }}
                  />
                  <TextField
                    label={t('editor.lang2Placeholder', { lang: learningLanguage ? getLanguageName(learningLanguage) : 'Lang 2' })}
                    value={sentence.lang2}
                    onChange={(e) => updateSentence(index, 'lang2', e.target.value)}
                    multiline minRows={2} sx={{ flex: 1, minWidth: 200 }}
                  />
                </Box>
                <IconButton
                  onClick={() => removeSentence(index)}
                  disabled={sentences.length === 1}
                  size="small" sx={{ mt: 1 }}
                  color="error"
                >
                  <DeleteIcon fontSize="small" />
                </IconButton>
              </Box>
            </Box>
          ))}

          <Button startIcon={<AddIcon />} onClick={addSentence} sx={{ mt: 2 }}>
            {t('editor.addSentence')}
          </Button>
        </Paper>

        {/* Actions */}
        <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap', alignItems: 'center' }}>
          <Button
            variant="outlined" size="large"
            onClick={() => handleSave(false)}
            disabled={saving}
          >
            {saving ? <CircularProgress size={20} /> : t('editor.saveDraft')}
          </Button>
          <Button
            variant="contained" size="large"
            onClick={() => handleSave(true)}
            disabled={saving}
          >
            {saving ? <CircularProgress size={20} color="inherit" /> : (savedId ? t('editor.saveChanges') : t('editor.saveDraft'))}
          </Button>

          {savedId && (
            <FormControlLabel
              control={
                <Switch
                  checked={published}
                  onChange={handlePublishToggle}
                  color="success"
                />
              }
              label={published ? t('editor.published') : t('common.publish')}
              sx={{ ml: 1 }}
            />
          )}

          <Button variant="text" onClick={() => navigate(-1)} sx={{ ml: 'auto' }}>
            {t('common.cancel')}
          </Button>
        </Box>
      </Container>

      <Snackbar
        open={!!snackbar}
        autoHideDuration={3000}
        onClose={() => setSnackbar('')}
        message={snackbar}
      />
      <Snackbar
        open={aiSnackbar}
        autoHideDuration={3000}
        onClose={() => setAiSnackbar(false)}
        message={t('editor.comingSoon')}
      />
    </Box>
  );
};

export default StoryEditorPage;
