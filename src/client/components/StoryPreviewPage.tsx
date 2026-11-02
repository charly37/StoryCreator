import React from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Button } from '@mui/material';
import RateReviewIcon from '@mui/icons-material/RateReview';
import { useTranslation } from 'react-i18next';
import StoryReader from './StoryReader';
import { AppUser } from '../App';

/**
 * Pre-publish preview for the author. Shares the published-story reader UI via
 * `StoryReader` and only adds the preview-specific actions.
 */
const StoryPreviewPage: React.FC<{ user: AppUser }> = ({ user }) => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { t } = useTranslation();

  if (!id) return null;

  return (
    <StoryReader
      storyId={id}
      backTo="/my-stories"
      backLabel={t('common.myStories')}
      allowClone={Boolean(user.canCreateStories)}
      showDisabledClone
      renderExtraActions={(story) =>
        story.isAIGenerated ? (
          <Button
            variant="outlined"
            startIcon={<RateReviewIcon />}
            onClick={() => navigate(`/review/${story._id}`)}
          >
            {t('preview.goToReview')}
          </Button>
        ) : null
      }
    />
  );
};

export default StoryPreviewPage;
