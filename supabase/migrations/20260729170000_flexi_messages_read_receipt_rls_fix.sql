-- ============================================================================
-- SmartCore Flexi — fix trainer "mark as read" RLS bug.
--
-- smartcore_flexi_messages_staff was FOR ALL with WITH CHECK requiring
-- sender_type = 'trainer'. That check also gates UPDATE, so a trainer
-- marking a client-sent message as read (read_at set, sender_type left as
-- 'client') always failed the WITH CHECK and silently updated zero rows.
-- Split the policy per command so UPDATE isn't subject to the
-- insert-only sender_type restriction.
-- ============================================================================

DROP POLICY IF EXISTS smartcore_flexi_messages_staff ON public.smartcore_flexi_messages;

CREATE POLICY smartcore_flexi_messages_staff_select ON public.smartcore_flexi_messages
  FOR SELECT USING (
    public.flexi_has_permission(company_id, 'flexi.send_messages')
    AND client_id IN (
      SELECT c.id FROM public.smartcore_flexi_clients c
      WHERE c.company_id = smartcore_flexi_messages.company_id
        AND (public.flexi_is_admin(c.company_id) OR c.trainer_id IS NULL OR c.trainer_id = public.flexi_current_employee_id(c.company_id))
    )
  );

CREATE POLICY smartcore_flexi_messages_staff_insert ON public.smartcore_flexi_messages
  FOR INSERT WITH CHECK (
    public.flexi_has_permission(company_id, 'flexi.send_messages')
    AND sender_type = 'trainer'
    AND client_id IN (
      SELECT c.id FROM public.smartcore_flexi_clients c
      WHERE c.company_id = smartcore_flexi_messages.company_id
        AND (public.flexi_is_admin(c.company_id) OR c.trainer_id IS NULL OR c.trainer_id = public.flexi_current_employee_id(c.company_id))
    )
  );

CREATE POLICY smartcore_flexi_messages_staff_update ON public.smartcore_flexi_messages
  FOR UPDATE USING (
    public.flexi_has_permission(company_id, 'flexi.send_messages')
    AND client_id IN (
      SELECT c.id FROM public.smartcore_flexi_clients c
      WHERE c.company_id = smartcore_flexi_messages.company_id
        AND (public.flexi_is_admin(c.company_id) OR c.trainer_id IS NULL OR c.trainer_id = public.flexi_current_employee_id(c.company_id))
    )
  ) WITH CHECK (
    public.flexi_has_permission(company_id, 'flexi.send_messages')
  );

CREATE POLICY smartcore_flexi_messages_staff_delete ON public.smartcore_flexi_messages
  FOR DELETE USING (
    public.flexi_has_permission(company_id, 'flexi.send_messages')
    AND client_id IN (
      SELECT c.id FROM public.smartcore_flexi_clients c
      WHERE c.company_id = smartcore_flexi_messages.company_id
        AND (public.flexi_is_admin(c.company_id) OR c.trainer_id IS NULL OR c.trainer_id = public.flexi_current_employee_id(c.company_id))
    )
  );
