/**
 * Catalogue invariants for `src/shared/aiModels.ts`.
 *
 * Run with `npm run check:models`. These assertions exist to protect the cost
 * policy: the cheap model must stay the default, and no premium entry may become
 * reachable without an explicit user choice.
 */
import {
  AI_MODELS,
  DEFAULT_AI_MODEL,
  EFFORT_ORDER,
  PREMIUM_MODEL_IDS,
  resolveSelection,
} from '../src/shared/aiModels';

const failures: string[] = [];

const expect = (condition: boolean, message: string): void => {
  if (!condition) failures.push(message);
};

// --- default model policy -------------------------------------------------
expect(
  AI_MODELS.some((model) => model.id === DEFAULT_AI_MODEL),
  `DEFAULT_AI_MODEL "${DEFAULT_AI_MODEL}" is not in the catalogue`
);
expect(
  !PREMIUM_MODEL_IDS.has(DEFAULT_AI_MODEL),
  `DEFAULT_AI_MODEL "${DEFAULT_AI_MODEL}" must not be a premium (opt-in) model`
);
expect(
  !AI_MODELS[0]?.premium,
  `the first catalogue entry ("${AI_MODELS[0]?.id}") must not be premium — it would look like the default`
);

// --- structural invariants ------------------------------------------------
const ids = AI_MODELS.map((model) => model.id);
expect(new Set(ids).size === ids.length, `duplicate model ids: ${ids.join(', ')}`);

for (const model of AI_MODELS) {
  if (model.reasoning) {
    expect(model.efforts.length > 0, `${model.id} is reasoning but declares no efforts`);
  } else {
    expect(model.efforts.length === 0, `${model.id} is not reasoning but declares efforts`);
  }
  for (const effort of model.efforts) {
    expect(
      (EFFORT_ORDER as readonly string[]).includes(effort),
      `${model.id} declares unknown effort "${effort}"`
    );
  }
  if (model.pinnedEffort) {
    expect(
      model.efforts.includes(model.pinnedEffort),
      `${model.id} pins effort "${model.pinnedEffort}" which it does not declare`
    );
  }
  expect(
    model.pinnedEffort === undefined || model.reasoning,
    `${model.id} pins an effort but is not a reasoning model`
  );
}

// --- resolution behaviour -------------------------------------------------
const pinned = resolveSelection('gpt-5-mini-high');
expect(pinned.apiModel === 'gpt-5-mini', 'gpt-5-mini-high must resolve to the gpt-5-mini API model');
expect(pinned.effort === 'high', 'gpt-5-mini-high must pin reasoning_effort to high');

const unset = resolveSelection('gpt-5-mini');
expect(unset.effort === undefined, 'gpt-5-mini with no effort must omit reasoning_effort');

const classic = resolveSelection('gpt-4o-mini', 'high');
expect(
  classic.effort === undefined,
  'a classic model must never receive a reasoning_effort, even when one is requested'
);

const supported = resolveSelection('gpt-5.4-mini', 'high');
expect(supported.effort === 'high', 'gpt-5.4-mini must accept high');

const unsupported = resolveSelection('gpt-5.4-mini', 'minimal');
expect(
  unsupported.effort === undefined,
  'an unsupported effort must be dropped, never clamped to a different tier'
);

const unknown = resolveSelection('not-a-model', 'high');
expect(
  unknown.spec.id === DEFAULT_AI_MODEL,
  'an unknown model id must fall back to the cheap default, not to a premium model'
);

// --- report --------------------------------------------------------------
if (failures.length > 0) {
  console.error(`AI model catalogue check FAILED (${failures.length}):`);
  for (const failure of failures) console.error(`  - ${failure}`);
  process.exit(1);
}

console.log(`AI model catalogue OK — ${AI_MODELS.length} entries, default ${DEFAULT_AI_MODEL}.`);
