import {
  APP_ROLE_VALUES,
  SLAVE_ALLOWED_PAGES,
  isMasterAppRole,
  isSlaveAppRole,
  resolveAppRoleFromEnv,
} from '@shared/appRole.js';

export const appRole = resolveAppRoleFromEnv(import.meta.env);
export const isMasterBuild = isMasterAppRole(appRole);
export const isSlaveBuild = isSlaveAppRole(appRole);

export {
  APP_ROLE_VALUES,
  SLAVE_ALLOWED_PAGES,
  isMasterAppRole,
  isSlaveAppRole,
  resolveAppRoleFromEnv,
};
