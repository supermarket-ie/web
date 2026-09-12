import type { RetailerHandoffResult, ShoppingBasket } from '../contracts';

export type RetailerAdapterContext = {
  household_id?: string | null;
};

export interface RetailerAdapter {
  readonly retailer: string;
  prepareHandoff(
    basket: ShoppingBasket,
    context?: RetailerAdapterContext,
  ): Promise<RetailerHandoffResult> | RetailerHandoffResult;
}
