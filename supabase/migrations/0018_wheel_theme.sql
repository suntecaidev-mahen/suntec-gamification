-- =============================================================================
-- 0018 · Brighter spin-wheel theme (Suntec City logo colours)
-- Updates the demo Year-End Spin segments from the old dark orange colours to the
-- new palette. Only segments still using the original demo colours are changed,
-- so colours chosen by admins are left alone. Safe to re-run.
-- =============================================================================
update public.game_outcomes o
   set display = o.display || jsonb_build_object('color', v.new_color, 'text_color', v.new_text)
  from (values
    ('22000000-0000-4000-8000-000000000003'::uuid, '#C2410C', '#0369A1', '#FFFFFF'),  -- Bonus Spin → Suntec blue
    ('22000000-0000-4000-8000-000000000004'::uuid, '#FED7AA', '#FDE68A', '#1F2937'),  -- 50 Points → gold
    ('22000000-0000-4000-8000-000000000005'::uuid, '#F97316', '#15803D', '#FFFFFF'),  -- Free Kopi → Suntec green
    ('22000000-0000-4000-8000-000000000006'::uuid, '#FFFFFF', '#FFEDD5', '#9A3412'),  -- 100 Suntec+ Pts → peach
    ('22000000-0000-4000-8000-000000000007'::uuid, '#9A3412', '#DC2626', '#FFFFFF'),  -- $10 Voucher → Suntec red
    ('22000000-0000-4000-8000-000000000008'::uuid, '#FFEDD5', '#E0F2FE', '#0369A1'),  -- Try Again → sky
    ('22000000-0000-4000-8000-000000000002'::uuid, '#FFFFFF', '#FFFFFF', '#C2410C')   -- $5 Dining → white, orange text
  ) as v(id, old_color, new_color, new_text)
 where o.id = v.id and upper(coalesce(o.display->>'color', '')) = v.old_color;
