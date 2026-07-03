# Truy Vet Crawl Facebook Data

Tai lieu nay mo ta luong hien tai cua Facebook Data Studio sau khi da huy tinh
nang Crawl Single Post.

## Trang Thai Hien Tai

- Chi con tinh nang **Crawl Group**.
- Da xoa nut **Crawl Post**, modal nhap link bai viet le, va cac handler crawl
  comment/post truc tiep.
- Executor chi di theo luong request-catching GraphQL khi crawl group.
- Khong dung DOM fallback, `page.evaluate()` de boc `post_content`, hoac
  accessibility tree de tao post.
- Parser khong duoc bien payload comment-only thanh post moi.

## Luong Tong Quat

```text
Facebook Data Studio
  -> startLocalCampaign
  -> ExecutorService.startScenario()
  -> _executeRequestCatchingLive()
      -> navigate den https://www.facebook.com/groups/{group_id}/
      -> URL Guard kiem tra dung group
      -> RequestCatchingPuppeteerCapture bat GraphQL
      -> parseFacebookGraphQLBatch
      -> PlatformCrawledDataService.saveFacebookPostsBatch
  -> telemetry rpa:execution-status
  -> FacebookDataPage refresh posts/comments
```

## File Chinh

| File | Vai tro |
|------|--------|
| `src/renderer/pages/FacebookDataPage.jsx` | Man Facebook Data Studio: Crawl Group, Refresh, Export, xoa post, xem posts/comments |
| `src/renderer/pages/FacebookDataSettingsPage.jsx` | Chon scenario crawl group, browser profile, proxy, scroll settle |
| `src/main/rpa/ExecutorService.js` | Chay request-catching, dieu huong group, scroll, luu GraphQL da parse |
| `src/main/rpa/RequestCatchingPuppeteerCapture.js` | Bat GraphQL tu browser |
| `src/shared/parseFacebookGraphQL.js` | Parse GraphQL thanh post/comment/media |
| `src/shared/facebookCrawlConfig.js` | Cau hinh URL, variables, setting crawl Facebook |
| `src/shared/facebookMediaExtract.js` | Extract image/video URL |
| `src/main/media/FacebookPostImageDownloader.js` | Tai media ve `facebook_media/` |
| `src/main/database/PlatformCrawledDataService.js` | Luu/liet ke/xoa du lieu Facebook |

## Quy Tac Parser

- Story/feed payload co `message`, `styled_message`, permalink, author,
  attachments/media, hoac count hop le moi duoc tao/cap nhat post.
- Feedback-only payload chi duoc merge vao post da co trong batch, khong tao
  post moi.
- Comment-only payload nhu `CometUFICommentsProviderQuery`,
  `display_comments`, orphan `Comment` nodes phai mang co `_comments_only` va
  khong la save candidate trong Group crawl.
- Khong lay comment lam `post_content`.

## Debug Checklist

1. Mo `debug_dumps/crawl/{folder}/session.json`.
2. Kiem tra `rawCaptured` co payload Story/feed that su hay chi co comment.
3. Parse lai bang `parseFacebookGraphQLBatch` voi cung `targetUrl` va
   variables.
4. Neu media da tai ve `facebook_media/` nhung UI trong, kiem tra serialize
   local path trong DB/UI.
5. Chay `node --check` cho file JS da sua va `npm run build:renderer`.
