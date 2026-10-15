import React, { useState, useRef, useEffect } from 'react';
import {
  GripVertical,
  Crosshair,
  ArrowRight,
  PencilLine,
  Trash2,
  Check,
  Zap,
} from 'lucide-react';
import { TaskItem, ContextItem, SlotType, SLOT_LBL } from '../types';

interface TaskRowProps {
  task: TaskItem;
  context?: ContextItem;
  isFocused: boolean;
  showCtxTag?: boolean;
  showSlotTag?: boolean;
  isNew?: boolean;
  onToggle: (id: string) => void;
  onFocus: (id: string) => void;
  onMoveSlot: (id: string) => void;
  onUpdate: (id: string, text: string, note: string, slot: SlotType, urgent: boolean) => void;
  onDelete: (id: string) => void;
  onDragStart: (e: React.DragEvent, id: string) => void;
  onDragEnd: () => void;
  onDragOverTask: (e: React.DragEvent, id: string) => void;
  onDropOnTask: (e: React.DragEvent, id: string) => void;
}

export const TaskRow: React.FC<TaskRowProps> = ({
  task,
  context,
  isFocused,
  showCtxTag = false,
  showSlotTag = false,
  isNew = false,
  onToggle,
  onFocus,
  onMoveSlot,
  onUpdate,
  onDelete,
  onDragStart,
  onDragEnd,
  onDragOverTask,
  onDropOnTask,
}) => {
  const [isEditing, setIsEditing] = useState(false);
  const [editText, setEditText] = useState(task.text);
  const [editNote, setEditNote] = useState(task.note || '');
  const [editSlot, setEditSlot] = useState<SlotType>(task.slot);
  const [editUrgent, setEditUrgent] = useState(task.urgent);
  const [dropIndicator, setDropIndicator] = useState<'drop-b' | 'drop-a' | null>(null);

  const editInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isEditing) {
      setEditText(task.text);
      setEditNote(task.note || '');
      setEditSlot(task.slot);
      setEditUrgent(task.urgent);
      setTimeout(() => {
        editInputRef.current?.focus();
      }, 30);
    }
  }, [isEditing, task]);

  const handleSaveEdit = () => {
    const trimmed = editText.trim();
    if (trimmed) {
      onUpdate(task.id, trimmed, editNote.trim(), editSlot, editUrgent);
    }
    setIsEditing(false);
  };

  const handleCancelEdit = () => {
    setIsEditing(false);
  };

  if (isEditing) {
    return (
      <li className="task editing" data-id={task.id}>
        <div className="ed">
          <input
            ref={editInputRef}
            className="ed-in"
            value={editText}
            maxLength={200}
            onChange={(e) => setEditText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                handleSaveEdit();
              } else if (e.key === 'Escape') {
                handleCancelEdit();
              }
            }}
          />
          <textarea
            className="ed-note"
            rows={2}
            placeholder="Detalle (opcional)…"
            value={editNote}
            onChange={(e) => setEditNote(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                handleCancelEdit();
              }
            }}
          />
          <div className="ed-opts">
            <span className="slots">
              <button
                type="button"
                className={`opt ${editSlot === 'hoy' ? 'on' : ''}`}
                onClick={() => setEditSlot('hoy')}
              >
                HOY
              </button>
              <button
                type="button"
                className={`opt ${editSlot === 'manana' ? 'on' : ''}`}
                onClick={() => setEditSlot('manana')}
              >
                MAÑANA
              </button>
              <button
                type="button"
                className={`opt ${editSlot === 'despues' ? 'on' : ''}`}
                onClick={() => setEditSlot('despues')}
              >
                DESPUÉS
              </button>
            </span>

            <button
              type="button"
              className={`opt urg ${editUrgent ? 'on' : ''}`}
              onClick={() => setEditUrgent(!editUrgent)}
            >
              <Zap size={11} />
              URGENTE
            </button>

            <span className="sp" />

            <button
              type="button"
              className="opt save"
              onClick={handleSaveEdit}
            >
              <Check size={11} />
              GUARDAR
            </button>
            <button
              type="button"
              className="opt"
              onClick={handleCancelEdit}
            >
              CANCELAR
            </button>
          </div>
        </div>
      </li>
    );
  }

  const nextSlotLabel =
    task.slot === 'hoy' ? 'MAÑANA' : task.slot === 'manana' ? 'DESPUÉS' : 'HOY';

  return (
    <li
      className={`task ${task.done ? 'done' : ''} ${task.urgent && !task.done ? 'urg' : ''} ${isNew ? 'new' : ''} ${dropIndicator || ''}`}
      data-id={task.id}
      draggable={!task.done}
      onDragStart={(e) => onDragStart(e, task.id)}
      onDragEnd={() => {
        setDropIndicator(null);
        onDragEnd();
      }}
      onDragOver={(e) => {
        e.preventDefault();
        const r = e.currentTarget.getBoundingClientRect();
        setDropIndicator(e.clientY < r.top + r.height / 2 ? 'drop-b' : 'drop-a');
        onDragOverTask(e, task.id);
      }}
      onDragLeave={() => setDropIndicator(null)}
      onDrop={(e) => {
        e.preventDefault();
        setDropIndicator(null);
        onDropOnTask(e, task.id);
      }}
    >
      <span className="drag" title="Arrastra para reordenar o cambiar de lista">
        <GripVertical size={13} />
      </span>

      <button
        type="button"
        className="chk"
        onClick={() => onToggle(task.id)}
        aria-label="Completar tarea"
      >
        <svg viewBox="0 0 12 10">
          <path d="M1.5 5.5 4.5 8.5 10.5 1.5" pathLength="1" />
        </svg>
      </button>

      <div className="txt">
        <span className="t">{task.text}</span>
        <span className="mt">
          {showCtxTag && context && (
            <span
              className="tag cx"
              style={{ '--c': context.color } as React.CSSProperties}
            >
              {context.name.toUpperCase()}
            </span>
          )}
          {showSlotTag && !task.done && (
            <span className="tag">{SLOT_LBL[task.slot]}</span>
          )}
          {task.urgent && !task.done && <span className="tag ugt">URGENTE</span>}
          {task.stale && !task.done && <span className="tag od">DE AYER</span>}
          {task.done && <span className="tag ok">HECHA</span>}
          {task.note && !task.done && (
            <span className="tag nt" title={task.note}>
              · {task.note.length > 70 ? task.note.slice(0, 70) + '…' : task.note}
            </span>
          )}
        </span>
      </div>

      <span className="acts">
        {!task.done && (
          <>
            <button
              type="button"
              className={`a ${isFocused ? 'on' : ''}`}
              onClick={() => onFocus(task.id)}
              title="Foco de hoy"
              style={isFocused ? { color: 'var(--accent)' } : undefined}
            >
              <Crosshair size={15} />
            </button>
            <button
              type="button"
              className="a"
              onClick={() => onMoveSlot(task.id)}
              title={`Mover a ${nextSlotLabel}`}
            >
              <ArrowRight size={15} />
            </button>
          </>
        )}
        <button
          type="button"
          className="a"
          onClick={() => setIsEditing(true)}
          title="Editar"
        >
          <PencilLine size={15} />
        </button>
        <button
          type="button"
          className="a"
          data-action="del"
          onClick={() => onDelete(task.id)}
          title="Eliminar"
        >
          <Trash2 size={15} />
        </button>
      </span>
    </li>
  );
};
