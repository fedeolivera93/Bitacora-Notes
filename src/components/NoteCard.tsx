import React, { useRef, useEffect } from 'react';
import { Pin, Code, Copy, Trash2 } from 'lucide-react';
import { NoteItem, ContextItem, pad, fmtUp } from '../types';

interface NoteCardProps {
  note: NoteItem;
  index: number;
  contexts: ContextItem[];
  showWhereSelector?: boolean;
  showGroupSelector?: boolean;
  isFlashed?: boolean;
  onUpdateNote: (id: string, updates: Partial<NoteItem>) => void;
  onDeleteNote: (id: string) => void;
  onCopyNote: (id: string) => void;
}

export const NoteCard: React.FC<NoteCardProps> = ({
  note,
  index,
  contexts,
  showWhereSelector = false,
  showGroupSelector = false,
  isFlashed = false,
  onUpdateNote,
  onDeleteNote,
  onCopyNote,
}) => {
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const cardRef = useRef<HTMLElement>(null);

  const autoResize = () => {
    if (bodyRef.current) {
      bodyRef.current.style.height = 'auto';
      bodyRef.current.style.height = `${bodyRef.current.scrollHeight + 2}px`;
    }
  };

  useEffect(() => {
    autoResize();
  }, [note.body]);

  useEffect(() => {
    if (isFlashed && cardRef.current) {
      cardRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }, [isFlashed]);

  const currentCtx = note.ctx ? contexts.find((c) => c.id === note.ctx) : null;
  const whereValue = note.ctx ? `${note.ctx}|${note.group || ''}` : '';

  const handleWhereChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const val = e.target.value;
    if (!val) {
      onUpdateNote(note.id, { ctx: null, group: null });
    } else {
      const [cId, gId] = val.split('|');
      onUpdateNote(note.id, { ctx: cId, group: gId || null });
    }
  };

  const handleGroupChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    onUpdateNote(note.id, { group: e.target.value || null });
  };

  return (
    <article
      ref={cardRef}
      className={`note ${isFlashed ? 'flash' : ''}`}
      data-nid={note.id}
    >
      <div className="n-top">
        <button
          type="button"
          className={`a np ${note.pin ? 'on' : ''}`}
          onClick={() => onUpdateNote(note.id, { pin: !note.pin })}
          title={note.pin ? 'Quitar de las fijadas' : 'Fijar arriba'}
        >
          <Pin size={13} />
        </button>

        <span className="n-idx">N.{pad(index + 1)}</span>

        <input
          className="n-title"
          value={note.title}
          placeholder="Sin título"
          maxLength={120}
          onChange={(e) => onUpdateNote(note.id, { title: e.target.value })}
        />

        {showWhereSelector && (
          <select
            className="sel"
            value={whereValue}
            onChange={handleWhereChange}
            title="Dónde vive esta nota"
          >
            <option value="">GENERAL</option>
            {contexts.map((c) => (
              <optgroup key={c.id} label={c.name}>
                <option value={`${c.id}|`}>{c.name.toUpperCase()}</option>
                {c.groups.map((g) => (
                  <option key={g.id} value={`${c.id}|${g.id}`}>
                    {g.name.toUpperCase()}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
        )}

        {showGroupSelector && currentCtx && currentCtx.groups.length > 0 && (
          <select
            className="sel"
            value={note.group || ''}
            onChange={handleGroupChange}
            title="Grupo"
          >
            <option value="">SIN GRUPO</option>
            {currentCtx.groups.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name.toUpperCase()}
              </option>
            ))}
          </select>
        )}

        <span className="n-acts">
          <button
            type="button"
            className={`a ${note.mono ? 'on' : ''}`}
            onClick={() => onUpdateNote(note.id, { mono: !note.mono })}
            title="Tipografía mono (código, shortcodes)"
          >
            <Code size={13} />
          </button>
          <button
            type="button"
            className="a"
            onClick={() => onCopyNote(note.id)}
            title="Copiar el contenido"
          >
            <Copy size={13} />
          </button>
          <button
            type="button"
            className="a"
            data-action="delnote"
            onClick={() => onDeleteNote(note.id)}
            title="Eliminar nota"
          >
            <Trash2 size={13} />
          </button>
        </span>
      </div>

      <textarea
        ref={bodyRef}
        className={`n-body ${note.mono ? 'mono' : ''}`}
        placeholder={note.mono ? 'Pega aquí shortcodes, código, planes…' : 'Escribe aquí…'}
        value={note.body}
        onChange={(e) => {
          onUpdateNote(note.id, { body: e.target.value });
          autoResize();
        }}
      />

      <p className="n-meta">
        EDITADA {fmtUp(note.up)}
        {note.mono ? ' · MONO' : ''}
      </p>
    </article>
  );
};
