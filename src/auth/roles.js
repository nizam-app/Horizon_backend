export const ROLES = ['admin', 'super_admin'];

/** Roles that admin may assign (super_admin may also assign super_admin). */
export const STAFF_ASSIGNABLE_ROLES = ['admin'];

export function canManageClaims(role) {
  return role === 'admin' || role === 'super_admin';
}

export function canManageStaffUsers(role) {
  return canManageClaims(role);
}

/** Employees and salaries CRUD — super_admin only. */
export function canManageHr(role) {
  return role === 'super_admin';
}

/** Attendance — admin and super_admin. */
export function canManageAttendance(role) {
  return role === 'admin' || role === 'super_admin';
}

export function canViewParts(role) {
  return role === 'admin' || role === 'super_admin';
}

export function canUpdatePartStatusInvoice(role) {
  return canViewParts(role);
}

/** Add part lines (full purchase fields on create) — admin and super_admin. */
export function canAddParts(role) {
  return canViewParts(role);
}

/** Edit existing part line fields — admin and super_admin. */
export function canEditPartLines(role) {
  return canViewParts(role);
}

/** Delete part lines — super_admin only. */
export function canManagePartsCrud(role) {
  return role === 'super_admin';
}

export function isValidRole(role) {
  return ROLES.includes(role);
}

/** Whether actor may set targetRole on create/patch. */
export function canAssignRole(actorRole, targetRole) {
  if (!isValidRole(targetRole)) return false;
  if (targetRole === 'super_admin') return actorRole === 'super_admin';
  return STAFF_ASSIGNABLE_ROLES.includes(targetRole);
}

export function assertAssignableRole(actorRole, targetRole) {
  if (!canAssignRole(actorRole, targetRole)) {
    if (targetRole === 'super_admin') {
      return 'Only a super administrator can assign the super_admin role';
    }
    return `role must be one of: ${STAFF_ASSIGNABLE_ROLES.join(', ')}`;
  }
  return null;
}
