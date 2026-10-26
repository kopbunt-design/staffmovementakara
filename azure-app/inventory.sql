-- ============================================================================
-- ย้ายทั้งระบบไป Azure — ดึง "โครงสร้าง" ของฐานข้อมูล Supabase ที่ใช้งานจริงตอนนี้ (ไม่มีข้อมูลพนักงาน/เงินเดือน)
-- รันใน Supabase → SQL Editor → Run → ผลออกมา 1 แถว 1 ช่อง → กด Download (CSV)
-- ได้: ตาราง+คอลัมน์+ชนิด+ค่าเริ่มต้น, คีย์/unique/check/FK, index, trigger, view, ฟังก์ชัน (โค้ดเต็ม), RLS policy,
--      bucket ของ storage (ชื่อ+ตั้งค่า ไม่มีไฟล์)
-- ============================================================================
select json_build_object(
  'columns', (select json_agg(json_build_object(
      'table', c.table_name, 'column', c.column_name, 'pos', c.ordinal_position,
      'type', c.data_type, 'udt', c.udt_name, 'nullable', c.is_nullable, 'default', c.column_default,
      'maxlen', c.character_maximum_length, 'precision', c.numeric_precision, 'scale', c.numeric_scale)
      order by c.table_name, c.ordinal_position)
    from information_schema.columns c
    join information_schema.tables t on t.table_schema = c.table_schema and t.table_name = c.table_name
    where c.table_schema = 'public' and t.table_type = 'BASE TABLE'),
  'constraints', (select json_agg(json_build_object(
      'table', rel.relname, 'name', con.conname, 'type', con.contype, 'def', pg_get_constraintdef(con.oid))
      order by rel.relname, con.conname)
    from pg_constraint con join pg_class rel on rel.oid = con.conrelid
    join pg_namespace n on n.oid = rel.relnamespace where n.nspname = 'public'),
  'indexes', (select json_agg(json_build_object('table', tablename, 'name', indexname, 'def', indexdef) order by tablename, indexname)
    from pg_indexes where schemaname = 'public'),
  'triggers', (select json_agg(json_build_object(
      'table', c.relname, 'name', tg.tgname, 'def', pg_get_triggerdef(tg.oid)) order by c.relname, tg.tgname)
    from pg_trigger tg join pg_class c on c.oid = tg.tgrelid join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and not tg.tgisinternal),
  'views', (select json_agg(json_build_object('name', viewname, 'def', definition)) from pg_views where schemaname = 'public'),
  'functions', (select json_agg(json_build_object('name', p.proname, 'args', pg_get_function_identity_arguments(p.oid),
      'def', pg_get_functiondef(p.oid)) order by p.proname)
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prokind in ('f', 'p')),
  'policies', (select json_agg(json_build_object('table', tablename, 'name', policyname, 'cmd', cmd,
      'roles', roles, 'using', qual, 'check', with_check) order by tablename, policyname)
    from pg_policies where schemaname in ('public', 'storage')),
  'buckets', (select json_agg(json_build_object('id', id, 'public', public, 'limit', file_size_limit, 'mime', allowed_mime_types))
    from storage.buckets),
  'bucket_sizes', (select json_agg(json_build_object('bucket', bucket_id, 'files', n, 'mb', round(mb::numeric, 1)))
    from (select bucket_id, count(*) n, sum(coalesce((metadata->>'size')::bigint, 0)) / 1048576.0 mb
          from storage.objects group by bucket_id) s),
  'row_counts', (select json_agg(json_build_object('table', relname, 'rows', n_live_tup) order by relname)
    from pg_stat_user_tables where schemaname = 'public')
) as inventory;
