import AdmZip from 'adm-zip';
import crypto from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';

export const SCENARIO_BUNDLE_JSON = 'scenario.json';
export const SCENARIO_FRAMES_DIR = 'frames';

export function sanitizeScenarioFileName(name) {
  return String(name || 'scenario').replace(/[<>:"/\\|?*]+/g, '_').trim() || 'scenario';
}

export async function writeScenarioBundleZip(filePath, bundle, assets = []) {
  const zip = new AdmZip();
  const payload = { ...bundle };
  delete payload._assets;

  zip.addFile(
    SCENARIO_BUNDLE_JSON,
    Buffer.from(`${JSON.stringify(payload, null, 2)}\n`, 'utf8'),
  );

  let copiedFrames = 0;
  for (const item of assets) {
    if (!item?.sourcePath || !item?.name) continue;
    if (!fs.existsSync(item.sourcePath)) continue;
    zip.addLocalFile(item.sourcePath, SCENARIO_FRAMES_DIR, item.name);
    copiedFrames += 1;
  }

  await fsp.mkdir(path.dirname(filePath), { recursive: true });
  zip.writeZip(filePath);
  return { copiedFrames };
}

export async function readScenarioBundleZip(zipFilePath, tempRoot = null) {
  if (!fs.existsSync(zipFilePath)) {
    throw new Error('Khong tim thay file zip.');
  }

  const zip = new AdmZip(zipFilePath);
  const entry = zip.getEntry(SCENARIO_BUNDLE_JSON);
  if (!entry) {
    throw new Error('File zip khong chua scenario.json.');
  }

  const raw = entry.getData().toString('utf8');
  const tempDir = path.join(
    tempRoot || path.dirname(zipFilePath),
    `.rpa-import-${crypto.randomUUID()}`,
  );

  try {
    zip.extractAllTo(tempDir, true);
    return { raw, assetsDir: tempDir };
  } catch (error) {
    await fsp.rm(tempDir, { recursive: true, force: true }).catch(() => {});
    throw error;
  }
}

export async function cleanupScenarioBundleTempDir(tempDir) {
  if (!tempDir) return;
  await fsp.rm(tempDir, { recursive: true, force: true }).catch(() => {});
}
