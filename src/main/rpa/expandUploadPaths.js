import fs from 'node:fs';
import path from 'node:path';

/** Extensions treated as uploadable when expanding a folder with empty accept. */
export const DEFAULT_UPLOAD_EXT_CATEGORY = {
  '.jpg': 'image',
  '.jpeg': 'image',
  '.png': 'image',
  '.gif': 'image',
  '.webp': 'image',
  '.bmp': 'image',
  '.svg': 'image',
  '.heic': 'image',
  '.heif': 'image',
  '.tif': 'image',
  '.tiff': 'image',
  '.mp4': 'video',
  '.webm': 'video',
  '.mov': 'video',
  '.avi': 'video',
  '.mkv': 'video',
  '.mpeg': 'video',
  '.mpg': 'video',
  '.m4v': 'video',
};

export function fileMatchesAccept(filePath, acceptRaw, extCategory = DEFAULT_UPLOAD_EXT_CATEGORY) {
  const accept = String(acceptRaw || '').trim();
  if (!accept) return true;

  const ext = path.extname(filePath).toLowerCase();
  const parts = accept.split(',').map((item) => item.trim()).filter(Boolean);
  for (const part of parts) {
    if (part.startsWith('.')) {
      if (ext === part.toLowerCase()) return true;
      continue;
    }
    if (part.endsWith('/*')) {
      const category = part.slice(0, -2);
      if (extCategory[ext] === category) return true;
      continue;
    }
    if (part.includes('/')) {
      const extGuess = ext.replace(/^\./, '');
      if (part.endsWith(`/${extGuess}`)) return true;
    }
  }
  return false;
}

function isDefaultMediaFile(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  return Boolean(DEFAULT_UPLOAD_EXT_CATEGORY[ext]);
}

/**
 * Expand raw variable values (file and/or folder paths, `;`-separated) into concrete files.
 * Folders are scanned one level deep (non-recursive). Empty accept on folders uses default media types.
 */
export function expandUploadPaths(rawPaths, { accept = '', maxSizeMb = 0 } = {}) {
  const inputs = (Array.isArray(rawPaths) ? rawPaths : [rawPaths])
    .flatMap((item) => String(item || '').split(';'))
    .map((item) => item.trim())
    .filter(Boolean);

  const maxBytes = Number(maxSizeMb) > 0 ? Number(maxSizeMb) * 1024 * 1024 : 0;
  const acceptTrimmed = String(accept || '').trim();
  const expanded = [];
  const seen = new Set();

  for (const inputPath of inputs) {
    if (!fs.existsSync(inputPath)) {
      throw new Error(`File/thư mục không tồn tại: ${inputPath}`);
    }

    const stat = fs.statSync(inputPath);
    if (stat.isFile()) {
      pushValidatedFile(expanded, seen, inputPath, {
        accept: acceptTrimmed,
        maxBytes,
        requireDefaultMedia: false,
      });
      continue;
    }

    if (!stat.isDirectory()) {
      throw new Error(`Đường dẫn không phải file hoặc thư mục: ${inputPath}`);
    }

    const entries = fs.readdirSync(inputPath, { withFileTypes: true })
      .filter((entry) => entry.isFile() && !entry.name.startsWith('.'))
      .map((entry) => path.join(inputPath, entry.name))
      .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));

    const before = expanded.length;
    for (const filePath of entries) {
      if (acceptTrimmed) {
        if (!fileMatchesAccept(filePath, acceptTrimmed)) continue;
      } else if (!isDefaultMediaFile(filePath)) {
        continue;
      }
      pushValidatedFile(expanded, seen, filePath, {
        accept: acceptTrimmed,
        maxBytes,
        requireDefaultMedia: false,
        skipAccept: true,
      });
    }

    if (expanded.length === before) {
      throw new Error(
        `Thư mục không có file hợp lệ để upload: ${inputPath}`
        + (acceptTrimmed ? ` (accept: ${acceptTrimmed})` : ' (ảnh/video)'),
      );
    }
  }

  if (!expanded.length) {
    throw new Error('File step không có file hợp lệ.');
  }

  return expanded;
}

function pushValidatedFile(list, seen, filePath, {
  accept,
  maxBytes,
  requireDefaultMedia = false,
  skipAccept = false,
} = {}) {
  const key = path.resolve(filePath);
  if (seen.has(key)) return;

  const stat = fs.statSync(filePath);
  if (!stat.isFile()) {
    throw new Error(`Đường dẫn không phải file: ${filePath}`);
  }
  if (maxBytes && stat.size > maxBytes) {
    throw new Error(`File vượt giới hạn ${Math.round(maxBytes / (1024 * 1024))}MB: ${path.basename(filePath)}`);
  }
  if (!skipAccept) {
    if (requireDefaultMedia && !isDefaultMediaFile(filePath)) {
      throw new Error(`File không thuộc loại ảnh/video hỗ trợ: ${path.basename(filePath)}`);
    }
    if (!fileMatchesAccept(filePath, accept)) {
      throw new Error(`File không đúng loại (${accept}): ${path.basename(filePath)}`);
    }
  }

  seen.add(key);
  list.push(filePath);
}
