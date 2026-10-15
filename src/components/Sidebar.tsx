import React, { useState, useRef, useEffect } from 'react';
import { User } from 'firebase/auth';
import { BitacoraState } from '../types';
import { LogOut, Trash2, Cloud, HardDrive } from 'lucide-react';

interface SidebarProps {
  state: BitacoraState;
  currentView: string;
  onSelectView: (view: string) => void;
  onAddContext: (name: string) => void;
  user: User | null;
  isGuest: boolean;
  onLoginClick: () => void;
  onLogoutClick: () => void;
  onDeleteAccountClick: () => void;
}

export const Sidebar: React.FC<SidebarProps> = ({
  state,
  currentView,
  onSelectView,
  onAddContext,
  user,
  isGuest,
  onLoginClick,
  onLogoutClick,
  onDeleteAccountClick,
}) => {
  const [isAddingCtx, setIsAddingCtx] = useState(false);
  const [newCtxName, setNewCtxName] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isAddingCtx && inputRef.current) {
      inputRef.current.focus();
    }
  }, [isAddingCtx]);

  const handleCommitNewCtx = () => {
    const val = newCtxName.trim();
    if (val) {
      onAddContext(val);
    }
    setNewCtxName('');
    setIsAddingCtx(false);
  };

  const hoyCount = state.tasks.filter((t) => !t.done && t.slot === 'hoy').length;
  const notesCount = state.notes.length;

  return (
    <aside className="side">
      <div className="side-top-bar">
        <div className="brand" onClick={() => onSelectView('today')} style={{ cursor: 'pointer' }}>
          <span className="mono-mark">B</span>
          <div>
            <span className="b-name">Bitácora</span>
            <span className="b-sub">CUADERNO DE TRABAJO</span>
          </div>
        </div>
      </div>

      <nav className="nav">
        <ul id="nav">
          <li
            className={`nav-it ${currentView === 'today' ? 'on' : ''}`}
            onClick={() => onSelectView('today')}
          >
            <span className="nm">Hoy</span>
            <span className="ct">{hoyCount || ''}</span>
          </li>

          <li className="nl">CONTEXTOS</li>

          {state.ctx.map((c) => {
            const count = state.tasks.filter((t) => !t.done && t.ctx === c.id).length;
            return (
              <li
                key={c.id}
                className={`nav-it ${currentView === c.id ? 'on' : ''}`}
                onClick={() => onSelectView(c.id)}
              >
                <span className="sw" style={{ '--c': c.color } as React.CSSProperties} />
                <span className="nm">{c.name}</span>
                <span className="ct">{count || ''}</span>
              </li>
            );
          })}

          {isAddingCtx ? (
            <li className="newc-in">
              <input
                ref={inputRef}
                id="newctx-in"
                placeholder="Nombre del contexto"
                maxLength={24}
                value={newCtxName}
                onChange={(e) => setNewCtxName(e.target.value)}
                onBlur={handleCommitNewCtx}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    handleCommitNewCtx();
                  } else if (e.key === 'Escape') {
                    setNewCtxName('');
                    setIsAddingCtx(false);
                  }
                }}
              />
            </li>
          ) : (
            <li className="newc">
              <button type="button" onClick={() => setIsAddingCtx(true)}>
                + AÑADIR CONTEXTO
              </button>
            </li>
          )}

          <li className="dv" />

          <li
            className={`nav-it ${currentView === 'notes' ? 'on' : ''}`}
            onClick={() => onSelectView('notes')}
          >
            <span className="nm">Notas</span>
            <span className="ct">{notesCount || ''}</span>
          </li>
        </ul>
      </nav>

      {/* User panel */}
      {user ? (
        <div className="user-panel">
          <div className="user-row">
            <div className="user-avatar" title={user.email || user.displayName || 'Usuario'}>
              {user.photoURL ? (
                <img src={user.photoURL} alt="" referrerPolicy="no-referrer" />
              ) : (
                (user.displayName || user.email || 'U')[0].toUpperCase()
              )}
            </div>
            <div className="user-meta">
              <span className="user-name">{user.displayName || 'Usuario'}</span>
              <span className="user-email">{user.email || ''}</span>
            </div>
          </div>
          <div className="user-actions">
            <button
              type="button"
              className="btn-link"
              onClick={onLogoutClick}
              title="Cerrar sesión en este dispositivo"
            >
              Cerrar sesión
            </button>
            <span>·</span>
            <button
              type="button"
              className="btn-link danger"
              onClick={onDeleteAccountClick}
              title="Eliminar cuenta y cuaderno de Firestore"
            >
              Eliminar cuenta
            </button>
          </div>
        </div>
      ) : (
        <div className="user-panel">
          <button
            type="button"
            className="opt save"
            style={{ width: '100%', justifyContent: 'center' }}
            onClick={onLoginClick}
          >
            ENTRAR CON GOOGLE
          </button>
        </div>
      )}

      {/* Side Foot */}
      <div className="side-foot">
        {user ? (
          <p>
            CONECTADO CON GOOGLE<br />
            GUARDADO EN TU CUENTA EN LA NUBE<br />
            SINCRONIZADO EN TUS DISPOSITIVOS<br />
            EXPORTA UN RESPALDO DE VEZ EN CUANDO
          </p>
        ) : (
          <p>
            GUARDADO EN ESTE NAVEGADOR<br />
            DATOS LOCALES · SIN SINCRONIZACIÓN<br />
            SE PIERDEN SI BORRAS EL HISTORIAL<br />
            EXPORTA UN RESPALDO DE VEZ EN CUANDO
          </p>
        )}
      </div>
    </aside>
  );
};
