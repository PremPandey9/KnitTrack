-- KnitTrack core RLS, grants, and RPCs for a NEW Supabase project.
-- Apply after 20261109090001_core_schema.sql. Do not apply to production as part
-- of staging setup. Run under the trusted postgres migration owner.

BEGIN;

-- These SECURITY DEFINER helpers return only the current caller's own role or
-- buyer_id. The search_path is pinned and all table/function references are
-- schema-qualified. Ownership is explicitly postgres for Phase 2 compatibility.
CREATE FUNCTION public.current_user_role()
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO pg_catalog, public, auth
AS $function$
  SELECT p.role
  FROM public.profiles AS p
  WHERE p.id = auth.uid()
$function$;
ALTER FUNCTION public.current_user_role() OWNER TO postgres;

CREATE FUNCTION public.current_user_buyer_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO pg_catalog, public, auth
AS $function$
  SELECT CASE WHEN p.role = 'buyer' THEN p.buyer_id ELSE NULL END
  FROM public.profiles AS p
  WHERE p.id = auth.uid()
$function$;
ALTER FUNCTION public.current_user_buyer_id() OWNER TO postgres;

REVOKE ALL ON FUNCTION public.current_user_role() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.current_user_buyer_id() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.current_user_role() TO authenticated;
GRANT EXECUTE ON FUNCTION public.current_user_buyer_id() TO authenticated;

-- Buyers can see only their own buyer row; merchandisers need the list for
-- order creation. No authenticated buyer-management writes are granted.
CREATE POLICY buyers_read_by_role ON public.buyers
  FOR SELECT TO authenticated
  USING (
    public.current_user_role() = 'merchandiser' OR
    (public.current_user_role() = 'buyer' AND id = public.current_user_buyer_id())
  );

-- Users can read their own profile. Merchandisers can read profiles for order
-- supervisor assignment. No app role can insert/update a profile or self-assign.
CREATE POLICY profiles_read_own_or_merchandiser ON public.profiles
  FOR SELECT TO authenticated
  USING (id = auth.uid() OR public.current_user_role() = 'merchandiser');

CREATE POLICY orders_read_by_role ON public.orders
  FOR SELECT TO authenticated
  USING (
    public.current_user_role() = 'merchandiser' OR
    (public.current_user_role() = 'supervisor' AND assigned_supervisor_id = auth.uid()) OR
    (public.current_user_role() = 'buyer' AND buyer_id = public.current_user_buyer_id())
  );

CREATE POLICY orders_insert_merchandiser ON public.orders
  FOR INSERT TO authenticated
  WITH CHECK (
    public.current_user_role() = 'merchandiser' AND completed_quantity = 0 AND
    (assigned_supervisor_id IS NULL OR EXISTS (
      SELECT 1 FROM public.profiles AS s
      WHERE s.id = assigned_supervisor_id AND s.role = 'supervisor'
    ))
  );

-- The application directly changes only assigned_supervisor_id. Final stage
-- changes go through configure_order_final_stage(); progress changes are made
-- by the protected production-update trigger path below.
CREATE POLICY orders_assign_supervisor_merchandiser ON public.orders
  FOR UPDATE TO authenticated
  USING (public.current_user_role() = 'merchandiser')
  WITH CHECK (
    public.current_user_role() = 'merchandiser' AND
    (assigned_supervisor_id IS NULL OR EXISTS (
      SELECT 1 FROM public.profiles AS s
      WHERE s.id = assigned_supervisor_id AND s.role = 'supervisor'
    ))
  );

CREATE POLICY production_updates_read_by_role ON public.production_updates
  FOR SELECT TO authenticated
  USING (
    public.current_user_role() = 'merchandiser' OR
    EXISTS (
      SELECT 1 FROM public.orders AS o
      WHERE o.id = production_updates.order_id AND (
        (public.current_user_role() = 'supervisor' AND o.assigned_supervisor_id = auth.uid()) OR
        (public.current_user_role() = 'buyer' AND o.buyer_id = public.current_user_buyer_id())
      )
    )
  );

CREATE POLICY production_updates_insert_authorized ON public.production_updates
  FOR INSERT TO authenticated
  WITH CHECK (
    photo_url = '' AND
    (
      (public.current_user_role() = 'merchandiser' AND supervisor_id IS NULL) OR
      (public.current_user_role() = 'supervisor' AND supervisor_id = auth.uid() AND EXISTS (
        SELECT 1 FROM public.orders AS o
        WHERE o.id = production_updates.order_id AND o.assigned_supervisor_id = auth.uid()
      ))
    )
  );

CREATE POLICY tna_milestones_read_by_order_role ON public.tna_milestones
  FOR SELECT TO authenticated
  USING (
    public.current_user_role() = 'merchandiser' OR
    EXISTS (
      SELECT 1 FROM public.orders AS o
      WHERE o.id = tna_milestones.order_id AND
        public.current_user_role() = 'buyer' AND
        o.buyer_id = public.current_user_buyer_id()
    )
  );

CREATE POLICY tna_milestones_insert_merchandiser ON public.tna_milestones
  FOR INSERT TO authenticated
  WITH CHECK (public.current_user_role() = 'merchandiser');
CREATE POLICY tna_milestones_update_merchandiser ON public.tna_milestones
  FOR UPDATE TO authenticated
  USING (public.current_user_role() = 'merchandiser')
  WITH CHECK (public.current_user_role() = 'merchandiser');
CREATE POLICY tna_milestones_delete_merchandiser ON public.tna_milestones
  FOR DELETE TO authenticated
  USING (public.current_user_role() = 'merchandiser');

-- A BEFORE trigger locks the order before checking assignment and quantity.
-- It also fixes attribution/photo values even if a caller inserts directly.
-- The table owner is postgres; orders/profiles are intentionally not FORCE RLS
-- so this narrowly scoped definer check can read their rows. The trigger still
-- checks auth.uid(), the profile role, and current order assignment itself.
CREATE FUNCTION public._knittrack_validate_production_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO pg_catalog, public, auth
AS $function$
DECLARE
  v_actor uuid := auth.uid();
  v_role text;
  v_order public.orders%ROWTYPE;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'An authenticated user is required.' USING ERRCODE = '28000';
  END IF;
  SELECT p.role INTO v_role FROM public.profiles AS p WHERE p.id = v_actor;
  IF v_role IS NULL OR v_role NOT IN ('merchandiser', 'supervisor') THEN
    RAISE EXCEPTION 'Only a merchandiser or supervisor may submit a production update.' USING ERRCODE = '42501';
  END IF;
  IF NEW.order_id IS NULL THEN
    RAISE EXCEPTION 'An order is required.' USING ERRCODE = '22023';
  END IF;
  SELECT o.* INTO v_order
  FROM public.orders AS o
  WHERE o.id = NEW.order_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'The order is unavailable.' USING ERRCODE = 'P0002';
  END IF;
  IF v_order.total_quantity IS NULL THEN
    RAISE EXCEPTION 'The order total quantity must be configured.' USING ERRCODE = '22023';
  END IF;
  IF v_role = 'supervisor' AND v_order.assigned_supervisor_id IS DISTINCT FROM v_actor THEN
    RAISE EXCEPTION 'A supervisor may update only an order assigned to them.' USING ERRCODE = '42501';
  END IF;
  IF NEW.stage IS NULL OR btrim(NEW.stage) = '' THEN
    RAISE EXCEPTION 'Production stage is required.' USING ERRCODE = '22023';
  END IF;
  NEW.stage := btrim(NEW.stage);
  IF lower(NEW.stage) NOT IN (
    'cutting', 'knitting', 'dyeing', 'sewing', 'stitching', 'printing',
    'finishing', 'quality check', 'packing'
  ) THEN
    RAISE EXCEPTION 'Unsupported production stage.' USING ERRCODE = '22023';
  END IF;
  IF NEW.quantity_completed IS NULL OR NEW.quantity_completed <= 0 THEN
    RAISE EXCEPTION 'Daily quantity must be a positive whole number.' USING ERRCODE = '22023';
  END IF;
  IF NEW.update_date IS NULL THEN
    RAISE EXCEPTION 'Update date is required.' USING ERRCODE = '22023';
  END IF;
  IF char_length(coalesce(NEW.issue_note, '')) > 2000 THEN
    RAISE EXCEPTION 'Issue note must be at most 2000 characters.' USING ERRCODE = '22023';
  END IF;
  NEW.issue_note := nullif(btrim(coalesce(NEW.issue_note, '')), '');
  NEW.photo_url := '';
  IF v_role = 'supervisor' THEN
    NEW.supervisor_id := v_actor;
  ELSE
    NEW.supervisor_id := NULL;
  END IF;
  IF v_order.final_production_stage IS NOT NULL AND
     lower(btrim(NEW.stage)) = lower(btrim(v_order.final_production_stage)) AND
     v_order.completed_quantity + NEW.quantity_completed > v_order.total_quantity THEN
    RAISE EXCEPTION 'Finished-goods output cannot exceed the order total.' USING ERRCODE = '22023';
  END IF;
  RETURN NEW;
END;
$function$;
ALTER FUNCTION public._knittrack_validate_production_update() OWNER TO postgres;

-- The AFTER trigger updates progress in the same transaction as history. An
-- intermediate-stage quantity remains history throughput and is never added to
-- finished quantity. Row locking in the BEFORE trigger serializes final output.
CREATE FUNCTION public._knittrack_apply_production_progress()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO pg_catalog, public, auth
AS $function$
BEGIN
  UPDATE public.orders AS o
  SET current_stage = NEW.stage,
      completed_quantity = CASE
        WHEN o.final_production_stage IS NOT NULL AND
             lower(btrim(NEW.stage)) = lower(btrim(o.final_production_stage))
          THEN o.completed_quantity + NEW.quantity_completed
        ELSE o.completed_quantity
      END
  WHERE o.id = NEW.order_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Order progress update failed.' USING ERRCODE = 'P0002';
  END IF;
  RETURN NULL;
END;
$function$;
ALTER FUNCTION public._knittrack_apply_production_progress() OWNER TO postgres;

CREATE TRIGGER production_updates_validate_before_insert
  BEFORE INSERT ON public.production_updates
  FOR EACH ROW EXECUTE FUNCTION public._knittrack_validate_production_update();
CREATE TRIGGER production_updates_apply_order_progress
  AFTER INSERT ON public.production_updates
  FOR EACH ROW EXECUTE FUNCTION public._knittrack_apply_production_progress();

CREATE FUNCTION public.submit_production_update(
  p_order_id uuid,
  p_stage text,
  p_quantity_completed numeric,
  p_issue_note text,
  p_update_date date
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path TO pg_catalog, public, auth
AS $function$
DECLARE
  v_actor uuid := auth.uid();
  v_role text;
  v_stage text := btrim(coalesce(p_stage, ''));
  v_quantity integer;
  v_order public.orders%ROWTYPE;
  v_update_id uuid;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'An authenticated user is required.' USING ERRCODE = '28000';
  END IF;
  SELECT p.role INTO v_role FROM public.profiles AS p WHERE p.id = v_actor;
  IF v_role IS NULL OR v_role NOT IN ('merchandiser', 'supervisor') THEN
    RAISE EXCEPTION 'Only a merchandiser or supervisor may submit a production update.' USING ERRCODE = '42501';
  END IF;
  IF v_stage = '' THEN
    RAISE EXCEPTION 'Production stage is required.' USING ERRCODE = '22023';
  END IF;
  IF lower(v_stage) NOT IN (
    'cutting', 'knitting', 'dyeing', 'sewing', 'stitching', 'printing',
    'finishing', 'quality check', 'packing'
  ) THEN
    RAISE EXCEPTION 'Unsupported production stage.' USING ERRCODE = '22023';
  END IF;
  IF p_quantity_completed IS NULL OR p_quantity_completed <= 0 OR
     p_quantity_completed <> trunc(p_quantity_completed) OR
     p_quantity_completed > 2147483647 THEN
    RAISE EXCEPTION 'Daily quantity must be a positive whole integer no greater than 2147483647.' USING ERRCODE = '22023';
  END IF;
  v_quantity := p_quantity_completed::integer;
  IF p_update_date IS NULL THEN
    RAISE EXCEPTION 'Update date is required.' USING ERRCODE = '22023';
  END IF;
  IF char_length(coalesce(p_issue_note, '')) > 2000 THEN
    RAISE EXCEPTION 'Issue note must be at most 2000 characters.' USING ERRCODE = '22023';
  END IF;
  SELECT o.* INTO v_order
  FROM public.orders AS o
  WHERE o.id = p_order_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'The order is not accessible.' USING ERRCODE = 'P0002';
  END IF;
  IF v_order.total_quantity IS NULL THEN
    RAISE EXCEPTION 'The order total quantity must be configured.' USING ERRCODE = '22023';
  END IF;
  IF v_role = 'supervisor' AND v_order.assigned_supervisor_id IS DISTINCT FROM v_actor THEN
    RAISE EXCEPTION 'A supervisor may update only an order assigned to them.' USING ERRCODE = '42501';
  END IF;

  INSERT INTO public.production_updates
    (order_id, stage, quantity_completed, issue_note, photo_url, update_date, supervisor_id)
  VALUES
    (p_order_id, v_stage, v_quantity,
     nullif(btrim(coalesce(p_issue_note, '')), ''), '', p_update_date,
     CASE WHEN v_role = 'supervisor' THEN v_actor ELSE NULL END)
  RETURNING id INTO v_update_id;
  RETURN v_update_id;
END;
$function$;
ALTER FUNCTION public.submit_production_update(uuid, text, numeric, text, date) OWNER TO postgres;

-- The SECURITY DEFINER configuration RPC updates only final_production_stage.
-- It derives the actor from auth.uid() and independently checks the profile role.
CREATE FUNCTION public.configure_order_final_stage(
  p_order_id uuid,
  p_final_production_stage text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO pg_catalog, public, auth
AS $function$
DECLARE
  v_actor uuid := auth.uid();
  v_stage text := btrim(coalesce(p_final_production_stage, ''));
  v_role text;
  v_existing_stage text;
  v_completed_quantity integer;
  v_order_id uuid;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'An authenticated user is required.' USING ERRCODE = '28000';
  END IF;
  SELECT p.role INTO v_role FROM public.profiles AS p WHERE p.id = v_actor;
  IF v_role IS DISTINCT FROM 'merchandiser' THEN
    RAISE EXCEPTION 'Only merchandisers may configure a final production stage.' USING ERRCODE = '42501';
  END IF;
  IF v_stage NOT IN (
    'Cutting', 'Knitting', 'Dyeing', 'Sewing', 'Stitching', 'Printing',
    'Finishing', 'Quality Check', 'Packing'
  ) THEN
    RAISE EXCEPTION 'Unsupported final production stage.' USING ERRCODE = '22023';
  END IF;
  SELECT o.final_production_stage, o.completed_quantity
    INTO v_existing_stage, v_completed_quantity
  FROM public.orders AS o
  WHERE o.id = p_order_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'The order does not exist.' USING ERRCODE = 'P0002';
  END IF;
  IF v_completed_quantity > 0 AND
     lower(btrim(v_existing_stage)) IS DISTINCT FROM lower(btrim(v_stage)) THEN
    RAISE EXCEPTION 'Final production stage cannot be changed after finished units have been counted. Reconcile existing finished quantities separately before changing the stage.'
      USING ERRCODE = '22023';
  END IF;
  UPDATE public.orders AS o
  SET final_production_stage = v_stage
  WHERE o.id = p_order_id
  RETURNING o.id INTO v_order_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'The order does not exist.' USING ERRCODE = 'P0002';
  END IF;
  RETURN v_order_id;
END;
$function$;
ALTER FUNCTION public.configure_order_final_stage(uuid, text) OWNER TO postgres;

-- Least privilege for cookie-authenticated PostgREST requests. No authenticated
-- profile/buyer writes, no order deletes, no production-history edits/deletes,
-- and no anonymous access. Order progress columns are not granted directly.
REVOKE ALL ON TABLE public.buyers, public.profiles, public.orders,
  public.production_updates, public.tna_milestones FROM PUBLIC, anon, authenticated;
GRANT USAGE ON SCHEMA public, auth TO authenticated;
GRANT SELECT ON TABLE public.buyers, public.profiles, public.orders,
  public.production_updates, public.tna_milestones TO authenticated;
GRANT INSERT (po_number, buyer_id, style_name, colour, total_quantity,
  completed_quantity, current_stage, ex_factory_date, final_production_stage)
  ON TABLE public.orders TO authenticated;
GRANT UPDATE (assigned_supervisor_id) ON TABLE public.orders TO authenticated;
GRANT INSERT (order_id, stage, quantity_completed, issue_note, photo_url,
  update_date, supervisor_id) ON TABLE public.production_updates TO authenticated;
GRANT INSERT (order_id, milestone_name, planned_date, actual_date, status)
  ON TABLE public.tna_milestones TO authenticated;
GRANT UPDATE (milestone_name, planned_date, actual_date, status)
  ON TABLE public.tna_milestones TO authenticated;
GRANT DELETE ON TABLE public.tna_milestones TO authenticated;

REVOKE ALL ON FUNCTION public.submit_production_update(uuid, text, numeric, text, date)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.configure_order_final_stage(uuid, text)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._knittrack_validate_production_update()
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._knittrack_apply_production_progress()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.submit_production_update(uuid, text, numeric, text, date)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.configure_order_final_stage(uuid, text)
  TO authenticated;

COMMIT;
