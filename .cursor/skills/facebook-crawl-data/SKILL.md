---
name: facebook-crawl-data
description: >-
  Guides Facebook Data Studio group-feed request-catching crawl changes:
  GraphQL parsing, media download, debug dumps, and PlatformCrawledDataService
  saves. Use when editing FacebookDataPage, ExecutorService request_catching
  flow, parseFacebookGraphQL, facebook media extraction/downloading, or
  facebook-data database persistence.
---

# Facebook Crawl Data Skill

## Core invariants

- Single Post crawl is isolated JSON-only. Keep the Crawl Single Post button and
  one-input post-link modal, but implement it only through Force GraphQL Fetch
  against `/api/graphql/`.
- HTML DOM element scraping is forbidden for Facebook data extraction. Do not
  use `querySelector`, accessibility trees, visible text, or Facebook UI classes
  to extract post/comment data. `page.evaluate` may only read runtime tokens and
  call JSON endpoints.
- Facebook Data Studio supports Crawl Group for public/private groups and a
  separate Single Post Force GraphQL flow. Runtime Crawl Group `group_id` must navigate to
  `https://www.facebook.com/groups/{group_id}/`.
- Post content, author, date, interaction stats, comments, and media must come
  from intercepted GraphQL network payloads or Single Post Force GraphQL JSON
  parsed by `parseFacebookGraphQLBatch`.
- Renderer crawl commands are fire-and-forget. Wait for
  `execution:completed` / `execution:failed` live status and inspect
  `resultJson.facebook_db_save`.
- If `facebook_db_save.success === false`, show an error toast and do not show a
  generic crawl-success/refresh toast.
- Never create a new `posts` row from comment-only GraphQL such as
  `CometUFICommentsProviderQuery` or payloads that only contain
  `display_comments`.
- Preserve `fb_api_req_friendly_name` / request query name on captured raw
  GraphQL objects. Parser may classify `CometUFICommentsProvider*` as
  comment-only, but comment-only payloads are not save candidates for Group
  crawl.
- Feedback-only payloads may enrich an existing parsed post in memory, but must
  not create a persisted post without a real Story-like post payload.
- Post and comment media must be downloaded into `facebook_media/` whenever a
  downloadable image or video URL is available.
- Preserve local paths such as `facebook_media/post_...jpg` in `post_images` /
  `comment_images`.
- Browser-like actions must not use fixed hardcoded delays. Click, type, scroll,
  and settle waits must go through centralized `randomDelay(baseMs, minMs, maxMs)`.
- `randomDelay` must multiply `baseMs` by a random floating factor in `[0.75,
  1.4]`, then clamp the result to `[minMs, maxMs]`.
- `page.keyboard.type` per-character delay must use `randomDelay` with a base
  between `50ms` and `100ms`.
- `betweenScrollMs` and `settleMs` in `infinity_scroll` loops must call
  `randomDelay` on every loop to create non-linear scroll timing.
- Future LinkedIn modules must use network interception against
  `/voyager/api/...` REST endpoints with URN mapping. Do not build LinkedIn DOM
  scrapers; reuse the centralized random delay discipline.

## Key files

| Area | Files |
|------|-------|
| UI orchestration | `src/renderer/pages/FacebookDataPage.jsx` |
| Settings UI | `src/renderer/pages/FacebookDataSettingsPage.jsx` |
| Request-catching execution | `src/main/rpa/ExecutorService.js` |
| CDP GraphQL capture | `src/main/rpa/RequestCatchingPuppeteerCapture.js` |
| URL/variable helpers | `src/shared/facebookCrawlConfig.js` |
| Parser | `src/shared/parseFacebookGraphQL.js` |
| Media extraction | `src/shared/facebookMediaExtract.js` |
| Media download | `src/main/media/FacebookPostImageDownloader.js` |
| DB save/list/delete | `src/main/database/PlatformCrawledDataService.js` |
| Debug dumps | `src/main/rpa/CrawlRequestDumpService.js`, `debug_dumps/crawl/*` |
| Flow notes | `docs/crawl-post-comment-trace.md` |

## Request classification

Classify GraphQL payloads before saving:

- **Real post/feed payload:** contains Story-like nodes with usable post fields
  such as `story.message.text`, `styled_message`, `post_id`, attachments, media,
  author, or permalink. These may create/update `posts`.
- **Feedback-only payload:** has feedback/count identifiers but no usable post
  content/media/author. Do not create a new post from this alone.
- **Comment-only payload:** contains comments (`display_comments`,
  `feedback.display_comments`, `Comment` nodes) without real post content. Mark
  it `_comments_only`; Group crawl must not save it as a new post.
- **Unrelated Facebook payload:** notifications, search bootstrap, stories tray,
  bookmarks, video settings, hovercards, left rail, etc. Ignore for post save.

## Group crawl URL guard

- Group crawl must navigate to the group supplied by runtime `group_id`, not a
  stale scenario sample URL.
- If the current page or request referer leaves the expected group, skip the
  request or fail with a clear URL guard error. Do not report success for data
  captured from another group.

## Media rules

Post and comment media must be downloaded into `facebook_media/` whenever a
downloadable URL is available.

- Extract images from `attachments`, `styles.attachment`,
  `all_subattachments.nodes`, `subattachments`, `media.image`, `photo_image`,
  `viewer_image`, `preferred_thumbnail`, and `thumbnail_image`.
- Extract videos from `playable_url`, `playable_url_quality_hd`,
  `browser_native_sd_url`, and `browser_native_hd_url`.
- If Facebook only returns a video thumbnail, download and save the thumbnail.
  If Facebook returns a direct video URL, download and save the video.
- Do not use serializers that drop local paths. `facebook_media/...` is valid
  persisted media.

## Debug workflow

When a crawl result looks wrong:

1. Inspect `debug_dumps/crawl/{folder}/session.json` and `captures/*.json`.
2. Parse the dump with `parseFacebookGraphQLBatch` using the same `targetUrl`
   and runtime variables.
3. Check whether the expected post text exists in raw GraphQL.
4. If media exists in `facebook_media/` but UI shows empty media, inspect DB
   serialization and UI parsing of local paths.
5. Run `node --check` for touched JS files and `npm run build:renderer` for UI.
