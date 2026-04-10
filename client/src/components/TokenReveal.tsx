import { useState } from 'react';
import { Copy, Check, AlertTriangle, Eye, EyeOff } from 'lucide-react';

interface TokenRevealProps {
  tokenValue: string;
}

export default function TokenReveal({ tokenValue }: TokenRevealProps) {
  const [copied, setCopied] = useState(false);
  const [visible, setVisible] = useState(false);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(tokenValue);
    setCopied(true);
    setTimeout(() => setCopied(false), 3000);
  };

  return (
    <div className="space-y-3">
      <div className="flex items-start gap-2 p-3 bg-amber-50 border border-amber-200 rounded-lg">
        <AlertTriangle className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" />
        <div className="text-sm text-amber-800">
          <p className="font-medium">Save this token now!</p>
          <p>This is the only time you'll see this token value. It cannot be retrieved later.</p>
        </div>
      </div>

      <div className="relative">
        <div className="bg-gray-900 text-gray-100 p-4 rounded-lg font-mono text-xs break-all pr-20">
          {visible ? tokenValue : tokenValue.slice(0, 20) + '...' + tokenValue.slice(-10)}
        </div>
        <div className="absolute top-2 right-2 flex gap-1">
          <button
            onClick={() => setVisible(!visible)}
            className="p-1.5 rounded bg-gray-700 hover:bg-gray-600 text-gray-300 transition-colors"
            title={visible ? 'Hide token' : 'Show full token'}
          >
            {visible ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
          </button>
          <button
            onClick={handleCopy}
            className="p-1.5 rounded bg-gray-700 hover:bg-gray-600 text-gray-300 transition-colors"
            title="Copy to clipboard"
          >
            {copied ? <Check className="w-4 h-4 text-green-400" /> : <Copy className="w-4 h-4" />}
          </button>
        </div>
      </div>
    </div>
  );
}
