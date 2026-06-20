-- =============================================================================
-- Fix invalid organization_members.org_id (e.g. placeholder "your_org_id_here")
-- Run in Supabase → SQL Editor while logged into your project.
-- =============================================================================

-- 1) Inspect your data
SELECT
  u.email,
  om.user_id,
  om.org_id,
  om.role,
  o.business_name
FROM organization_members om
LEFT JOIN auth.users u ON u.id = om.user_id
LEFT JOIN organizations o ON o.id = om.org_id;

SELECT id, business_name, created_at FROM organizations ORDER BY created_at;

-- 2) Remove invalid membership rows (placeholder or broken org_id)
DELETE FROM organization_members
WHERE org_id::text = 'your_org_id_here'
   OR org_id IS NULL
   OR NOT (org_id::text ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$');

-- If DELETE fails because org_id is not uuid type, use:
-- DELETE FROM organization_members WHERE org_id = 'your_org_id_here';

-- 3) Link your user to a real organization
-- Replace YOUR_EMAIL and pick the org id from the organizations query above.
--
-- INSERT INTO organization_members (org_id, user_id, role)
-- SELECT
--   o.id,
--   u.id,
--   'owner'
-- FROM organizations o
-- CROSS JOIN auth.users u
-- WHERE u.email = 'YOUR_EMAIL@example.com'
--   AND o.business_name = 'Your Business Name'
-- ON CONFLICT (org_id, user_id) DO NOTHING;

-- 4) If you have NO organizations row, sign up again at /signup
-- or create one from /admin/tenants/new (platform admin).
