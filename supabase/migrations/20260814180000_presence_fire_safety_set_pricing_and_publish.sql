-- Prices Presence & Fire Safety and takes it out of draft. Uses the shop's
-- existing size-based pricing engine (shop/index.html SIZE_TIERS) rather
-- than a new pricing model — monthly_price/yearly_price here is the
-- "Micro" base that the shop scales by company-size band automatically,
-- same mechanism already live for Flexi/CRM/SmartFits Vehicle Database.
-- Annual price follows the same ~10% discount already used by every
-- published module (monthly * 12 * 0.9).
UPDATE public.marketplace_modules
SET monthly_price = 39.00,
    yearly_price = 421.20,
    status = 'published'
WHERE slug = 'presence-and-fire-safety';
