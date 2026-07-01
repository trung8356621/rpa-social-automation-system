export function resolveVariableTemplate(value, variableMap) {
  if (!value) return value;

  const map = variableMap instanceof Map
    ? variableMap
    : new Map((variableMap || []).map((item) => [item.key || item.name, item.value ?? '']));

  return String(value).replace(/\{\{\s*([a-zA-Z0-9_.-]+)\s*\}\}/g, (match, key) => (
    map.has(key) ? map.get(key) : match
  ));
}
