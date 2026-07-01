function normalizeHeaders(headers = {}) {
  const normalized = {};
  Object.entries(headers || {}).forEach(([key, value]) => {
    normalized[String(key).toLowerCase()] = String(value ?? '');
  });
  return normalized;
}

export function buildFilterFromDiscovery(record = {}) {
  const url = String(record.url || '');
  const postData = String(record.postData || '');
  const headers = normalizeHeaders(record.requestHeaders || {});

  const filter = {
    urlIncludes: [],
    postDataIncludes: [],
    requestHeaders: {},
  };

  if (url.includes('facebook.com/api/graphql')) {
    filter.urlIncludes = ['facebook.com/api/graphql'];
  } else if (url) {
    try {
      const parsed = new URL(url);
      filter.urlIncludes = [`${parsed.hostname}${parsed.pathname}`];
    } catch {
      filter.urlIncludes = [url.slice(0, 120)];
    }
  }

  const friendlyName = headers['x-fb-friendly-name'];
  if (friendlyName) {
    filter.requestHeaders['x-fb-friendly-name'] = friendlyName;
    return filter;
  }

  const friendlyMatch = postData.match(/fb_api_req_friendly_name[=:]([^&\s"']+)/i);
  if (friendlyMatch) {
    filter.postDataIncludes = [decodeURIComponent(friendlyMatch[1])];
  }

  return filter;
}

export function formatFilterSummary(filters = {}) {
  const headerEntries = Object.entries(filters.requestHeaders || {});
  if (headerEntries.length) {
    return headerEntries.map(([key, value]) => `${key}: ${value}`).join(', ');
  }
  if (Array.isArray(filters.postDataIncludes) && filters.postDataIncludes.length) {
    return filters.postDataIncludes.join(', ');
  }
  if (Array.isArray(filters.urlIncludes) && filters.urlIncludes.length) {
    return filters.urlIncludes.join(', ');
  }
  return '';
}

export function hasActiveFilters(filters = {}) {
  const headerCount = Object.keys(filters.requestHeaders || {}).length;
  const postCount = Array.isArray(filters.postDataIncludes) ? filters.postDataIncludes.length : 0;
  const urlCount = Array.isArray(filters.urlIncludes) ? filters.urlIncludes.length : 0;
  return headerCount > 0 || postCount > 0 || urlCount > 0;
}
