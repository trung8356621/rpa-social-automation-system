import fs from 'node:fs/promises';
import path from 'node:path';
import {
  isLikelyFacebookVideoUrl,
  parseFacebookMediaUrls,
  pickHighestQualityFacebookImageUrl,
  upgradeFacebookImageUrlToMaxQuality,
} from '../../shared/facebookMediaExtract.js';

const FACEBOOK_MEDIA_DIR = 'facebook_media';
const DOWNLOAD_TIMEOUT_MS = 60000;

function normalizeRelativePath(value = '') {
  return String(value || '').trim().replace(/\\/g, '/');
}

function extensionFromContentType(contentType = '') {
  const type = String(contentType || '').toLowerCase();
  if (type.includes('mp4')) return '.mp4';
  if (type.includes('quicktime')) return '.mov';
  if (type.includes('webm')) return '.webm';
  if (type.includes('png')) return '.png';
  if (type.includes('webp')) return '.webp';
  if (type.includes('gif')) return '.gif';
  return '.jpg';
}

function extensionFromUrl(url = '') {
  const clean = String(url || '').split('?')[0].toLowerCase();
  if (clean.endsWith('.mp4')) return '.mp4';
  if (clean.endsWith('.mov')) return '.mov';
  if (clean.endsWith('.webm')) return '.webm';
  if (clean.endsWith('.png')) return '.png';
  if (clean.endsWith('.webp')) return '.webp';
  if (clean.endsWith('.gif')) return '.gif';
  if (clean.endsWith('.jpeg')) return '.jpeg';
  return '.jpg';
}

function sanitizeEntityKey(value = '') {
  return String(value || 'unknown').trim().replace(/[^\w.-]+/g, '_').slice(0, 80) || 'unknown';
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

  async downloadImageFromUrl(sourceUrl, filename) {
    const isVideo = isLikelyFacebookVideoUrl(sourceUrl);
    const response = await fetch(sourceUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        Referer: 'https://www.facebook.com/',
        Accept: isVideo
          ? 'video/mp4,video/webm,video/*,*/*;q=0.8'
          : 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8',
      },
      signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS),
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const contentType = response.headers.get('content-type') || '';
    const extension = extensionFromContentType(contentType) || extensionFromUrl(sourceUrl);
    const safeFilename = filename.includes('.') ? filename : `${filename}${extension}`;
    const absolutePath = path.join(this.mediaDir, safeFilename);
    const relativePath = normalizeRelativePath(path.posix.join(FACEBOOK_MEDIA_DIR, safeFilename));

    const buffer = Buffer.from(await response.arrayBuffer());
    if (!buffer.length) {
      throw new Error('Empty image response');
    }

    await fs.writeFile(absolutePath, buffer);
    return relativePath;
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
      const normalizedPostId = sanitizeEntityKey(postId);
      if (!normalizedPostId) return null;

      const paths = await this.downloadAllImages(`post_${normalizedPostId}`, imageUrls, {
        prefix: 'post',
        maxImages: 1,
      });
      return paths[0] || null;
    } catch (error) {
      console.warn(
        `[FacebookMedia] Post image download failed (${postId || 'unknown'}):`,
        error?.message || error,
      );
      return null;
    }
  }

  /**
   * Download all content images for an entity.
   * Never throws — returns only successfully downloaded relative paths.
   *
   * @param {string} entityKey
   * @param {string[]|string} imageUrls
   * @param {{ prefix?: string, maxImages?: number }} [options]
   * @returns {Promise<string[]>}
   */
  async downloadAllImages(entityKey, imageUrls = [], options = {}) {
    const prefix = String(options.prefix || 'media').trim() || 'media';
    const safeKey = sanitizeEntityKey(entityKey);
    const urls = parseFacebookMediaUrls(imageUrls)
      .filter((url) => /^https?:\/\//i.test(url))
      .map((url) => (isLikelyFacebookVideoUrl(url) ? url : upgradeFacebookImageUrlToMaxQuality(url)))
      .filter(Boolean);

    const maxImages = Number.isFinite(options.maxImages) && options.maxImages > 0
      ? Math.floor(options.maxImages)
      : urls.length;

    if (!safeKey || !urls.length) return [];

    try {
      await fs.mkdir(this.mediaDir, { recursive: true });

      const downloaded = [];
      const limit = Math.min(urls.length, maxImages);

      for (let index = 0; index < limit; index += 1) {
        const sourceUrl = urls[index];
        const filename = `${prefix}_${safeKey}_${index + 1}`;
        try {
          const relativePath = await this.downloadImageFromUrl(sourceUrl, filename);
          if (relativePath) downloaded.push(relativePath);
        } catch (error) {
          console.warn(
            `[FacebookMedia] Image download failed (${safeKey} #${index + 1}):`,
            error?.message || error,
          );
        }
      }

      return downloaded;
    } catch (error) {
      console.warn(
        `[FacebookMedia] Batch image download failed (${safeKey}):`,
        error?.message || error,
      );
      return [];
    }
  }

  /**
   * Upgrade URL list to max quality and return best single URL.
   * @param {string[]|string} imageUrls
   * @returns {string}
   */
  pickBestSourceUrl(imageUrls = []) {
    return pickHighestQualityFacebookImageUrl(imageUrls);
  }
}

export default FacebookPostImageDownloader;
