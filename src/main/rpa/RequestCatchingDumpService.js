import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';

const SESSION_FILE = 'session.json';
const RESPONSES_DIR = 'responses';

function emptySession(scenarioId) {
  return {
    scenarioId: scenarioId || 'draft',
    updatedAt: new Date().toISOString(),
    crawledData: [],
    discovered: [],
  };
}

export class RequestCatchingDumpService {
  static resolveRoot() {
    return path.join(process.cwd(), 'debug_dumps');
  }

  static resolveScenarioDir(scenarioId) {
    const safeId = String(scenarioId || 'draft').trim() || 'draft';
    return path.join(this.resolveRoot(), safeId);
  }

  static resolveSessionPath(scenarioId) {
    return path.join(this.resolveScenarioDir(scenarioId), SESSION_FILE);
  }

  static async ensureScenarioDir(scenarioId) {
    const dir = this.resolveScenarioDir(scenarioId);
    await fsp.mkdir(dir, { recursive: true });
    await fsp.mkdir(path.join(dir, RESPONSES_DIR), { recursive: true });
    return dir;
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

  static mergeDiscovered(previous = [], incoming = null) {
    const record = incoming && typeof incoming === 'object' ? incoming : null;
    if (!record?.id) return previous || [];

    const next = [record, ...(previous || []).filter((item) => item.id !== record.id)];
    return next.slice(0, 120);
  }

  static syncCrawledDataFromDiscovered(session = {}) {
    let crawledData = Array.isArray(session.crawledData) ? [...session.crawledData] : [];
    for (const record of session.discovered || []) {
      if (Array.isArray(record?.items) && record.items.length) {
        crawledData = this.mergeRawObjects(crawledData, record.items);
      }
    }
    return crawledData;
  }

  static async loadSession(scenarioId) {
    const sessionPath = this.resolveSessionPath(scenarioId);
    let session = emptySession(scenarioId);

    try {
      if (fs.existsSync(sessionPath)) {
        const raw = await fsp.readFile(sessionPath, 'utf8');
        const parsed = JSON.parse(raw);
        session = {
          ...emptySession(scenarioId),
          ...parsed,
          crawledData: Array.isArray(parsed?.crawledData) ? parsed.crawledData : [],
          discovered: Array.isArray(parsed?.discovered) ? parsed.discovered : [],
        };
      }
    } catch {
      session = emptySession(scenarioId);
    }

    const responsesDir = path.join(this.resolveScenarioDir(scenarioId), RESPONSES_DIR);
    if (fs.existsSync(responsesDir)) {
      const files = (await fsp.readdir(responsesDir))
        .filter((name) => name.endsWith('.json'))
        .sort();

      for (const fileName of files) {
        try {
          const raw = await fsp.readFile(path.join(responsesDir, fileName), 'utf8');
          const parsed = JSON.parse(raw);
          if (Array.isArray(parsed)) {
            session.crawledData = this.mergeRawObjects(session.crawledData, parsed);
          } else if (Array.isArray(parsed?.items)) {
            session.crawledData = this.mergeRawObjects(session.crawledData, parsed.items);
          } else if (parsed && typeof parsed === 'object') {
            session.crawledData = this.mergeRawObjects(session.crawledData, [parsed]);
          }
        } catch {
          // Skip invalid dump files.
        }
      }
    }

    session.crawledData = this.syncCrawledDataFromDiscovered(session);

    const hasContent = session.crawledData.length > 0 || session.discovered.length > 0;

    return {
      ...session,
      hasContent,
      dumpPath: this.resolveScenarioDir(scenarioId),
      sessionPath,
      updatedAt: hasContent ? session.updatedAt : null,
    };
  }

  static async saveSession(scenarioId, session) {
    await this.ensureScenarioDir(scenarioId);
    const discovered = Array.isArray(session?.discovered) ? session.discovered : [];
    const crawledData = this.syncCrawledDataFromDiscovered({
      crawledData: Array.isArray(session?.crawledData) ? session.crawledData : [],
      discovered,
    });
    const payload = {
      scenarioId: scenarioId || 'draft',
      updatedAt: new Date().toISOString(),
      crawledData,
      discovered,
    };
    await fsp.writeFile(this.resolveSessionPath(scenarioId), JSON.stringify(payload, null, 2), 'utf8');
    return {
      ...payload,
      hasContent: crawledData.length > 0 || discovered.length > 0,
      dumpPath: this.resolveScenarioDir(scenarioId),
    };
  }

  static async appendCaptured(scenarioId, items = []) {
    const session = await this.loadSession(scenarioId);
    session.crawledData = this.mergeRawObjects(session.crawledData, items);
    return this.saveSession(scenarioId, session);
  }

  static async appendDiscovered(scenarioId, record = null) {
    const session = await this.loadSession(scenarioId);
    session.discovered = this.mergeDiscovered(session.discovered, record);
    if (Array.isArray(record?.items) && record.items.length) {
      session.crawledData = this.mergeRawObjects(session.crawledData, record.items);
    }
    return this.saveSession(scenarioId, session);
  }

  static async clearSession(scenarioId) {
    const dir = this.resolveScenarioDir(scenarioId);
    if (!fs.existsSync(dir)) {
      return emptySession(scenarioId);
    }

    await fsp.rm(dir, { recursive: true, force: true });
    return emptySession(scenarioId);
  }
}
