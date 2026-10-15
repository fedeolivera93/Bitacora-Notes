import React from 'react';
import { ArrowRight } from 'lucide-react';
import { BitacoraState, pad, SlotType } from '../types';
import { TaskRow } from './TaskRow';

interface SearchViewProps {
  state: BitacoraState;
  query: string;
  onGoToNote: (noteId: string) => void;
  onToggleTask: (id: string) => void;
  onFocusTask: (id: string) => void;
  onMoveSlot: (id: string) => void;
  onUpdateTask: (id: string, text: string, note: string, slot: SlotType, urgent: boolean) => void;
  onDeleteTask: (id: string) => void;
}

export const SearchView: React.FC<SearchViewProps> = ({
  state,
  query,
  onGoToNote,
  onToggleTask,
  onFocusTask,
  onMoveSlot,
  onUpdateTask,
  onDeleteTask,
}) => {
  const q = query.trim().toLowerCase();
  const ts = state.tasks.filter((t) =>
    ((t.text || '') + ' ' + (t.note || '')).toLowerCase().includes(q)
  );
  const openTasks = ts.filter((t) => !t.done);
  const doneTasks = ts.filter((t) => t.done);
  const ns = state.notes.filter((n) =>
    ((n.title || '') + ' ' + (n.body || '')).toLowerCase().includes(q)
  );

  const highlight = (text: string) => {
    if (!q) return text;
    const parts = text.split(new RegExp(`(${q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi'));
    return parts.map((part, i) =>
      part.toLowerCase() === q ? <mark key={i}>{part}</mark> : part
    );
  };

  let sectionIdx = 0;

  if (!ts.length && !ns.length) {
    return (
      <div className="blank">
        <p>Nada que encaje con «{query}».</p>
      </div>
    );
  }

  return (
    <div>
      {openTasks.length > 0 && (
        <section className="grp">
          <h3 className="grp-h">
            <span className="gi">{pad(++sectionIdx)}</span>
            PENDIENTES
          </h3>
          <ul className="tlist">
            {openTasks.map((t) => {
              const ctx = state.ctx.find((c) => c.id === t.ctx);
              return (
                <TaskRow
                  key={t.id}
                  task={t}
                  context={ctx}
                  isFocused={state.focus === t.id}
                  showCtxTag
                  showSlotTag
                  onToggle={onToggleTask}
                  onFocus={onFocusTask}
                  onMoveSlot={onMoveSlot}
                  onUpdate={onUpdateTask}
                  onDelete={onDeleteTask}
                  onDragStart={() => {}}
                  onDragEnd={() => {}}
                  onDragOverTask={() => {}}
                  onDropOnTask={() => {}}
                />
              );
            })}
          </ul>
        </section>
      )}

      {doneTasks.length > 0 && (
        <section className="grp">
          <h3 className="grp-h">
            <span className="gi">{pad(++sectionIdx)}</span>
            COMPLETADAS
          </h3>
          <ul className="tlist">
            {doneTasks.map((t) => {
              const ctx = state.ctx.find((c) => c.id === t.ctx);
              return (
                <TaskRow
                  key={t.id}
                  task={t}
                  context={ctx}
                  isFocused={state.focus === t.id}
                  showCtxTag
                  showSlotTag
                  onToggle={onToggleTask}
                  onFocus={onFocusTask}
                  onMoveSlot={onMoveSlot}
                  onUpdate={onUpdateTask}
                  onDelete={onDeleteTask}
                  onDragStart={() => {}}
                  onDragEnd={() => {}}
                  onDragOverTask={() => {}}
                  onDropOnTask={() => {}}
                />
              );
            })}
          </ul>
        </section>
      )}

      {ns.length > 0 && (
        <section className="grp">
          <h3 className="grp-h">
            <span className="gi">{pad(++sectionIdx)}</span>
            NOTAS
          </h3>
          <div className="hits">
            {ns.map((n) => {
              const body = (n.body || '').replace(/\s+/g, ' ').trim();
              const snippet = body.slice(0, 130);
              const ctx = n.ctx ? state.ctx.find((c) => c.id === n.ctx) : null;
              const grp = ctx && n.group ? ctx.groups.find((g) => g.id === n.group) : null;

              return (
                <article
                  key={n.id}
                  className="hit"
                  onClick={() => onGoToNote(n.id)}
                >
                  <span className="h-t">
                    {highlight(n.title || 'Sin título')}
                    {ctx && (
                      <span
                        className="tag cx"
                        style={{ '--c': ctx.color } as React.CSSProperties}
                      >
                        {ctx.name.toUpperCase()}
                        {grp ? ` · ${grp.name.toUpperCase()}` : ''}
                      </span>
                    )}
                  </span>
                  <span className="h-b">
                    {highlight(snippet)}
                    {body.length > 130 ? '…' : ''}
                  </span>
                  <span className="h-go">
                    <ArrowRight size={14} />
                  </span>
                </article>
              );
            })}
          </div>
        </section>
      )}
    </div>
  );
};
