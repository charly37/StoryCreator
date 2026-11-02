import React from 'react';
import { FormControl, InputLabel, MenuItem, Select } from '@mui/material';
import { useTranslation } from 'react-i18next';
import { findModelSpec } from '../utils/aiModels';

interface AiEffortSelectProps {
  id: string;
  label: string;
  /** Selection id of the paired model select. */
  modelId?: string;
  /** '' means "provider default" (the parameter is omitted). */
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  minWidth?: number;
}

/**
 * Thinking-level picker for a reasoning model.
 *
 * Renders nothing for classic models (they have no `reasoning_effort`). The
 * "provider default" option comes first and is the initial value, so the app
 * never sends a thinking level the author did not explicitly choose — which is
 * what keeps the cost of the existing models unchanged.
 *
 * Pinned aliases (e.g. `gpt-5-mini-high`) show a single, locked option.
 */
const AiEffortSelect: React.FC<AiEffortSelectProps> = ({
  id,
  label,
  modelId,
  value,
  onChange,
  disabled,
  minWidth = 190,
}) => {
  const { t } = useTranslation();
  const spec = findModelSpec(modelId);
  if (!spec?.reasoning) return null;

  const fixedEffort = spec.pinnedEffort;

  return (
    <FormControl sx={{ minWidth }}>
      <InputLabel id={id}>{label}</InputLabel>
      <Select
        labelId={id}
        label={label}
        value={fixedEffort ?? value}
        onChange={(event) => onChange(String(event.target.value))}
        disabled={disabled === true || !!fixedEffort}
      >
        {fixedEffort ? (
          <MenuItem value={fixedEffort}>{t(`effort.${fixedEffort}`)}</MenuItem>
        ) : (
          [
            <MenuItem key="provider-default" value="">
              {t('effort.providerDefault')}
            </MenuItem>,
            ...spec.efforts.map((effort) => (
              <MenuItem key={effort} value={effort}>
                {t(`effort.${effort}`)}
              </MenuItem>
            )),
          ]
        )}
      </Select>
    </FormControl>
  );
};

export default AiEffortSelect;
