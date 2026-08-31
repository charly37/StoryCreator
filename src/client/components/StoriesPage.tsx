import React, { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Box, Container, Typography, TextField, Grid, Card, CardContent,
  CardActions, Chip, CircularProgress, Alert, Button,
  Select, MenuItem, FormControl, InputLabel, InputAdornment, Pagination,
} from '@mui/material';
import SearchIcon from '@mui/icons-material/Search';
import { useTranslation } from 'react-i18next';
import { LANGUAGES, getLanguageName } from '../utils/languages';

interface StoryCard {
  _id: string;
  title: { lang1: string; lang2: string };
  nativeLanguage: string;
  learningLanguage: string;
  level: string;
  topic: string;
  authorName: string;
  sentenceCount: number;
}

const LEVELS = ['beginner', 'intermediate', 'advanced'] as const;

const LEVEL_COLOR: Record<string, 'success' | 'warning' | 'error'> = {
  beginner: 'success',
  intermediate: 'warning',
  advanced: 'error',
};

const StoriesPage: React.FC = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();

  const [stories, setStories] = useState<StoryCard[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [nativeLang, setNativeLang] = useState('');
  const [learningLang, setLearningLang] = useState('');
  const [level, setLevel] = useState('');
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);

  const fetchStories = useCallback(async (currentPage: number) => {
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams({ page: String(currentPage) });
      if (search) params.set('search', search);
      if (nativeLang) params.set('nativeLang', nativeLang);
      if (learningLang) params.set('learningLang', learningLang);
      if (level) params.set('level', level);

      const res = await fetch(`/api/stories?${params}`);
      if (!res.ok) throw new Error('Failed to fetch');
      const data = await res.json();
      setStories(data.stories || []);
      setTotalPages(data.pages || 1);
    } catch {
      setError('Failed to load stories.');
    } finally {
      setLoading(false);
    }
  }, [search, nativeLang, learningLang, level]);

  useEffect(() => {
    setPage(1);
    fetchStories(1);
  }, [fetchStories]);

  const handlePageChange = (_: React.ChangeEvent<unknown>, value: number) => {
    setPage(value);
    fetchStories(value);
    window.scrollTo(0, 0);
  };

  return (
    <Box sx={{ pt: 10, pb: 6, bgcolor: 'background.default', minHeight: '100vh' }}>
      <Container maxWidth="lg">
        <Typography variant="h4" sx={{ fontWeight: 700 }} gutterBottom>
          {t('stories.title')}
        </Typography>

        {/* Filters */}
        <Box sx={{ display: 'flex', gap: 2, mb: 3, flexWrap: 'wrap', alignItems: 'center' }}>
          <TextField
            placeholder={t('stories.searchPlaceholder')}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            size="small"
            sx={{ flexGrow: 1, minWidth: 220 }}
            slotProps={{
              input: {
                startAdornment: <InputAdornment position="start"><SearchIcon fontSize="small" /></InputAdornment>,
              },
            }}
          />

          <FormControl size="small" sx={{ minWidth: 150 }}>
            <InputLabel>{t('stories.filterNativeLang')}</InputLabel>
            <Select value={nativeLang} label={t('stories.filterNativeLang')} onChange={(e) => setNativeLang(e.target.value)}>
              <MenuItem value="">{t('stories.allLanguages')}</MenuItem>
              {LANGUAGES.map((l) => (
                <MenuItem key={l.code} value={l.code}>{l.name}</MenuItem>
              ))}
            </Select>
          </FormControl>

          <FormControl size="small" sx={{ minWidth: 160 }}>
            <InputLabel>{t('stories.filterLearningLang')}</InputLabel>
            <Select value={learningLang} label={t('stories.filterLearningLang')} onChange={(e) => setLearningLang(e.target.value)}>
              <MenuItem value="">{t('stories.allLanguages')}</MenuItem>
              {LANGUAGES.map((l) => (
                <MenuItem key={l.code} value={l.code}>{l.name}</MenuItem>
              ))}
            </Select>
          </FormControl>

          <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
            <Chip
              label={t('stories.allLevels')}
              onClick={() => setLevel('')}
              color={level === '' ? 'primary' : 'default'}
              variant={level === '' ? 'filled' : 'outlined'}
            />
            {LEVELS.map((lv) => (
              <Chip
                key={lv}
                label={t(`levels.${lv}`)}
                onClick={() => setLevel(lv)}
                color={level === lv ? LEVEL_COLOR[lv] : 'default'}
                variant={level === lv ? 'filled' : 'outlined'}
              />
            ))}
          </Box>
        </Box>

        {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}

        {loading ? (
          <Box sx={{ display: 'flex', justifyContent: 'center', py: 8 }}>
            <CircularProgress />
          </Box>
        ) : stories.length === 0 ? (
          <Box sx={{ textAlign: 'center', py: 8 }}>
            <Typography color="text.secondary">{t('stories.noResults')}</Typography>
          </Box>
        ) : (
          <>
            <Grid container spacing={3}>
              {stories.map((story) => (
                <Grid size={{ xs: 12, sm: 6, md: 4 }} key={story._id}>
                  <Card elevation={2} sx={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
                    <CardContent sx={{ flexGrow: 1 }}>
                      <Box sx={{ display: 'flex', gap: 1, mb: 1.5, flexWrap: 'wrap' }}>
                        <Chip
                          label={t(`levels.${story.level}`)}
                          color={LEVEL_COLOR[story.level] ?? 'default'}
                          size="small"
                        />
                        <Chip
                          label={`${getLanguageName(story.nativeLanguage)} → ${getLanguageName(story.learningLanguage)}`}
                          size="small" variant="outlined"
                        />
                      </Box>
                      <Typography variant="h6" sx={{ fontWeight: 600 }} gutterBottom noWrap>
                        {story.title.lang1}
                      </Typography>
                      <Typography variant="body2" color="text.secondary" noWrap sx={{ fontStyle: 'italic' }}>
                        {story.title.lang2}
                      </Typography>
                      {story.topic && (
                        <Typography variant="caption" color="text.secondary" sx={{ mt: 0.5, display: 'block' }}>
                          {story.topic}
                        </Typography>
                      )}
                    </CardContent>
                    <CardActions sx={{ px: 2, pb: 2 }}>
                      <Typography variant="caption" color="text.secondary" sx={{ flexGrow: 1 }}>
                        {t('stories.by')} {story.authorName} · {t('stories.sentences', { count: story.sentenceCount })}
                      </Typography>
                      <Button size="small" variant="outlined" onClick={() => navigate(`/stories/${story._id}`)}>
                        {t('stories.readStory')}
                      </Button>
                    </CardActions>
                  </Card>
                </Grid>
              ))}
            </Grid>

            {totalPages > 1 && (
              <Box sx={{ display: 'flex', justifyContent: 'center', mt: 4 }}>
                <Pagination count={totalPages} page={page} onChange={handlePageChange} color="primary" />
              </Box>
            )}
          </>
        )}
      </Container>
    </Box>
  );
};

export default StoriesPage;
