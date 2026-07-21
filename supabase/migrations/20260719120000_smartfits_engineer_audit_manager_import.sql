-- ============================================================================
-- Smartfits Engineer Install Audit — bulk import of engineer -> manager
-- assignments supplied by the Smartfits Operations Director. Nicknames
-- resolved: Dan = Daniel Bittlinski, Ben = Ben Weston, Tara = Tara Hassall,
-- James = James Davey, Kevin = Kevin Porter, Oli = Oli Hassall,
-- Liam = Liam Maunder. Rows with manager "NA" are omitted (no assignment).
-- "Jordan Horgan" and "Mark McIvor" from the source list have no matching
-- core_employees record for this company and are intentionally skipped.
-- ============================================================================

-- Round out the Senior Regional Engineering Manager roster with the extra
-- names that show up as managers/mentors in the import (Tara, Kevin, Liam
-- were not previously on the roster; Ben/Dan/James/Oli already were).
UPDATE smartfitsinstallationsltd.audit_settings
SET manager_employee_ids = (
  SELECT array_agg(DISTINCT id) FROM (
    SELECT unnest(manager_employee_ids) AS id
    UNION
    SELECT id FROM public.core_employees
    WHERE company_id = '34c3dc62-25dc-4159-b159-ae7b24479bee'
      AND full_name IN ('Tara Hassall', 'Kevin Porter', 'Liam Maunder')
  ) x
)
WHERE id = '00000000-0000-0000-0000-000000000001';

WITH company AS (
  SELECT '34c3dc62-25dc-4159-b159-ae7b24479bee'::uuid AS id
),
pairs(engineer_name, manager_name) AS (
  VALUES
    ('Danny Baty', 'Daniel Bittlinski'),
    ('Nick Fossick', 'Ben Weston'),
    ('John Gunn', 'Daniel Bittlinski'),
    ('James Hassall', 'Daniel Bittlinski'),
    ('David Hunt', 'Daniel Bittlinski'),
    ('Jack McCormack', 'Daniel Bittlinski'),
    ('Simon Parker', 'Ben Weston'),
    ('Mike Phillips', 'Daniel Bittlinski'),
    ('Kevin Porter', 'Daniel Bittlinski'),
    ('Dave Redfern', 'Ben Weston'),
    ('Paul Smith', 'Ben Weston'),
    ('Harry Teagle', 'Ben Weston'),
    ('Richard Wigley', 'Ben Weston'),
    ('Keiran Morley', 'Ben Weston'),
    ('Alex Goodhall', 'Ben Weston'),
    ('Liam Maunder', 'Daniel Bittlinski'),
    ('Sean Andrews', 'Ben Weston'),
    ('Gary Buchanan', 'Daniel Bittlinski'),
    ('Adrian Sandrasegaram', 'Daniel Bittlinski'),
    ('Shannon Porter', 'Kevin Porter'),
    ('Shannon Porter', 'Oli Hassall'),
    ('Daniel Maunder', 'Liam Maunder'),
    ('Daniel Maunder', 'Oli Hassall'),
    ('Patrick Pal', 'Ben Weston'),
    ('Gethin Morgan-Jones', 'Daniel Bittlinski'),
    ('Cristian Apopei', 'James Davey'),
    ('Luke Lankester', 'James Davey'),
    ('Abdul Rashid', 'James Davey'),
    ('Henly Nicholas', 'James Davey'),
    ('Harry Watson', 'James Davey'),
    ('Paul Crookes', 'James Davey'),
    ('Andrew Robson', 'James Davey'),
    ('Stephen Millard', 'James Davey')
),
resolved AS (
  SELECT
    eng.id AS engineer_employee_id,
    mgr.id AS manager_employee_id
  FROM pairs p
  JOIN public.core_employees eng ON eng.full_name = p.engineer_name AND eng.company_id = (SELECT id FROM company)
  JOIN public.core_employees mgr ON mgr.full_name = p.manager_name AND mgr.company_id = (SELECT id FROM company)
)
INSERT INTO smartfitsinstallationsltd.audit_manager_assignments (engineer_employee_id, manager_employee_id, is_active)
SELECT r.engineer_employee_id, r.manager_employee_id, true
FROM resolved r
WHERE NOT EXISTS (
  SELECT 1 FROM smartfitsinstallationsltd.audit_manager_assignments a
  WHERE a.engineer_employee_id = r.engineer_employee_id
    AND a.manager_employee_id = r.manager_employee_id
    AND a.is_active
);

-- Two stray assignments predating this import didn't match the supplied
-- list (leftover from earlier manual testing of Manage Assignments) —
-- deactivate them so the roster matches the source list exactly.
UPDATE smartfitsinstallationsltd.audit_manager_assignments a
SET is_active = false
FROM public.core_employees eng, public.core_employees mgr
WHERE a.engineer_employee_id = eng.id AND a.manager_employee_id = mgr.id AND a.is_active
  AND (
    (eng.full_name = 'Danny Baty' AND mgr.full_name = 'Finley Hassall')
    OR (eng.full_name = 'Daniel Maunder' AND mgr.full_name = 'Daniel Bittlinski')
  );
