import React from 'react';
import { useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import StoryReader from './StoryReader';
import { AppUser } from '../App';

/**
 * Published-story reader. All reading UI (keyboard navigation, translation
 * toggles, chapter jumps, progress) lives in the shared `StoryReader` so the
 * preview page behaves identically.
 */
const StoryReadPage: React.FC<{ user: AppUser | null }> = ({ user }) => {
  const { id } = useParams<{ id: string }>();
  const { t } = useTranslation();

  if (!id) return null;

  return (
    <StoryReader
      storyId={id}
      backTo="/stories"
      backLabel={t('reader.backToStories')}
      allowClone={Boolean(user?.canCreateStories)}
    />
  );
};

export default StoryReadPage;
