Tampermonkey userscript that filters videos on YouTube channel Videos pages by upload age. Choose any whole number of days, weeks, months, or years. The script preserves YouTube's selected order; choose Popular to see the most popular matching uploads.

Install [Tampermonkey](https://www.tampermonkey.net/), open the [userscript](https://raw.githubusercontent.com/sashokey/youtube-video-age-filter/master/youtube-video-age-filter.user.js), and confirm installation. Reload YouTube. The readable source is [youtube-video-age-filter.src.js](youtube-video-age-filter.src.js).

Use Upload age to enable or disable the filter. Changes apply as you type, and preferences are saved. Load next page requests one more native page through normal scrolling. Find 20 more continues until at least 20 additional matching videos appear or 10 pages have loaded. Stop ends further loading. Turning the filter off restores normal scrolling.

The filter uses YouTube's displayed upload ages, which are rounded. Missing dates and ages overlapping the cutoff are hidden unless Include uncertain dates is enabled. English and Russian age labels are supported. View counts are lifetime totals, and the loaded list may not cover the channel's entire history.

The script makes no direct network requests and uses no external services. YouTube's own code handles pagination. Tampermonkey checks this GitHub repository for script updates.

Build the installable file with the globally installed Terser:

```sh
terser youtube-video-age-filter.src.js --compress passes=10 --mangle --comments all --output youtube-video-age-filter.user.js
```
