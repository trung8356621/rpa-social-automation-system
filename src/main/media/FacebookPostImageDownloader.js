import fs from 'node:fs/promises';
import path from 'node:path';
import {
  pickHighestQualityFacebookImageUrl,
} from '../../shared/facebookMediaExtract.js';

const FACEBOOK_MEDIA_DIR = 'facebook_media';
const DOWNLOAD_TIMEOUT_MS = 60000;

function normalizeRelativePath(value = '') {
  return String(value || '').trim().replace(/\\/g, '/');
}

function extensionFromContentType(contentType = '') {
  const type = String(contentType || '').toLowerCase();
  if (type.includes('png')) return '.png';
  if (type.includes('webp')) return '.webp';
  if (type.includes('gif')) return '.gif';
  return '.jpg';
}

function extensionFromUrl(url = '') {
  const clean = String(url || '').split('?')[0].toLowerCase();
  if (clean.endsWith('.png')) return '.png';
  if (clean.endsWith('.webp')) return '.webp';
  if (clean.endsWith('.gif')) return '.gif';
  if (clean.endsWith('.jpeg')) return '.jpeg';
  return '.jpg';
}

export class FacebookPostImageDownloader {
  /**
   * @param {{ projectRoot?: string }} [options]
   */
  constructor(options = {}) {
    this.projectRoot = options.projectRoot || process.cwd();
    this.mediaDir = path.join(this.projectRoot, FACEBOOK_MEDIA_DIR);
  }

  getMediaDirectory() {
    return this.mediaDir;
  }

  resolveAbsolutePath(relativePath = '') {
    const normalized = normalizeRelativePath(relativePath);
    if (!normalized || normalized.includes('..')) return null;

    const absolutePath = path.resolve(this.projectRoot, normalized);
    const mediaRoot = path.resolve(this.mediaDir);
    if (!absolutePath.startsWith(mediaRoot)) return null;
    return absolutePath;
  }

  /**
   * Download the highest-quality post image and return a project-relative path.
   * Never throws — returns null on failure.
   *
   * @param {string} postId
   * @param {string[]|string} imageUrls
   * @returns {Promise<string|null>}
   */
  async downloadPostImage(postId, imageUrls = []) {
    try {
      const normalizedPostId = String(postId || '').trim();
      if (!normalizedPostId) return null;

      const sourceUrl = pickHighestQualityFacebookImageUrl(imageUrls);
      if (!sourceUrl) return null;

      await fs.mkdir(this.mediaDir, { recursive: true });

      const response = await fetch(sourceUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
          Referer: 'https://www.facebook.com/',
          Accept: 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8',
        },
        signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS),
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const contentType = response.headers.get('content-type') || '';
      const extension = extensionFromContentType(contentType) || extensionFromUrl(sourceUrl);
      const filename = `post_${normalizedPostId}${extension}`;
      const absolutePath = path.join(this.mediaDir, filename);
      const relativePath = normalizeRelativePath(path.posix.join(FACEBOOK_MEDIA_DIR, filename));

      const buffer = Buffer.from(await response.arrayBuffer());
      if (!buffer.length) {
        throw new Error('Empty image response');
      }

      await fs.writeFile(absolutePath, buffer);
      return relativePath;
    } catch (error) {
      console.warn(
        `[FacebookMedia] Post image download failed (${postId || 'unknown'}):`,
        error?.message || error,
      );
      return null;
    }
  }
}

export default FacebookPostImageDownloader;
