import React from 'react';

interface ConfirmationModalProps {
  isOpen: boolean;
  tag?: string;
  title: string;
  description: string;
  confirmLabel: string;
  cancelLabel?: string;
  isDestructive?: boolean;
  extraAction?: {
    label: string;
    onClick: () => void;
  };
  onConfirm: () => void;
  onCancel: () => void;
}

export const ConfirmationModal: React.FC<ConfirmationModalProps> = ({
  isOpen,
  tag = 'CONFIRMACIÓN',
  title,
  description,
  confirmLabel,
  cancelLabel = 'CANCELAR',
  isDestructive = false,
  extraAction,
  onConfirm,
  onCancel,
}) => {
  if (!isOpen) return null;

  return (
    <div className="modal-overlay" onClick={onCancel}>
      <div className="modal-box" onClick={(e) => e.stopPropagation()}>
        <span className="modal-tag">{tag}</span>
        <h2 className="modal-title">{title}</h2>
        <p className="modal-text">{description}</p>
        <div className="modal-acts">
          {extraAction && (
            <button
              type="button"
              className="opt"
              style={{ marginRight: 'auto' }}
              onClick={extraAction.onClick}
            >
              {extraAction.label}
            </button>
          )}
          <button type="button" className="opt" onClick={onCancel}>
            {cancelLabel}
          </button>
          <button
            type="button"
            className={`opt ${isDestructive ? 'bad' : 'save'}`}
            onClick={onConfirm}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
};
