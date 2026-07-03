import fs from 'node:fs';
import path from 'node:path';

let loaded = false;

function stripQuotes(value = '') {
  const text = String(value || '').trim();
  if (
    (text.startsWith('"') && text.endsWith('"'))
    || (text.startsWith("'") && text.endsWith("'"))
  ) {
    return text.slice(1, -1);
  }
  return text;
}

export function loadProjectEnv(projectRoot = process.cwd()) {
  if (loaded) return;
  loaded = true;

  const envPath = path.join(projectRoot, '.env');
  if (!fs.existsSync(envPath)) return;

  const content = fs.readFileSync(envPath, 'utf8');
  content.split(/\r?\n/).forEach((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) return;

    const separatorIndex = trimmed.indexOf('=');
    if (separatorIndex <= 0) return;

    const key = trimmed.slice(0, separatorIndex).trim();
    const value = stripQuotes(trimmed.slice(separatorIndex + 1));
    if (!key || Object.prototype.hasOwnProperty.call(process.env, key)) return;
    process.env[key] = value;
  });
}

export function isTruthyEnv(value = '') {
  return ['1', 'true', 'yes', 'on'].includes(String(value || '').trim().toLowerCase());
}

export function isFacebookCrawlRequestDumpEnabled() {
  return isTruthyEnv(process.env.FACEBOOK_CRAWL_DUMP_REQUESTS);
}
