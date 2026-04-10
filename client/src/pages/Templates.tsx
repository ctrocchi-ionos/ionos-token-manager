import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { listTemplates, createTemplate, deleteTemplate } from '@/api/client';
import PermissionPicker from '@/components/PermissionPicker';
import ConfirmDialog from '@/components/ConfirmDialog';
import { getEnabledPermissionLabels, countEnabledPermissions } from '@/lib/permissions';
import { toast } from 'sonner';
import { Plus, Trash2, Lock, X, Loader2 } from 'lucide-react';

export default function Templates() {
  const queryClient = useQueryClient();
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState('');
  const [newDesc, setNewDesc] = useState('');
  const [newPerms, setNewPerms] = useState<Record<string, boolean>>({});
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const { data: resp, isLoading } = useQuery({
    queryKey: ['templates'],
    queryFn: () => listTemplates(),
  });

  const createMut = useMutation({
    mutationFn: () => createTemplate({ name: newName.trim(), description: newDesc.trim() || undefined, permissions: newPerms }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['templates'] });
      toast.success('Template created');
      setShowCreate(false);
      setNewName('');
      setNewDesc('');
      setNewPerms({});
    },
    onError: (err) => toast.error(`Failed: ${err.message}`),
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) => deleteTemplate(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['templates'] });
      toast.success('Template deleted');
      setDeleteTarget(null);
    },
    onError: (err) => toast.error(`Failed: ${err.message}`),
  });

  const templates = resp?.data ?? [];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">Permission Templates</h1>
        <button
          onClick={() => setShowCreate(true)}
          className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 text-sm font-medium"
        >
          <Plus className="w-4 h-4" />
          New Template
        </button>
      </div>

      {/* Create form */}
      {showCreate && (
        <div className="bg-white border border-gray-200 rounded-xl p-6 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="font-medium text-gray-900">Create Custom Template</h3>
            <button onClick={() => setShowCreate(false)} className="text-gray-400 hover:text-gray-600">
              <X className="w-5 h-5" />
            </button>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Name *</label>
              <input
                type="text"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Description</label>
              <input
                type="text"
                value={newDesc}
                onChange={(e) => setNewDesc(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
          </div>
          <PermissionPicker value={newPerms} onChange={setNewPerms} />
          <div className="flex justify-end">
            <button
              onClick={() => createMut.mutate()}
              disabled={!newName.trim() || countEnabledPermissions(newPerms) === 0 || createMut.isPending}
              className="flex items-center gap-2 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50 text-sm font-medium"
            >
              {createMut.isPending && <Loader2 className="w-4 h-4 animate-spin" />}
              Create Template
            </button>
          </div>
        </div>
      )}

      {/* Template list */}
      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="w-5 h-5 animate-spin text-gray-400" />
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {templates.map((t) => {
            const permLabels = getEnabledPermissionLabels(t.permissions);
            const isExpanded = expandedId === t.id;

            return (
              <div key={t.id} className="bg-white border border-gray-200 rounded-xl p-4">
                <div className="flex items-start justify-between mb-2">
                  <div>
                    <div className="flex items-center gap-2">
                      <h3 className="font-medium text-gray-900">{t.name}</h3>
                      {t.isBuiltin && (
                        <span className="flex items-center gap-1 text-xs text-gray-400">
                          <Lock className="w-3 h-3" /> Built-in
                        </span>
                      )}
                    </div>
                    {t.description && (
                      <p className="text-sm text-gray-500 mt-0.5">{t.description}</p>
                    )}
                  </div>
                  {!t.isBuiltin && (
                    <button
                      onClick={() => setDeleteTarget(t.id)}
                      className="text-red-400 hover:text-red-600 p-1"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  )}
                </div>
                <div className="flex flex-wrap gap-1">
                  {permLabels.slice(0, isExpanded ? undefined : 4).map((label) => (
                    <span key={label} className="inline-block px-1.5 py-0.5 bg-blue-50 text-blue-700 rounded text-xs">
                      {label}
                    </span>
                  ))}
                  {!isExpanded && permLabels.length > 4 && (
                    <button
                      onClick={() => setExpandedId(t.id)}
                      className="inline-block px-1.5 py-0.5 bg-gray-100 text-gray-500 rounded text-xs hover:bg-gray-200"
                    >
                      +{permLabels.length - 4} more
                    </button>
                  )}
                  {isExpanded && (
                    <button
                      onClick={() => setExpandedId(null)}
                      className="inline-block px-1.5 py-0.5 bg-gray-100 text-gray-500 rounded text-xs hover:bg-gray-200"
                    >
                      show less
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      <ConfirmDialog
        open={!!deleteTarget}
        title="Delete Template"
        message="Are you sure you want to delete this custom template?"
        confirmLabel="Delete"
        confirmVariant="danger"
        onConfirm={() => deleteTarget && deleteMut.mutate(deleteTarget)}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  );
}
