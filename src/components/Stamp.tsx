import React from 'react';

interface StampProps {
  show: boolean;
  dateStr: string;
  onDismiss: () => void;
}

export const Stamp: React.FC<StampProps> = ({ show, dateStr, onDismiss }) => {
  const parts = dateStr.split('-');
  const formatted = parts.length === 3 ? `${parts[2]}·${parts[1]}·${parts[0]}` : dateStr;

  return (
    <div
      className={`stamp ${show ? 'show' : ''}`}
      onClick={onDismiss}
      title="Pulsa para cerrar"
    >
      <div className="stamp-in">
        <span className="s1">DÍA</span>
        <span className="s2">CUBIERTO</span>
        <span className="s3">{formatted}</span>
      </div>
    </div>
  );
};
