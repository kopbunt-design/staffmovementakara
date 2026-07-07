-- ============================================================
-- MASTER DATA TABLES — เพิ่มในหน้า SQL Editor ของ Supabase
-- ============================================================

-- 1. DIVISIONS
create table if not exists master_divisions (
  id          serial primary key,
  code        text unique not null,
  name        text not null,
  name_th     text,
  sort_order  int default 0,
  is_active   boolean default true,
  created_at  timestamptz default now()
);

-- 2. DEPARTMENTS
create table if not exists master_departments (
  id           serial primary key,
  code         text unique not null,
  name         text not null,
  name_th      text,
  division_id  int references master_divisions(id) on delete set null,
  sort_order   int default 0,
  is_active    boolean default true,
  created_at   timestamptz default now()
);

-- 3. SECTIONS
create table if not exists master_sections (
  id             serial primary key,
  code           text unique not null,
  name           text not null,
  name_th        text,
  department_id  int references master_departments(id) on delete set null,
  sort_order     int default 0,
  is_active      boolean default true,
  created_at     timestamptz default now()
);

-- 4. TEAMS
create table if not exists master_teams (
  id          serial primary key,
  code        text unique not null,
  name        text not null,
  name_th     text,
  section_id  int references master_sections(id) on delete set null,
  sort_order  int default 0,
  is_active   boolean default true,
  created_at  timestamptz default now()
);

-- 5. POSITIONS
create table if not exists master_positions (
  id          serial primary key,
  code        text unique not null,
  name        text not null,
  name_th     text,
  sort_order  int default 0,
  is_active   boolean default true,
  created_at  timestamptz default now()
);

-- 6. JOB LEVELS
create table if not exists master_job_levels (
  id          serial primary key,
  code        text unique not null,
  name        text not null,
  sort_order  int default 0,
  is_active   boolean default true,
  created_at  timestamptz default now()
);

-- ============================================================
-- RLS POLICIES
-- ============================================================
alter table master_divisions   enable row level security;
alter table master_departments enable row level security;
alter table master_sections    enable row level security;
alter table master_teams       enable row level security;
alter table master_positions   enable row level security;
alter table master_job_levels  enable row level security;

-- ทุกคน login แล้วอ่านได้
create policy "master_read" on master_divisions   for select using (auth.role() = 'authenticated');
create policy "master_read" on master_departments for select using (auth.role() = 'authenticated');
create policy "master_read" on master_sections    for select using (auth.role() = 'authenticated');
create policy "master_read" on master_teams       for select using (auth.role() = 'authenticated');
create policy "master_read" on master_positions   for select using (auth.role() = 'authenticated');
create policy "master_read" on master_job_levels  for select using (auth.role() = 'authenticated');

-- เฉพาะ admin แก้ไขได้
create policy "master_write" on master_divisions   for all using (get_my_role() = 'admin');
create policy "master_write" on master_departments for all using (get_my_role() = 'admin');
create policy "master_write" on master_sections    for all using (get_my_role() = 'admin');
create policy "master_write" on master_teams       for all using (get_my_role() = 'admin');
create policy "master_write" on master_positions   for all using (get_my_role() = 'admin');
create policy "master_write" on master_job_levels  for all using (get_my_role() = 'admin');

-- ============================================================
-- SEED DATA — ข้อมูลเริ่มต้นจากโครงสร้าง Akara Resources
-- ============================================================

-- Divisions
insert into master_divisions (code, name, name_th, sort_order) values
  ('L1-001', 'Kingsgate',      'คิงส์เกต',                1),
  ('L1-002', 'Sustainability', 'ความยั่งยืนขององค์กร',      2),
  ('L1-003', 'Operations',     'ปฎิบัติการ',               3),
  ('L1-004', 'Exploration',    'สำรวจ',                    4),
  ('L1-005', 'Commercial',     'การพาณิชย์',               5)
on conflict (code) do nothing;

-- Departments (with division_id)
insert into master_departments (code, name, name_th, division_id, sort_order) values
  ('L2-018', 'Legal',                          'กฎหมาย',                        (select id from master_divisions where code='L1-001'), 1),
  ('L2-001', 'Environment',                    'สิ่งแวดล้อม',                    (select id from master_divisions where code='L1-002'), 1),
  ('L2-004', 'Community Relations & Development','ชุมชนสัมพันธ์และการพัฒนา',    (select id from master_divisions where code='L1-002'), 2),
  ('L2-012', 'Regulatory Affairs',             'งานอนุญาต',                     (select id from master_divisions where code='L1-002'), 3),
  ('L2-013', 'Science & Health',               'วิทยาศาสตร์และสุขภาพ',          (select id from master_divisions where code='L1-002'), 4),
  ('L2-014', 'Communications',                 'สื่อสารองค์กร',                 (select id from master_divisions where code='L1-002'), 5),
  ('L2-002', 'Processing',                     'ผลิต',                          (select id from master_divisions where code='L1-003'), 1),
  ('L2-005', 'Special Projects',               'โครงการพิเศษ',                  (select id from master_divisions where code='L1-003'), 2),
  ('L2-006', 'Mining',                         'เหมืองแร่',                     (select id from master_divisions where code='L1-003'), 3),
  ('L2-007', 'Laboratory',                     'ห้องปฏิบัติการทดสอบ',           (select id from master_divisions where code='L1-003'), 4),
  ('L2-010', 'Administration',                 'ธุรการ',                        (select id from master_divisions where code='L1-003'), 5),
  ('L2-015', 'Occupational Health & Safety',   'อาชีวอนามัยและความปลอดภัย',    (select id from master_divisions where code='L1-003'), 6),
  ('L2-016', 'Human Resources',                'ทรัพยากรบุคคล',                 (select id from master_divisions where code='L1-003'), 7),
  ('L2-003', 'Exploration',                    'สำรวจ',                        (select id from master_divisions where code='L1-004'), 1),
  ('L2-017', 'Land Management',                'บริหารที่ดิน',                  (select id from master_divisions where code='L1-004'), 2),
  ('L2-008', 'Finance & Accounting',           'การเงินและบัญชี',               (select id from master_divisions where code='L1-005'), 1),
  ('L2-009', 'Supply',                         'จัดซื้อ',                       (select id from master_divisions where code='L1-005'), 2),
  ('L2-011', 'Information Technology',         'เทคโนโลยีสารสนเทศ',             (select id from master_divisions where code='L1-005'), 3)
on conflict (code) do nothing;

-- Sections
insert into master_sections (code, name, name_th, department_id, sort_order) values
  ('L3-028','Legal','กฎหมาย',(select id from master_departments where code='L2-018'),1),
  ('L3-001','Environment','สิ่งแวดล้อม',(select id from master_departments where code='L2-001'),1),
  ('L3-004','Community Relations & Development','ชุมชนสัมพันธ์และการพัฒนา',(select id from master_departments where code='L2-004'),1),
  ('L3-025','Sustainable Development','พัฒนาความยั่งยืน',(select id from master_departments where code='L2-004'),2),
  ('L3-014','Permitting','งานอนุญาต',(select id from master_departments where code='L2-012'),1),
  ('L3-026','Government Relations','รัฐกิจสัมพันธ์',(select id from master_departments where code='L2-012'),2),
  ('L3-016','Science & Health','วิทยาศาสตร์และสุขภาพ',(select id from master_departments where code='L2-013'),1),
  ('L3-017','Communications','สื่อสารองค์กร',(select id from master_departments where code='L2-014'),1),
  ('L3-002','Process','ผลิต',(select id from master_departments where code='L2-002'),1),
  ('L3-009','Maintenance','ซ่อมบำรุง',(select id from master_departments where code='L2-002'),2),
  ('L3-023','Metallurgy','โลหวิทยา',(select id from master_departments where code='L2-002'),3),
  ('L3-005','Special Projects','โครงการพิเศษ',(select id from master_departments where code='L2-005'),1),
  ('L3-006','Geology','ธรณีวิทยา',(select id from master_departments where code='L2-006'),1),
  ('L3-010','Mining Operation','ปฏิบัติการเหมืองแร่',(select id from master_departments where code='L2-006'),2),
  ('L3-019','Mine Planning','วางแผนการทำเหมือง',(select id from master_departments where code='L2-006'),3),
  ('L3-027','Chatree North','ชาตรีเหนือ',(select id from master_departments where code='L2-006'),4),
  ('L3-007','Laboratory','ห้องปฏิบัติการทดสอบ',(select id from master_departments where code='L2-007'),1),
  ('L3-012','Administration','ธุรการ',(select id from master_departments where code='L2-010'),1),
  ('L3-018','Occupational Health & Safety','อาชีวอนามัยและความปลอดภัย',(select id from master_departments where code='L2-015'),1),
  ('L3-020','Human Resources Development','พัฒนาทรัพยากรบุคคล',(select id from master_departments where code='L2-016'),1),
  ('L3-021','Human Resources Management','บริหารงานทรัพยากรบุคคล',(select id from master_departments where code='L2-016'),2),
  ('L3-022','Compensation & Benefits','ค่าตอบแทนและสวัสดิการ',(select id from master_departments where code='L2-016'),3),
  ('L3-003','Exploration','สำรวจ',(select id from master_departments where code='L2-003'),1),
  ('L3-024','Land Management','บริหารที่ดิน',(select id from master_departments where code='L2-017'),1),
  ('L3-008','Finance & Accounting','การเงินและบัญชี',(select id from master_departments where code='L2-008'),1),
  ('L3-011','Purchasing','จัดซื้อ',(select id from master_departments where code='L2-009'),1),
  ('L3-015','Warehouse','คลังพัสดุ',(select id from master_departments where code='L2-009'),2),
  ('L3-013','Information Technology','เทคโนโลยีสารสนเทศ',(select id from master_departments where code='L2-011'),1)
on conflict (code) do nothing;

-- Teams
insert into master_teams (code, name, name_th, section_id, sort_order) values
  ('L4-034','Legal','กฎหมาย',(select id from master_sections where code='L3-028'),1),
  ('L4-001','Environment','สิ่งแวดล้อม',(select id from master_sections where code='L3-001'),1),
  ('L4-004','Community Relations & Development','ชุมชนสัมพันธ์และการพัฒนา',(select id from master_sections where code='L3-004'),1),
  ('L4-029','Sustainable Development','พัฒนาความยั่งยืน',(select id from master_sections where code='L3-025'),1),
  ('L4-015','Permitting','งานอนุญาต',(select id from master_sections where code='L3-014'),1),
  ('L4-031','Government Relations','รัฐกิจสัมพันธ์',(select id from master_sections where code='L3-026'),1),
  ('L4-017','Science & Health','วิทยาศาสตร์และสุขภาพ',(select id from master_sections where code='L3-016'),1),
  ('L4-018','Communications','สื่อสารองค์กร',(select id from master_sections where code='L3-017'),1),
  ('L4-002','Process','วางแผนการผลิต',(select id from master_sections where code='L3-002'),1),
  ('L4-009','Mechanical','ช่างกลและช่างเชื่อม',(select id from master_sections where code='L3-009'),1),
  ('L4-012','Electrical','ไฟฟ้า',(select id from master_sections where code='L3-009'),2),
  ('L4-032','Project','โครงการ',(select id from master_sections where code='L3-009'),3),
  ('L4-026','Planning','วางแผนการผลิต',(select id from master_sections where code='L3-009'),4),
  ('L4-027','Metallurgy','โลหวิทยา',(select id from master_sections where code='L3-023'),1),
  ('L4-005','Special Projects','โครงการพิเศษ',(select id from master_sections where code='L3-005'),1),
  ('L4-006','Geology','ธรณีวิทยา',(select id from master_sections where code='L3-006'),1),
  ('L4-010','Mining Operation','ปฏิบัติการเหมืองแร่',(select id from master_sections where code='L3-010'),1),
  ('L4-021','Mine Planning','วางแผนการทำเหมือง',(select id from master_sections where code='L3-019'),1),
  ('L4-020','Civil','โยธา',(select id from master_sections where code='L3-019'),2),
  ('L4-033','Chatree North','ชาตรีเหนือ',(select id from master_sections where code='L3-027'),1),
  ('L4-007','Laboratory','ห้องปฏิบัติการทดสอบ',(select id from master_sections where code='L3-007'),1),
  ('L4-013','Administration','ธุรการ',(select id from master_sections where code='L3-012'),1),
  ('L4-019','Occupational Health & Safety','อาชีวอนามัยและความปลอดภัย',(select id from master_sections where code='L3-018'),1),
  ('L4-022','Human Resources Development','พัฒนาทรัพยากรบุคคล',(select id from master_sections where code='L3-020'),1),
  ('L4-023','Human Resources','บริหารงานทรัพยากรบุคคล',(select id from master_sections where code='L3-021'),1),
  ('L4-024','Compensation & Benefits','ค่าตอบแทนและสวัสดิการ',(select id from master_sections where code='L3-022'),1),
  ('L4-003','Exploration','สำรวจ',(select id from master_sections where code='L3-003'),1),
  ('L4-028','Land Management','บริหารที่ดิน',(select id from master_sections where code='L3-024'),1),
  ('L4-008','Finance & Accounting','การเงินและบัญชี',(select id from master_sections where code='L3-008'),1),
  ('L4-011','Purchasing','จัดซื้อ',(select id from master_sections where code='L3-011'),1),
  ('L4-016','Warehouse','คลังพัสดุ',(select id from master_sections where code='L3-015'),1),
  ('L4-014','Information Technology','เทคโนโลยีสารสนเทศ',(select id from master_sections where code='L3-013'),1),
  ('L4-025','Network Infrastructure','บริหารงานโครงข่ายพื้นฐาน',(select id from master_sections where code='L3-013'),2),
  ('L4-030','Digital Transformation','พัฒนาระบบงานดิจิทัล',(select id from master_sections where code='L3-013'),3)
on conflict (code) do nothing;

-- Job Levels
insert into master_job_levels (code, name, sort_order) values
  ('M1','M1',1),('M2','M2',2),('M3','M3',3),('M4','M4',4),
  ('O1','O1',5),('O2','O2',6),('O3','O3',7),
  ('S1','S1',8),('S2','S2',9),('S3','S3',10)
on conflict (code) do nothing;

-- Realtime
alter publication supabase_realtime add table master_divisions;
alter publication supabase_realtime add table master_departments;
alter publication supabase_realtime add table master_sections;
alter publication supabase_realtime add table master_teams;
alter publication supabase_realtime add table master_positions;
alter publication supabase_realtime add table master_job_levels;
