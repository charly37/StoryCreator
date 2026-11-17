import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Box, Container, Typography, Paper, Button, Chip, CircularProgress,
  Alert, LinearProgress, IconButton, Tooltip, Divider, Menu, MenuItem,
  ToggleButton, ToggleButtonGroup,
} from '@mui/material';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import ArrowBackIosNewIcon from '@mui/icons-material/ArrowBackIosNew';
import ArrowForwardIosIcon from '@mui/icons-material/ArrowForwardIos';
import VisibilityIcon from '@mui/icons-material/Visibility';
import VisibilityOffIcon from '@mui/icons-material/VisibilityOff';
import AutoStoriesIcon from '@mui/icons-material/AutoStories';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import KeyboardIcon from '@mui/icons-material/Keyboard';
import SwipeIcon from '@mui/icons-material/Swipe';
import TouchAppIcon from '@mui/icons-material/TouchApp';
import DownloadIcon from '@mui/icons-material/Download';
import VolumeUpIcon from '@mui/icons-material/VolumeUp';
import { useTranslation } from 'react-i18next';
import { getLanguageName } from '../utils/languages';
import { getAIModelLabel } from '../utils/aiModels';
import { formatSeedPreview } from '../utils/seedPreview';
import { formatRelativeDate } from '../utils/relativeDate';
import { cloneStory } from '../utils/cloneStory';
import { getChapterContext, getChapterStartIndex, getStoryPercent } from '../utils/readingProgress';
import { useTouchInput } from '../utils/useTouchInput';
import {
  downloadName,
  fetchStoryAudio,
  formatDuration,
  formatSize,
  pickDefaultVariant,
  StoryAudioVariant,
  TtsVariant,
} from '../utils/storyAudio';
import {
  fetchTtsRequests,
  summarizeStoryAudio,
  TtsRequestStatus,
} from '../utils/ttsRequests';

export interface Sentence {
  lang1: string;
  lang2: string;
}

export interface Chapter {
  title?: { lang1: string; lang2: string };
  seed: string;
  sentences: Sentence[];
}

export interface StoryReaderStory {
  _id: string;
  title: { lang1: string; lang2: string };
  chapters: Chapter[];
  nativeLanguage: string;
  learningLanguage: string;
  level: 'beginner' | 'intermediate' | 'advanced';
  labels?: string[];
  topic?: string;
  authorName: string;
  creationSource?: 'ui' | 'api';
  createdViaApiKeyName?: string;
  aiModel?: string;
  aiReasoningEffort?: string;
  isAIGenerated: boolean;
  seed: string;
  aiCallCount: number;
  updatedAt: string;
  sentenceCount: number;
}

interface FlatSentence extends Sentence {
  chapterIndex: number;
  isFirstInChapter: boolean;
  chapterTitle?: { lang1: string; lang2: string };
}

export interface StoryReaderProps {
  storyId: string;
  /** Route to return to when leaving the reader (and from the error state). */
  backTo: string;
  /** Translated label for the back button. */
  backLabel: string;
  /** Enables the Clone action (creator access). */
  allowClone: boolean;
  /** Render the Clone button disabled with a creator-access tooltip instead of hiding it. */
  showDisabledClone?: boolean;
  /** Extra toolbar actions; called with the loaded story (e.g. the review button). */
  renderExtraActions?: (story: StoryReaderStory) => React.ReactNode;
}

const LEVEL_COLOR: Record<string, 'success' | 'warning' | 'error'> = {
  beginner: 'success',
  intermediate: 'warning',
  advanced: 'error',
};

/** In-flight touch gesture on the sentence card, captured on pointerdown. */
interface SwipeGesture {
  pointerId: number;
  x: number;
  y: number;
  lastX: number;
  lastY: number;
  time: number;
}

const Kbd: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <Box
    component="kbd"
    sx={{
      border: '1px solid',
      borderColor: 'divider',
      borderRadius: 1,
      px: 0.5,
      py: 0.25,
      fontFamily: 'monospace',
      fontSize: '0.75rem',
      lineHeight: 1.4,
      bgcolor: 'action.hover',
    }}
  >
    {children}
  </Box>
);

/**
 * Shared bilingual reader used by both the published-story page (`/stories/:id`)
 * and the pre-publish preview (`/preview/:id`). Both routes must expose the same
 * reading experience: keyboard navigation, translation toggles, chapter jumps
 * and progress indicators.
 */
const StoryReader: React.FC<StoryReaderProps> = ({
  storyId,
  backTo,
  backLabel,
  allowClone,
  showDisabledClone = false,
  renderExtraActions,
}) => {
  const navigate = useNavigate();
  const { t, i18n } = useTranslation();
  // Touch devices get swipe navigation and tap-to-translate instead of keyboard hints.
  const isTouch = useTouchInput();
  const gestureRef = useRef<SwipeGesture | null>(null);

  const [story, setStory] = useState<StoryReaderStory | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [currentIndex, setCurrentIndex] = useState(0);
  // tracks which sentences have their translation revealed
  const [revealed, setRevealed] = useState<Set<number>>(new Set());
  const [cloning, setCloning] = useState(false);
  const [actionError, setActionError] = useState('');
  const [chapterMenuAnchor, setChapterMenuAnchor] = useState<HTMLElement | null>(null);
  // Narrated audio is served separately from the story payload.
  const [audioVariants, setAudioVariants] = useState<StoryAudioVariant[]>([]);
  const [audioVariant, setAudioVariant] = useState<TtsVariant | null>(null);
  const [audioStatus, setAudioStatus] = useState<TtsRequestStatus | null>(null);

  useEffect(() => {
    if (!storyId) return;
    setLoading(true);
    setError('');
    fetch(`/api/stories/${storyId}`)
      .then((res) => {
        if (res.status === 404 || res.status === 403) throw new Error('not-found');
        if (!res.ok) throw new Error('error');
        return res.json();
      })
      .then((data) => setStory(data))
      .catch((err) => setError(err.message === 'not-found' ? 'not-found' : 'error'))
      .finally(() => setLoading(false));
  }, [storyId]);

  const loadAudio = useCallback(async () => {
    if (!storyId) return;
    const [audio, requests] = await Promise.all([
      fetchStoryAudio(storyId),
      fetchTtsRequests([storyId]),
    ]);
    setAudioStatus(summarizeStoryAudio(requests.data));
    if (audio.ok && audio.variants.length > 0) {
      setAudioVariants(audio.variants);
      setAudioVariant((current) =>
        current && audio.variants.some((item) => item.variant === current)
          ? current
          : pickDefaultVariant(audio.variants)
      );
    }
  }, [storyId]);

  useEffect(() => {
    void loadAudio();
  }, [loadAudio]);

  // Poll only while a request is still in flight, so the player appears shortly after
  // the worker finishes. Same 5s cadence as the review and wizard pages.
  useEffect(() => {
    if (audioVariants.length > 0) return;
    if (audioStatus !== 'queued' && audioStatus !== 'processing') return;
    const interval = setInterval(() => {
      void loadAudio();
    }, 5000);
    return () => clearInterval(interval);
  }, [audioVariants.length, audioStatus, loadAudio]);

  // Derived values must be computed before the early returns below so that every
  // hook is called in the same order on each render.
  const storyLabels = Array.isArray(story?.labels)
    ? story.labels
    : typeof story?.topic === 'string' && story.topic.trim() !== ''
      ? [story.topic.trim()]
      : [];

  // Flatten chapters into a single navigable list
  const flatSentences: FlatSentence[] = (story?.chapters ?? []).flatMap((chapter, ci) =>
    (chapter.sentences ?? []).map((s, si) => ({
      chapterIndex: ci,
      lang1: s.lang1,
      lang2: s.lang2,
      isFirstInChapter: si === 0,
      chapterTitle: chapter.title,
    }))
  );

  const total = flatSentences.length;
  const sentence = flatSentences[currentIndex];
  const isRevealed = revealed.has(currentIndex);
  const allRevealed = total > 0 && revealed.size === total;
  // Story-level progress (chapter counter + % of the whole story)
  const progressPercent = getStoryPercent(currentIndex, total);
  const chapterContext = getChapterContext(flatSentences, currentIndex, story?.chapters.length ?? 0);
  // Chapter heading: learning-language title, with the native title revealed on demand
  const chapterTitleLang2 = sentence?.chapterTitle?.lang2?.trim() ?? '';
  const chapterTitleLang1 = sentence?.chapterTitle?.lang1?.trim() ?? '';
  const chapterHeadingTitle = chapterTitleLang2 || chapterTitleLang1;
  const chapterHeadingTranslation =
    chapterTitleLang1 && chapterTitleLang1 !== chapterHeadingTitle ? chapterTitleLang1 : '';

  // Playback state: the selector swaps the element's src, so only the active render
  // and its URL are needed.
  const activeAudio = audioVariants.find((item) => item.variant === audioVariant) ?? null;
  const audioSrc = activeAudio?.url ?? '';
  const audioVariantLabel = (variant: TtsVariant) =>
    variant === 'bilingual'
      ? t('reader.audio.bilingual')
      : getLanguageName(
          variant === 'lang1'
            ? (story?.nativeLanguage ?? '')
            : (story?.learningLanguage ?? '')
        );

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
      setRevealed(new Set(flatSentences.map((_, i) => i)));
    }
  };

  const handleClone = async () => {
    if (!story) return;
    setCloning(true);
    setActionError('');
    const result = await cloneStory(story._id);
    setCloning(false);
    if (!result.ok || !result.id) {
      setActionError(
        result.code === 'CREATOR_ACCESS_REQUIRED'
          ? t('editor.noCreatorAccessError')
          : result.message || t('common.cloneError')
      );
      return;
    }
    navigate(`/editor/${result.id}`);
  };

  // Keyboard shortcuts: ← / → move between sentences, ↑ / ↓ hide / reveal the translation.
  // Works globally, so readers never have to click before using the keyboard.
  useEffect(() => {
    const ARROW_KEYS = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'];

    const handleKeyDown = (event: KeyboardEvent) => {
      // Let browser shortcuts (Ctrl/⌘ + arrows) through
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      // While the chapter menu is open, arrow keys belong to the menu
      if (chapterMenuAnchor) return;

      const target = event.target as HTMLElement | null;
      if (
        target &&
        (target.isContentEditable ||
          // AUDIO keeps its own arrow-key handling (seeking) when focused.
          ['INPUT', 'TEXTAREA', 'SELECT', 'AUDIO'].includes(target.tagName))
      ) {
        return;
      }

      if (!ARROW_KEYS.includes(event.key)) return;
      // Stop arrow keys from scrolling the page
      event.preventDefault();
      if (total === 0) return;

      switch (event.key) {
        case 'ArrowLeft':
          setCurrentIndex((i) => Math.max(0, i - 1));
          break;
        case 'ArrowRight':
          setCurrentIndex((i) => Math.min(total - 1, i + 1));
          break;
        case 'ArrowUp':
          setRevealed((prev) => {
            if (!prev.has(currentIndex)) return prev;
            const next = new Set(prev);
            next.delete(currentIndex);
            return next;
          });
          break;
        case 'ArrowDown':
          setRevealed((prev) => {
            if (prev.has(currentIndex)) return prev;
            const next = new Set(prev);
            next.add(currentIndex);
            return next;
          });
          break;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [currentIndex, total, chapterMenuAnchor]);

  // Touch gestures on the sentence card: swipe left / right moves one sentence,
  // a tap toggles the translation. Mouse input is ignored so desktop behaviour and
  // text selection are unchanged; no preventDefault is used, so vertical page
  // scrolling, pinch-zoom and long-press selection keep working natively.
  const handleGestureStart = (event: React.PointerEvent<HTMLElement>) => {
    if (!isTouch || !event.isPrimary || event.pointerType === 'mouse') return;
    // Leave the screen edges to the OS: Android's back gesture and iOS' edge-swipe-back
    // would otherwise hijack "swipe right to go back one sentence".
    const EDGE_GUARD_PX = 24;
    if (event.clientX <= EDGE_GUARD_PX || event.clientX >= window.innerWidth - EDGE_GUARD_PX) return;
    const target = event.target as HTMLElement | null;
    // Let taps on in-card controls (e.g. the translation eye) behave normally. Native
    // audio controls and sliders have their own gesture handling.
    if (target?.closest('button, a, input, textarea, select, [role="button"], audio, [role="slider"]')) return;
    gestureRef.current = {
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      lastX: event.clientX,
      lastY: event.clientY,
      time: Date.now(),
    };
  };

  useEffect(() => {
    const SWIPE_MIN_PX = 50;
    const TAP_MAX_PX = 10;
    const SWIPE_MAX_MS = 800;
    const TAP_MAX_MS = 400;

    const finishGesture = (endX: number, endY: number, allowTap: boolean) => {
      const gesture = gestureRef.current;
      gestureRef.current = null;
      if (!gesture) return;

      const dx = endX - gesture.x;
      const dy = endY - gesture.y;
      const elapsed = Date.now() - gesture.time;
      const absX = Math.abs(dx);
      const absY = Math.abs(dy);

      // Horizontal swipe: dominant horizontal movement over a minimum distance.
      if (absX >= SWIPE_MIN_PX && absX > absY * 1.5 && elapsed < SWIPE_MAX_MS) {
        if (total === 0) return;
        if (dx < 0) setCurrentIndex((i) => Math.min(total - 1, i + 1));
        else setCurrentIndex((i) => Math.max(0, i - 1));
        return;
      }

      // Tap: barely any movement, short duration -> toggle the current translation.
      if (allowTap && absX <= TAP_MAX_PX && absY <= TAP_MAX_PX && elapsed < TAP_MAX_MS) {
        setRevealed((prev) => {
          const next = new Set(prev);
          next.has(currentIndex) ? next.delete(currentIndex) : next.add(currentIndex);
          return next;
        });
      }
    };

    const handlePointerMove = (event: PointerEvent) => {
      const gesture = gestureRef.current;
      if (gesture && event.pointerId === gesture.pointerId) {
        gesture.lastX = event.clientX;
        gesture.lastY = event.clientY;
      }
    };

    const handlePointerUp = (event: PointerEvent) => {
      if (gestureRef.current && event.pointerId === gestureRef.current.pointerId) {
        finishGesture(event.clientX, event.clientY, true);
      }
    };

    // Browsers that still claim the touch (e.g. a horizontal drag turned into a pan)
    // fire pointercancel instead of pointerup; use the last known position so the
    // swipe still registers. Taps are not inferred from a cancelled gesture.
    const handlePointerCancel = (event: PointerEvent) => {
      const gesture = gestureRef.current;
      if (gesture && event.pointerId === gesture.pointerId) {
        finishGesture(gesture.lastX, gesture.lastY, false);
      }
    };

    // Listen on the window so the gesture resolves even when the finger lifts outside the card.
    window.addEventListener('pointermove', handlePointerMove, { passive: true });
    window.addEventListener('pointerup', handlePointerUp);
    window.addEventListener('pointercancel', handlePointerCancel);
    return () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
      window.removeEventListener('pointercancel', handlePointerCancel);
    };
  }, [currentIndex, total]);

  if (loading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '100vh' }}>
        <CircularProgress />
      </Box>
    );
  }

  if (error) {
    return (
      <Box sx={{ pt: { xs: 9, sm: 12 }, pb: 6 }}>
        <Container maxWidth="md">
          <Button startIcon={<ArrowBackIcon />} onClick={() => navigate(backTo)} sx={{ mb: 2 }}>
            {backLabel}
          </Button>
          <Alert severity={error === 'not-found' ? 'info' : 'error'}>
            {t(error === 'not-found' ? 'reader.notFoundMessage' : 'reader.notFound')}
          </Alert>
        </Container>
      </Box>
    );
  }

  if (!story) return null;

  return (
    <Box sx={{ pt: 10, pb: 6, bgcolor: 'background.default', minHeight: '100vh' }}>
      <Container maxWidth="md">
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 1, mb: 3 }}>
          <Button startIcon={<ArrowBackIcon />} onClick={() => navigate(backTo)}>
            {backLabel}
          </Button>
          <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', flexWrap: 'wrap' }}>
            {renderExtraActions?.(story)}
            {(allowClone || showDisabledClone) && (
              <Tooltip title={allowClone ? '' : t('creatorAccess.tooltip')}>
                <span>
                  <Button
                    variant="outlined"
                    startIcon={<ContentCopyIcon />}
                    onClick={handleClone}
                    disabled={!allowClone || cloning}
                  >
                    {t('common.clone')}
                  </Button>
                </span>
              </Tooltip>
            )}
          </Box>
        </Box>

        {actionError && (
          <Alert severity="error" sx={{ mb: 2 }} onClose={() => setActionError('')}>{actionError}</Alert>
        )}

        {/* Story header */}
        <Paper elevation={2} sx={{ p: { xs: 2, sm: 3 }, mb: 3, borderLeft: '4px solid', borderColor: 'primary.main' }}>
          <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 2 }}>
            <AutoStoriesIcon sx={{ fontSize: 40, color: 'primary.main', mt: 0.5, flexShrink: 0 }} />
            <Box sx={{ flexGrow: 1 }}>
              <Box sx={{ display: 'flex', gap: 1, mb: 1, flexWrap: 'wrap' }}>
                <Chip label={t(`levels.${story.level}`)} color={LEVEL_COLOR[story.level] ?? 'default'} size="small" />
                <Chip
                  label={`${getLanguageName(story.nativeLanguage)} → ${getLanguageName(story.learningLanguage)}`}
                  size="small" variant="outlined"
                />
                {storyLabels.map((label) => (
                  <Chip key={label} label={label} size="small" variant="outlined" />
                ))}
                <Chip
                  label={
                    story.isAIGenerated
                      ? t('stories.aiModelTag', { model: getAIModelLabel(story.aiModel, story.aiReasoningEffort) })
                      : t('stories.manualTag')
                  }
                  size="small"
                  color={story.isAIGenerated ? 'info' : 'default'}
                  variant="outlined"
                />
                {story.creationSource === 'api' && story.createdViaApiKeyName && (
                  <Chip
                    label={t('stories.apiSourceTag', { keyName: story.createdViaApiKeyName })}
                    size="small"
                    color="secondary"
                    variant="outlined"
                  />
                )}
              </Box>
              <Typography variant="h5" sx={{ fontWeight: 700 }}>{story.title.lang1}</Typography>
              <Typography
                variant="body2"
                color="text.secondary"
                sx={{
                  mt: 0.5, mb: 0.5,
                  display: '-webkit-box',
                  WebkitLineClamp: 2,
                  WebkitBoxOrient: 'vertical',
                  overflow: 'hidden',
                }}
              >
                {formatSeedPreview(story.seed) || t('stories.seedUnavailable')}
              </Typography>
              <Typography variant="caption" color="text.secondary">
                {t('stories.by')} {story.authorName} · {t('stories.sentences', { count: total })} · {t('stories.updatedAgo', { when: formatRelativeDate(story.updatedAt, i18n.language) })}{((story.aiCallCount ?? 0) > 0 || story.isAIGenerated) ? ` · ${t('stories.aiCalls', { count: Math.max(story.aiCallCount ?? 0, story.isAIGenerated ? 1 : 0) })}` : ''}
              </Typography>
            </Box>
          </Box>
        </Paper>

        {/* Progress bar */}
        <Box sx={{ mb: 2 }}>
          <Box sx={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 1, mb: 0.5 }}>
            {total > 0 ? (
              <Button
                size="small"
                variant="text"
                onClick={(event) => setChapterMenuAnchor(event.currentTarget)}
                endIcon={<ExpandMoreIcon sx={{ fontSize: 16 }} />}
                aria-label={t('reader.jumpToChapter')}
                aria-haspopup="true"
                aria-expanded={Boolean(chapterMenuAnchor)}
                sx={{
                  px: 0.5,
                  py: 0,
                  minWidth: 0,
                  fontSize: '0.75rem',
                  lineHeight: 1.6,
                  color: 'text.secondary',
                  textTransform: 'none',
                }}
              >
                {t('reader.progress', {
                  chapter: chapterContext.chapterNumber,
                  chapters: chapterContext.chapterCount,
                  percent: progressPercent,
                })}
              </Button>
            ) : (
              <Box />
            )}
            <Button size="small" onClick={toggleAll} startIcon={allRevealed ? <VisibilityOffIcon /> : <VisibilityIcon />}>
              {allRevealed ? t('reader.hideAll') : t('reader.showAll')}
            </Button>
          </Box>
          <LinearProgress variant="determinate" value={progressPercent} sx={{ borderRadius: 2 }} />
          <Menu
            anchorEl={chapterMenuAnchor}
            open={Boolean(chapterMenuAnchor)}
            onClose={() => setChapterMenuAnchor(null)}
            slotProps={{ list: { dense: true, sx: { maxHeight: 320, minWidth: 220 } } }}
          >
            {story.chapters.map((chapter, ci) => {
              const startIndex = getChapterStartIndex(flatSentences, ci);
              const menuChapterTitle =
                chapter.title?.lang2?.trim() || chapter.title?.lang1?.trim() || '';
              const isCurrentChapter = ci + 1 === chapterContext.chapterNumber;
              return (
                <MenuItem
                  key={ci}
                  selected={isCurrentChapter}
                  disabled={startIndex < 0}
                  sx={{ fontWeight: isCurrentChapter ? 700 : 400 }}
                  onClick={() => {
                    if (startIndex >= 0) setCurrentIndex(startIndex);
                    setChapterMenuAnchor(null);
                  }}
                >
                  {t('reader.chapterN', { n: ci + 1 })}
                  {menuChapterTitle ? ` — ${menuChapterTitle}` : ''}
                </MenuItem>
              );
            })}
          </Menu>
        </Box>

        {/* Audio player — native controls plus a download, mirroring the podcast page */}
        {activeAudio && audioVariant && (
          <Paper elevation={2} sx={{ p: { xs: 2, sm: 3 }, mb: 2 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap', mb: 2 }}>
              <VolumeUpIcon sx={{ color: 'primary.main' }} />
              <Typography variant="subtitle1" sx={{ fontWeight: 600, mr: 'auto' }}>
                {t('reader.audio.title')}
              </Typography>
              {activeAudio.durationMs > 0 && (
                <Chip label={formatDuration(activeAudio.durationMs)} size="small" variant="outlined" />
              )}
              {activeAudio.sizeBytes > 0 && (
                <Chip label={formatSize(activeAudio.sizeBytes)} size="small" variant="outlined" />
              )}
            </Box>

            {audioVariants.length > 1 && (
              <ToggleButtonGroup
                size="small"
                exclusive
                value={audioVariant}
                onChange={(_event, next: TtsVariant | null) => {
                  if (next) setAudioVariant(next);
                }}
                sx={{ mb: 2, flexWrap: 'wrap' }}
                aria-label={t('reader.audio.title')}
              >
                {audioVariants.map((option) => (
                  <ToggleButton
                    key={option.variant}
                    value={option.variant}
                    sx={{ px: 1.5, textTransform: 'none' }}
                  >
                    {audioVariantLabel(option.variant)}
                  </ToggleButton>
                ))}
              </ToggleButtonGroup>
            )}

            {/* key: a new variant starts a fresh element, so playback restarts at 0 */}
            <audio
              key={audioSrc}
              controls
              preload="metadata"
              src={audioSrc}
              aria-label={t('reader.audio.title')}
              style={{ width: '100%' }}
            >
              {t('reader.audio.unsupported')}
            </audio>

            <Box sx={{ mt: 2, display: 'flex', gap: 1, flexWrap: 'wrap' }}>
              <Button
                variant="contained"
                color="secondary"
                size="small"
                startIcon={<DownloadIcon />}
                component="a"
                href={audioSrc}
                download={downloadName(
                  story.title?.lang1 || story.title?.lang2 || '',
                  audioVariant,
                  story._id
                )}
              >
                {t('reader.audio.download')}
              </Button>
            </Box>
          </Paper>
        )}

        {/* No audio yet: show progress for the author's pending request only */}
        {!activeAudio && audioStatus && audioStatus !== 'done' && (
          <Box sx={{ mb: 2 }}>
            <Chip
              icon={<VolumeUpIcon fontSize="small" />}
              label={t(`audio.status.${audioStatus}`)}
              size="small"
              color={audioStatus === 'failed' ? 'error' : 'info'}
              variant="outlined"
            />
          </Box>
        )}

        {/* Sentence card */}
        {total > 0 && sentence && (
          <Paper
            elevation={2}
            onPointerDown={handleGestureStart}
            sx={{
              p: 3,
              mb: 2,
              minHeight: 140,
              // Claim horizontal drags for the swipe handler while leaving vertical
              // panning and pinch-zoom to the browser (without this the browser pan
              // cancels the pointer sequence and swipes are never seen).
              touchAction: 'pan-y pinch-zoom',
            }}
          >
            {/* Chapter heading shown at the first sentence of each chapter */}
            {sentence.isFirstInChapter && (
              <>
                <Typography variant="overline" color="primary" sx={{ display: 'block', fontWeight: 700, lineHeight: 1.6 }}>
                  {t('reader.chapterN', { n: sentence.chapterIndex + 1 })}
                </Typography>
                {chapterHeadingTitle && (
                  <Typography variant="h6" sx={{ fontWeight: 700, lineHeight: 1.4 }}>
                    {chapterHeadingTitle}
                  </Typography>
                )}
                {isRevealed && chapterHeadingTranslation && (
                  <Typography variant="body2" color="text.secondary" sx={{ fontStyle: 'italic', mt: 0.5 }}>
                    {chapterHeadingTranslation}
                  </Typography>
                )}
                <Divider sx={{ mt: 1, mb: 2 }} />
              </>
            )}
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
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 1 }}>
          <Button
            startIcon={<ArrowBackIosNewIcon />}
            onClick={() => setCurrentIndex((i) => Math.max(0, i - 1))}
            disabled={currentIndex === 0}
            sx={{ flexShrink: 0, px: { xs: 1, sm: 2 } }}
          >
            {t('reader.previous')}
          </Button>
          <Typography
            variant="body2"
            color="text.secondary"
            sx={{ flex: 1, minWidth: 0, textAlign: 'center', lineHeight: 1.3 }}
          >
            {total > 0
              ? t('reader.chapterSentence', {
                  current: chapterContext.chapterSentence,
                  total: chapterContext.chapterSentenceCount,
                })
              : ''}
          </Typography>
          <Button
            endIcon={<ArrowForwardIosIcon />}
            onClick={() => setCurrentIndex((i) => Math.min(total - 1, i + 1))}
            disabled={total === 0 || currentIndex >= total - 1}
            sx={{ flexShrink: 0, px: { xs: 1, sm: 2 } }}
          >
            {t('reader.next')}
          </Button>
        </Box>

        {/* Input hint — gestures on touch devices, keyboard shortcuts otherwise */}
        <Box
          sx={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexWrap: 'wrap',
            gap: 1.5,
            mt: 2,
            color: 'text.secondary',
          }}
        >
          {isTouch ? (
            <>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                <SwipeIcon sx={{ fontSize: 18 }} />
                <Typography variant="caption">{t('reader.swipeSentenceNav')}</Typography>
              </Box>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                <TouchAppIcon sx={{ fontSize: 18 }} />
                <Typography variant="caption">{t('reader.tapTranslation')}</Typography>
              </Box>
            </>
          ) : (
            <>
              <KeyboardIcon sx={{ fontSize: 18 }} />
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                <Kbd>←</Kbd>
                <Kbd>→</Kbd>
                <Typography variant="caption">{t('reader.kbSentenceNav')}</Typography>
              </Box>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                <Kbd>↑</Kbd>
                <Kbd>↓</Kbd>
                <Typography variant="caption">{t('reader.kbTranslation')}</Typography>
              </Box>
            </>
          )}
        </Box>
      </Container>
    </Box>
  );
};

export default StoryReader;
