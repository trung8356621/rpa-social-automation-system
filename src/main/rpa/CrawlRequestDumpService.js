import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { parseFacebookPostLink } from '../../shared/facebookCrawlConfig.js';
import { isFacebookCrawlRequestDumpEnabled } from '../config/loadEnv.js';

const ROOT_DIR = 'crawl';
const CAPTURES_DIR = 'captures';
const SESSION_FILE = 'session.json';
const META_FILE = 'meta.json';
const FORCE_GRAPHQL_FILE = 'force_graphql_fetch.json';

export class CrawlRequestDumpService {
  static isEnabled() {
    return isFacebookCrawlRequestDumpEnabled();
  }

  static resolveRoot() {
    return path.join(process.cwd(), 'debug_dumps', ROOT_DIR);
  }

  static resolveFolderId({ targetUrl = '', variables = null, scenarioId = '', executionId = '' } = {}) {
    const parsed = parseFacebookPostLink(targetUrl);
    if (parsed.post_id) return parsed.post_id;

    const map = variables instanceof Map ? variables : null;
    const postId = String(parsed.post_id || map?.get('post_id') || '').trim();
    if (postId) return postId;

    const groupId = String(
      parsed.group_id
      || map?.get('group_id')
      || '',
    ).trim();
    const lastDate = String(map?.get('last_date') || '').trim();

    if (groupId && lastDate) return `group_${groupId}_${lastDate}`;
    if (groupId) return `group_${groupId}`;
    if (scenarioId) return `scenario_${scenarioId}`;
    return `execution_${executionId || 'draft'}`;
  }

  static resolveDumpDir(folderId) {
    const safeId = String(folderId || 'draft').trim() || 'draft';
    return path.join(this.resolveRoot(), safeId);
  }

  static async ensureDumpDir(folderId) {
    const dir = this.resolveDumpDir(folderId);
    await fsp.mkdir(path.join(dir, CAPTURES_DIR), { recursive: true });
    return dir;
  }

  static async writeMeta(folderId, meta = {}) {
    if (!this.isEnabled()) return null;

    const dir = await this.ensureDumpDir(folderId);
    const payload = {
      ...meta,
      folderId,
      updatedAt: new Date().toISOString(),
      dumpPath: dir,
    };
    await fsp.writeFile(path.join(dir, META_FILE), JSON.stringify(payload, null, 2), 'utf8');
    return payload;
  }

  static async appendCapture(folderId, items = [], meta = {}) {
    if (!this.isEnabled() || !folderId) return null;

    const dir = await this.ensureDumpDir(folderId);
    const capturesDir = path.join(dir, CAPTURES_DIR);
    const existing = fs.existsSync(capturesDir)
      ? (await fsp.readdir(capturesDir)).filter((name) => name.endsWith('.json')).length
      : 0;
    const fileName = `${String(existing + 1).padStart(4, '0')}.json`;
    const payload = {
      capturedAt: new Date().toISOString(),
      url: meta?.url || '',
      postData: meta?.postData || '',
      itemCount: Array.isArray(items) ? items.length : 0,
      items: Array.isArray(items) ? items : [],
    };

    await fsp.writeFile(path.join(capturesDir, fileName), JSON.stringify(payload, null, 2), 'utf8');
    return path.join(capturesDir, fileName);
  }

  static async saveForceGraphQLFetch(folderId, debug = {}) {
    if (!this.isEnabled() || !folderId) return null;

    const dir = await this.ensureDumpDir(folderId);
    const payload = {
      capturedAt: new Date().toISOString(),
      ...debug,
    };
    const filePath = path.join(dir, FORCE_GRAPHQL_FILE);
    await fsp.writeFile(filePath, JSON.stringify(payload, null, 2), 'utf8');
    return filePath;
  }

  static mergeRawObjects(previous = [], incoming = []) {
    const items = Array.isArray(incoming) ? incoming : [];
    if (!items.length) return previous || [];

    const seen = new Set((previous || []).map((item) => JSON.stringify(item)));
    const next = [...(previous || [])];

    items.forEach((item) => {
      const key = JSON.stringify(item);
      if (seen.has(key)) return;
      seen.add(key);
      next.push(item);
    });

    return next;
  }

  static async saveSession(folderId, session = {}) {
    if (!this.isEnabled() || !folderId) return null;

    const dir = await this.ensureDumpDir(folderId);
    const payload = {
      folderId,
      updatedAt: new Date().toISOString(),
      targetUrl: session.targetUrl || '',
      actualUrl: session.actualUrl || '',
      executionId: session.executionId || '',
      scenarioId: session.scenarioId || '',
      dom_fallback_post: session.domFallbackPost || null,
      raw_object_count: Array.isArray(session.rawCaptured) ? session.rawCaptured.length : 0,
      rawCaptured: Array.isArray(session.rawCaptured) ? session.rawCaptured : [],
    };

    await fsp.writeFile(path.join(dir, SESSION_FILE), JSON.stringify(payload, null, 2), 'utf8');
    return {
      dumpPath: dir,
      sessionPath: path.join(dir, SESSION_FILE),
      raw_object_count: payload.raw_object_count,
    };
  }
}
