export const APP_ROLE_VALUES = Object.freeze({
  MASTER: 'master',
  SLAVE: 'slave',
});

export const SLAVE_ALLOWED_PAGES = Object.freeze([
  'scenarios',
  'executions',
  'browserProfiles',
  'settings',
]);

export function normalizeAppRole(value) {
  const normalized = String(value || '').trim().toLowerCase();
  return normalized === APP_ROLE_VALUES.SLAVE
    ? APP_ROLE_VALUES.SLAVE
    : APP_ROLE_VALUES.MASTER;
}

export function resolveAppRoleFromEnv(env = {}) {
  return normalizeAppRole(env.VITE_APP_ROLE || env.APP_ROLE);
}

export function isMasterAppRole(role) {
  return role === APP_ROLE_VALUES.MASTER;
}

export function isSlaveAppRole(role) {
  return role === APP_ROLE_VALUES.SLAVE;
}
