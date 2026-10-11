import type { BrandRule } from './branded-product-identity';

// Evidence-backed allowlist, not a blacklist followed by 'everything else is
// branded'. Unlisted brands remain unknown. Owners below are the operator named
// by the cited source, not a claim about the ultimate holding company.
export const BRAND_REGISTRY_VERSION = '2026-10-11.1';
const rules: BrandRule[] = [];
function add(names: string[], owner: string | null, source: string, kind: BrandRule['kind'] = 'manufacturer_brand') {
  for (const name of names) rules.push({ name, aliases: [], owner, source, kind, checkedAt: '2026-10-11' });
}
add(['Tesco'], 'Tesco', 'https://www.tesco.com/shop/en-GB/zone/exclusively-at-tesco/', 'retailer_private_label');
add(['SuperValu','Signature Tastes'], 'Musgrave / SuperValu', 'https://supervalu.ie/about/our-approach', 'retailer_private_label');
add(['Dunnes Stores','Simply Better'], 'Dunnes Stores', 'https://www.dunnesstores.com/about/background', 'retailer_private_label');
add(['Stockwell & Co','Hearty Food Co','Creamfields','Ms Mollys','Eastmans','Butchers Choice','Growers Harvest','H W Nevills'],
  'Tesco', 'https://www.tesco.com/shop/en-GB/zone/exclusively-at-tesco/', 'retailer_private_label');
add(['Avonmore','Kilmeaden','Premier Dairies'], 'Tirlán', 'https://www.tirlan.com/our-brands');
add(['Fairy','Flash','Lenor','Febreze','Pampers','Oral-B','Bold','Ariel','Gillette','Head & Shoulders'], 'Procter & Gamble', 'https://www.pg.co.uk/brands/');
add(['Knorr','Hellmanns','Comfort','Domestos','Dove','Cif','Persil'], 'Unilever', 'https://www.unilever.com/brands/all-brands/');
add(['Cadbury','Philadelphia','Oreo','Ritz','Toblerone'], 'Mondelēz International', 'https://www.mondelezinternational.com/our-brands/');
add(['Birds Eye','Goodfellas'], 'Nomad Foods', 'https://www.nomadfoods.com/our-brands/');
add(['Bens Original','Dolmio','Pedigree','Whiskas','Mars','Galaxy','Maltesers','Snickers','Twix'], 'Mars', 'https://www.mars.com/our-brands');
add(['Kelloggs','Pringles'], 'Kellanova', 'https://www.kelloggs.ie/en_IE/home.html');
add(['Batchelors','Jacobs','Odlums'], 'Valeo Foods Ireland', 'https://valeofoods.ie/our-story/');
add(['Chef','Shamrock','Kelkin','Rowse'], 'Valeo Foods Ireland', 'https://odlumsingredients.ie/wp-content/uploads/2024/12/3085-Odlums-ingredients-dec24.pdf');
add(['Schwartz'], 'McCormick', 'https://www.mccormickcorporation.com/brands');
add(['Dr Oetker'], 'Dr. Oetker', 'https://www.oetker.com/about-us/who-we-are/locations-and-brands');
add(['Ellas Kitchen'], 'Ella’s Kitchen', 'https://www.ellaskitchen.co.uk/about');
add(['Flahavans'], 'Flahavan’s', 'https://www.flahavans.ie/');
add(['Colgate','Palmolive'], 'Colgate-Palmolive', 'https://www.colgatepalmolive.com/en-us/brands');
add(['Alpro','Volvic','Activia','Actimel','Evian'], 'Danone', 'https://www.danone.com/brands.html');
add(['Glade','Mr Muscle','Pledge','Duck','Ecover'], 'SC Johnson', 'https://scjohnson.com/en/our-brands');
add(['Lucozade','Ribena'], 'Suntory Beverage & Food', 'https://www.suntorybeverageandfood-europe.com/en-GB/gbi/brands/');
add(['Heinz'], 'Kraft Heinz', 'https://www.heinz.com/en-IE/products');
add(['Tayto','King','Hunky Dorys'], 'Tayto Snacks', 'https://taytosnacks.ie/our-brands/');
add(['Brennans'], 'Brennans Bakeries', 'https://brennansbread.ie/about-us');
add(['John West'], 'Thai Union', 'https://www.john-west.ie/about-us/');
add(['Green Isle'], 'Green Isle Foods', 'https://greenisle.ie/about-us/');
add(['Muller'], 'Müller UK & Ireland', 'https://www.muller.co.uk/about-muller');
add(['KitKat'], 'Nestlé', 'https://www.nestle.com/brands/chocolate-confectionery/kitkat');
add(['Felix'], 'Nestlé Purina', 'https://www.nestle.com/brands/petcare/felix');
add(['Dettol','Vanish','Finish'], 'Reckitt', 'https://www.reckitt.com/us/our-brands/');
add(['Ballygowan','Club','MiWadi','Pepsi','7Up','Cidona'], 'Britvic Ireland (brand operator)', 'https://www.britvicireland.com/about-us/our-company/');
add(['McCain'], 'McCain Foods', 'https://www.mccain.com/about-us/our-business-brands/');
add(['Magnum','Ben & Jerrys','Cornetto','Walls'], 'The Magnum Ice Cream Company', 'https://corporate.magnumicecream.com/en/brands.html');
add(['Kerrygold'], 'Ornua', 'https://www.ornua.com/our-brands/');
add(['Coca-Cola','Fanta','Sprite','Deep RiverRock'], 'Coca-Cola (brand operator)', 'https://www.coca-cola.com/ie/en/brands');
rules.find(r=>r.name==='7Up')!.aliases.push('7 Up');
add(['Haribo'], 'HARIBO', 'https://www.haribo.com/en-gb/about-us/history');
export const BRAND_RULES: BrandRule[] = rules;
