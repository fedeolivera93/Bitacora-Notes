import React from 'react';
import { Crosshair, Check } from 'lucide-react';
import { BitacoraState, TaskItem } from '../types';

interface FocusBlockProps {
  state: BitacoraState;
  onToggleTask: (taskId: string) => void;
  onUnfocus: () => void;
}

export const FocusBlock: React.FC<FocusBlockProps> = ({
  state,
  onToggleTask,
  onUnfocus,
}) => {
  const focusedTask = state.tasks.find(
    (x) => x.id === state.focus && !x.done
  );

  if (focusedTask) {
    const c = state.ctx.find((ctx) => ctx.id === focusedTask.ctx);
    return (
      <div className="focus">
        <span className="f-lab">
          <Crosshair size={13} />
          FOCO DE HOY
        </span>
        {focusedTask.urgent && (
          <span className="tag ugt" style={{ marginLeft: '8px' }}>
            URGENTE
          </span>
        )}
        <p className="f-txt">{focusedTask.text}</p>
        <p className="f-mt">
          {c && (
            <span className="tag cx" style={{ '--c': c.color } as React.CSSProperties}>
              {c.name.toUpperCase()}
            </span>
          )}
          {focusedTask.stale && <span className="tag od">DE AYER</span>}
        </p>
        <div className="f-act">
          <button
            type="button"
            className="btn-solid"
            onClick={() => onToggleTask(focusedTask.id)}
          >
            <Check size={13} />
            MARCAR HECHO
          </button>
          <button
            type="button"
            className="btn-ghost"
            onClick={onUnfocus}
          >
            QUITAR EL FOCO
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="focus empty">
      <span className="f-lab">
        <Crosshair size={13} />
        FOCO DE HOY
      </span>
      <p className="f-txt">
        Nada señalado todavía. Pulsa la <Crosshair size={14} style={{ display: 'inline', verticalAlign: 'middle', margin: '0 2px' }} /> de una tarea y aparecerá aquí.
      </p>
    </div>
  );
};
