DO $assert$
BEGIN
  IF (SELECT count(*) FROM public.buyers) <> 0 OR
     (SELECT count(*) FROM public.profiles) <> 0 OR
     (SELECT count(*) FROM public.orders) <> 0 OR
     (SELECT count(*) FROM public.production_updates) <> 0 OR
     (SELECT count(*) FROM public.tna_milestones) <> 0 THEN
    RAISE EXCEPTION 'The missing-Auth-user seed attempt left partial records.';
  END IF;
END;
$assert$;
