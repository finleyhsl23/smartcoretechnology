export function isAdmin(profile) {
  return profile?.role === 'admin';
}

export function isManager(profile) {
  return profile?.role === 'manager';
}

export function isManagerOrAdmin(profile) {
  return isAdmin(profile) || isManager(profile);
}
