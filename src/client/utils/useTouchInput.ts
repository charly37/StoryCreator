import { useMediaQuery } from '@mui/material';

/**
 * True when the device reports a coarse (touch) pointer — phones, tablets and
 * touch-screen laptops.
 *
 * This is the ONE allowed use of `useMediaQuery` in this codebase: it detects the
 * *input mode*, not the layout. Layout must stay CSS-only (see docs/design.md),
 * because a narrow desktop window is not a touch device and a landscape tablet is.
 * `any-pointer` (rather than `pointer`) is used so hybrid devices with both a
 * touchscreen and a mouse are treated as touch-capable.
 */
export const useTouchInput = (): boolean => useMediaQuery('(any-pointer: coarse)');

export default useTouchInput;
