import React, { useState, useRef } from 'react';
import { CornerDownLeft, Zap } from 'lucide-react';
import { ContextItem, SlotType } from '../types';

interface AddTaskFormProps {
  contexts: ContextItem[];
  defaultCtxId: string;
  showCtxSelect: boolean;
  onAddTask: (text: string, ctxId: string, slot: SlotType, urgent: boolean) => void;
}

export const AddTaskForm: React.FC<AddTaskFormProps> = ({
  contexts,
  defaultCtxId,
  showCtxSelect,
  onAddTask,
}) => {
  const [text, setText] = useState('');
  const [slot, setSlot] = useState<SlotType>('hoy');
  const [urgent, setUrgent] = useState(false);
  const [selectedCtx, setSelectedCtx] = useState(defaultCtxId);
  const inputRef = useRef<HTMLInputElement>(null);

  // Sync selectedCtx when defaultCtxId changes
  React.useEffect(() => {
    setSelectedCtx(defaultCtxId);
  }, [defaultCtxId]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = text.trim();
    if (!trimmed) {
      inputRef.current?.focus();
      return;
    }
    const finalCtx = contexts.some((c) => c.id === selectedCtx)
      ? selectedCtx
      : contexts[0]?.id || '';
    onAddTask(trimmed, finalCtx, slot, urgent);
    setText('');
    inputRef.current?.focus();
  };

  return (
    <form className="add" onSubmit={handleSubmit}>
      <div className="add-row">
        <input
          ref={inputRef}
          className="add-in"
          placeholder="¿Qué hay que hacer?"
          maxLength={200}
          autoComplete="off"
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
        <button type="submit" className="add-go" title="Añadir">
          <CornerDownLeft size={16} />
        </button>
      </div>

      <div className="add-opts">
        {showCtxSelect && contexts.length > 0 && (
          <select
            className="sel"
            value={selectedCtx}
            onChange={(e) => setSelectedCtx(e.target.value)}
            title="Contexto"
          >
            {contexts.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name.toUpperCase()}
              </option>
            ))}
          </select>
        )}

        <span className="slots">
          <button
            type="button"
            className={`opt ${slot === 'hoy' ? 'on' : ''}`}
            onClick={() => setSlot('hoy')}
          >
            HOY
          </button>
          <button
            type="button"
            className={`opt ${slot === 'manana' ? 'on' : ''}`}
            onClick={() => setSlot('manana')}
          >
            MAÑANA
          </button>
          <button
            type="button"
            className={`opt ${slot === 'despues' ? 'on' : ''}`}
            onClick={() => setSlot('despues')}
          >
            DESPUÉS
          </button>
        </span>

        <button
          type="button"
          className={`opt urg ${urgent ? 'on' : ''}`}
          onClick={() => setUrgent(!urgent)}
        >
          <Zap size={11} />
          URGENTE
        </button>

        <span className="hint">ENTER AÑADE</span>
      </div>
    </form>
  );
};
