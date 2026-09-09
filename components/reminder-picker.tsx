'use client';
import { useState } from 'react';
import { Bell, X } from 'lucide-react';
import {
  reminderInput,
  reminderLabel,
  reminderPreset,
  parseReminderInput,
} from '@/lib/reminders';
import type { Entity } from '@/lib/model';

export function ReminderPicker({
  task,
  onChange,
  disabled = false,
}: {
  task: Pick<Entity, 'reminderAt' | 'reminderZone' | 'repeat'>;
  onChange: (at: string, zone: string) => void;
  disabled?: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const [value, setValue] = useState('');
  const [error, setError] = useState('');
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  function edit() {
    setValue(task.reminderAt ? reminderInput(task.reminderAt) : '');
    setError('');
    setExpanded(true);
  }
  return (
    <div className="reminder-picker">
      <div className="reminder-picker-heading">
        <button
          type="button"
          className="text-button"
          disabled={disabled}
          onClick={edit}
        >
          <Bell />
          {task.reminderAt ? reminderLabel(task) : 'Remind me'}
        </button>
        {task.reminderAt && (
          <button
            type="button"
            className="icon-button"
            disabled={disabled}
            aria-label="Remove reminder"
            onClick={() => {
              onChange('', '');
              setExpanded(false);
            }}
          >
            <X />
          </button>
        )}
      </div>
      {expanded && (
        <fieldset disabled={disabled} className="reminder-choices">
          <legend>Choose a reminder time</legend>
          <div className="button-row">
            {(
              [
                ['hour', 'In 1 hour'],
                ['tonight', 'Tonight · 7 PM'],
                ['tomorrow', 'Tomorrow · 9 AM'],
              ] as const
            ).map(([key, label]) => (
              <button
                key={key}
                type="button"
                className="button small"
                disabled={Date.parse(reminderPreset(key)) <= Date.now()}
                onClick={() => {
                  setValue(reminderInput(reminderPreset(key)));
                  setError('');
                }}
              >
                {label}
              </button>
            ))}
          </div>
          <label className="field">
            Custom date and time
            <input
              type="datetime-local"
              value={value}
              onChange={(e) => {
                setValue(e.target.value);
                setError('');
              }}
            />
          </label>
          <p className="hint">
            {zone.replaceAll('_', ' ')} · A reminder does not change a deadline.
          </p>
          {error && (
            <p className="reminder-error" role="alert">
              {error}
            </p>
          )}
          <div className="button-row">
            <button
              type="button"
              className="button small primary"
              onClick={() => {
                try {
                  onChange(parseReminderInput(value), zone);
                  setExpanded(false);
                  setError('');
                } catch (e) {
                  setError((e as Error).message);
                }
              }}
            >
              Use this time
            </button>
            <button
              type="button"
              className="text-button"
              onClick={() => setExpanded(false)}
            >
              Cancel
            </button>
          </div>
        </fieldset>
      )}
      {(expanded || task.reminderAt) && (
        <p className="hint reminder-availability">
          Reminders appear inside Launch. Phone notifications while the app is
          closed aren’t connected yet.
        </p>
      )}
      {task.reminderAt && task.repeat && task.repeat !== 'none' && (
        <p className="hint">This reminder applies to this occurrence only.</p>
      )}
    </div>
  );
}
