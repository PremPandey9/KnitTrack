DO $assert$
BEGIN
  IF (SELECT count(*) FROM public.buyers) <> 2 OR
     (SELECT count(*) FROM public.profiles) <> 5 OR
     (SELECT count(*) FROM public.orders) <> 2 OR
     (SELECT count(*) FROM public.production_updates) <> 8 OR
     (SELECT count(*) FROM public.tna_milestones) <> 2 OR
     (SELECT completed_quantity FROM public.orders
      WHERE po_number='STAGING-DEMO-B-001') <> 20 OR
     (SELECT completed_quantity FROM public.orders
      WHERE po_number='STAGING-DEMO-C-001') <> 0 THEN
    RAISE EXCEPTION 'A duplicate seed attempt changed existing synthetic staging records.';
  END IF;
END;
$assert$;
