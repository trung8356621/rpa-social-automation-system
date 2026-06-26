export function formatVariableToken(key) {
  const normalized = String(key || '').trim();
  return normalized ? `{{${normalized}}}` : '';
}

export function insertTextAtCursor(element, currentValue, insertion) {
  const value = currentValue ?? '';
  if (!element) {
    return `${value}${insertion}`;
  }

  const start = element.selectionStart ?? value.length;
  const end = element.selectionEnd ?? start;
  return `${value.slice(0, start)}${insertion}${value.slice(end)}`;
}

export function focusWithCursor(element, position) {
  if (!element) return;
  requestAnimationFrame(() => {
    element.focus();
    element.setSelectionRange(position, position);
  });
}

export function normalizeActionType(actionType) {
  return actionType === 'type' ? 'input' : actionType;
}

export function resolveVariableTemplate(value, variableMap) {
  if (!value) return value;

  const map = variableMap instanceof Map
    ? variableMap
    : new Map((variableMap || []).map((item) => [item.key || item.name, item.value ?? '']));

  return String(value).replace(/\{\{\s*([a-zA-Z0-9_.-]+)\s*\}\}/g, (match, key) => (
    map.has(key) ? map.get(key) : match
  ));
}

export function buildResolvedVariableMap(skeleton = [], profileValues = []) {
  const profileMap = new Map(
    profileValues.map((item) => [item.variable_key || item.key, item.value ?? '']),
  );

  const resolved = new Map();
  for (const item of skeleton) {
    const key = item.key || item.name;
    const profileValue = profileMap.get(key);
    const defaultValue = item.value ?? '';
    resolved.set(
      key,
      (profileValue != null && profileValue !== '') ? profileValue : defaultValue,
    );
  }

  return resolved;
}
