import { parseFacebookGraphQL, parseFacebookGraphQLBatch } from './parseFacebookGraphQL.js';

export { parseFacebookGraphQL, parseFacebookGraphQLBatch };

/**
 * @deprecated Use parseFacebookGraphQLBatch — kept for existing imports.
 */
export function cleanFacebookData(rawObjects) {
  return parseFacebookGraphQLBatch(rawObjects);
}
