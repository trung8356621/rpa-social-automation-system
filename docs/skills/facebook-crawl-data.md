# Facebook Crawl Data Skill

Use this note when changing Facebook Data Studio group crawl flows, GraphQL
parsing, media extraction/download, or crawled-data persistence.

## Must Not Break

- Single Post crawl is isolated JSON-only. Keep the Crawl Single Post button and
  one-input post-link modal, but implement it only through Force GraphQL Fetch
  against `/api/graphql/`.
- HTML DOM element scraping is forbidden for Facebook data extraction. Do not
  use `querySelector`, accessibility trees, visible text, or Facebook UI classes
  to extract post/comment data. `page.evaluate` may only read runtime tokens and
  call JSON endpoints.
- Facebook Data Studio supports Crawl Group for public/private groups and a
  separate Single Post Force GraphQL flow. Do not mix the two flows.
- Runtime `group_id` must navigate to
  `https://www.facebook.com/groups/{group_id}/`.
- Post content, author, date, interaction stats, comments, and media must come
  from intercepted GraphQL network payloads or Single Post Force GraphQL JSON
  parsed by `parseFacebookGraphQLBatch`.
- Renderer crawl commands are fire-and-forget. Wait for terminal/live status and
  inspect `resultJson.facebook_db_save`.
- If `facebook_db_save.success === false`, show an error toast instead of a
  generic success/refresh toast.
- Never create a `posts` row from comment-only GraphQL (`display_comments`,
  `CometUFICommentsProviderQuery`, orphan `Comment` nodes).
- Preserve request query names such as `fb_api_req_friendly_name`; parser may
  treat `CometUFICommentsProvider*` as comment-only, but Group crawl must not
  save comment-only payloads as new posts.
- Feedback-only payloads may enrich already parsed posts in memory, but must not
  create persisted posts by themselves.
- Post/comment media must be downloaded into `facebook_media/` when Facebook
  returns a downloadable image or video URL.
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

## Main Files

- `src/renderer/pages/FacebookDataPage.jsx`
- `src/renderer/pages/FacebookDataSettingsPage.jsx`
- `src/main/rpa/ExecutorService.js`
- `src/shared/parseFacebookGraphQL.js`
- `src/shared/facebookMediaExtract.js`
- `src/main/media/FacebookPostImageDownloader.js`
- `src/main/database/PlatformCrawledDataService.js`
- `src/shared/facebookCrawlConfig.js`
- `docs/crawl-post-comment-trace.md`

## Request Types

- Real feed/post request: contains Story nodes with usable `message`,
  `styled_message`, author, permalink, attachments/media, or counts. This may
  create/update posts.
- Feedback-only request: counts/feedback IDs without usable post content/media.
  Do not create a post from this alone.
- Comment-only request: comments without real post payload. Mark as
  comment-only and exclude from Group crawl save candidates.
- Unrelated request: notifications/search/bookmarks/left rail/video settings.
  Ignore for post save.

## Media Extraction

Inspect these image fields: `attachments`, `styles.attachment`,
`all_subattachments.nodes`, `subattachments`, `media.image`, `photo_image`,
`viewer_image`, `preferred_thumbnail`, `thumbnail_image`.

Inspect these video fields: `playable_url`, `playable_url_quality_hd`,
`browser_native_sd_url`, `browser_native_hd_url`.

If only a thumbnail exists, save/download the thumbnail. If a direct video URL
exists, download the video.

## Debug Checklist

1. Open `debug_dumps/crawl/{folder}/session.json` and captures.
2. Parse raw objects with `parseFacebookGraphQLBatch` using the same target URL
   and variables.
3. If expected post text is absent from raw GraphQL, inspect request filters or
   Facebook feed pagination, not DOM fallback paths.
4. If media exists in `facebook_media/` but UI shows empty media, inspect
   serialization of local paths.
5. Run `node --check` for touched JS files and `npm run build:renderer` for UI.
