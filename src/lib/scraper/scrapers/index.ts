import type { Retailer, ScrapeResult, ScrapeContext } from '../types';
import * as tesco from './tesco';
import * as dunnes from './dunnes';
import * as supervalu from './supervalu';
import * as lidl from './lidl';
import * as aldi from './aldi';

type ScraperModule = {
  scrape(url: string, ctx: ScrapeContext): Promise<ScrapeResult>;
  PARSE_VERSION: string;
};

const scrapers: Record<Retailer, ScraperModule> = {
  tesco,
  dunnes,
  supervalu,
  lidl,
  aldi,
};

export function getScraper(retailer: Retailer): ScraperModule {
  return scrapers[retailer];
}
