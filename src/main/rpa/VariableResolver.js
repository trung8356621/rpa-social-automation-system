import { resolveSessionStartUrl } from '../browser/BrowserSessionPaths.js';
import { resolveVariableTemplate } from '../../shared/variableTemplate.js';

export { resolveVariableTemplate };

export function resolveScenarioTargetUrl(rawUrl, variableMap) {
  const trimmed = String(rawUrl || '').trim();
  if (!trimmed) return 'about:blank';
  if (trimmed === 'about:blank') return trimmed;

  const resolved = resolveVariableTemplate(trimmed, variableMap);
  if (/\{\{/.test(resolved)) {
    const missing = [...resolved.matchAll(/\{\{\s*([a-zA-Z0-9_.-]+)\s*\}\}/g)].map((match) => match[1]);
    throw new Error(`Chua thay the bien: ${[...new Set(missing)].join(', ')}. Hay dien gia tri trong panel Variables.`);
  }

  const sessionUrl = resolveSessionStartUrl(resolved) || resolved;

  try {
    const parsed = new URL(sessionUrl);
    if (!['http:', 'https:', 'about:'].includes(parsed.protocol)) {
      throw new Error(`URL khong hop le: ${sessionUrl}`);
    }
    return sessionUrl;
  } catch (error) {
    if (error.message.startsWith('Chua thay') || error.message.startsWith('URL khong')) {
      throw error;
    }
    throw new Error(`URL khong hop le: ${sessionUrl}. Kiem tra Target URL hoac bien trong Variables.`);
  }
}
