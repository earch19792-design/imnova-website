-- Seller OS staging: allow the existing Product Research wizard checkpoint.
-- This changes only the accepted workflow label; existing reviews remain intact.

alter table public.ebay_command_center_reviews
  drop constraint if exists ebay_command_center_reviews_step_check;

alter table public.ebay_command_center_reviews
  add constraint ebay_command_center_reviews_step_check check (
    current_step in ('luna', 'ebay', 'product_research', 'economics', 'listing', 'review')
  );
