/**
 * Client-facing re-exports of the shared model catalogue.
 *
 * Kept as a thin shim so existing `../utils/aiModels` imports keep working while
 * the real definitions live in `src/shared/aiModels.ts` (also used by the server).
 */
import type { AIModelSpec, ReasoningEffort } from '../../shared/aiModels';
import { modelLabel } from '../../shared/aiModels';

export type AIModel = AIModelSpec;

export {
  AI_MODELS,
  AI_EFFORT_VALUES,
  DEFAULT_AI_MODEL,
  EFFORT_ORDER,
  PREMIUM_MODEL_IDS,
  SELECTABLE_MODELS,
  STAGED_AI_MODELS,
  canChooseEffort,
  effortsFor,
  effortForRequest,
  findModelSpec,
  isEffortSupportedBy,
  isReasoningEffort,
  isSelectableModel,
  modelLabel,
  resolveSelection,
  supportsReasoning,
} from '../../shared/aiModels';

export type { AIModelSpec, ReasoningEffort };

/** Label for a stored model id, optionally including the chosen effort. */
export const getAIModelLabel = (modelId?: string, effort?: string): string =>
  modelLabel(modelId, effort);

