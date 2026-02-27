import type { StoreName, StoreResolver } from '../types';
import { TescoResolver } from './tesco';
import { DunnesResolver } from './dunnes';
import { SuperValuResolver } from './supervalu';
import { LidlResolver } from './lidl';
import { AldiResolver } from './aldi';

const resolvers: Record<StoreName, StoreResolver> = {
  tesco: TescoResolver,
  dunnes: DunnesResolver,
  supervalu: SuperValuResolver,
  lidl: LidlResolver,
  aldi: AldiResolver,
};

export function getResolver(store: StoreName): StoreResolver {
  return resolvers[store];
}
