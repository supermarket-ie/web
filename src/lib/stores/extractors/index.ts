import type { StoreName, StoreExtractor } from '../types';
import { TescoExtractor } from './tesco';
import { DunnesExtractor } from './dunnes';
import { SuperValuExtractor } from './supervalu';
import { LidlExtractor } from './lidl';
import { AldiExtractor } from './aldi';

const extractors: Record<StoreName, StoreExtractor> = {
  tesco: TescoExtractor,
  dunnes: DunnesExtractor,
  supervalu: SuperValuExtractor,
  lidl: LidlExtractor,
  aldi: AldiExtractor,
};

export function getExtractor(store: StoreName): StoreExtractor {
  return extractors[store];
}
