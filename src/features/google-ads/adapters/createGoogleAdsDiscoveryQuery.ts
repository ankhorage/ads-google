import type { GoogleAdsDiscoveryPort } from '../ports/googleAdsPorts.js';

/*** Build bounded GAQL discovery queries needed to locate mutable resource identifiers. */
export function createGoogleAdsDiscoveryQuery(
  kind: Parameters<GoogleAdsDiscoveryPort['listResourcesAsync']>[0]['kind'],
): string {
  if (kind === 'campaigns')
    return 'SELECT campaign.resource_name, campaign.name, campaign.status, campaign.campaign_budget, campaign_budget.resource_name, campaign_budget.amount_micros FROM campaign';
  if (kind === 'ad-groups')
    return 'SELECT ad_group.resource_name, ad_group.name, ad_group.status, ad_group.cpc_bid_micros, campaign.resource_name FROM ad_group';
  if (kind === 'keywords')
    return 'SELECT ad_group_criterion.resource_name, ad_group_criterion.status, ad_group_criterion.cpc_bid_micros, ad_group_criterion.keyword.text, ad_group_criterion.keyword.match_type, ad_group.resource_name FROM keyword_view WHERE ad_group_criterion.negative = FALSE';
  if (kind === 'negative-keywords')
    return 'SELECT ad_group_criterion.resource_name, ad_group_criterion.keyword.text, ad_group_criterion.keyword.match_type, ad_group.resource_name FROM keyword_view WHERE ad_group_criterion.negative = TRUE';
  return 'SELECT campaign_criterion.resource_name, campaign_criterion.keyword.text, campaign_criterion.keyword.match_type, campaign.resource_name FROM campaign_criterion WHERE campaign_criterion.negative = TRUE';
}
