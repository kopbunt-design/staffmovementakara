// ============================================================================
// Azure build of js/supabase-config.js — same `supabase` object the pages already use, but every call goes to
// this App Service (/api/*) instead of Supabase. build.sh copies this file over the Supabase one, so no page changes.
//   supabase.from(t)…      → POST /api/rest            (Azure SQL, row security per signed-in user)
//   supabase.rpc(name)     → POST /api/rpc/<name>
//   supabase.auth.*        → Microsoft login (App Service Authentication)
//   supabase.storage.*     → /api/storage/<bucket>/…   (Azure Blob Storage)
//   supabase.functions.*   → POST /api/fn/<name>       (e-mail etc.)
//   supabase.channel()     → light polling instead of realtime
// Returns {data, error, count} exactly like supabase-js, so existing `if (error)` checks keep working.
// ============================================================================

const post = async (url, body) => {
  let r;
  try {
    r = await fetch(url, { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body ?? {}) });
  } catch (e) { return { data: null, error: { message: "เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ — ตรวจอินเทอร์เน็ตแล้วลองใหม่", code: "NETWORK" } }; }
  if (r.status === 401) { location.href = "/.auth/login/aad?post_login_redirect_uri=" + encodeURIComponent(location.pathname + location.search + location.hash); return new Promise(() => {}); }
  const t = await r.text();
  try { return JSON.parse(t); } catch { return { data: null, error: { message: `${r.status} ${t.slice(0, 300)}`, code: String(r.status) } }; }
};

// ---------------------------------------------------------------- tables
class Query {
  constructor(table) { this.q = { table, method: "GET", select: "*", filters: [], or: [], order: [] }; }
  select(cols = "*", opts = {}) {
    if (this.q.method === "GET") { this.q.select = cols; if (opts.count) this.q.count = opts.count; if (opts.head) this.q.head = true; }
    else this.q.returning = true;          // .insert(...).select() → give the rows back
    return this;
  }
  insert(values, opts = {}) { Object.assign(this.q, { method: "POST", values }); if (opts.count) this.q.count = opts.count; return this; }
  upsert(values, opts = {}) {
    Object.assign(this.q, { method: "POST", values, upsert: { onConflict: opts.onConflict || null, ignoreDuplicates: !!opts.ignoreDuplicates } });
    return this;
  }
  update(values, opts = {}) { Object.assign(this.q, { method: "PATCH", values }); if (opts.count) this.q.count = opts.count; return this; }
  delete(opts = {}) { this.q.method = "DELETE"; if (opts.count) this.q.count = opts.count; return this; }
  _f(col, op, val) { this.q.filters.push([col, op, val === undefined ? null : val]); return this; }
  eq(c, v) { return this._f(c, "eq", v); }
  neq(c, v) { return this._f(c, "neq", v); }
  gt(c, v) { return this._f(c, "gt", v); }
  gte(c, v) { return this._f(c, "gte", v); }
  lt(c, v) { return this._f(c, "lt", v); }
  lte(c, v) { return this._f(c, "lte", v); }
  like(c, v) { return this._f(c, "like", v); }
  ilike(c, v) { return this._f(c, "ilike", v); }
  is(c, v) { return this._f(c, "is", v); }
  in(c, v) { return this._f(c, "in", v); }
  contains(c, v) { return this._f(c, "cs", v); }
  not(c, op, v) { return this._f(c, "not." + op, v); }
  filter(c, op, v) { return this._f(c, op, v); }
  match(obj) { for (const [k, v] of Object.entries(obj)) this.eq(k, v); return this; }
  or(s) { this.q.or.push(s); return this; }
  order(c, opts = {}) { this.q.order.push([c, opts.ascending !== false, opts.nullsFirst ?? null]); return this; }
  limit(n) { this.q.limit = n; return this; }
  range(a, b) { this.q.offset = a; this.q.limit = b - a + 1; return this; }
  single() { this.q.single = "one"; return this; }
  maybeSingle() { this.q.single = "maybe"; return this; }
  abortSignal() { return this; }
  throwOnError() { this.q.throw = true; return this; }
  then(ok, bad) {
    return post("/api/rest", this.q).then(r => {
      if (this.q.throw && r.error) throw Object.assign(new Error(r.error.message), r.error);
      return r;
    }).then(ok, bad);
  }
}

// ---------------------------------------------------------------- auth (Microsoft login)
let sessionP = null;
const loadSession = () => sessionP ||= fetch("/api/auth/session", { credentials: "same-origin" })
  .then(r => r.status === 401 ? null : r.json()).then(j => j?.user ? { user: j.user, access_token: "azure" } : null).catch(() => null);

const auth = {
  async getSession() { return { data: { session: await loadSession() }, error: null }; },
  async getUser() { const s = await loadSession(); return { data: { user: s?.user || null }, error: null }; },
  onAuthStateChange(cb) {
    loadSession().then(s => cb(s ? "SIGNED_IN" : "SIGNED_OUT", s));
    return { data: { subscription: { unsubscribe() {} } } };
  },
  async signOut() { location.href = "/.auth/logout?post_logout_redirect_uri=/"; return { error: null }; },
  async signInWithOAuth() { location.href = "/.auth/login/aad?post_login_redirect_uri=/"; return { data: null, error: null }; },
  async signInWithPassword() { return { data: null, error: { message: "ระบบนี้เข้าด้วยบัญชี Microsoft ของบริษัท" } }; },
  async signUp() { return { data: null, error: { message: "ระบบนี้เข้าด้วยบัญชี Microsoft ของบริษัท — ไม่ต้องสมัคร" } }; },
  async updateUser() { return { data: null, error: { message: "รหัสผ่านจัดการที่บัญชี Microsoft ของบริษัท" } }; },
};

// ---------------------------------------------------------------- storage (Azure Blob through the app)
const enc = p => p.split("/").map(encodeURIComponent).join("/");
const storage = {
  from(bucket) {
    return {
      async upload(path, file, opts = {}) {
        const r = await fetch(`/api/storage/${bucket}/${enc(path)}${opts.upsert ? "?upsert=1" : ""}`, {
          method: "PUT", credentials: "same-origin", body: file,
          headers: { "Content-Type": opts.contentType || file?.type || "application/octet-stream" } });
        const j = await r.json().catch(() => ({}));
        return r.ok ? { data: { path }, error: null } : { data: null, error: { message: j.detail || `อัปโหลดไม่สำเร็จ (${r.status})` } };
      },
      async download(path) {
        const r = await fetch(`/api/storage/${bucket}/${enc(path)}`, { credentials: "same-origin" });
        return r.ok ? { data: await r.blob(), error: null } : { data: null, error: { message: `เปิดไฟล์ไม่ได้ (${r.status})` } };
      },
      async createSignedUrl(path, _secs, opts = {}) {
        const j = await post(`/api/storage-sign/${bucket}`, { path, download: opts.download || null });
        return j.error ? { data: null, error: j.error } : { data: { signedUrl: j.data.url }, error: null };
      },
      async remove(paths) {
        const j = await post(`/api/storage-remove/${bucket}`, { paths });
        return j.error ? { data: null, error: j.error } : { data: j.data, error: null };
      },
    };
  },
};

// ---------------------------------------------------------------- realtime → polling
// The pages subscribe to employees/movements/notifications changes; poll a cheap "what changed" endpoint instead.
const channels = [];
let pollT = null, since = null, sigs = null;
async function poll() {
  const tables = [...new Set(channels.flatMap(c => c.subs.map(s => s.table)))];
  if (!tables.length) return;
  const r = await post("/api/changes", { tables, since });
  if (r.error || !r.data) return;
  if (sigs) for (const t of tables) {
    const changed = r.data.sigs[t] !== sigs[t], ins = r.data.inserted?.[t] || [];
    for (const c of channels) for (const s of c.subs) {
      if (s.table !== t) continue;
      if (s.event === "INSERT") ins.forEach(row => s.cb({ eventType: "INSERT", new: row }));
      else if (changed) s.cb({ eventType: "*" });
    }
  }
  sigs = r.data.sigs; since = r.data.now;
}
function channel(name) {
  const c = {
    name, subs: [],
    on(_type, f, cb) { this.subs.push({ table: f.table, event: f.event || "*", cb }); return this; },
    subscribe() { channels.push(this); if (!pollT) { poll(); pollT = setInterval(() => document.hidden || poll(), 20000); } return this; },
    unsubscribe() { channels.splice(channels.indexOf(this), 1); return Promise.resolve("ok"); },
  };
  return c;
}

export const supabase = {
  from: t => new Query(t),
  rpc: (name, args = {}) => ({ then: (ok, bad) => post(`/api/rpc/${name}`, args).then(ok, bad) }),
  auth,
  storage,
  functions: { invoke: (name, opts = {}) => post(`/api/fn/${name}`, opts.body || {}) },
  channel,
  removeChannel: c => c?.unsubscribe?.(),
};
