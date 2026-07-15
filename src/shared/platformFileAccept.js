/**
 * Platform upload rules shown on file steps (info only — Facebook accepts a very wide set).
 * Extend with other platforms later using the same shape.
 */

export const PLATFORM_FILE_RULES = {
  facebook: {
    labelKey: 'scenarioEditor.fileRules.facebook.title',
    linesKeys: [
      'scenarioEditor.fileRules.facebook.line1',
      'scenarioEditor.fileRules.facebook.line2',
      'scenarioEditor.fileRules.facebook.line3',
    ],
  },
  custom: {
    labelKey: 'scenarioEditor.fileRules.custom.title',
    linesKeys: [
      'scenarioEditor.fileRules.custom.line1',
    ],
  },
};

export function getPlatformFileRules(platform = 'custom') {
  const key = String(platform || 'custom').toLowerCase();
  return PLATFORM_FILE_RULES[key] || PLATFORM_FILE_RULES.custom;
}
