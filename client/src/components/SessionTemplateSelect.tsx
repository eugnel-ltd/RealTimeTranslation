import React from 'react';
import { SESSION_TEMPLATES, type SessionTemplateId } from '../../../shared/sessionTemplates';

const SessionTemplateSelect: React.FC<{
  value: SessionTemplateId;
  onChange: (id: SessionTemplateId) => void;
  className?: string;
  id?: string;
}> = ({ value, onChange, className, id }) => (
  <select
    id={id}
    value={value}
    title="Session type"
    onChange={(e) => onChange(e.target.value as SessionTemplateId)}
    className={className}
  >
    {SESSION_TEMPLATES.map((t) => (
      <option key={t.id} value={t.id} title={t.description}>
        {t.label}
      </option>
    ))}
  </select>
);

export default SessionTemplateSelect;
