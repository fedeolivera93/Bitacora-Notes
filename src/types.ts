export const LS_KEY = 'bitacora.v2';
export const PALETTE = ['#C25A35', '#8E9B55', '#C29535', '#6D8FA6', '#B3779B', '#A08258'];
export const SLOTS = ['hoy', 'manana', 'despues'] as const;
export type SlotType = (typeof SLOTS)[number];
export const SLOT_LBL: Record<SlotType, string> = {
  hoy: 'HOY',
  manana: 'MAÑANA',
  despues: 'DESPUÉS',
};

export interface GroupItem {
  id: string;
  name: string;
}

export interface ContextItem {
  id: string;
  name: string;
  color: string;
  groups: GroupItem[];
}

export interface TaskItem {
  id: string;
  text: string;
  note: string;
  ctx: string;
  slot: SlotType;
  urgent: boolean;
  done: boolean;
  doneAt: string | null;
  stale: boolean;
}

export interface NoteItem {
  id: string;
  title: string;
  body: string;
  ctx: string | null;
  group: string | null;
  mono: boolean;
  pin: boolean;
  up: number;
}

export interface BitacoraState {
  v: 2;
  day: string;
  focus: string | null;
  stamp: string | null;
  log: Record<string, number>;
  ctx: ContextItem[];
  tasks: TaskItem[];
  notes: NoteItem[];
  updatedAt?: number;
}

export interface PendingSyncData {
  state: BitacoraState;
  lastSyncedAt: number;
}

export const getPendingKey = (userUid: string) => `bitacora.pending.${userUid}`;

export const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

export const pad = (n: number | string) => String(n).padStart(2, '0');

export function dstr(d = new Date()): string {
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
}

export function dshift(iso: string, n: number): string {
  const [y, m, d] = iso.split('-').map(Number);
  return dstr(new Date(y, m - 1, d + n));
}

export function isoWeek(d = new Date()): number {
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const dn = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - dn);
  const y0 = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  return Math.ceil(((t.getTime() - y0.getTime()) / 864e5 + 1) / 7);
}

export function dayOfYear(d = new Date()): number {
  return Math.floor((d.getTime() - new Date(d.getFullYear(), 0, 1).getTime()) / 864e5) + 1;
}

export function streak(st: BitacoraState): number {
  let n = 0;
  const d = new Date();
  if (!((st.log[dstr(d)] || 0) > 0)) {
    d.setDate(d.getDate() - 1);
  }
  while ((st.log[dstr(d)] || 0) > 0) {
    n++;
    d.setDate(d.getDate() - 1);
  }
  return n;
}

export function fmtUp(ts: number): string {
  const d = new Date(ts);
  const ds = dstr(d);
  const now = new Date();
  const y = new Date(now);
  y.setDate(y.getDate() - 1);
  const hm = d.toTimeString().slice(0, 5);
  if (ds === dstr(now)) return 'HOY ' + hm;
  if (ds === dstr(y)) return 'AYER ' + hm;
  return ds.slice(8, 10) + '/' + ds.slice(5, 7) + ' ' + hm;
}

export function seed(): BitacoraState {
  const today = dstr();
  return {
    v: 2,
    day: today,
    focus: null,
    stamp: null,
    log: {},
    ctx: [
      { id: 'c-personal', name: 'Personal', color: PALETTE[0], groups: [] },
      { id: 'c-trabajo', name: 'Trabajo', color: PALETTE[1], groups: [] },
    ],
    tasks: [],
    notes: [],
  };
}

export function normalize(d: any): BitacoraState {
  const base = seed();
  const today = dstr();
  const st: BitacoraState = {
    v: 2,
    day: d?.day || today,
    focus: d?.focus || null,
    stamp: d?.stamp || null,
    log: d?.log && typeof d.log === 'object' ? d.log : {},
    ctx: (Array.isArray(d?.ctx) && d.ctx.length ? d.ctx : base.ctx).map((c: any, i: number) => ({
      id: c.id || uid(),
      name: c.name || 'Contexto',
      color: c.color || PALETTE[i % PALETTE.length],
      groups: Array.isArray(c.groups)
        ? c.groups.map((g: any) => ({
            id: g.id || uid(),
            name: String(g.name || 'Grupo').slice(0, 24),
          }))
        : [],
    })),
    tasks: [],
    notes: [],
    updatedAt: typeof d?.updatedAt === 'number' ? d.updatedAt : Date.now(),
  };

  const ids = new Set(st.ctx.map((c) => c.id));
  st.tasks = (Array.isArray(d?.tasks) ? d.tasks : []).map((t: any) => ({
    id: t.id || uid(),
    text: String(t.text || '').slice(0, 200),
    note: String(t.note || '').slice(0, 2000),
    ctx: ids.has(t.ctx) ? t.ctx : st.ctx[0].id,
    slot: SLOTS.includes(t.slot) ? t.slot : 'despues',
    urgent: !!t.urgent,
    done: !!t.done,
    doneAt: t.doneAt || null,
    stale: !!t.stale,
  }));

  st.notes = (Array.isArray(d?.notes) ? d.notes : []).map((n: any) => {
    let ctx: string | null = null;
    let grp: string | null = null;
    if (n.ctx && ids.has(n.ctx)) {
      ctx = n.ctx;
      const c = st.ctx.find((x) => x.id === ctx);
      const g = n.group && c?.groups.find((x) => x.id === n.group);
      grp = g ? g.id : null;
    }
    return {
      id: n.id || uid(),
      title: String(n.title || '').slice(0, 120),
      body: String(n.body || ''),
      ctx,
      group: grp,
      mono: !!n.mono,
      pin: !!n.pin,
      up: n.up || Date.now(),
    };
  });

  return st;
}
