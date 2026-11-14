import { fail, validId } from './errors.js';

export const COMPANY_COOKIE = 'weconnect_company';
const common = ['overview:view', 'projects:view', 'team:view', 'notifications:view'];
export const COMPANY_PERMISSIONS = {
  Owner: [...common, 'projects:manage', 'talent:view', 'hiring:manage', 'evaluations:manage', 'company:manage', 'team:manage', 'finance:view', 'settings:manage'],
  Admin: [...common, 'projects:manage', 'talent:view', 'hiring:manage', 'evaluations:manage', 'company:manage', 'team:manage', 'finance:view', 'settings:manage'],
  Evaluator: [...common, 'evaluations:manage'],
  Recruiter: [...common, 'talent:view', 'hiring:manage'],
};

export async function resolveCompanyWorkspace(client, userId, companyId = null) {
  if (companyId && !validId(companyId)) return null;
  const { rows } = await client.query(`SELECT c.*, owner.email AS owner_email,
      owner.email_verified_at IS NOT NULL AS owner_email_verified,
      coalesce(v.status,'draft') AS verification_status,
      CASE WHEN c.user_id=$1 THEN 'Owner' ELSE m.team_role END AS workspace_role
    FROM public.company_profiles c JOIN public.users owner ON owner.id=c.user_id
    LEFT JOIN public.account_verifications v ON v.user_id=c.user_id
    LEFT JOIN public.company_team_members m ON m.company_id=c.user_id AND m.member_user_id=$1 AND m.status='active'
    WHERE owner.account_status='active' AND (c.user_id=$1 OR m.id IS NOT NULL)
      AND ($2::uuid IS NULL OR c.user_id=$2)
    ORDER BY (c.user_id=$1) DESC, m.joined_at NULLS LAST, c.created_at, c.user_id LIMIT 1`, [userId, companyId]);
  const row = rows[0];
  if (!row) return null;
  return {
    company: { name: row.company_name, website: row.website, industry: row.industry, size: row.company_size, location: row.location, contactName: row.contact_name, contactTitle: row.contact_title, about: row.about },
    verificationStatus: row.verification_status,
    companyAccess: { companyId: row.user_id, role: row.workspace_role, isOwner: row.user_id === userId,
      ownerEmail: row.owner_email, ownerEmailVerified: row.owner_email_verified,
      permissions: COMPANY_PERMISSIONS[row.workspace_role] || [] },
  };
}

export const profileOwnerId = user => user.role === 'company' ? user.companyAccess.companyId : user.id;
export function requireCompanyPermission(permission) {
  return (req, _res, next) => {
    if (req.user?.role !== 'company' || !req.user.companyAccess?.permissions.includes(permission)) fail(403, 'Your company role does not have access to this feature.');
    next();
  };
}
export async function teamWorkspace(client, req, permission = 'team:view') {
  const companyId = req.query.companyId || req.user.companyAccess?.companyId;
  if (!validId(companyId)) fail(404, 'Workspace not found.');
  const context = await resolveCompanyWorkspace(client, req.user.id, companyId);
  if (!context?.companyAccess.permissions.includes(permission)) fail(403, 'You do not have permission to access this company workspace.');
  return { ...context.companyAccess, name: context.company.name };
}
