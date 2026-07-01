import {
  isMasterAppRole,
  isSlaveAppRole,
  resolveAppRoleFromEnv,
} from '../shared/appRole.js';

export const appRole = resolveAppRoleFromEnv(process.env);
export const isMasterBuild = isMasterAppRole(appRole);
export const isSlaveBuild = isSlaveAppRole(appRole);
