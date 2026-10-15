import React, { useState, useRef, useEffect } from 'react';
import { Search, Flame, PencilLine, Trash2 } from 'lucide-react';
import { BitacoraState, ContextItem, streak, isoWeek, dayOfYear, dstr } from '../types';

interface HeaderProps {
  state: BitacoraState;
  currentView: string;
  searchQuery: string;
  onSearchChange: (q: string) => void;
  onClearSearch: () => void;
  onRenameContext: (ctxId: string, newName: string) => void;
  onDeleteContext: (ctxId: string) => void;
  saveStatus: 'saved' | 'saving' | 'error';
  isGuest: boolean;
  onRetrySave?: () => void;
}

export const Header: React.FC<HeaderProps> = ({
  state,
  currentView,
  searchQuery,
  onSearchChange,
  onClearSearch,
  onRenameContext,
  onDeleteContext,
  saveStatus,
  isGuest,
  onRetrySave,
}) => {
  const [isRenaming, setIsRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const renameInputRef = useRef<HTMLInputElement>(null);

  const activeCtx = state.ctx.find((c) => c.id === currentView);

  useEffect(() => {
    setConfirmDelete(false);
    setIsRenaming(false);
  }, [currentView]);

  useEffect(() => {
    if (isRenaming && renameInputRef.current) {
      renameInputRef.current.focus();
      renameInputRef.current.select();
    }
  }, [isRenaming]);

  // Global keydown for '/'
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (
        e.key === '/' &&
        document.activeElement &&
        !/INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName)
      ) {
        e.preventDefault();
        searchInputRef.current?.focus();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  const handleStartRename = () => {
    if (activeCtx) {
      setRenameValue(activeCtx.name);
      setIsRenaming(true);
    }
  };

  const handleCommitRename = () => {
    if (activeCtx && renameValue.trim()) {
      onRenameContext(activeCtx.id, renameValue.trim());
    }
    setIsRenaming(false);
  };

  const mastHTML = (sub: string) => (
    <div className="mast">
      <div className="m-left">
        <span className="m-title">{sub}</span>
        {isGuest ? (
          <span className="sync-badge saved" title="Tus cambios se guardan localmente en este navegador">
            ● LOCAL
          </span>
        ) : saveStatus === 'saving' ? (
          <span className="sync-badge saving" title="Guardando cambios en Firestore...">
            ○ GUARDANDO...
          </span>
        ) : saveStatus === 'error' ? (
          <span className="sync-badge error" title="Hubo un error al guardar en la nube">
            ▲ ERROR DE GUARDADO
            {onRetrySave && (
              <button
                type="button"
                className="lk"
                style={{ marginLeft: '5px', textDecoration: 'underline' }}
                onClick={onRetrySave}
              >
                REINTENTAR
              </button>
            )}
          </span>
        ) : (
          <span className="sync-badge saved" title="Sincronizado y guardado en Firestore">
            ● GUARDADO
          </span>
        )}
      </div>
      <label className="srch">
        <Search size={13} />
        <input
          ref={searchInputRef}
          id="q"
          placeholder="Buscar  ( / )"
          value={searchQuery}
          onChange={(e) => onSearchChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              onClearSearch();
            }
          }}
        />
      </label>
    </div>
  );

  if (currentView === 'today') {
    const d = new Date();
    const dw = new Intl.DateTimeFormat('es', { weekday: 'long' }).format(d);
    const mes = new Intl.DateTimeFormat('es', { month: 'long' }).format(d);
    const hoyTasks = state.tasks.filter((t) => !t.done && t.slot === 'hoy');
    const manTasks = state.tasks.filter((t) => !t.done && t.slot === 'manana');
    const urg = hoyTasks.filter((t) => t.urgent).length;
    const stale = hoyTasks.filter((t) => t.stale).length;
    const doneToday = state.tasks.filter((t) => t.done && t.doneAt === dstr()).length;
    const st = streak(state);

    const dots = Array.from({ length: 7 }, (_, i) => {
      const dd = new Date();
      dd.setDate(dd.getDate() - (6 - i));
      const k = dstr(dd);
      const isFilled = (state.log[k] || 0) > 0;
      const isToday = k === dstr();
      return (
        <span
          key={k}
          className={`d ${isFilled ? 'f' : ''} ${isToday ? 't' : ''}`}
        />
      );
    });

    return (
      <header className="head" id="head">
        {mastHTML('EDICIÓN DE HOY')}
        <h1 className="date">
          {d.getDate()} <em>de {mes}</em>
          <span className="yr">{d.getFullYear()}</span>
        </h1>
        <p className="almanac">
          {dw.toUpperCase()} · SEMANA {isoWeek(d)} · DÍA {dayOfYear(d)} DEL AÑO
          <span className="rach">
            <Flame size={12} />
            {st} {st === 1 ? 'DÍA' : 'DÍAS'}
          </span>
          <span className="dots">{dots}</span>
        </p>
        <div className="rule" />
        <p className="ledger">
          {hoyTasks.length} PARA HOY
          {urg > 0 ? (
            <> · <b className="bad">{urg} URGENTE{urg === 1 ? '' : 'S'}</b></>
          ) : null}
          {stale > 0 ? (
            <> · <b className="bad">{stale} DE AYER</b></>
          ) : null}
          {' '}· {manTasks.length} MAÑANA · {doneToday} HECHA{doneToday === 1 ? '' : 'S'} HOY
        </p>
      </header>
    );
  }

  if (currentView === 'notes') {
    const pinned = state.notes.filter((n) => n.pin).length;
    return (
      <header className="head" id="head">
        {mastHTML('NOTAS')}
        <h1 className="date">Notas</h1>
        <div className="rule" />
        <p className="ledger">
          {state.notes.length} NOTAS · {pinned} FIJADAS · GUARDADO AUTOMÁTICO
        </p>
      </header>
    );
  }

  if (currentView === 'search') {
    const q = searchQuery.trim().toLowerCase();
    const tn = state.tasks.filter((t) =>
      ((t.text || '') + ' ' + (t.note || '')).toLowerCase().includes(q)
    ).length;
    const nn = state.notes.filter((n) =>
      ((n.title || '') + ' ' + (n.body || '')).toLowerCase().includes(q)
    ).length;

    return (
      <header className="head" id="head">
        {mastHTML('BÚSQUEDA')}
        <h1 className="date">Resultados</h1>
        <div className="rule" />
        <p className="ledger">
          «{searchQuery}» · {tn} TAREAS · {nn} NOTAS ·{' '}
          <button type="button" className="lk" onClick={onClearSearch}>
            LIMPIAR
          </button>
        </p>
      </header>
    );
  }

  // Context view
  if (activeCtx) {
    const h = state.tasks.filter((t) => !t.done && t.slot === 'hoy' && t.ctx === activeCtx.id).length;
    const m = state.tasks.filter((t) => !t.done && t.slot === 'manana' && t.ctx === activeCtx.id).length;
    const de = state.tasks.filter((t) => !t.done && t.slot === 'despues' && t.ctx === activeCtx.id).length;
    const dn = state.tasks.filter((t) => t.done && t.ctx === activeCtx.id).length;
    const stale = state.tasks.filter((t) => !t.done && t.slot === 'hoy' && t.stale && t.ctx === activeCtx.id).length;
    const other = state.ctx.find((x) => x.id !== activeCtx.id);

    return (
      <header className="head" id="head">
        {mastHTML('CONTEXTO')}
        <h1 className="date">
          {isRenaming ? (
            <input
              ref={renameInputRef}
              id="renctx-in"
              value={renameValue}
              maxLength={24}
              onChange={(e) => setRenameValue(e.target.value)}
              onBlur={handleCommitRename}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  handleCommitRename();
                } else if (e.key === 'Escape') {
                  setIsRenaming(false);
                }
              }}
            />
          ) : (
            <>
              <span className="ctx-t">
                <span className="sw" style={{ '--c': activeCtx.color } as React.CSSProperties} />
                {activeCtx.name}
              </span>
              <span className="h-acts">
                <button
                  type="button"
                  className="a"
                  onClick={handleStartRename}
                  title="Cambiar nombre"
                >
                  <PencilLine size={16} />
                </button>
                <button
                  type="button"
                  className="a"
                  onClick={() => setConfirmDelete(true)}
                  title="Eliminar contexto"
                >
                  <Trash2 size={16} />
                </button>
              </span>
            </>
          )}
        </h1>

        {confirmDelete && (
          <div className="warn">
            <p>
              ¿Eliminar «{activeCtx.name}»? Sus{' '}
              {state.tasks.filter((t) => t.ctx === activeCtx.id).length} tareas pasarán a «
              {other ? other.name : '—'}» y sus{' '}
              {state.notes.filter((n) => n.ctx === activeCtx.id).length} notas quedarán en General.
            </p>
            <span>
              <button
                type="button"
                className="opt bad"
                onClick={() => {
                  onDeleteContext(activeCtx.id);
                  setConfirmDelete(false);
                }}
              >
                ELIMINAR
              </button>
              <button
                type="button"
                className="opt"
                onClick={() => setConfirmDelete(false)}
              >
                CANCELAR
              </button>
            </span>
          </div>
        )}

        <div className="rule" />
        <p className="ledger">
          {h} HOY · {m} MAÑANA · {de} DESPUÉS · {dn} HECHAS
          {stale > 0 ? (
            <> · <b className="bad">{stale} DE AYER</b></>
          ) : null}
        </p>
      </header>
    );
  }

  return null;
};
