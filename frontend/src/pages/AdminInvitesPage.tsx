import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, Copy, Check } from 'lucide-react';
import { api, ApiError } from '../api/client';

export function AdminInvitesPage() {
  const [email, setEmail] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [link, setLink] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    setLink(null);
    try {
      const res = await api.createInvite(email.trim() || undefined);
      const url = new URL('/accept-invite', window.location.origin);
      url.searchParams.set('token', res.token);
      if (res.email) url.searchParams.set('email', res.email);
      setLink(url.toString());
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to create invite');
    } finally {
      setSubmitting(false);
    }
  };

  const copyLink = async () => {
    if (!link) return;
    await navigator.clipboard.writeText(link);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div className="mx-auto max-w-lg px-4 py-8">
      <Link to="/" className="mb-6 inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-800">
        <ArrowLeft className="h-4 w-4" /> Back to Drive
      </Link>
      <h1 className="mb-1 text-lg font-semibold text-slate-900">Create an invite</h1>
      <p className="mb-6 text-sm text-slate-500">
        Generates a single-use invite link. The token is shown once — copy it now, it isn't recoverable afterward.
      </p>

      <form onSubmit={handleSubmit} className="space-y-3">
        <div>
          <label className="mb-1 block text-sm text-slate-600">Email (optional — restricts the invite to this address)</label>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="someone@example.com"
            className="w-full rounded border border-slate-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none"
          />
        </div>
        {error && <p className="text-sm text-red-600">{error}</p>}
        <button
          type="submit"
          disabled={submitting}
          className="rounded bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
        >
          {submitting ? 'Creating…' : 'Create invite'}
        </button>
      </form>

      {link && (
        <div className="mt-6 rounded border border-emerald-200 bg-emerald-50 p-3">
          <p className="mb-2 text-sm font-medium text-emerald-800">Invite created</p>
          <div className="flex items-center gap-2">
            <input readOnly value={link} className="w-full rounded border border-emerald-200 bg-white px-2 py-1.5 text-xs" />
            <button onClick={copyLink} className="shrink-0 rounded bg-emerald-600 p-2 text-white hover:bg-emerald-700">
              {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
