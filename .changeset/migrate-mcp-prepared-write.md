---
'@ankhorage/ads-google': major
---

Remove the legacy `google-ads.prepare-mutation` MCP tool. Google Ads writes use only the published
prepared-write tool pairs, which persist the original proposal at the trusted host before external
approval and execution.
