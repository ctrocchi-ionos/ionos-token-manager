import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { createToken, listTemplates, type CreateTokenPayload, type SharedResource } from '@/api/client';
import PermissionPicker from '@/components/PermissionPicker';
import ResourceBrowser from '@/components/ResourceBrowser';
import TokenReveal from '@/components/TokenReveal';
import { countEnabledPermissions, getEnabledPermissionLabels } from '@/lib/permissions';
import { cn, TTL_PRESETS, formatTtl } from '@/lib/utils';
import { toast } from 'sonner';
import { ArrowLeft, ArrowRight, Check, Loader2 } from 'lucide-react';

const STEPS = ['Name', 'Permissions', 'Resources', 'TTL', 'Review', 'Done'];

export default function CreateToken() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [step, setStep] = useState(0);

  // Form state
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [selectedTemplate, setSelectedTemplate] = useState<string | null>(null);
  const [permissions, setPermissions] = useState<Record<string, boolean>>({});
  const [sharedResources, setSharedResources] = useState<SharedResource[]>([]);
  const [ttlSeconds, setTtlSeconds] = useState(2592000); // 30 days default
  const [resultToken, setResultToken] = useState<string | null>(null);

  const { data: templatesResp } = useQuery({
    queryKey: ['templates'],
    queryFn: () => listTemplates(),
  });
  const templates = templatesResp?.data ?? [];

  const createMut = useMutation({
    mutationFn: (payload: CreateTokenPayload) => createToken(payload),
    onSuccess: (resp) => {
      if (resp.data?.tokenValue) {
        setResultToken(resp.data.tokenValue);
        setStep(5); // Done step
        queryClient.invalidateQueries({ queryKey: ['tokens'] });
        queryClient.invalidateQueries({ queryKey: ['tokenStats'] });
        toast.success('Token created successfully!');
      }
    },
    onError: (err) => {
      toast.error(`Failed to create token: ${err.message}`);
    },
  });

  const applyTemplate = (templateId: string) => {
    const t = templates.find((t) => t.id === templateId);
    if (t) {
      setPermissions(t.permissions);
      setSelectedTemplate(templateId);
    }
  };

  const canProceed = () => {
    switch (step) {
      case 0: return name.trim().length > 0;
      case 1: return countEnabledPermissions(permissions) > 0;
      case 2: return true; // Resources are optional
      case 3: return ttlSeconds >= 60 && ttlSeconds <= 31536000;
      case 4: return true; // Review
      default: return false;
    }
  };

  const handleCreate = () => {
    createMut.mutate({
      name: name.trim(),
      description: description.trim() || undefined,
      permissions,
      sharedResources: sharedResources.length > 0 ? sharedResources : undefined,
      ttlSeconds,
      templateId: selectedTemplate ?? undefined,
    });
  };

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <h1 className="text-2xl font-bold text-gray-900">Create Token</h1>

      {/* Stepper */}
      <div className="flex items-center gap-1">
        {STEPS.map((label, i) => (
          <div key={label} className="flex items-center">
            <div
              className={cn(
                'flex items-center justify-center w-7 h-7 rounded-full text-xs font-medium',
                i < step ? 'bg-blue-600 text-white' :
                i === step ? 'bg-blue-600 text-white ring-2 ring-blue-200' :
                'bg-gray-200 text-gray-500',
              )}
            >
              {i < step ? <Check className="w-3.5 h-3.5" /> : i + 1}
            </div>
            <span className={cn('ml-1.5 text-xs hidden sm:inline', i === step ? 'text-gray-900 font-medium' : 'text-gray-400')}>
              {label}
            </span>
            {i < STEPS.length - 1 && <div className="w-6 h-px bg-gray-300 mx-2" />}
          </div>
        ))}
      </div>

      {/* Step content */}
      <div className="bg-white rounded-xl border border-gray-200 p-6">
        {step === 0 && (
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Token Name *</label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. CI/CD Pipeline, S3 Backup Service..."
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                autoFocus
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Description</label>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="What is this token used for?"
                rows={2}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
              />
            </div>
            {templates.length > 0 && (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Start from template</label>
                <div className="grid grid-cols-2 gap-2">
                  {templates.map((t) => (
                    <button
                      key={t.id}
                      onClick={() => applyTemplate(t.id)}
                      className={cn(
                        'text-left p-3 border rounded-lg text-sm transition-colors',
                        selectedTemplate === t.id
                          ? 'border-blue-500 bg-blue-50'
                          : 'border-gray-200 hover:border-gray-300 bg-white',
                      )}
                    >
                      <div className="font-medium">{t.name}</div>
                      <div className="text-xs text-gray-500 mt-0.5">{t.description}</div>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {step === 1 && (
          <div className="space-y-4">
            <div>
              <h3 className="font-medium text-gray-900 mb-1">Select Permissions</h3>
              <p className="text-sm text-gray-500">
                Choose which IONOS services this token can access. The sub-user will only have these permissions.
              </p>
            </div>
            <PermissionPicker value={permissions} onChange={setPermissions} />
          </div>
        )}

        {step === 2 && (
          <div className="space-y-4">
            <div>
              <h3 className="font-medium text-gray-900 mb-1">Share Resources (Optional)</h3>
              <p className="text-sm text-gray-500">
                Restrict access to specific datacenters. Skip this to grant service-level permissions only.
              </p>
            </div>
            <ResourceBrowser value={sharedResources} onChange={setSharedResources} />
          </div>
        )}

        {step === 3 && (
          <div className="space-y-4">
            <div>
              <h3 className="font-medium text-gray-900 mb-1">Token Lifetime</h3>
              <p className="text-sm text-gray-500">
                How long should this token remain valid?
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              {TTL_PRESETS.map((preset) => (
                <button
                  key={preset.value}
                  onClick={() => setTtlSeconds(preset.value)}
                  className={cn(
                    'px-4 py-2 rounded-lg text-sm font-medium border transition-colors',
                    ttlSeconds === preset.value
                      ? 'border-blue-500 bg-blue-50 text-blue-700'
                      : 'border-gray-200 text-gray-600 hover:border-gray-300',
                  )}
                >
                  {preset.label}
                </button>
              ))}
            </div>
            <div>
              <label className="block text-sm text-gray-500 mb-1">Or set custom (seconds):</label>
              <input
                type="number"
                min={60}
                max={31536000}
                value={ttlSeconds}
                onChange={(e) => setTtlSeconds(parseInt(e.target.value, 10) || 0)}
                className="w-48 px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <span className="ml-2 text-sm text-gray-400">= {formatTtl(ttlSeconds)}</span>
            </div>
          </div>
        )}

        {step === 4 && (
          <div className="space-y-4">
            <h3 className="font-medium text-gray-900 mb-3">Review & Create</h3>
            <dl className="space-y-3 text-sm">
              <div>
                <dt className="text-gray-500">Name</dt>
                <dd className="font-medium">{name}</dd>
              </div>
              {description && (
                <div>
                  <dt className="text-gray-500">Description</dt>
                  <dd>{description}</dd>
                </div>
              )}
              <div>
                <dt className="text-gray-500">Permissions ({countEnabledPermissions(permissions)})</dt>
                <dd className="flex flex-wrap gap-1 mt-1">
                  {getEnabledPermissionLabels(permissions).map((label) => (
                    <span key={label} className="inline-block px-2 py-0.5 bg-blue-50 text-blue-700 rounded text-xs">
                      {label}
                    </span>
                  ))}
                </dd>
              </div>
              {sharedResources.length > 0 && (
                <div>
                  <dt className="text-gray-500">Shared Resources ({sharedResources.length})</dt>
                  <dd>
                    {sharedResources.map((r) => (
                      <div key={r.resourceId} className="text-xs">
                        {r.name} ({r.editPrivilege ? 'edit' : 'view'}{r.sharePrivilege ? ', share' : ''})
                      </div>
                    ))}
                  </dd>
                </div>
              )}
              <div>
                <dt className="text-gray-500">Lifetime</dt>
                <dd>{formatTtl(ttlSeconds)}</dd>
              </div>
            </dl>
          </div>
        )}

        {step === 5 && resultToken && (
          <div className="space-y-4">
            <h3 className="font-medium text-green-700">Token Created Successfully</h3>
            <TokenReveal tokenValue={resultToken} />
            <button
              onClick={() => navigate('/')}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 text-sm font-medium"
            >
              Go to Dashboard
            </button>
          </div>
        )}
      </div>

      {/* Navigation */}
      {step < 5 && (
        <div className="flex justify-between">
          <button
            onClick={() => step === 0 ? navigate('/') : setStep(step - 1)}
            className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-gray-600 hover:text-gray-900"
          >
            <ArrowLeft className="w-4 h-4" />
            {step === 0 ? 'Cancel' : 'Back'}
          </button>

          {step < 4 ? (
            <button
              onClick={() => setStep(step + 1)}
              disabled={!canProceed()}
              className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed text-sm font-medium"
            >
              Next
              <ArrowRight className="w-4 h-4" />
            </button>
          ) : (
            <button
              onClick={handleCreate}
              disabled={createMut.isPending}
              className="flex items-center gap-2 px-6 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50 text-sm font-medium"
            >
              {createMut.isPending ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Creating...
                </>
              ) : (
                <>
                  <Check className="w-4 h-4" />
                  Create Token
                </>
              )}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
