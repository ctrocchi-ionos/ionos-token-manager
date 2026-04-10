import { useQuery } from '@tanstack/react-query';
import { listDatacenters, type SharedResource, type DatacenterInfo } from '@/api/client';
import { Loader2, Server } from 'lucide-react';

interface ResourceBrowserProps {
  value: SharedResource[];
  onChange: (value: SharedResource[]) => void;
  readOnly?: boolean;
}

export default function ResourceBrowser({ value, onChange, readOnly }: ResourceBrowserProps) {
  const { data, isLoading, error } = useQuery({
    queryKey: ['datacenters'],
    queryFn: () => listDatacenters(),
  });

  const datacenters = data?.data ?? [];

  const isSelected = (id: string) => value.some((r) => r.resourceId === id);

  const toggleResource = (dc: DatacenterInfo) => {
    if (readOnly) return;
    if (isSelected(dc.id)) {
      onChange(value.filter((r) => r.resourceId !== dc.id));
    } else {
      onChange([
        ...value,
        {
          resourceId: dc.id,
          type: 'datacenter',
          name: dc.name,
          editPrivilege: true,
          sharePrivilege: false,
        },
      ]);
    }
  };

  const toggleEditPrivilege = (id: string) => {
    if (readOnly) return;
    onChange(
      value.map((r) =>
        r.resourceId === id ? { ...r, editPrivilege: !r.editPrivilege } : r,
      ),
    );
  };

  const toggleSharePrivilege = (id: string) => {
    if (readOnly) return;
    onChange(
      value.map((r) =>
        r.resourceId === id ? { ...r, sharePrivilege: !r.sharePrivilege } : r,
      ),
    );
  };

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 text-sm text-gray-500 py-4">
        <Loader2 className="w-4 h-4 animate-spin" />
        Loading datacenters from IONOS...
      </div>
    );
  }

  if (error) {
    return (
      <div className="text-sm text-red-600 py-4">
        Failed to load datacenters. Check your admin token.
      </div>
    );
  }

  if (datacenters.length === 0) {
    return (
      <div className="text-sm text-gray-500 py-4">
        No datacenters found in your IONOS account.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <p className="text-sm text-gray-500">
        {readOnly
          ? 'Resources shared with this token:'
          : 'Select datacenters to share with this token. If none selected, the token has service-level permissions only (no access to specific datacenters).'}
      </p>

      <div className="space-y-2">
        {datacenters.map((dc) => {
          const selected = isSelected(dc.id);
          const resource = value.find((r) => r.resourceId === dc.id);

          return (
            <div
              key={dc.id}
              className={`border rounded-lg p-3 transition-colors ${
                selected ? 'border-blue-300 bg-blue-50' : 'border-gray-200 bg-white'
              }`}
            >
              <div className="flex items-center gap-3">
                {!readOnly && (
                  <input
                    type="checkbox"
                    checked={selected}
                    onChange={() => toggleResource(dc)}
                    className="rounded border-gray-300 text-blue-600"
                  />
                )}
                <Server className="w-4 h-4 text-gray-400" />
                <div className="flex-1 min-w-0">
                  <span className="font-medium text-sm">{dc.name}</span>
                  <span className="text-xs text-gray-400 ml-2">{dc.location}</span>
                  {dc.description && (
                    <p className="text-xs text-gray-500 truncate">{dc.description}</p>
                  )}
                </div>
              </div>

              {selected && resource && (
                <div className="flex gap-4 mt-2 ml-9 text-xs">
                  <label className={`flex items-center gap-1 ${readOnly ? '' : 'cursor-pointer'}`}>
                    <input
                      type="checkbox"
                      checked={resource.editPrivilege}
                      onChange={() => toggleEditPrivilege(dc.id)}
                      disabled={readOnly}
                      className="rounded border-gray-300 text-blue-600"
                    />
                    Can edit
                  </label>
                  <label className={`flex items-center gap-1 ${readOnly ? '' : 'cursor-pointer'}`}>
                    <input
                      type="checkbox"
                      checked={resource.sharePrivilege}
                      onChange={() => toggleSharePrivilege(dc.id)}
                      disabled={readOnly}
                      className="rounded border-gray-300 text-blue-600"
                    />
                    Can share
                  </label>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
