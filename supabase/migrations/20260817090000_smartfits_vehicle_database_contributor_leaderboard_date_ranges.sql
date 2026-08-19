-- Broadens "Top Contributors" to count both employee-submitted change
-- requests AND managers'/admins'/owners' direct vehicle adds (which skip
-- the review queue entirely and previously didn't count toward anything).
-- Also adds optional date-range filtering to both leaderboards so the page
-- can offer This Month / Past 3 Months / This Year / All Time / Custom.
--
-- Direct adds explicitly exclude any vehicle that originated from an
-- approved "new_vehicle" edit request — approveEditRequest() stamps the
-- resulting vdb_vehicles row's created_by as the reviewing manager, but
-- that's not the manager's own contribution to credit twice; the original
-- requester already gets credit via their request count, and the manager
-- already gets credit via the approvals leaderboard.

drop function if exists smartfitsinstallationsltd.vdb_change_request_leaderboard();

create function smartfitsinstallationsltd.vdb_contributor_leaderboard(from_date timestamptz default null, to_date timestamptz default null)
returns table(employee_id uuid, request_count bigint, direct_add_count bigint, total_count bigint)
language sql stable security definer
set search_path to 'public', 'smartfitsinstallationsltd', 'pg_temp'
as $function$
  with requests as (
    select r.requested_by as employee_id, count(*) as request_count
    from smartfitsinstallationsltd.vdb_edit_requests r
    where smartfitsinstallationsltd.vdb_current_employee_id() is not null
      and (from_date is null or r.created_at >= from_date)
      and (to_date is null or r.created_at < to_date)
    group by r.requested_by
  ),
  direct_adds as (
    select v.created_by as employee_id, count(*) as direct_add_count
    from smartfitsinstallationsltd.vdb_vehicles v
    where smartfitsinstallationsltd.vdb_current_employee_id() is not null
      and v.created_by is not null
      and (from_date is null or v.created_at >= from_date)
      and (to_date is null or v.created_at < to_date)
      and not exists (
        select 1 from smartfitsinstallationsltd.vdb_edit_requests r
        where r.vehicle_id = v.id and r.request_type = 'new_vehicle' and r.status = 'approved'
      )
    group by v.created_by
  )
  select
    coalesce(r.employee_id, d.employee_id) as employee_id,
    coalesce(r.request_count, 0) as request_count,
    coalesce(d.direct_add_count, 0) as direct_add_count,
    coalesce(r.request_count, 0) + coalesce(d.direct_add_count, 0) as total_count
  from requests r
  full outer join direct_adds d on d.employee_id = r.employee_id
  order by total_count desc;
$function$;

revoke execute on function smartfitsinstallationsltd.vdb_contributor_leaderboard(timestamptz, timestamptz) from anon;

drop function if exists smartfitsinstallationsltd.vdb_approval_leaderboard();

create function smartfitsinstallationsltd.vdb_approval_leaderboard(from_date timestamptz default null, to_date timestamptz default null)
returns table(employee_id uuid, approval_count bigint)
language sql stable security definer
set search_path to 'public', 'smartfitsinstallationsltd', 'pg_temp'
as $function$
  select r.reviewed_by, count(*)
  from smartfitsinstallationsltd.vdb_edit_requests r
  where smartfitsinstallationsltd.vdb_current_employee_id() is not null
    and r.status = 'approved'
    and r.reviewed_by is not null
    and (from_date is null or r.reviewed_at >= from_date)
    and (to_date is null or r.reviewed_at < to_date)
  group by r.reviewed_by
  order by count(*) desc;
$function$;

revoke execute on function smartfitsinstallationsltd.vdb_approval_leaderboard(timestamptz, timestamptz) from anon;
