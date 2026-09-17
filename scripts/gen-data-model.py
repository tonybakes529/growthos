#!/usr/bin/env python3
"""Generate docs/DATA_MODEL.md from a migrated database.
Usage: python3 scripts/gen-data-model.py [dbname]   (uses psql on PATH)"""
import json, os, shlex, subprocess, sys, re, pathlib

db = sys.argv[1] if len(sys.argv) > 1 else "growth_os_test"
root = pathlib.Path(__file__).resolve().parent.parent

q = r"""
select json_agg(t order by t.table_name) from (
  select c.relname as table_name,
         coalesce(r.module, '') as module, coalesce(r.policy_mode, '') as policy_mode,
         coalesce(r.soft_delete, false) as soft_delete, coalesce(r.audited, false) as audited,
         coalesce(r.org_scoped, false) as org_scoped,
         (select json_agg(json_build_object(
                   'name', a.attname,
                   'type', format_type(a.atttypid, a.atttypmod),
                   'notnull', a.attnotnull,
                   'default', pg_get_expr(d.adbin, d.adrelid)) order by a.attnum)
            from pg_attribute a left join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
           where a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped) as columns,
         (select json_agg(pg_get_constraintdef(k.oid) order by k.conname)
            from pg_constraint k where k.conrelid = c.oid and k.contype = 'f') as fks
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  left join private.rls_registry r on r.table_name = c.relname
  where n.nspname = 'public' and c.relkind = 'r'
) t;
"""
psql = shlex.split(os.environ.get("PSQL", "psql"))
out = subprocess.check_output(psql + ["-X", "-At", "-d", db, "-c", q], text=True)
tables = {t["table_name"]: t for t in json.loads(out)}

# order + grouping follows the migration files
groups = []
for f in sorted((root / "supabase/migrations").glob("*.sql")):
    names = re.findall(r"create table public\.(\w+)", f.read_text())
    if names:
        title = re.search(r"-- \d{4} (.+)", f.read_text()).group(1).strip().title()
        groups.append((f.name, title, names))

audit_cols = {"created_at", "updated_at", "created_by", "updated_by", "deleted_at", "deleted_by"}
lines = ["# Data Model", "",
         "Generated from the migrated schema by `scripts/gen-data-model.py`. Do not edit by hand.", "",
         f"**{len(tables)} tables.** Standard audit columns (`created_at`, `updated_at`, `created_by`, `updated_by`, "
         "and `deleted_at`/`deleted_by` where soft delete is on) are listed once per table in the flags line instead of the column list.", "",
         "Legend: 🏢 tenant-scoped (`organization_id`) · 🗑 soft delete · 📝 audited · 🔐 custom RLS · 🚫 service-role only", ""]
lines.append("## Contents\n")
for fname, title, names in groups:
    lines.append(f"- **{title}**: " + ", ".join(f"[{n}](#{n})" for n in names))
lines.append("")

for fname, title, names in groups:
    lines += [f"## {title}", f"_Migration: `{fname}`_", ""]
    for n in names:
        t = tables[n]
        flags = []
        if t["org_scoped"]: flags.append("🏢 tenant")
        if t["soft_delete"]: flags.append("🗑 soft delete")
        if t["audited"]: flags.append("📝 audited")
        if t["policy_mode"] == "custom": flags.append("🔐 custom RLS")
        if t["policy_mode"] == "service_only": flags.append("🚫 service only")
        if t["module"]: flags.append(f"permission module `{t['module']}`")
        present = [c["name"] for c in t["columns"] if c["name"] in audit_cols]
        lines += [f"### {n}", " · ".join(flags) + (f" · audit cols: {', '.join(present)}" if present else ""), "",
                  "| Column | Type | Null | Default |", "|---|---|---|---|"]
        for c in t["columns"]:
            if c["name"] in audit_cols: continue
            d = (c["default"] or "").replace("|", "\\|")
            if len(d) > 40: d = d[:37] + "..."
            lines.append(f"| `{c['name']}` | {c['type']} | {'' if c['notnull'] else 'yes'} | {d} |")
        fks = [fk for fk in (t["fks"] or []) if "users(id)" not in fk or "user_id" in fk.split("REFERENCES")[0]]
        if fks:
            lines += ["", "**References:** " + "; ".join(f"`{re.sub(r' ON DELETE.*', '', fk)}`" for fk in fks)]
        lines.append("")
(root / "docs/DATA_MODEL.md").write_text("\n".join(lines))
print(f"wrote docs/DATA_MODEL.md ({len(tables)} tables)")
