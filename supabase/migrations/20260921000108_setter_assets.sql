-- =============================================================================
-- 0108 SETTER ASSETS
--
-- A shelf of material setters send or show on calls: PDFs, case studies, testimonials and links. Lives under
-- Growth next to the pipeline. Each asset has a title, an optional category (the filter chips), an optional
-- description, at most one uploaded file (org-files bucket, same pipeline as every other upload) and any number
-- of links, each with an optional label.
--
-- Access follows the sales module through the standard policies: sales.read to see, sales.create to add,
-- sales.update to edit, sales.delete to remove (app.soft_delete). The file itself is an ordinary files row with
-- organization visibility, so anyone with files.read in the workspace can open it.
-- =============================================================================

create table public.setter_assets (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations(id) on delete cascade,
  title            text not null check (char_length(btrim(title)) between 1 and 200),
  category         text check (category is null or char_length(category) between 1 and 60),
  description      text check (description is null or char_length(description) <= 4000),
  file_id          uuid,
  -- [{ "label": "Roofing case study" | null, "url": "https://..." }]
  links            jsonb not null default '[]'::jsonb
                   check (jsonb_typeof(links) = 'array' and jsonb_array_length(links) <= 50),
  -- the file must belong to the same workspace; removing the file keeps the asset and its links
  foreign key (organization_id, file_id) references public.files(organization_id, id) on delete set null (file_id)
);
select private.standardize('setter_assets', 'sales', true, true);

create index setter_assets_file_id_fkidx on public.setter_assets (organization_id, file_id) where file_id is not null;
