# Canonical enrichment proposal — 60 blocked replacement repairs (read-only, revised)

Generated 2026-11-15T20:56Z. Nothing was written. Revision (owner review): brands stated in retailer titles are recognised when structured brand fields are blank, and EVERY attached offer (any retailer) is checked for brand, pack and variant conflicts. Only Dunnes/SuperValu offers may substantiate the core identity; any conflicting offer forces a split.

| Outcome | Count |
|---|---|
| split ready | 4 |
| substantiated | 0 |
| needs split | 56 |
| contradicted | 0 |
| insufficient evidence | 0 |

The two production errors you found are now caught: Flahavan's Hi8 Muesli Original 1kg (Dunnes) conflicts with Lifeforce Muesli 750g on brand (from the title) and pack; Lakeshore Dijon Mustard 200g (Dunnes) conflicts with Maille Dijon Mustard 215g on brand and pack.

## Split-ready (core identity substantiated; every other attached offer is a demonstrably different product)

### Cajun Seasoning [Schwartz] → **Schwartz Cajun Seasoning 44g**

| Store | Role | SKU | Title | Brand (source) | Verdict | Conflicts |
|---|---|---|---|---|---|---|
| tesco | proposed | 257518392 | Schwartz Cajun Seasoning 44g | Schwartz | core | – |
| supervalu | peer | 1020899000 | Schwartz Cajun Seasoning (44 g) | Schwartz (structured) | agrees |  |
| dunnes | peer | 100206328 | Dunnes Stores Cajun Seasoning 35g | Dunnes Stores (title) | conflicts | brand(Dunnes Stores vs Schwartz), pack(35g vs 44g) |
| tesco | current | 289081921 | Tesco Cajun Seasoning 45G | Tesco (title) | conflicts | brand(Tesco vs Schwartz), pack(45g vs 44g) |
| aldi | other | READY, SET…COOK! Cajun Seasoning | READY, SET…COOK! Cajun Seasoning | READY, SET…COOK! (structured) | conflicts | brand(READY, SET…COOK! vs Schwartz) |

### Black Pepper Ground [Schwartz] → **Schwartz Ground Black Pepper 33g**

| Store | Role | SKU | Title | Brand (source) | Verdict | Conflicts |
|---|---|---|---|---|---|---|
| tesco | proposed | 257515124 | Schwartz Ground Black Pepper 33G Jar | Schwartz | core | – |
| dunnes | peer | 100111810 | Schwartz Black Pepper Ground Medium 33g | Schwartz (structured) | conflicts | variant_words |
| supervalu | peer | 1004862000 | Schwartz Black Pepper Ground Jar (33 g) | Schwartz (structured) | agrees |  |
| tesco | current | 256146389 | Tesco Ground Black Pepper 50G | Schwartz (structured) | conflicts | pack(50g vs 33g) |
| lidl | other | – | Kania Ground Black Pepper | Kania (structured) | conflicts | brand(Kania vs Schwartz) |
| aldi | other | SPECIALLY SELECTED Black Pepper Crackers | SPECIALLY SELECTED Black Pepper Crackers | SPECIALLY SELECTED (structured) | conflicts | brand(SPECIALLY SELECTED vs Schwartz) |

### Muesli [Lifeforce] → **Lifeforce Muesli 750g**

| Store | Role | SKU | Title | Brand (source) | Verdict | Conflicts |
|---|---|---|---|---|---|---|
| tesco | proposed | 251970492 | Lifeforce Irish Muesli 750G | LIFEFORCE | core | – |
| supervalu | peer | 1008602002 | Lifeforce Muesli (750 g) | Lifeforce (structured) | agrees |  |
| tesco | current | 315060999 | Flahavan's Hi8 Muesli - Fruit & Nut | Flahavan's (title) | conflicts | brand(Flahavan's vs LIFEFORCE) |
| aldi | other | HARVEST MORN Chocolate Muesli Bars | HARVEST MORN Chocolate Muesli Bars | HARVEST MORN (structured) | conflicts | brand(HARVEST MORN vs LIFEFORCE), variant_qualifier |
| dunnes | peer | 100673561 | Flahavan's Hi8 Muesli Original 1kg | Flahavan's (title) | conflicts | brand(Flahavan's vs LIFEFORCE), pack(1kg vs 750g) |

### Dijon Mustard [Maille] → **Maille Dijon Mustard 215g**

| Store | Role | SKU | Title | Brand (source) | Verdict | Conflicts |
|---|---|---|---|---|---|---|
| tesco | proposed | 250858535 | Maille Dijon Original Mustard 215G | MAILLE | core | – |
| supervalu | peer | 1038275000 | Maille Dijon Mustard (215 g) | Maille (structured) | agrees |  |
| tesco | current | 260691710 | Tesco Dijon Mustard 185g | Tesco (title) | conflicts | brand(Tesco vs MAILLE), pack(185g vs 215g) |
| dunnes | peer | 100173824 | Lakeshore Dijon Mustard 200g | Lakeshore (title) | conflicts | brand(Lakeshore vs MAILLE), pack(200g vs 215g) |
| aldi | other | BRAMWELLS Dijon Mustard | BRAMWELLS Dijon Mustard | BRAMWELLS (structured) | conflicts | brand(BRAMWELLS vs MAILLE) |

## Needs split, core not substantiated (not in the batch)

| Canonical now | Why |
|---|---|
| Granola [Special K] | canonical_brand_contradicts(Special K vs TESCO finest); attached_offers_are_5_different_products; core_identity_not_substantiated; a_split_out_product_lacks_brand_or_pack |
| Mango [–] | attached_offers_are_3_different_products; core_identity_not_substantiated; a_split_out_product_lacks_brand_or_pack |
| Tuna in Water [John West] | attached_offers_are_4_different_products; core_identity_not_substantiated; a_split_out_product_lacks_brand_or_pack |
| Tea Bags 160 Pack [barry's tea] | canonical_brand_contradicts(barry's tea vs BARRYS); attached_offers_are_4_different_products; core_identity_not_substantiated; a_split_out_product_lacks_brand_or_pack |
| Butternut Squash [–] | attached_offers_are_3_different_products; core_identity_not_substantiated; a_split_out_product_lacks_brand_or_pack |
| Broccoli [–] | attached_offers_are_5_different_products; core_identity_not_substantiated; a_split_out_product_lacks_brand_or_pack |
| Custard Creams [McVitie's] | canonical_brand_contradicts(McVitie's vs TESCO); attached_offers_are_5_different_products; core_identity_not_substantiated; a_split_out_product_lacks_brand_or_pack |
| Egg Noodles [–] | attached_offers_are_4_different_products; core_identity_not_substantiated; a_split_out_product_lacks_brand_or_pack |
| Tuna Steak [–] | attached_offers_are_5_different_products; core_identity_not_substantiated; a_split_out_product_lacks_brand_or_pack |
| Pineapple Chunks Tinned [–] | attached_offers_are_3_different_products; core_identity_not_substantiated; a_split_out_product_lacks_brand_or_pack |
| Mackerel Fillets [Unbranded] | canonical_brand_contradicts(Unbranded vs TESCO); attached_offers_are_4_different_products; core_identity_not_substantiated; a_split_out_product_lacks_brand_or_pack |
| Red Kidney Beans 400g [–] | attached_offers_are_3_different_products; core_identity_not_substantiated; a_split_out_product_lacks_brand_or_pack |
| Crisps Ready Salted 6 Pack [Walkers] | canonical_brand_contradicts(Walkers vs TESCO); attached_offers_are_4_different_products; core_identity_not_substantiated; a_split_out_product_lacks_brand_or_pack |
| Curry Sauce Mild [Daily Basics] | canonical_brand_contradicts(Daily Basics vs TESCO); attached_offers_are_6_different_products; core_identity_not_substantiated; a_split_out_product_lacks_brand_or_pack |
| Pork Sausages [–] | attached_offers_are_6_different_products; core_identity_not_substantiated; a_split_out_product_lacks_brand_or_pack |
| Chilli Powder [Schwartz] | canonical_brand_contradicts(Schwartz vs TESCO); attached_offers_are_4_different_products; core_identity_not_substantiated; a_split_out_product_lacks_brand_or_pack |
| Oat Milk Unsweetened [Alpro] | attached_offers_are_5_different_products; core_identity_not_substantiated; a_split_out_product_lacks_brand_or_pack |
| Grapes Seedless 500g [TESCO] | attached_offers_are_4_different_products; core_identity_not_substantiated; a_split_out_product_lacks_brand_or_pack |
| Potatoes 2kg [–] | attached_offers_are_5_different_products; core_identity_not_substantiated |
| Turkey Mince [–] | attached_offers_are_4_different_products; core_identity_not_substantiated; a_split_out_product_lacks_brand_or_pack |
| Table Salt [–] | attached_offers_are_4_different_products; core_identity_not_substantiated; a_split_out_product_lacks_brand_or_pack |
| Mayonnaise [Hellmann's] | attached_offers_are_4_different_products; core_identity_not_substantiated; a_split_out_product_lacks_brand_or_pack |
| Creme Fraiche [–] | attached_offers_are_4_different_products; core_identity_not_substantiated |
| Popcorn Sweet [Keogh's] | canonical_brand_contradicts(Keogh's vs TESCO); attached_offers_are_5_different_products; core_identity_not_substantiated; a_split_out_product_lacks_brand_or_pack |
| Sweet Chilli Sauce [Thai Gold] | canonical_brand_contradicts(Thai Gold vs MAE PLOY); attached_offers_are_5_different_products; core_identity_not_substantiated; a_split_out_product_lacks_brand_or_pack |
| Oat Milk Barista [Oatly!] | attached_offers_are_3_different_products; core_identity_not_substantiated |
| Curry Powder [Schwartz] | canonical_brand_contradicts(Schwartz vs TESCO); attached_offers_are_5_different_products; core_identity_not_substantiated; a_split_out_product_lacks_brand_or_pack |
| Baked Beans [Heinz] | attached_offers_are_5_different_products; core_identity_not_substantiated; a_split_out_product_lacks_brand_or_pack |
| Wholegrain Mustard [Lakeshore] | canonical_brand_contradicts(Lakeshore vs TESCO); attached_offers_are_4_different_products; core_identity_not_substantiated; a_split_out_product_lacks_brand_or_pack |
| Chopped Tomatoes 400g [–] | attached_offers_are_6_different_products; core_identity_not_substantiated; a_split_out_product_lacks_brand_or_pack |
| Bran Flakes [Kellogg's] | attached_offers_are_5_different_products; core_identity_not_substantiated; a_split_out_product_lacks_brand_or_pack |
| Cream Cheese [Philadelphia] | canonical_brand_contradicts(Philadelphia vs KERRYGOLD); attached_offers_are_3_different_products; core_identity_not_substantiated |
| Cheddar Cheese Block [–] | attached_offers_are_4_different_products; core_identity_not_substantiated |
| Coconut Milk Drink [OKF] | canonical_brand_contradicts(OKF vs alpro); attached_offers_are_4_different_products; core_identity_not_substantiated |
| Beef Steak Sirloin [–] | attached_offers_are_5_different_products; core_identity_not_substantiated; a_split_out_product_lacks_brand_or_pack |
| Shreddies [Shreddies] | attached_offers_are_2_different_products; core_identity_not_substantiated |
| Instant Coffee 100g [–] | attached_offers_are_5_different_products; core_identity_not_substantiated; a_split_out_product_lacks_brand_or_pack |
| Smoked Salmon [–] | attached_offers_are_5_different_products; core_identity_not_substantiated; a_split_out_product_lacks_brand_or_pack |
| Oyster Sauce [Thai Gold] | canonical_brand_contradicts(Thai Gold vs GO TAN); attached_offers_are_3_different_products; core_identity_not_substantiated |
| Greek Style Yogurt Plain [–] | attached_offers_are_6_different_products; core_identity_not_substantiated; a_split_out_product_lacks_brand_or_pack |
| Mixed Dried Fruit [–] | attached_offers_are_4_different_products; core_identity_not_substantiated |
| Vanilla Extract [Goodall's] | canonical_brand_contradicts(Goodall's vs Dr. Oetker); attached_offers_are_5_different_products; core_identity_not_substantiated; a_split_out_product_lacks_brand_or_pack |
| Baking Powder [Odlums] | canonical_brand_contradicts(Odlums vs GEM); attached_offers_are_5_different_products; core_identity_not_substantiated; a_split_out_product_lacks_brand_or_pack |
| Ready Meal Lasagne [Meals Made Easy] | attached_offers_are_3_different_products; core_identity_not_substantiated; a_split_out_product_lacks_brand_or_pack |
| BBQ Sauce [Chef] | canonical_brand_contradicts(Chef vs HEINZ); attached_offers_are_5_different_products; core_identity_not_substantiated; a_split_out_product_lacks_brand_or_pack |
| Roast Chicken Slices [–] | attached_offers_are_4_different_products; core_identity_not_substantiated; a_split_out_product_lacks_brand_or_pack |
| Pesto Green [–] | attached_offers_are_5_different_products; core_identity_not_substantiated; a_split_out_product_lacks_brand_or_pack |
| Naan Bread 2 Pack [Fitzgeralds Family Bakery] | canonical_brand_contradicts(Fitzgeralds Family Bakery vs TESCO); attached_offers_are_3_different_products; core_identity_not_substantiated |
| Tomato Ketchup [Heinz] | attached_offers_are_5_different_products; core_identity_not_substantiated; a_split_out_product_lacks_brand_or_pack |
| Sweetcorn Tinned 340g [Green giant] | attached_offers_are_2_different_products; core_identity_not_substantiated |
| Strawberry Jam [–] | attached_offers_are_5_different_products; core_identity_not_substantiated; a_split_out_product_lacks_brand_or_pack |
| Marmalade [–] | attached_offers_are_5_different_products; core_identity_not_substantiated; a_split_out_product_lacks_brand_or_pack |
| Worcestershire Sauce [Goodall's of Ireland] | canonical_brand_contradicts(Goodall's of Ireland vs TESCO); attached_offers_are_4_different_products; core_identity_not_substantiated; a_split_out_product_lacks_brand_or_pack |
| Teriyaki Sauce [Kikkoman] | canonical_brand_contradicts(Kikkoman vs BLUE DRAGON); attached_offers_are_5_different_products; core_identity_not_substantiated; a_split_out_product_lacks_brand_or_pack |
| Fresh Whole Milk 2L [–] | attached_offers_are_4_different_products; core_identity_not_substantiated |
| Hoisin Sauce [–] | attached_offers_are_5_different_products; core_identity_not_substantiated; a_split_out_product_lacks_brand_or_pack |
