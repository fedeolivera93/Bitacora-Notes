/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  onAuthStateChanged,
  signInWithPopup,
  signOut,
  deleteUser,
  User,
} from 'firebase/auth';
import { doc, getDoc, setDoc, deleteDoc, getDocFromServer } from 'firebase/firestore';
import { auth, db, googleProvider, handleFirestoreError, OperationType } from './firebase';
import {
  BitacoraState,
  ContextItem,
  TaskItem,
  NoteItem,
  SlotType,
  PendingSyncData,
  getPendingKey,
  PALETTE,
  LS_KEY,
  dstr,
  uid,
  seed,
  normalize,
} from './types';
import { AuthScreen } from './components/AuthScreen';
import { Sidebar } from './components/Sidebar';
import { Header } from './components/Header';
import { FocusBlock } from './components/FocusBlock';
import { AddTaskForm } from './components/AddTaskForm';
import { TaskRow } from './components/TaskRow';
import { NoteCard } from './components/NoteCard';
import { SearchView } from './components/SearchView';
import { Stamp } from './components/Stamp';
import { ConfirmationModal } from './components/ConfirmationModal';
import { ChevronDown, ChevronRight, Plus, PencilLine, Trash2 } from 'lucide-react';

interface ToastInfo {
  id: string;
  msg: string;
  action?: {
    label: string;
    fn: () => void;
  };
}

const RETRY_BACKOFF_MS = [5000, 15000, 60000];

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [authChecked, setAuthChecked] = useState(false);
  const [isGuest, setIsGuest] = useState(false);
  const [sessionExpired, setSessionExpired] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [isAuthLoading, setIsAuthLoading] = useState(false);

  // App state
  const [state, setState] = useState<BitacoraState>(() => seed());
  const [currentView, setCurrentView] = useState<string>('today');
  const [prevView, setPrevView] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [collapsedSections, setCollapsedSections] = useState<Record<string, boolean>>({});
  const [flashedNoteId, setFlashedNoteId] = useState<string | null>(null);
  const [lastAddedTaskId, setLastAddedTaskId] = useState<string | null>(null);

  // Modals & Stamp
  const [showStamp, setShowStamp] = useState(false);
  const [stampDate, setStampDate] = useState('');
  const [toasts, setToasts] = useState<ToastInfo[]>([]);
  const [saveStatus, setSaveStatus] = useState<'saved' | 'saving' | 'error'>('saved');

  // Modals
  const [showDeleteAccountModal, setShowDeleteAccountModal] = useState(false);
  const [showImportLocalModal, setShowImportLocalModal] = useState(false);
  const [pendingLocalState, setPendingLocalState] = useState<BitacoraState | null>(null);

  // Conflict resolution modal
  const [showConflictModal, setShowConflictModal] = useState(false);
  const [conflictCloudState, setConflictCloudState] = useState<BitacoraState | null>(null);
  const [conflictPendingState, setConflictPendingState] = useState<BitacoraState | null>(null);

  // Context group creation in Context View
  const [isAddingGroup, setIsAddingGroup] = useState(false);
  const [newGroupName, setNewGroupName] = useState('');
  const [editingGroupId, setEditingGroupId] = useState<string | null>(null);
  const [editingGroupName, setEditingGroupName] = useState('');

  // Drag and drop tracking
  const [draggingTaskId, setDraggingTaskId] = useState<string | null>(null);

  const importFileInputRef = useRef<HTMLInputElement>(null);
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const retryTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const retryCountRef = useRef<number>(0);

  const stateRef = useRef<BitacoraState>(state);
  stateRef.current = state;

  const hasEverLoggedInRef = useRef<boolean>(false);
  const lastSyncedAtRef = useRef<number>(Date.now());
  const hasUnsavedChangesRef = useRef<boolean>(false);
  const currentUidRef = useRef<string | null>(null);

  // Toast helper
  const addToast = useCallback((msg: string, action?: { label: string; fn: () => void }) => {
    const id = uid();
    setToasts((prev) => [...prev, { id, msg, action }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, action ? 6000 : 3500);
  }, []);

  // Alert before closing / reloading if there are unsaved changes
  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (hasUnsavedChangesRef.current) {
        e.preventDefault();
        e.returnValue = '';
        return '';
      }
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, []);

  // Rollover logic: "Mañana" -> "Hoy", "Hoy" -> "Stale"
  const checkRollover = useCallback(
    (st: BitacoraState): { state: BitacoraState; count: number } => {
      const today = dstr();
      if (st.day === today) return { state: st, count: 0 };
      let count = 0;
      const newTasks = st.tasks.map((t) => {
        if (t.done) return t;
        if (t.slot === 'manana') {
          count++;
          return { ...t, slot: 'hoy' as SlotType, stale: true };
        }
        if (t.slot === 'hoy') {
          count++;
          return { ...t, stale: true };
        }
        return t;
      });
      return {
        state: { ...st, day: today, tasks: newTasks },
        count,
      };
    },
    []
  );

  // Firestore write with 10-second hard timeout
  const writeToFirestoreWithTimeout = useCallback(
    async (targetUid: string, stateToSave: BitacoraState): Promise<void> => {
      const payload = {
        ...stateToSave,
        updatedAt: Date.now(),
      };

      const writePromise = setDoc(doc(db, 'users', targetUid), payload);
      let timer: ReturnType<typeof setTimeout>;
      const timeoutPromise = new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          const timeoutErr = new Error('TIMEOUT_10S');
          (timeoutErr as any).code = 'timeout';
          reject(timeoutErr);
        }, 10000);
      });

      try {
        await Promise.race([writePromise, timeoutPromise]);
      } finally {
        clearTimeout(timer!);
      }
    },
    []
  );

  // Schedule auto-retry with exponential backoff [5s, 15s, 60s]
  const scheduleRetry = useCallback(() => {
    if (retryTimeoutRef.current) {
      clearTimeout(retryTimeoutRef.current);
    }
    const delay =
      RETRY_BACKOFF_MS[
        Math.min(retryCountRef.current, RETRY_BACKOFF_MS.length - 1)
      ];
    retryCountRef.current++;

    retryTimeoutRef.current = setTimeout(() => {
      if (hasUnsavedChangesRef.current && currentUidRef.current) {
        executeCloudSave(currentUidRef.current, stateRef.current);
      }
    }, delay);
  }, []);

  // Direct cloud save execution
  const executeCloudSave = useCallback(
    async (targetUid: string, stateToSave: BitacoraState) => {
      if (!auth.currentUser || auth.currentUser.uid !== targetUid) {
        console.error(
          '[Save Error Code]: unauthenticated - No active matching user session'
        );
        setSaveStatus('error');
        setSessionExpired(true);
        scheduleRetry();
        return;
      }

      setSaveStatus('saving');

      // Ensure pending copy exists in localStorage before the network call
      try {
        const pendingData: PendingSyncData = {
          state: stateToSave,
          lastSyncedAt: lastSyncedAtRef.current,
        };
        localStorage.setItem(getPendingKey(targetUid), JSON.stringify(pendingData));
      } catch (err: any) {
        console.error(
          '[LocalStorage Error Code]:',
          err?.code || err?.name || 'unknown',
          err
        );
      }

      try {
        await writeToFirestoreWithTimeout(targetUid, stateToSave);

        // Success: clear pending copy and reset errors
        localStorage.removeItem(getPendingKey(targetUid));
        lastSyncedAtRef.current = Date.now();
        hasUnsavedChangesRef.current = false;
        retryCountRef.current = 0;
        setSaveStatus('saved');
        if (retryTimeoutRef.current) {
          clearTimeout(retryTimeoutRef.current);
          retryTimeoutRef.current = null;
        }
      } catch (err: any) {
        const errCode = err?.code || err?.name || err?.message || 'UNKNOWN';
        console.error(
          `[Firestore Error Code: ${errCode}] during save to users/${targetUid}:`,
          err
        );
        handleFirestoreError(err, OperationType.WRITE, `users/${targetUid}`);

        setSaveStatus('error');
        hasUnsavedChangesRef.current = true;

        if (
          errCode === 'permission-denied' ||
          errCode === 'unauthenticated' ||
          !auth.currentUser
        ) {
          setSessionExpired(true);
        }

        scheduleRetry();
      }
    },
    [writeToFirestoreWithTimeout, scheduleRetry]
  );

  // Trigger Save (debounced)
  const triggerSave = useCallback(
    (newState: BitacoraState, immediateLocal = false) => {
      setState(newState);

      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
      }

      if (user) {
        hasUnsavedChangesRef.current = true;
        setSaveStatus('saving');

        // Immediately update pending changes in localStorage so power cut / tab close won't lose them
        try {
          const pendingData: PendingSyncData = {
            state: newState,
            lastSyncedAt: lastSyncedAtRef.current,
          };
          localStorage.setItem(getPendingKey(user.uid), JSON.stringify(pendingData));
        } catch (e: any) {
          console.error('[LocalStorage Save Pending Error]:', e?.code || e);
        }

        saveTimeoutRef.current = setTimeout(() => {
          executeCloudSave(user.uid, newState);
        }, 1800);
      } else {
        // Local mode
        const delay = immediateLocal ? 0 : 150;
        saveTimeoutRef.current = setTimeout(() => {
          try {
            localStorage.setItem(LS_KEY, JSON.stringify(newState));
            setSaveStatus('saved');
          } catch (e: any) {
            console.error('[LocalStorage Error Code]:', e?.code || e);
            addToast('No se pudo guardar localmente (¿almacenamiento lleno?)');
          }
        }, delay);
      }
    },
    [user, executeCloudSave, addToast]
  );

  // Retry save manually
  const handleManualRetrySave = useCallback(() => {
    if (user) {
      retryCountRef.current = 0;
      executeCloudSave(user.uid, stateRef.current);
    }
  }, [user, executeCloudSave]);

  // Check if all today tasks are completed
  const checkCompletionStamp = useCallback(
    (st: BitacoraState) => {
      const today = dstr();
      const pendingHoy = st.tasks.some((t) => !t.done && t.slot === 'hoy');
      if (!pendingHoy && (st.log[today] || 0) > 0 && st.stamp !== today) {
        const nextState = { ...st, stamp: today };
        triggerSave(nextState);
        setStampDate(today);
        setShowStamp(true);
        setTimeout(() => setShowStamp(false), 3400);
      }
    },
    [triggerSave]
  );

  // Listeners for reconnection & tab visibility
  useEffect(() => {
    const handleOnline = () => {
      if (hasUnsavedChangesRef.current && currentUidRef.current) {
        retryCountRef.current = 0;
        executeCloudSave(currentUidRef.current, stateRef.current);
      }
    };

    const handleVisibilityChange = () => {
      if (
        document.visibilityState === 'visible' &&
        hasUnsavedChangesRef.current &&
        currentUidRef.current
      ) {
        retryCountRef.current = 0;
        executeCloudSave(currentUidRef.current, stateRef.current);
      }
    };

    window.addEventListener('online', handleOnline);
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      window.removeEventListener('online', handleOnline);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [executeCloudSave]);

  // Download pending copy as JSON
  const downloadPendingJson = useCallback(() => {
    if (!conflictPendingState) return;
    try {
      const blob = new Blob([JSON.stringify(conflictPendingState, null, 2)], {
        type: 'application/json',
      });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      const [y, m, d] = dstr().split('-');
      a.download = `bitacora-pendiente-${d}${m}${y}.json`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 500);
      addToast('Copia local pendiente descargada');
    } catch (err: any) {
      console.error('[Export Error Code]:', err?.code || err);
      addToast('No se pudo descargar la copia local');
    }
  }, [conflictPendingState, addToast]);

  // Auth observer: onAuthStateChanged as single source of truth
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
      setUser(currentUser);
      setIsAuthLoading(false);
      currentUidRef.current = currentUser ? currentUser.uid : null;

      if (currentUser) {
        hasEverLoggedInRef.current = true;
        setSessionExpired(false);
        setIsGuest(false);

        try {
          // Check test connection defensively
          try {
            await getDocFromServer(doc(db, 'test', 'connection'));
          } catch (_) {
            /* ignore */
          }

          // Fetch cloud doc
          let userDocSnap;
          try {
            userDocSnap = await getDoc(doc(db, 'users', currentUser.uid));
          } catch (err: any) {
            console.error(
              '[Firestore Fetch Error Code]:',
              err?.code || err?.name || 'unknown',
              err
            );
            handleFirestoreError(
              err,
              OperationType.GET,
              `users/${currentUser.uid}`
            );
            return;
          }

          // Check if there are pending unconfirmed changes strictly for THIS user
          let pendingForThisUser: PendingSyncData | null = null;
          try {
            const rawPending = localStorage.getItem(getPendingKey(currentUser.uid));
            if (rawPending) {
              pendingForThisUser = JSON.parse(rawPending);
            }
          } catch (e: any) {
            console.error('[Pending Read Error Code]:', e?.code || e);
          }

          if (userDocSnap?.exists()) {
            const cloudState = normalize(userDocSnap.data());
            const cloudUpdatedAt = cloudState.updatedAt || 0;

            if (pendingForThisUser?.state) {
              const pendingState = normalize(pendingForThisUser.state);
              const lastSyncedAt = pendingForThisUser.lastSyncedAt || 0;

              // Compare timestamps
              if (cloudUpdatedAt <= lastSyncedAt) {
                // Cloud has not changed elsewhere; upload pending state
                const { state: rolled } = checkRollover(pendingState);
                setState(rolled);
                lastSyncedAtRef.current = cloudUpdatedAt;
                hasUnsavedChangesRef.current = true;
                executeCloudSave(currentUser.uid, rolled);
                addToast('Se han sincronizado tus cambios pendientes con la nube.');
              } else {
                // Conflict! Cloud was modified elsewhere
                setConflictCloudState(cloudState);
                setConflictPendingState(pendingState);
                setShowConflictModal(true);
                setState(cloudState);
              }
            } else {
              // Normal load
              const { state: rolled } = checkRollover(cloudState);
              setState(rolled);
              lastSyncedAtRef.current = cloudUpdatedAt;
              hasUnsavedChangesRef.current = false;
              setSaveStatus('saved');
            }

            // Check if there are separate guest data in localStorage to optionally import
            let localRaw: string | null = null;
            try {
              localRaw = localStorage.getItem(LS_KEY);
            } catch (_) {
              /* noop */
            }
            if (localRaw) {
              try {
                const parsedLocal = normalize(JSON.parse(localRaw));
                if (parsedLocal.tasks.length > 0 || parsedLocal.notes.length > 0) {
                  setPendingLocalState(parsedLocal);
                  setShowImportLocalModal(true);
                }
              } catch (_) {
                /* ignore */
              }
            }
          } else {
            // New user document in Firestore
            let initialState: BitacoraState;
            if (pendingForThisUser?.state) {
              initialState = normalize(pendingForThisUser.state);
            } else {
              let localRaw: string | null = null;
              try {
                localRaw = localStorage.getItem(LS_KEY);
              } catch (_) {
                /* noop */
              }
              if (localRaw) {
                try {
                  initialState = normalize(JSON.parse(localRaw));
                } catch (_) {
                  initialState = seed();
                }
              } else {
                initialState = seed();
              }
            }

            const { state: rolled } = checkRollover(initialState);
            setState(rolled);
            hasUnsavedChangesRef.current = true;
            executeCloudSave(currentUser.uid, rolled);

            setTimeout(() => {
              addToast(
                '¡Te damos la bienvenida a Bitácora! Empieza añadiendo tus tareas y notas.'
              );
            }, 600);
          }
        } catch (err: any) {
          console.error(
            '[Auth Setup Error Code]:',
            err?.code || err?.name || 'unknown',
            err
          );
        }
      } else {
        // User is NULL
        if (hasEverLoggedInRef.current) {
          // Previously logged in, but session was terminated/expired
          console.error(
            '[Auth Session Error Code]: session-expired / user became null'
          );
          setSessionExpired(true);
          setSaveStatus('error');
        } else {
          // Guest or fresh visitor
          const guestChoice = localStorage.getItem('bitacora.mode');
          if (guestChoice === 'trial') {
            setIsGuest(true);
            let raw: string | null = null;
            try {
              raw = localStorage.getItem(LS_KEY);
            } catch (_) {
              /* noop */
            }
            if (raw) {
              try {
                const loaded = normalize(JSON.parse(raw));
                const { state: rolled } = checkRollover(loaded);
                setState(rolled);
              } catch (_) {
                const s = seed();
                setState(s);
                localStorage.setItem(LS_KEY, JSON.stringify(s));
              }
            } else {
              const s = seed();
              setState(s);
              localStorage.setItem(LS_KEY, JSON.stringify(s));
              setTimeout(() => {
                addToast(
                  '¡Te damos la bienvenida a Bitácora! Empieza añadiendo tus tareas y notas.'
                );
              }, 600);
            }
          }
        }
      }

      setAuthChecked(true);
    });

    return () => unsubscribe();
  }, [addToast, checkRollover, executeCloudSave]);

  // Midnight interval check
  useEffect(() => {
    const timer = setInterval(() => {
      const today = dstr();
      if (today !== stateRef.current.day) {
        const { state: updated, count } = checkRollover(stateRef.current);
        triggerSave(updated, true);
        if (count > 0) {
          addToast(
            `Un nuevo día: lo de «Mañana» pasó a «Hoy» · ${count} ${
              count === 1 ? 'tarea quedó marcada' : 'tareas quedaron marcadas'
            } «DE AYER»`
          );
        }
      }
    }, 60000);
    return () => clearInterval(timer);
  }, [checkRollover, triggerSave, addToast]);

  // Google sign in handler
  const handleGoogleLogin = async () => {
    setAuthError(null);
    setIsAuthLoading(true);
    try {
      await signInWithPopup(auth, googleProvider);
    } catch (err: any) {
      console.error(
        '[Google Login Error Code]:',
        err?.code || err?.name || 'unknown',
        err
      );
      if (err.code !== 'auth/popup-closed-by-user') {
        setAuthError('No se pudo iniciar sesión con Google. Inténtalo de nuevo.');
      }
      setIsAuthLoading(false);
    }
  };

  // Continue as guest
  const handleContinueGuest = () => {
    localStorage.setItem('bitacora.mode', 'trial');
    setIsGuest(true);
    let raw: string | null = null;
    try {
      raw = localStorage.getItem(LS_KEY);
    } catch (_) {
      /* noop */
    }
    if (raw) {
      try {
        const loaded = normalize(JSON.parse(raw));
        setState(loaded);
      } catch (_) {
        const s = seed();
        setState(s);
        localStorage.setItem(LS_KEY, JSON.stringify(s));
      }
    } else {
      const s = seed();
      setState(s);
      localStorage.setItem(LS_KEY, JSON.stringify(s));
      setTimeout(() => {
        addToast(
          '¡Te damos la bienvenida a Bitácora! Empieza añadiendo tus tareas y notas.'
        );
      }, 500);
    }
  };

  // Logout handler
  const handleLogout = async () => {
    try {
      await signOut(auth);
      setUser(null);
      setIsGuest(false);
      setSessionExpired(false);
      hasEverLoggedInRef.current = false;
      currentUidRef.current = null;
      localStorage.removeItem('bitacora.mode');
      addToast('Sesión cerrada');
    } catch (err: any) {
      console.error(
        '[Logout Error Code]:',
        err?.code || err?.name || 'unknown',
        err
      );
    }
  };

  // Delete account & data
  const handleDeleteAccount = async () => {
    if (!user) return;
    try {
      try {
        await deleteDoc(doc(db, 'users', user.uid));
      } catch (err: any) {
        console.error(
          '[Delete Doc Error Code]:',
          err?.code || err?.name || 'unknown',
          err
        );
        handleFirestoreError(err, OperationType.DELETE, `users/${user.uid}`);
      }

      await deleteUser(user);

      localStorage.removeItem(getPendingKey(user.uid));
      localStorage.removeItem(LS_KEY);
      localStorage.removeItem('bitacora.mode');
      setUser(null);
      setIsGuest(false);
      setSessionExpired(false);
      hasEverLoggedInRef.current = false;
      currentUidRef.current = null;
      setShowDeleteAccountModal(false);
      setState(seed());
      addToast('Tu cuenta y tus datos han sido eliminados.');
    } catch (err: any) {
      console.error(
        '[Delete User Error Code]:',
        err?.code || err?.name || 'unknown',
        err
      );
      if (err.code === 'auth/requires-recent-login') {
        addToast('Por seguridad, vuelve a iniciar sesión antes de eliminar tu cuenta.');
      } else {
        addToast('No se pudo eliminar la cuenta. Inténtalo de nuevo.');
      }
      setShowDeleteAccountModal(false);
    }
  };

  // Import local data to cloud account modal actions
  const handleConfirmImportLocal = () => {
    if (pendingLocalState && user) {
      triggerSave(pendingLocalState);
      localStorage.removeItem(LS_KEY);
      addToast('Datos locales importados con éxito a tu cuenta en la nube.');
    }
    setShowImportLocalModal(false);
    setPendingLocalState(null);
  };

  const handleDeclineImportLocal = () => {
    setShowImportLocalModal(false);
    setPendingLocalState(null);
    addToast('Conservando los datos existentes en la nube.');
  };

  // Conflict modal actions
  const handleResolveConflictLocal = () => {
    if (conflictPendingState && user) {
      triggerSave(conflictPendingState);
      localStorage.removeItem(getPendingKey(user.uid));
      addToast('Se aplicó la versión de este navegador a la nube.');
    }
    setShowConflictModal(false);
    setConflictPendingState(null);
    setConflictCloudState(null);
  };

  const handleResolveConflictCloud = () => {
    if (conflictCloudState && user) {
      setState(conflictCloudState);
      localStorage.removeItem(getPendingKey(user.uid));
      hasUnsavedChangesRef.current = false;
      setSaveStatus('saved');
      addToast('Se conservó la versión de la nube.');
    }
    setShowConflictModal(false);
    setConflictPendingState(null);
    setConflictCloudState(null);
  };

  // View navigation
  const handleSelectView = (view: string) => {
    if (view !== currentView) {
      if (currentView !== 'search') {
        setPrevView(currentView);
      }
      setCurrentView(view);
      setSearchQuery('');
    }
  };

  // Search input change
  const handleSearchChange = (query: string) => {
    setSearchQuery(query);
    if (query.trim().length > 0) {
      if (currentView !== 'search') {
        setPrevView(currentView);
        setCurrentView('search');
      }
    } else {
      setCurrentView(prevView && prevView !== 'search' ? prevView : 'today');
    }
  };

  const handleClearSearch = () => {
    setSearchQuery('');
    setCurrentView(prevView && prevView !== 'search' ? prevView : 'today');
  };

  // Toggle collapse section
  const handleToggleCollapse = (key: string) => {
    setCollapsedSections((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  // Task operations
  const handleAddTask = (text: string, ctxId: string, slot: SlotType, urgent: boolean) => {
    const newTask: TaskItem = {
      id: uid(),
      text,
      note: '',
      ctx: ctxId || state.ctx[0].id,
      slot,
      urgent,
      done: false,
      doneAt: null,
      stale: false,
    };
    const nextState = {
      ...state,
      tasks: [...state.tasks, newTask],
    };
    setLastAddedTaskId(newTask.id);
    triggerSave(nextState);
    setTimeout(() => {
      setLastAddedTaskId((prev) => (prev === newTask.id ? null : prev));
    }, 1500);
  };

  const handleToggleTask = (taskId: string) => {
    const today = dstr();
    const t = state.tasks.find((x) => x.id === taskId);
    if (!t) return;

    if (!t.done) {
      const updatedTasks = state.tasks.map((x) =>
        x.id === taskId ? { ...x, done: true, doneAt: today } : x
      );
      const newLog = { ...state.log, [today]: (state.log[today] || 0) + 1 };
      const nextState: BitacoraState = {
        ...state,
        tasks: updatedTasks,
        log: newLog,
        focus: state.focus === taskId ? null : state.focus,
      };
      triggerSave(nextState);
      checkCompletionStamp(nextState);
    } else {
      const updatedTasks = state.tasks.map((x) =>
        x.id === taskId ? { ...x, done: false, doneAt: null } : x
      );
      const newLog = { ...state.log };
      if (t.doneAt === today && (newLog[today] || 0) > 0) {
        newLog[today]--;
      }
      const nextState = {
        ...state,
        tasks: updatedTasks,
        log: newLog,
      };
      triggerSave(nextState);
    }
  };

  const handleUpdateTask = (
    id: string,
    text: string,
    note: string,
    slot: SlotType,
    urgent: boolean
  ) => {
    const updatedTasks = state.tasks.map((t) => {
      if (t.id === id) {
        const slotChanged = t.slot !== slot;
        return {
          ...t,
          text,
          note,
          slot,
          urgent,
          stale: slotChanged ? false : t.stale,
        };
      }
      return t;
    });
    triggerSave({ ...state, tasks: updatedTasks });
  };

  const handleDeleteTask = (id: string) => {
    const taskIndex = state.tasks.findIndex((t) => t.id === id);
    if (taskIndex < 0) return;
    const deletedTask = state.tasks[taskIndex];
    const updatedTasks = state.tasks.filter((t) => t.id !== id);
    const nextState = {
      ...state,
      tasks: updatedTasks,
      focus: state.focus === id ? null : state.focus,
    };
    triggerSave(nextState);

    const snippet =
      deletedTask.text.length > 28
        ? deletedTask.text.slice(0, 28) + '…'
        : deletedTask.text;

    addToast(`Eliminada: «${snippet}»`, {
      label: 'Deshacer',
      fn: () => {
        const restored = [...stateRef.current.tasks];
        restored.splice(Math.min(taskIndex, restored.length), 0, deletedTask);
        triggerSave({ ...stateRef.current, tasks: restored });
      },
    });
  };

  const handleMoveTaskSlot = (id: string) => {
    const updatedTasks = state.tasks.map((t) => {
      if (t.id === id) {
        const nextSlot: SlotType =
          t.slot === 'hoy' ? 'manana' : t.slot === 'manana' ? 'despues' : 'hoy';
        return { ...t, slot: nextSlot, stale: false };
      }
      return t;
    });
    setLastAddedTaskId(id);
    triggerSave({ ...state, tasks: updatedTasks });
    setTimeout(() => {
      setLastAddedTaskId((prev) => (prev === id ? null : prev));
    }, 1400);
  };

  const handleFocusTask = (id: string) => {
    const nextFocus = state.focus === id ? null : id;
    triggerSave({ ...state, focus: nextFocus });
  };

  const handleUnfocus = () => {
    triggerSave({ ...state, focus: null });
  };

  // Context management
  const handleAddContext = (name: string) => {
    const newCtx: ContextItem = {
      id: uid(),
      name,
      color: PALETTE[state.ctx.length % PALETTE.length],
      groups: [],
    };
    const nextState = {
      ...state,
      ctx: [...state.ctx, newCtx],
    };
    triggerSave(nextState);
    setCurrentView(newCtx.id);
    addToast(`Contexto «${name}» creado`);
  };

  const handleRenameContext = (ctxId: string, newName: string) => {
    const updatedCtx = state.ctx.map((c) =>
      c.id === ctxId ? { ...c, name: newName } : c
    );
    triggerSave({ ...state, ctx: updatedCtx });
  };

  const handleDeleteContext = (ctxId: string) => {
    if (state.ctx.length <= 1) {
      addToast('Necesitas al menos un contexto');
      return;
    }
    const deletingCtx = state.ctx.find((c) => c.id === ctxId);
    if (!deletingCtx) return;
    const fallbackCtx = state.ctx.find((c) => c.id !== ctxId)!;

    const mt = state.tasks.filter((t) => t.ctx === ctxId);
    const mn = state.notes.filter((n) => n.ctx === ctxId);

    const updatedTasks = state.tasks.map((t) =>
      t.ctx === ctxId ? { ...t, ctx: fallbackCtx.id } : t
    );
    const updatedNotes = state.notes.map((n) =>
      n.ctx === ctxId ? { ...n, ctx: null, group: null } : n
    );
    const updatedCtx = state.ctx.filter((c) => c.id !== ctxId);

    const nextState = {
      ...state,
      ctx: updatedCtx,
      tasks: updatedTasks,
      notes: updatedNotes,
    };
    if (currentView === ctxId) {
      setCurrentView('today');
    }
    triggerSave(nextState);

    addToast(`Contexto «${deletingCtx.name}» eliminado`, {
      label: 'Deshacer',
      fn: () => {
        const restoredCtx = [...stateRef.current.ctx, deletingCtx];
        const restoredTasks = stateRef.current.tasks.map((t) =>
          mt.some((x) => x.id === t.id) ? { ...t, ctx: deletingCtx.id } : t
        );
        const restoredNotes = stateRef.current.notes.map((n) =>
          mn.some((x) => x.id === n.id) ? { ...n, ctx: deletingCtx.id } : n
        );
        triggerSave({
          ...stateRef.current,
          ctx: restoredCtx,
          tasks: restoredTasks,
          notes: restoredNotes,
        });
      },
    });
  };

  // Group management inside context
  const handleCommitAddGroup = () => {
    const val = newGroupName.trim();
    if (val && activeContext) {
      const newGrp = { id: uid(), name: val };
      const updatedCtx = state.ctx.map((c) =>
        c.id === activeContext.id ? { ...c, groups: [...c.groups, newGrp] } : c
      );
      triggerSave({ ...state, ctx: updatedCtx });
    }
    setNewGroupName('');
    setIsAddingGroup(false);
  };

  const handleCommitRenameGroup = () => {
    const val = editingGroupName.trim();
    if (val && editingGroupId && activeContext) {
      const updatedCtx = state.ctx.map((c) =>
        c.id === activeContext.id
          ? {
              ...c,
              groups: c.groups.map((g) => (g.id === editingGroupId ? { ...g, name: val } : g)),
            }
          : c
      );
      triggerSave({ ...state, ctx: updatedCtx });
    }
    setEditingGroupId(null);
    setEditingGroupName('');
  };

  const handleDeleteGroup = (groupId: string) => {
    if (!activeContext) return;
    const delGrp = activeContext.groups.find((g) => g.id === groupId);
    if (!delGrp) return;

    const updatedCtx = state.ctx.map((c) =>
      c.id === activeContext.id
        ? { ...c, groups: c.groups.filter((g) => g.id !== groupId) }
        : c
    );
    const updatedNotes = state.notes.map((n) =>
      n.ctx === activeContext.id && n.group === groupId ? { ...n, group: null } : n
    );

    triggerSave({ ...state, ctx: updatedCtx, notes: updatedNotes });
    addToast(`Grupo «${delGrp.name}» eliminado — sus notas pasaron a General`);
  };

  // Note operations
  const handleAddNote = (ctxId?: string | null, groupId?: string | null) => {
    const newN: NoteItem = {
      id: uid(),
      title: '',
      body: '',
      ctx: ctxId || null,
      group: groupId || null,
      mono: false,
      pin: false,
      up: Date.now(),
    };
    const nextState = {
      ...state,
      notes: [newN, ...state.notes],
    };
    triggerSave(nextState);
  };

  const handleUpdateNote = (id: string, updates: Partial<NoteItem>) => {
    const updatedNotes = state.notes.map((n) =>
      n.id === id ? { ...n, ...updates, up: Date.now() } : n
    );
    triggerSave({ ...state, notes: updatedNotes });
  };

  const handleDeleteNote = (id: string) => {
    const noteIndex = state.notes.findIndex((n) => n.id === id);
    if (noteIndex < 0) return;
    const deletedNote = state.notes[noteIndex];
    const updatedNotes = state.notes.filter((n) => n.id !== id);
    triggerSave({ ...state, notes: updatedNotes });

    addToast(`Nota «${deletedNote.title || 'sin título'}» eliminada`, {
      label: 'Deshacer',
      fn: () => {
        const restored = [...stateRef.current.notes];
        restored.splice(Math.min(noteIndex, restored.length), 0, deletedNote);
        triggerSave({ ...stateRef.current, notes: restored });
      },
    });
  };

  const handleCopyNote = async (id: string) => {
    const note = state.notes.find((n) => n.id === id);
    if (!note) return;
    const txt = (note.body || '').trim();
    if (!txt) {
      addToast('La nota está vacía');
      return;
    }
    try {
      await navigator.clipboard.writeText(txt);
      addToast('Nota copiada al portapapeles');
    } catch (_) {
      const ta = document.createElement('textarea');
      ta.value = txt;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      let ok = false;
      try {
        ok = document.execCommand('copy');
      } catch (_) {
        /* noop */
      }
      ta.remove();
      addToast(ok ? 'Nota copiada al portapapeles' : 'No se pudo copiar automáticamente');
    }
  };

  const handleGoToNote = (noteId: string) => {
    setCurrentView('notes');
    setSearchQuery('');
    setFlashedNoteId(noteId);
    setTimeout(() => {
      setFlashedNoteId(null);
    }, 1800);
  };

  // Drag and drop operations
  const handleDragStart = (_e: React.DragEvent, taskId: string) => {
    setDraggingTaskId(taskId);
  };

  const handleDragEnd = () => {
    setDraggingTaskId(null);
  };

  const handleDropOnZone = (e: React.DragEvent, slot: SlotType) => {
    e.preventDefault();
    if (!draggingTaskId) return;
    const task = state.tasks.find((t) => t.id === draggingTaskId);
    if (!task) return;

    const remainingTasks = state.tasks.filter((t) => t.id !== draggingTaskId);
    const updatedTask = { ...task, slot, stale: false };
    const nextState = {
      ...state,
      tasks: [...remainingTasks, updatedTask],
    };
    setLastAddedTaskId(task.id);
    setDraggingTaskId(null);
    triggerSave(nextState);
    setTimeout(() => {
      setLastAddedTaskId((prev) => (prev === task.id ? null : prev));
    }, 1400);
  };

  const handleDropOnTask = (e: React.DragEvent, targetTaskId: string) => {
    e.preventDefault();
    if (!draggingTaskId || draggingTaskId === targetTaskId) return;
    const dragged = state.tasks.find((t) => t.id === draggingTaskId);
    const target = state.tasks.find((t) => t.id === targetTaskId);
    if (!dragged || !target) return;

    const withoutDragged = state.tasks.filter((t) => t.id !== draggingTaskId);
    const targetIdx = withoutDragged.findIndex((t) => t.id === targetTaskId);

    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const insertAfter = e.clientY >= r.top + r.height / 2;
    const finalIdx = insertAfter ? targetIdx + 1 : targetIdx;

    const moved = { ...dragged, slot: target.slot, stale: false };
    withoutDragged.splice(finalIdx, 0, moved);

    setLastAddedTaskId(dragged.id);
    setDraggingTaskId(null);
    triggerSave({ ...state, tasks: withoutDragged });
    setTimeout(() => {
      setLastAddedTaskId((prev) => (prev === dragged.id ? null : prev));
    }, 1400);
  };

  // Export & Import
  const handleExport = () => {
    try {
      const blob = new Blob([JSON.stringify(state, null, 2)], {
        type: 'application/json',
      });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      const [y, m, d] = dstr().split('-');
      a.download = `bitacora-${d}${m}${y}.json`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 500);
      addToast('Respaldo descargado');
    } catch (_) {
      addToast('No se pudo exportar');
    }
  };

  const handleImportFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(reader.result as string);
        if (!parsed || !Array.isArray(parsed.tasks)) throw new Error();
        const backup = { ...stateRef.current };
        const normalized = normalize(parsed);
        const { state: rolled } = checkRollover(normalized);
        triggerSave(rolled);
        addToast(
          `Importado: ${rolled.tasks.length} tareas · ${rolled.notes.length} notas`,
          {
            label: 'Deshacer',
            fn: () => triggerSave(backup),
          }
        );
      } catch (_) {
        addToast('El archivo no parece un respaldo válido');
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  // If auth is still checking, show minimal loading
  if (!authChecked) {
    return <div className="app" style={{ opacity: 0 }} />;
  }

  // If not logged in and not in guest/trial mode, show AuthScreen
  if (!user && !isGuest && !sessionExpired) {
    return (
      <AuthScreen
        onLoginGoogle={handleGoogleLogin}
        onContinueGuest={handleContinueGuest}
        isLoading={isAuthLoading}
        errorMessage={authError}
      />
    );
  }

  const activeContext = state.ctx.find((c) => c.id === currentView);
  const sortNotes = (arr: NoteItem[]) =>
    arr.slice().sort((a, b) => (b.pin ? 1 : 0) - (a.pin ? 1 : 0) || b.up - a.up);

  return (
    <div className="app">
      <Sidebar
        state={state}
        currentView={currentView}
        onSelectView={handleSelectView}
        onAddContext={handleAddContext}
        user={user}
        isGuest={isGuest}
        onLoginClick={handleGoogleLogin}
        onLogoutClick={handleLogout}
        onDeleteAccountClick={() => setShowDeleteAccountModal(true)}
      />

      <main className="main">
        {/* Session expired discreet banner */}
        {sessionExpired && (
          <div
            className="warn"
            style={{ marginBottom: '18px', borderColor: 'var(--accent)' }}
          >
            <p>Tu sesión terminó. Inicia sesión para seguir guardando.</p>
            <span>
              <button
                type="button"
                className="opt save"
                onClick={handleGoogleLogin}
              >
                INICIAR SESIÓN
              </button>
            </span>
          </div>
        )}

        <Header
          state={state}
          currentView={currentView}
          searchQuery={searchQuery}
          onSearchChange={handleSearchChange}
          onClearSearch={handleClearSearch}
          onRenameContext={handleRenameContext}
          onDeleteContext={handleDeleteContext}
          saveStatus={saveStatus}
          isGuest={isGuest}
          onRetrySave={handleManualRetrySave}
        />

        <section className="view" id="view">
          {/* TODAY VIEW */}
          {currentView === 'today' && (
            <div>
              <FocusBlock
                state={state}
                onToggleTask={handleToggleTask}
                onUnfocus={handleUnfocus}
              />

              <AddTaskForm
                contexts={state.ctx}
                defaultCtxId={state.ctx[0]?.id || ''}
                showCtxSelect
                onAddTask={handleAddTask}
              />

              {/* 01 PARA HOY */}
              {(() => {
                const hoyTasks = state.tasks.filter((t) => !t.done && t.slot === 'hoy');
                return (
                  <section
                    className="grp"
                    data-slot="hoy"
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={(e) => handleDropOnZone(e, 'hoy')}
                  >
                    <h3 className="grp-h">
                      <span className="gi">01</span>
                      PARA HOY
                    </h3>
                    {hoyTasks.length > 0 ? (
                      state.ctx.map((c) => {
                        const ts = hoyTasks.filter((t) => t.ctx === c.id);
                        if (!ts.length) return null;
                        return (
                          <React.Fragment key={c.id}>
                            <div className="sub">
                              <span
                                className="sw"
                                style={{ '--c': c.color } as React.CSSProperties}
                              />
                              <span>{c.name.toUpperCase()}</span>
                              <span className="subct">{ts.length}</span>
                            </div>
                            <ul className="tlist">
                              {ts.map((t) => (
                                <TaskRow
                                  key={t.id}
                                  task={t}
                                  context={c}
                                  isFocused={state.focus === t.id}
                                  isNew={lastAddedTaskId === t.id}
                                  onToggle={handleToggleTask}
                                  onFocus={handleFocusTask}
                                  onMoveSlot={handleMoveTaskSlot}
                                  onUpdate={handleUpdateTask}
                                  onDelete={handleDeleteTask}
                                  onDragStart={handleDragStart}
                                  onDragEnd={handleDragEnd}
                                  onDragOverTask={() => {}}
                                  onDropOnTask={handleDropOnTask}
                                />
                              ))}
                            </ul>
                          </React.Fragment>
                        );
                      })
                    ) : (
                      <p className="hintline">
                        {state.tasks.some((t) => !t.done)
                          ? 'Nada para hoy todavía. Lo de «Mañana» y «Después» está más abajo.'
                          : 'Nada pendiente en todo el cuaderno.'}
                      </p>
                    )}
                  </section>
                );
              })()}

              {/* 02 MAÑANA */}
              {(() => {
                const manTasks = state.tasks.filter((t) => !t.done && t.slot === 'manana');
                const isOpen = !collapsedSections['man'];
                return (
                  <section
                    className="grp"
                    data-slot="manana"
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={(e) => handleDropOnZone(e, 'manana')}
                  >
                    <h3
                      className="grp-h cl"
                      onClick={() => handleToggleCollapse('man')}
                    >
                      <span className="chev">
                        {isOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                      </span>
                      <span className="gi">02</span>
                      MAÑANA
                      <span className="gc">{manTasks.length}</span>
                    </h3>
                    {isOpen && (
                      <div className="fb">
                        {manTasks.length > 0 ? (
                          state.ctx.map((c) => {
                            const ts = manTasks.filter((t) => t.ctx === c.id);
                            if (!ts.length) return null;
                            return (
                              <React.Fragment key={c.id}>
                                <div className="sub">
                                  <span
                                    className="sw"
                                    style={{ '--c': c.color } as React.CSSProperties}
                                  />
                                  <span>{c.name.toUpperCase()}</span>
                                  <span className="subct">{ts.length}</span>
                                </div>
                                <ul className="tlist">
                                  {ts.map((t) => (
                                    <TaskRow
                                      key={t.id}
                                      task={t}
                                      context={c}
                                      isFocused={state.focus === t.id}
                                      isNew={lastAddedTaskId === t.id}
                                      onToggle={handleToggleTask}
                                      onFocus={handleFocusTask}
                                      onMoveSlot={handleMoveTaskSlot}
                                      onUpdate={handleUpdateTask}
                                      onDelete={handleDeleteTask}
                                      onDragStart={handleDragStart}
                                      onDragEnd={handleDragEnd}
                                      onDragOverTask={() => {}}
                                      onDropOnTask={handleDropOnTask}
                                    />
                                  ))}
                                </ul>
                              </React.Fragment>
                            );
                          })
                        ) : (
                          <p className="hintline">
                            Vacío — arrastra tareas hasta aquí o pulsa la flecha de una tarea para traerlas.
                          </p>
                        )}
                      </div>
                    )}
                  </section>
                );
              })()}

              {/* 03 DESPUÉS */}
              {(() => {
                const desTasks = state.tasks.filter((t) => !t.done && t.slot === 'despues');
                const isOpen = !collapsedSections['des'];
                return (
                  <section
                    className="grp"
                    data-slot="despues"
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={(e) => handleDropOnZone(e, 'despues')}
                  >
                    <h3
                      className="grp-h cl"
                      onClick={() => handleToggleCollapse('des')}
                    >
                      <span className="chev">
                        {isOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                      </span>
                      <span className="gi">03</span>
                      DESPUÉS
                      <span className="gc">{desTasks.length}</span>
                    </h3>
                    {isOpen && (
                      <div className="fb">
                        {desTasks.length > 0 ? (
                          state.ctx.map((c) => {
                            const ts = desTasks.filter((t) => t.ctx === c.id);
                            if (!ts.length) return null;
                            return (
                              <React.Fragment key={c.id}>
                                <div className="sub">
                                  <span
                                    className="sw"
                                    style={{ '--c': c.color } as React.CSSProperties}
                                  />
                                  <span>{c.name.toUpperCase()}</span>
                                  <span className="subct">{ts.length}</span>
                                </div>
                                <ul className="tlist">
                                  {ts.map((t) => (
                                    <TaskRow
                                      key={t.id}
                                      task={t}
                                      context={c}
                                      isFocused={state.focus === t.id}
                                      isNew={lastAddedTaskId === t.id}
                                      onToggle={handleToggleTask}
                                      onFocus={handleFocusTask}
                                      onMoveSlot={handleMoveTaskSlot}
                                      onUpdate={handleUpdateTask}
                                      onDelete={handleDeleteTask}
                                      onDragStart={handleDragStart}
                                      onDragEnd={handleDragEnd}
                                      onDragOverTask={() => {}}
                                      onDropOnTask={handleDropOnTask}
                                    />
                                  ))}
                                </ul>
                              </React.Fragment>
                            );
                          })
                        ) : (
                          <p className="hintline">Vacío — el cajón de «algún día».</p>
                        )}
                      </div>
                    )}
                  </section>
                );
              })()}

              {/* 04 COMPLETADAS HOY */}
              {(() => {
                const today = dstr();
                const doneToday = state.tasks.filter((t) => t.done && t.doneAt === today);
                if (!doneToday.length) return null;
                const isOpen = !collapsedSections['done'];
                return (
                  <section className="grp">
                    <h3
                      className="grp-h cl"
                      onClick={() => handleToggleCollapse('done')}
                    >
                      <span className="chev">
                        {isOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                      </span>
                      <span className="gi">04</span>
                      COMPLETADAS HOY
                      <span className="gc">{doneToday.length}</span>
                    </h3>
                    {isOpen && (
                      <div className="fb">
                        <ul className="tlist">
                          {doneToday.map((t) => {
                            const c = state.ctx.find((ctx) => ctx.id === t.ctx);
                            return (
                              <TaskRow
                                key={t.id}
                                task={t}
                                context={c}
                                isFocused={false}
                                showCtxTag
                                onToggle={handleToggleTask}
                                onFocus={() => {}}
                                onMoveSlot={() => {}}
                                onUpdate={handleUpdateTask}
                                onDelete={handleDeleteTask}
                                onDragStart={() => {}}
                                onDragEnd={() => {}}
                                onDragOverTask={() => {}}
                                onDropOnTask={() => {}}
                              />
                            );
                          })}
                        </ul>
                      </div>
                    )}
                  </section>
                );
              })()}
            </div>
          )}

          {/* CONTEXT VIEW */}
          {activeContext && currentView !== 'today' && currentView !== 'notes' && currentView !== 'search' && (
            <div>
              <AddTaskForm
                contexts={state.ctx}
                defaultCtxId={activeContext.id}
                showCtxSelect={false}
                onAddTask={handleAddTask}
              />

              {/* Context Hoy */}
              {(() => {
                const ts = state.tasks.filter(
                  (t) => !t.done && t.slot === 'hoy' && t.ctx === activeContext.id
                );
                return (
                  <section
                    className="grp"
                    data-slot="hoy"
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={(e) => handleDropOnZone(e, 'hoy')}
                  >
                    <h3 className="grp-h">
                      <span className="gi">01</span>
                      HOY
                    </h3>
                    {ts.length > 0 ? (
                      <ul className="tlist">
                        {ts.map((t) => (
                          <TaskRow
                            key={t.id}
                            task={t}
                            context={activeContext}
                            isFocused={state.focus === t.id}
                            isNew={lastAddedTaskId === t.id}
                            onToggle={handleToggleTask}
                            onFocus={handleFocusTask}
                            onMoveSlot={handleMoveTaskSlot}
                            onUpdate={handleUpdateTask}
                            onDelete={handleDeleteTask}
                            onDragStart={handleDragStart}
                            onDragEnd={handleDragEnd}
                            onDragOverTask={() => {}}
                            onDropOnTask={handleDropOnTask}
                          />
                        ))}
                      </ul>
                    ) : (
                      <p className="hintline">Nada para hoy aquí.</p>
                    )}
                  </section>
                );
              })()}

              {/* Context Mañana */}
              {(() => {
                const ts = state.tasks.filter(
                  (t) => !t.done && t.slot === 'manana' && t.ctx === activeContext.id
                );
                return (
                  <section
                    className="grp"
                    data-slot="manana"
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={(e) => handleDropOnZone(e, 'manana')}
                  >
                    <h3 className="grp-h">
                      <span className="gi">02</span>
                      MAÑANA
                    </h3>
                    {ts.length > 0 ? (
                      <ul className="tlist">
                        {ts.map((t) => (
                          <TaskRow
                            key={t.id}
                            task={t}
                            context={activeContext}
                            isFocused={state.focus === t.id}
                            isNew={lastAddedTaskId === t.id}
                            onToggle={handleToggleTask}
                            onFocus={handleFocusTask}
                            onMoveSlot={handleMoveTaskSlot}
                            onUpdate={handleUpdateTask}
                            onDelete={handleDeleteTask}
                            onDragStart={handleDragStart}
                            onDragEnd={handleDragEnd}
                            onDragOverTask={() => {}}
                            onDropOnTask={handleDropOnTask}
                          />
                        ))}
                      </ul>
                    ) : (
                      <p className="hintline">
                        Vacío — arrastra tareas hasta aquí o pulsa la flecha para traerlas.
                      </p>
                    )}
                  </section>
                );
              })()}

              {/* Context Después */}
              {(() => {
                const ts = state.tasks.filter(
                  (t) => !t.done && t.slot === 'despues' && t.ctx === activeContext.id
                );
                return (
                  <section
                    className="grp"
                    data-slot="despues"
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={(e) => handleDropOnZone(e, 'despues')}
                  >
                    <h3 className="grp-h">
                      <span className="gi">03</span>
                      DESPUÉS
                    </h3>
                    {ts.length > 0 ? (
                      <ul className="tlist">
                        {ts.map((t) => (
                          <TaskRow
                            key={t.id}
                            task={t}
                            context={activeContext}
                            isFocused={state.focus === t.id}
                            isNew={lastAddedTaskId === t.id}
                            onToggle={handleToggleTask}
                            onFocus={handleFocusTask}
                            onMoveSlot={handleMoveTaskSlot}
                            onUpdate={handleUpdateTask}
                            onDelete={handleDeleteTask}
                            onDragStart={handleDragStart}
                            onDragEnd={handleDragEnd}
                            onDragOverTask={() => {}}
                            onDropOnTask={handleDropOnTask}
                          />
                        ))}
                      </ul>
                    ) : (
                      <p className="hintline">Vacío — el cajón de «más adelante».</p>
                    )}
                  </section>
                );
              })()}

              {/* Context Completadas */}
              {(() => {
                const doneRec = state.tasks
                  .filter((t) => t.done && t.ctx === activeContext.id)
                  .sort((a, b) => String(b.doneAt || '').localeCompare(String(a.doneAt || '')))
                  .slice(0, 10);

                if (!doneRec.length) return null;
                const isOpen = !collapsedSections[`done:${activeContext.id}`];

                return (
                  <section className="grp">
                    <h3
                      className="grp-h cl"
                      onClick={() => handleToggleCollapse(`done:${activeContext.id}`)}
                    >
                      <span className="chev">
                        {isOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                      </span>
                      <span className="gi">04</span>
                      COMPLETADAS
                      <span className="gc">{doneRec.length}</span>
                    </h3>
                    {isOpen && (
                      <div className="fb">
                        <ul className="tlist">
                          {doneRec.map((t) => (
                            <TaskRow
                              key={t.id}
                              task={t}
                              context={activeContext}
                              isFocused={false}
                              onToggle={handleToggleTask}
                              onFocus={() => {}}
                              onMoveSlot={() => {}}
                              onUpdate={handleUpdateTask}
                              onDelete={handleDeleteTask}
                              onDragStart={() => {}}
                              onDragEnd={() => {}}
                              onDragOverTask={() => {}}
                              onDropOnTask={() => {}}
                            />
                          ))}
                        </ul>
                      </div>
                    )}
                  </section>
                );
              })()}

              {/* Context Notes Section */}
              {(() => {
                const ctxNotes = state.notes.filter((n) => n.ctx === activeContext.id);
                const validGroupIds = new Set(activeContext.groups.map((g) => g.id));

                return (
                  <section className="grp">
                    <h3 className="grp-h">
                      <span className="gi">05</span>
                      NOTAS
                      <span className="gc">{ctxNotes.length}</span>
                      <button
                        type="button"
                        className="mini"
                        onClick={() => handleAddNote(activeContext.id, null)}
                      >
                        <Plus size={10} />
                        NOTA
                      </button>
                      <button
                        type="button"
                        className="mini"
                        onClick={() => setIsAddingGroup(true)}
                      >
                        <Plus size={10} />
                        GRUPO
                      </button>
                    </h3>

                    {isAddingGroup && (
                      <div className="gh">
                        <input
                          id="newgrp-in"
                          placeholder="Nombre del grupo (ej. un cliente)"
                          maxLength={24}
                          value={newGroupName}
                          autoFocus
                          onChange={(e) => setNewGroupName(e.target.value)}
                          onBlur={handleCommitAddGroup}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              e.preventDefault();
                              handleCommitAddGroup();
                            } else if (e.key === 'Escape') {
                              setIsAddingGroup(false);
                              setNewGroupName('');
                            }
                          }}
                        />
                      </div>
                    )}

                    {activeContext.groups.length > 0 ? (
                      <div>
                        {activeContext.groups.map((g) => {
                          const groupNotes = sortNotes(
                            ctxNotes.filter((n) => n.group === g.id)
                          );
                          const isEditingThis = editingGroupId === g.id;

                          return (
                            <React.Fragment key={g.id}>
                              {isEditingThis ? (
                                <div className="gh">
                                  <input
                                    id="rengrp-in"
                                    value={editingGroupName}
                                    maxLength={24}
                                    autoFocus
                                    onChange={(e) => setEditingGroupName(e.target.value)}
                                    onBlur={handleCommitRenameGroup}
                                    onKeyDown={(e) => {
                                      if (e.key === 'Enter') {
                                        e.preventDefault();
                                        handleCommitRenameGroup();
                                      } else if (e.key === 'Escape') {
                                        setEditingGroupId(null);
                                      }
                                    }}
                                  />
                                </div>
                              ) : (
                                <div className="gh">
                                  <span className="gh-n">{g.name.toUpperCase()}</span>
                                  <span className="gc">{groupNotes.length}</span>
                                  <button
                                    type="button"
                                    className="mini"
                                    onClick={() => handleAddNote(activeContext.id, g.id)}
                                  >
                                    <Plus size={10} />
                                    NOTA
                                  </button>
                                  <button
                                    type="button"
                                    className="a"
                                    title="Renombrar grupo"
                                    onClick={() => {
                                      setEditingGroupId(g.id);
                                      setEditingGroupName(g.name);
                                    }}
                                  >
                                    <PencilLine size={13} />
                                  </button>
                                  <button
                                    type="button"
                                    className="a"
                                    title="Eliminar grupo (las notas pasan a General)"
                                    onClick={() => handleDeleteGroup(g.id)}
                                  >
                                    <Trash2 size={13} />
                                  </button>
                                </div>
                              )}

                              {groupNotes.length > 0 ? (
                                groupNotes.map((n, i) => (
                                  <NoteCard
                                    key={n.id}
                                    note={n}
                                    index={i}
                                    contexts={state.ctx}
                                    showGroupSelector
                                    isFlashed={flashedNoteId === n.id}
                                    onUpdateNote={handleUpdateNote}
                                    onDeleteNote={handleDeleteNote}
                                    onCopyNote={handleCopyNote}
                                  />
                                ))
                              ) : (
                                <p className="hintline">
                                  Nada apuntado para «{g.name}» todavía.
                                </p>
                              )}
                            </React.Fragment>
                          );
                        })}

                        {/* General notes within grouped context */}
                        {(() => {
                          const genNotes = sortNotes(
                            ctxNotes.filter((n) => !n.group || !validGroupIds.has(n.group))
                          );
                          if (!genNotes.length) return null;
                          return (
                            <div>
                              <div className="gh">
                                <span className="gh-n">GENERAL</span>
                                <span className="gc">{genNotes.length}</span>
                                <button
                                  type="button"
                                  className="mini"
                                  onClick={() => handleAddNote(activeContext.id, null)}
                                >
                                  <Plus size={10} />
                                  NOTA
                                </button>
                              </div>
                              {genNotes.map((n, i) => (
                                <NoteCard
                                  key={n.id}
                                  note={n}
                                  index={i}
                                  contexts={state.ctx}
                                  showGroupSelector
                                  isFlashed={flashedNoteId === n.id}
                                  onUpdateNote={handleUpdateNote}
                                  onDeleteNote={handleDeleteNote}
                                  onCopyNote={handleCopyNote}
                                />
                              ))}
                            </div>
                          );
                        })()}
                      </div>
                    ) : (
                      <div>
                        {ctxNotes.length > 0 ? (
                          sortNotes(ctxNotes).map((n, i) => (
                            <NoteCard
                              key={n.id}
                              note={n}
                              index={i}
                              contexts={state.ctx}
                              isFlashed={flashedNoteId === n.id}
                              onUpdateNote={handleUpdateNote}
                              onDeleteNote={handleDeleteNote}
                              onCopyNote={handleCopyNote}
                            />
                          ))
                        ) : (
                          <p className="hintline">
                            Nada apuntado para «{activeContext.name}» todavía. Con «+ GRUPO» puedes separar por cliente, proyecto, etc.
                          </p>
                        )}
                      </div>
                    )}
                  </section>
                );
              })()}
            </div>
          )}

          {/* NOTES VIEW */}
          {currentView === 'notes' && (
            <div>
              <div className="nbar">
                <button
                  type="button"
                  className="btn-solid"
                  onClick={() => handleAddNote(null, null)}
                >
                  <Plus size={13} />
                  NUEVA NOTA
                </button>
                <span className="hint">
                  SE GUARDAN SOLAS MIENTRAS ESCRIBES · FIJA LAS QUE USAS SEGUIDO
                </span>
              </div>

              {state.notes.length > 0 ? (
                sortNotes(state.notes).map((n, i) => (
                  <NoteCard
                    key={n.id}
                    note={n}
                    index={i}
                    contexts={state.ctx}
                    showWhereSelector
                    isFlashed={flashedNoteId === n.id}
                    onUpdateNote={handleUpdateNote}
                    onDeleteNote={handleDeleteNote}
                    onCopyNote={handleCopyNote}
                  />
                ))
              ) : (
                <div className="blank">
                  <p>
                    Apunta aquí lo que no quieras perder: ideas de proyectos, listas, planes de acción, recordatorios…
                  </p>
                </div>
              )}
            </div>
          )}

          {/* SEARCH VIEW */}
          {currentView === 'search' && (
            <SearchView
              state={state}
              query={searchQuery}
              onGoToNote={handleGoToNote}
              onToggleTask={handleToggleTask}
              onFocusTask={handleFocusTask}
              onMoveSlot={handleMoveTaskSlot}
              onUpdateTask={handleUpdateTask}
              onDeleteTask={handleDeleteTask}
            />
          )}
        </section>

        {/* FOOTER */}
        <footer className="foot">
          {user ? (
            <span>GUARDADO EN TU CUENTA · SINCRONIZADO</span>
          ) : (
            <span>DATOS SOLO EN ESTE EQUIPO</span>
          )}
          <span>·</span>
          <button type="button" className="lk" onClick={handleExport}>
            EXPORTAR RESPALDO
          </button>
          <span>·</span>
          <button
            type="button"
            className="lk"
            onClick={() => importFileInputRef.current?.click()}
          >
            IMPORTAR
          </button>
          <span className="r">/ BUSCA · ARRASTRA PARA REORDENAR O APLAZAR</span>
        </footer>
      </main>

      {/* Hidden file input for import */}
      <input
        ref={importFileInputRef}
        type="file"
        id="importFile"
        accept="application/json,.json"
        hidden
        onChange={handleImportFileChange}
      />

      {/* STAMP OVERLAY */}
      <Stamp
        show={showStamp}
        dateStr={stampDate}
        onDismiss={() => setShowStamp(false)}
      />

      {/* TOASTS */}
      <div id="toasts">
        {toasts.map((toast) => (
          <div key={toast.id} className="toast">
            <span>{toast.msg}</span>
            {toast.action && (
              <button
                type="button"
                onClick={() => {
                  toast.action?.fn();
                  setToasts((prev) => prev.filter((t) => t.id !== toast.id));
                }}
              >
                {toast.action.label}
              </button>
            )}
          </div>
        ))}
      </div>

      {/* Confirmation Modal for Local Data Import upon login */}
      <ConfirmationModal
        isOpen={showImportLocalModal}
        tag="SINCRONIZACIÓN"
        title="¿Importar datos locales a tu cuenta?"
        description={`Se han encontrado ${pendingLocalState?.tasks.length || 0} tareas y ${pendingLocalState?.notes.length || 0} notas guardadas en este navegador. ¿Deseas incorporarlas a tu cuenta de Google o prefieres mantener intacto lo que ya tienes en la nube?`}
        confirmLabel="IMPORTAR A MI CUENTA"
        cancelLabel="CONSERVAR DATOS DE LA NUBE"
        onConfirm={handleConfirmImportLocal}
        onCancel={handleDeclineImportLocal}
      />

      {/* Conflict Resolution Modal for Pending vs Cloud */}
      <ConfirmationModal
        isOpen={showConflictModal}
        tag="CONFLICTO DE SINCRONIZACIÓN"
        title="¿Qué versión deseas conservar?"
        description="Hay cambios guardados en este navegador que no se subieron a la nube, pero tu cuaderno en la nube también tiene cambios más recientes realizados desde otro dispositivo."
        confirmLabel="CONSERVAR VERSIÓN DE ESTE NAVEGADOR"
        cancelLabel="CONSERVAR VERSIÓN DE LA NUBE"
        extraAction={{
          label: 'DESCARGAR COPIA LOCAL (.JSON)',
          onClick: downloadPendingJson,
        }}
        onConfirm={handleResolveConflictLocal}
        onCancel={handleResolveConflictCloud}
      />

      {/* Confirmation Modal for Account and Data Deletion */}
      <ConfirmationModal
        isOpen={showDeleteAccountModal}
        tag="ZONA DE PELIGRO"
        title="¿Eliminar tu cuenta y todos tus datos?"
        description="Esta acción es irreversible y definitiva. Se borrarán permanentemente tu cuaderno de trabajo de la nube en Firestore y se cancelará tu cuenta de usuario."
        confirmLabel="ELIMINAR DEFINITIVAMENTE"
        cancelLabel="CANCELAR"
        isDestructive
        onConfirm={handleDeleteAccount}
        onCancel={() => setShowDeleteAccountModal(false)}
      />
    </div>
  );
}
