import React, { useState } from 'react';
import { cn, formatTitle } from '../../lib/utils';
import { Save } from 'lucide-react';

interface Props {
  data: Record<string, unknown>;
  schema?: Record<string, unknown>;
  onSave?: (updates: Record<string, unknown>) => void;
}

export function LensEditor({ data, schema, onSave }: Props) {
  const schemaProps = (schema as { properties?: Record<string, { title?: string; type?: string; enum?: string[] }> })?.properties;
  const keys = schemaProps ? Object.keys(schemaProps) : Object.keys(data);
  const [formData, setFormData] = useState<Record<string, unknown>>({ ...data });
  const [dirty, setDirty] = useState(false);

  const handleChange = (key: string, value: string | boolean) => {
    setFormData(prev => ({ ...prev, [key]: value }));
    setDirty(true);
  };

  const handleSave = () => {
    if (onSave && dirty) {
      onSave(formData);
      setDirty(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-border bg-card p-4 space-y-4">
        {keys.map((key) => {
          const spec = schemaProps?.[key];
          const label = spec?.title ?? formatTitle(key);
          const type = spec?.type ?? typeof data[key];
          const enumValues = spec?.enum;
          const value = formData[key];

          return (
            <div key={key} className="space-y-1">
              <label className="text-sm text-muted-foreground">{label}</label>

              {enumValues ? (
                <select
                  value={String(value ?? '')}
                  onChange={(e) => handleChange(key, e.target.value)}
                  className="w-full bg-secondary rounded-lg px-3 py-2 text-sm outline-none border border-border"
                >
                  {enumValues.map((opt) => (
                    <option key={opt} value={opt}>{opt}</option>
                  ))}
                </select>
              ) : type === 'boolean' ? (
                <div className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={Boolean(value)}
                    onChange={(e) => handleChange(key, e.target.checked)}
                    className="rounded"
                  />
                  <span className="text-sm">{value ? 'Yes' : 'No'}</span>
                </div>
              ) : (
                <input
                  type={type === 'number' ? 'number' : 'text'}
                  value={String(value ?? '')}
                  onChange={(e) => handleChange(key, type === 'number' ? e.target.value : e.target.value)}
                  className="w-full bg-secondary rounded-lg px-3 py-2 text-sm outline-none placeholder:text-muted-foreground border border-border"
                />
              )}
            </div>
          );
        })}
      </div>

      {onSave && (
        <button
          onClick={handleSave}
          disabled={!dirty}
          className={cn(
            'flex items-center gap-2 px-4 py-2 rounded-lg text-sm transition-colors',
            dirty
              ? 'bg-primary text-primary-foreground hover:opacity-80'
              : 'bg-muted text-muted-foreground cursor-not-allowed'
          )}
        >
          <Save size={14} />
          Save Changes
        </button>
      )}
    </div>
  );
}
