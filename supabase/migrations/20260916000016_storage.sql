-- =============================================================================
-- 0016 STORAGE
-- One private bucket. Object path: {organization_id}/{file_id}/{file_name}
-- A files row must exist first (created by the upload server action), and all
-- read access reuses private.can_read_file(). Downloads use signed URLs.
-- =============================================================================

insert into storage.buckets (id, name, public, file_size_limit)
values ('org-files', 'org-files', false, 5368709120)   -- 5 GB (video)
on conflict (id) do update set public = false;

create policy org_files_read on storage.objects for select to authenticated using (
  bucket_id = 'org-files'
  and exists (select 1 from public.files f
              where f.storage_path = storage.objects.name and f.bucket = 'org-files'
                and private.can_read_file(f.id))
);

create policy org_files_upload on storage.objects for insert to authenticated with check (
  bucket_id = 'org-files'
  and exists (select 1 from public.files f
              where f.storage_path = storage.objects.name
                and f.bucket = 'org-files'
                and f.upload_status = 'pending'
                and f.created_by = (select private.effective_user_id()))
);

create policy org_files_update on storage.objects for update to authenticated using (
  bucket_id = 'org-files'
  and exists (select 1 from public.files f
              where f.storage_path = storage.objects.name
                and f.organization_id in (select private.orgs_with_permission('files.update')))
);

create policy org_files_delete on storage.objects for delete to authenticated using (
  bucket_id = 'org-files' and (select private.is_super_admin())
);

-- Mark the files row as uploaded when the object lands.
create or replace function private.on_storage_object_created()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  update public.files
     set upload_status = 'uploaded',
         size_bytes = coalesce((new.metadata->>'size')::bigint, size_bytes),
         mime_type = coalesce(new.metadata->>'mimetype', mime_type)
   where storage_path = new.name and bucket = new.bucket_id and upload_status = 'pending';
  return new;
end;
$$;
-- Hosted Supabase may not let the migration role add triggers to storage.objects
-- (it is owned by supabase_storage_admin). If so, the app calls
-- app.confirm_file_upload() after the upload finishes instead.
do $$
begin
  create trigger on_org_file_uploaded after insert on storage.objects
    for each row when (new.bucket_id = 'org-files') execute function private.on_storage_object_created();
exception when insufficient_privilege then
  raise notice 'storage.objects trigger not created (insufficient privilege); use app.confirm_file_upload()';
end $$;

create or replace function app.confirm_file_upload(p_file_id uuid, p_size_bytes bigint default null, p_mime_type text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare f public.files;
begin
  select * into f from public.files where id = p_file_id;
  if f.id is null or f.created_by is distinct from private.effective_user_id() then
    raise exception 'file not found' using errcode = 'P0002';
  end if;
  if not exists (select 1 from storage.objects o where o.bucket_id = f.bucket and o.name = f.storage_path) then
    raise exception 'object has not been uploaded yet';
  end if;
  update public.files
     set upload_status = case when upload_status = 'pending' then 'uploaded' else upload_status end,
         size_bytes = coalesce(p_size_bytes, size_bytes), mime_type = coalesce(p_mime_type, mime_type)
   where id = f.id;
end;
$$;
