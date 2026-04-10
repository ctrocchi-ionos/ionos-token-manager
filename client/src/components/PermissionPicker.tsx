import { PERMISSION_GROUPS } from '@/lib/permissions';
import { cn } from '@/lib/utils';

interface PermissionPickerProps {
  value: Record<string, boolean>;
  onChange: (value: Record<string, boolean>) => void;
  readOnly?: boolean;
}

export default function PermissionPicker({ value, onChange, readOnly }: PermissionPickerProps) {
  const togglePermission = (key: string) => {
    if (readOnly) return;
    onChange({ ...value, [key]: !value[key] });
  };

  const toggleGroup = (groupKeys: string[]) => {
    if (readOnly) return;
    const allEnabled = groupKeys.every((k) => value[k]);
    const updated = { ...value };
    for (const k of groupKeys) {
      updated[k] = !allEnabled;
    }
    onChange(updated);
  };

  const selectAll = () => {
    if (readOnly) return;
    const updated: Record<string, boolean> = {};
    for (const group of Object.values(PERMISSION_GROUPS)) {
      for (const key of Object.keys(group)) {
        updated[key] = true;
      }
    }
    onChange(updated);
  };

  const clearAll = () => {
    if (readOnly) return;
    onChange({});
  };

  const totalEnabled = Object.values(value).filter(Boolean).length;
  const totalPermissions = Object.values(PERMISSION_GROUPS).reduce((sum, g) => sum + Object.keys(g).length, 0);

  return (
    <div className="space-y-4">
      {!readOnly && (
        <div className="flex items-center gap-3 text-sm">
          <span className="text-gray-500">{totalEnabled} / {totalPermissions} selected</span>
          <button type="button" onClick={selectAll} className="text-blue-600 hover:underline">
            Select all
          </button>
          <button type="button" onClick={clearAll} className="text-blue-600 hover:underline">
            Clear all
          </button>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {Object.entries(PERMISSION_GROUPS).map(([groupName, permissions]) => {
          const keys = Object.keys(permissions);
          const enabledCount = keys.filter((k) => value[k]).length;
          const allEnabled = enabledCount === keys.length;

          return (
            <div key={groupName} className="border border-gray-200 rounded-lg p-4 bg-white">
              <div className="flex items-center justify-between mb-3">
                <h4 className="font-medium text-sm text-gray-700">{groupName}</h4>
                {!readOnly && (
                  <button
                    type="button"
                    onClick={() => toggleGroup(keys)}
                    className={cn(
                      'text-xs px-2 py-0.5 rounded',
                      allEnabled
                        ? 'text-red-600 hover:bg-red-50'
                        : 'text-blue-600 hover:bg-blue-50',
                    )}
                  >
                    {allEnabled ? 'Deselect all' : 'Select all'}
                  </button>
                )}
              </div>
              <div className="space-y-2">
                {Object.entries(permissions).map(([key, label]) => (
                  <label
                    key={key}
                    className={cn(
                      'flex items-center gap-2 text-sm',
                      readOnly ? 'cursor-default' : 'cursor-pointer',
                    )}
                  >
                    <input
                      type="checkbox"
                      checked={!!value[key]}
                      onChange={() => togglePermission(key)}
                      disabled={readOnly}
                      className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                    />
                    <span className={value[key] ? 'text-gray-900' : 'text-gray-500'}>{label}</span>
                  </label>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
