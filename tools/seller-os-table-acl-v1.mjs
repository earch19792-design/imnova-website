// Recognize explicit REVOKE lists, including multi-table SQL. No SQL is run.
export function hasExplicitSellerOsTableRevokeV1(sql, table) {
  const statements = sql.replace(/--[^\n]*|\/\*[\s\S]*?\*\/|'(?:''|[^'])*'/g, " ")
  for (const match of statements.matchAll(/\brevoke\s+all(?:\s+privileges)?\s+on\s+table\s+((?:public\.[a-z0-9_]+\s*,\s*)*public\.[a-z0-9_]+)\s+from\s+([a-z_,\s]+);/gi)) {
    const tables = match[1].toLowerCase().split(/\s*,\s*/).map(x => x.trim())
    const roles = match[2].toLowerCase().split(/\s*,\s*/).map(x => x.trim())
    if (tables.includes(`public.${table}`) && roles.includes("anon") && roles.includes("authenticated")) return true
  }
  return false
}
