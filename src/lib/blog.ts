// Blog post definitions — all content lives here as structured data
// Add new posts by adding to this array. Newest first.

export interface BlogPost {
  slug: string;
  title: string;
  description: string;
  date: string; // YYYY-MM-DD
  category: 'Saving Money' | 'Meal Ideas' | 'Price Comparison' | 'Ireland Food';
  readingTime: string;
  content: Section[];
}

export type Section =
  | { type: 'intro'; text: string }
  | { type: 'h2'; text: string }
  | { type: 'p'; text: string }
  | { type: 'ul'; items: string[] }
  | { type: 'tip'; heading: string; text: string }
  | { type: 'cta'; heading: string; text: string; link: string; linkText: string };

export const POSTS: BlogPost[] = [
  {
    slug: 'is-it-worth-shopping-at-multiple-supermarkets-ireland',
    title: 'Is It Worth Shopping at Multiple Supermarkets in Ireland?',
    description: 'Our price data across 300+ products shows you can save up to €12.10 per week by shopping at the right store — and even more by splitting your shop.',
    date: '2026-03-20',
    category: 'Saving Money',
    readingTime: '4 min read',
    content: [
      {
        type: 'intro',
        text: 'Most Irish shoppers pick one supermarket and stick to it. Convenient, yes — but our live price data across 300+ products suggests that loyalty to a single store could be costing you more than you think.',
      },
      { type: 'h2', text: 'What the data shows' },
      {
        type: 'p',
        text: 'We track prices twice weekly across Tesco, Dunnes Stores and SuperValu. Looking at a standard weekly basket of 80+ products, the difference between the cheapest and most expensive store is consistently €10–€15. Our latest data puts the saving at up to €12.10 per week — or over €600 a year.',
      },
      { type: 'h2', text: 'Splitting your shop by category' },
      {
        type: 'p',
        text: 'The bigger opportunity isn\'t just picking the cheapest store overall — it\'s splitting your shop by category. No single supermarket wins across every aisle. Based on our data:',
      },
      {
        type: 'ul',
        items: [
          'Dairy: Dunnes own-brand milk, butter and cheese tend to undercut both Tesco and SuperValu',
          'Meat: Tesco and Dunnes are competitive on packaged cuts; SuperValu wins on quality but not always price',
          'Fresh veg & fruit: prices are close across all three, but SuperValu often has better variety',
          'Bakery: Dunnes own-brand bread is consistently among the cheapest options',
          'Household & toiletries: Tesco Clubcard prices can be 20–40% cheaper on specific products',
        ],
      },
      { type: 'h2', text: 'Is the hassle worth it?' },
      {
        type: 'p',
        text: 'Shopping at two stores adds time — but it doesn\'t have to mean two full shops. A practical split is doing your main shop (meat, dairy, bakery, staples) at whichever store is cheapest that week, then picking up fresh produce wherever is most convenient. That alone can save €5–8 per week with minimal extra effort.',
      },
      {
        type: 'tip',
        heading: 'The smart way to split',
        text: 'Use our AI planner to generate your weekly list — it shows live prices from all major stores side by side, so you can see at a glance where each item is cheapest and decide whether to split.',
      },
      { type: 'h2', text: 'What about Lidl and Aldi?' },
      {
        type: 'p',
        text: 'Lidl and Aldi are widely regarded as cheapest overall in Ireland, but they don\'t offer online grocery shopping, so we can\'t track their prices systematically. Anecdotally, adding a Lidl or Aldi run for basics (tinned goods, cereals, household) on top of a Dunnes or Tesco shop for fresh items is one of the most effective strategies for cutting your weekly bill.',
      },
      { type: 'h2', text: 'How much could you actually save?' },
      {
        type: 'p',
        text: 'Based on our current data: switching from the most expensive store to the cheapest saves up to €12.10 per week. That\'s €630 per year for a household of four. Splitting your shop by category — buying each item at its cheapest store — could save more again. The exact number depends on what you buy, but the direction is clear: loyalty to one store without checking prices is costing you money.',
      },
      {
        type: 'cta',
        heading: 'See which store is cheapest for your shop',
        text: 'Our AI planner shows live prices for every item on your list across Tesco, Dunnes and SuperValu — so you can make the call yourself.',
        link: '/',
        linkText: 'Build my list free →',
      },
    ],
  },
  {
    slug: 'cheapest-supermarket-ireland-2026',
    title: 'Cheapest Supermarket in Ireland 2026: Tesco vs Dunnes vs SuperValu',
    description: 'We tracked prices on 300+ products across Ireland\'s three main supermarkets. Here\'s which one is cheapest — and where you should be buying each category.',
    date: '2026-03-20',
    category: 'Price Comparison',
    readingTime: '5 min read',
    content: [
      {
        type: 'intro',
        text: 'The big question every Irish shopper asks: which supermarket should I actually be using? We track live prices on over 300 products across Tesco, Dunnes Stores and SuperValu twice a week. Here\'s what the data says.',
      },
      { type: 'h2', text: 'The short answer' },
      {
        type: 'p',
        text: 'It depends on what you\'re buying. No single supermarket wins across every category — and splitting your shop can save you significantly more than just picking one store and sticking to it.',
      },
      { type: 'h2', text: 'Overall basket comparison' },
      {
        type: 'p',
        text: 'Across a standard weekly basket of ~80 products covering dairy, meat, veg, fruit, bakery, and staples, here\'s roughly what you\'d pay at each store based on our latest data:',
      },
      {
        type: 'ul',
        items: [
          'Dunnes Stores tends to come out cheapest on own-brand basics — bread, dairy, and staples',
          'Tesco has the widest range and competitive prices on branded goods',
          'SuperValu is often pricier but wins on fresh produce and premium cuts',
        ],
      },
      {
        type: 'tip',
        heading: 'Live data',
        text: 'Our price comparison page shows the current basket totals updated this week — check it for the latest numbers before you shop.',
      },
      { type: 'h2', text: 'Category by category' },
      {
        type: 'p',
        text: 'This is where it gets interesting. The smart move is to split your shop by category:',
      },
      {
        type: 'ul',
        items: [
          'Dairy: Dunnes own-brand milk and cheese typically undercut Tesco and SuperValu',
          'Meat: SuperValu has strong fresh counters but higher per-kg prices. Tesco and Dunnes are closer on packaged cuts',
          'Fruit & veg: SuperValu wins on quality and variety, Dunnes on price',
          'Bakery: Dunnes own-brand bread is consistently among the cheapest',
          'Household & toiletries: Tesco tends to have the best deals with Clubcard pricing',
        ],
      },
      { type: 'h2', text: 'What about Lidl and Aldi?' },
      {
        type: 'p',
        text: 'Lidl and Aldi are widely regarded as the cheapest overall in Ireland — but they don\'t offer online grocery shopping, which makes systematic price tracking impossible. We\'re in talks with Lidl about a data partnership. For now, our comparison covers the five major Irish supermarkets, including Aldi — with prices scraped directly from their websites.',
      },
      { type: 'h2', text: 'How to use this to save money' },
      {
        type: 'ul',
        items: [
          'Use our AI planner to generate your weekly list — it automatically shows the cheapest store for each item',
          'Do a big Dunnes or Tesco run for staples (dairy, bread, tinned goods, household)',
          'Pick up fresh meat and veg at SuperValu or your local market if quality matters',
          'Check Tesco Clubcard prices — some deals are exclusive to card holders and make a big difference',
        ],
      },
      {
        type: 'cta',
        heading: 'See live prices for your area',
        text: 'Our AI planner shows you exactly which store is cheapest for your specific weekly shop — not just averages.',
        link: '/',
        linkText: 'Build my list free →',
      },
    ],
  },
  {
    slug: 'save-money-weekly-shop-ireland',
    title: 'How to Save Money on Your Weekly Shop in Ireland (2026)',
    description: '10 practical ways to cut your grocery bill in Ireland — from switching stores to using the AI planner to find the best prices without spending hours comparing.',
    date: '2026-03-20',
    category: 'Saving Money',
    readingTime: '6 min read',
    content: [
      {
        type: 'intro',
        text: 'Irish grocery prices have risen sharply over the past few years. The average household now spends over €200 a week on food. Here are 10 ways to cut that down — without eating worse.',
      },
      { type: 'h2', text: '1. Know which store is cheapest for each category' },
      {
        type: 'p',
        text: 'No single supermarket wins across every aisle. Dairy might be cheapest in Dunnes, fresh veg in SuperValu, and branded goods in Tesco with a Clubcard. Splitting your shop — even just between two stores — can save €20+ a week.',
      },
      { type: 'h2', text: '2. Build a meal plan before you shop' },
      {
        type: 'p',
        text: 'Impulse buying is the biggest budget killer. Knowing what you\'re cooking before you walk in means you only buy what you need. Use our AI planner — tell it what you want to cook and it generates a full list with live prices.',
      },
      { type: 'h2', text: '3. Get a Tesco Clubcard' },
      {
        type: 'p',
        text: 'Some Tesco Clubcard prices are 20–40% below standard shelf price. It\'s free to get one and takes 5 minutes. If you shop at Tesco even occasionally, it\'s a no-brainer.',
      },
      { type: 'h2', text: '4. Buy own-brand for staples' },
      {
        type: 'p',
        text: 'For basics — tinned tomatoes, pasta, rice, flour, milk, butter — own-brand is almost always as good as the branded version and 30–50% cheaper. Dunnes and Tesco have strong own-brand ranges.',
      },
      { type: 'h2', text: '5. Buy meat in bulk and freeze it' },
      {
        type: 'p',
        text: 'Chicken breasts, mince, and sausages are significantly cheaper per kg when bought in larger packs. Freeze what you don\'t use immediately.',
      },
      { type: 'h2', text: '6. Check the reduced section' },
      {
        type: 'p',
        text: 'Most supermarkets mark down fresh produce and meat in the evening (typically after 6pm). If you shop then, you can pick up quality items for half price. Freeze anything you won\'t use that day.',
      },
      { type: 'h2', text: '7. Don\'t shop hungry' },
      {
        type: 'p',
        text: 'Classic advice for a reason. Hungry shoppers spend an average of 15% more. Eat before you go.',
      },
      { type: 'h2', text: '8. Use frozen vegetables' },
      {
        type: 'p',
        text: 'Frozen veg is cheaper, lasts longer, and (for many products) is nutritionally equivalent to fresh. Frozen peas, spinach, and mixed veg are pantry staples that save money every week.',
      },
      { type: 'h2', text: '9. Plan around what\'s on offer' },
      {
        type: 'p',
        text: 'Supermarkets rotate promotions on meat, fish and produce weekly. Building your meal plan around what\'s cheap this week (rather than a fixed menu) is one of the most effective ways to save.',
      },
      { type: 'h2', text: '10. Track your spend' },
      {
        type: 'p',
        text: 'Awareness is half the battle. Knowing roughly what you spend per week creates natural accountability. Even a quick tally at the checkout changes your habits over time.',
      },
      {
        type: 'cta',
        heading: 'Start with a free shopping list',
        text: 'Tell our AI what you want to cook this week and get a full list with live prices from Tesco, Dunnes and SuperValu — so you know exactly where to shop.',
        link: '/',
        linkText: 'Build my list free →',
      },
    ],
  },
  {
    slug: 'spaghetti-bolognese-ireland-cheapest',
    title: 'How to Make Spaghetti Bolognese for 4 — Cheapest Ingredients in Ireland',
    description: 'A classic family bolognese with real ingredient prices from Tesco, Dunnes Stores and SuperValu. Find out which store gives you the cheapest dinner.',
    date: '2026-03-20',
    category: 'Meal Ideas',
    readingTime: '4 min read',
    content: [
      {
        type: 'intro',
        text: 'Spaghetti bolognese is one of Ireland\'s most-cooked family dinners — and for good reason. It\'s quick, filling, and feeds four for well under €10 if you shop right. Here\'s what it actually costs at each Irish supermarket.',
      },
      { type: 'h2', text: 'Ingredients you\'ll need' },
      {
        type: 'ul',
        items: [
          '500g beef mince',
          '500g spaghetti',
          '2 tins of chopped tomatoes',
          '1 onion',
          '3 garlic cloves',
          '2 tbsp tomato purée',
          'Salt, pepper, and a pinch of mixed herbs',
          'Parmesan or cheddar to serve (optional)',
        ],
      },
      { type: 'h2', text: 'What it costs at each store' },
      {
        type: 'p',
        text: 'Based on our live price data, beef mince is typically the most variable ingredient across stores — it\'s worth checking all three before you shop. Pasta and tinned tomatoes are very close in price across Tesco, Dunnes and SuperValu, so buy those wherever is convenient.',
      },
      {
        type: 'tip',
        heading: 'Pro tip',
        text: 'Own-brand beef mince is usually the same quality as branded — look for 20% fat for flavour. Dunnes and Tesco own-brand are both solid.',
      },
      { type: 'h2', text: 'How to make it (45 minutes)' },
      {
        type: 'ul',
        items: [
          'Fry diced onion in olive oil on medium heat for 5 minutes until soft',
          'Add garlic and cook for another minute',
          'Add beef mince — break it up and cook until browned (8–10 min)',
          'Stir in tomato purée, cook for 2 minutes',
          'Add both tins of chopped tomatoes, season well, simmer on low for 20 minutes',
          'Cook spaghetti according to packet instructions',
          'Serve with grated cheese on top',
        ],
      },
      { type: 'h2', text: 'Make it cheaper' },
      {
        type: 'ul',
        items: [
          'Swap half the mince for red lentils — same texture, half the cost, more fibre',
          'Buy mince in a bigger pack and freeze half for next week',
          'Own-brand spaghetti and tinned tomatoes are just as good as branded',
        ],
      },
      {
        type: 'cta',
        heading: 'Get the full price breakdown',
        text: 'Our AI planner shows live prices for every bolognese ingredient across all major stores — so you know exactly where to shop.',
        link: '/?prompt=Spaghetti bolognese for 4',
        linkText: 'Price up my bolognese →',
      },
    ],
  },
  {
    slug: 'tesco-clubcard-ireland-guide',
    title: 'Tesco Clubcard Ireland: Is It Worth It? (Honest Guide)',
    description: 'Everything you need to know about the Tesco Clubcard in Ireland — how it works, what discounts you actually get, and whether it\'s worth signing up in 2026.',
    date: '2026-03-20',
    category: 'Saving Money',
    readingTime: '4 min read',
    content: [
      {
        type: 'intro',
        text: 'The Tesco Clubcard is free, takes 5 minutes to set up, and can save you a serious amount of money if you shop at Tesco regularly. Here\'s an honest breakdown of how it actually works in Ireland.',
      },
      { type: 'h2', text: 'How it works' },
      {
        type: 'p',
        text: 'You earn 1 point for every €1 spent in Tesco. Every 100 points = €1 in Clubcard vouchers. But the real savings come from Clubcard prices — hundreds of products in store are discounted exclusively for Clubcard members, sometimes by 30–50%.',
      },
      { type: 'h2', text: 'Is the discount real?' },
      {
        type: 'p',
        text: 'Yes — and it\'s significant. We regularly see Clubcard prices that are 20–40% below the standard shelf price on items like meat, cheese, beverages and household products. The headline points scheme is modest, but the in-store pricing is where the value is.',
      },
      { type: 'h2', text: 'How to get one' },
      {
        type: 'ul',
        items: [
          'Sign up online at tesco.ie or in any Tesco store — it\'s free',
          'You\'ll get a physical card in the post (usually within 5–7 days)',
          'Or use the Tesco app immediately while you wait for the card',
          'Show your card or app at checkout to activate Clubcard prices',
        ],
      },
      { type: 'h2', text: 'Clubcard vs Dunnes and SuperValu' },
      {
        type: 'p',
        text: 'Dunnes doesn\'t have a loyalty card scheme. SuperValu has Real Rewards, which gives you vouchers based on spend. Neither offers the in-store price discounting that Tesco Clubcard does — that\'s what makes Tesco\'s scheme stand out.',
      },
      { type: 'h2', text: 'Worth it?' },
      {
        type: 'p',
        text: 'Yes, unconditionally. It\'s free, and Clubcard prices on even a few products can save you €5–10 per week. Even if you do most of your shopping elsewhere, it\'s worth having for the Clubcard-exclusive deals.',
      },
      {
        type: 'cta',
        heading: 'Compare Tesco prices vs Dunnes and SuperValu',
        text: 'See live prices across all major stores for your weekly shop.',
        link: '/compare/supermarket-prices-ireland',
        linkText: 'See price comparison →',
      },
    ],
  },
];

export function getPost(slug: string): BlogPost | undefined {
  return POSTS.find(p => p.slug === slug);
}
