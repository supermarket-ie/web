export type DealCandidate = {
  price: number;
  was_price: number | null;
  on_promotion: boolean;
  observed_at: string;
};

export function isCurrentDeal(price: DealCandidate) {
  // A retailer promotion flag is useful evidence, but it is not enough to
  // claim a saving. Shopper-facing deals require a confirmed higher price.
  return price.was_price != null && price.was_price > price.price;
}

export function isRetailerMarkedOffer(price: DealCandidate) {
  return price.on_promotion === true;
}

export function latestObservationAt(prices: DealCandidate[]) {
  return prices.reduce<string | null>((latest, price) => {
    if (!price.observed_at) return latest;
    return !latest || price.observed_at > latest ? price.observed_at : latest;
  }, null);
}
