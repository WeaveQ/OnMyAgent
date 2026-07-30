/**
 * Settings-domain re-export of kernel keymap helpers.
 * Prefer `react-app/kernel/keymap` for cross-domain consumers.
 * Session must not import this path (domain boundary: session↛settings).
 */
export {
  COMPOSER_SCOPED_ACTIONS,
  DEFAULT_KEYMAP_ACTIONS,
  acceleratorToKeyGroups,
  clearPressedCodes,
  detectKeymapPlatform,
  eventToAccelerator,
  formatAcceleratorForDisplay,
  isDoubleCommandPressed,
  isDoubleControlPressed,
  isEditableShortcutTarget,
  matchAccelerator,
  matchChord,
  matchKeymapAction,
  matchSpecialAppSnapshot,
  noteKeyDownCode,
  noteKeyUpCode,
  parseBinding,
  resolveAccelerator,
  resolveDefaultAccelerator,
  shouldIgnoreForTarget,
  type KeymapActionDef,
  type KeymapActionId,
  type KeymapGroupId,
  type KeymapPlatform,
  type NormalizedChord,
} from "../../kernel/keymap";
