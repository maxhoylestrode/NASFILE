import { useState, type FormEvent } from 'react';
import { Copy, Check } from 'lucide-react';
import { api, ApiError } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { Sidebar } from '../components/Sidebar';
import { TopBar } from '../components/TopBar';
import { UploadPanel } from '../components/UploadPanel';

export function AdminInvitesPage() {
  const { user, logout } = useAuth();
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
    <div className="flex h-screen bg-slate-50 transition-colors duration-200 dark:bg-slate-900">
      <Sidebar isAdmin={user?.isAdmin} />

      <div className="flex flex-1 flex-col overflow-hidden">
        <TopBar email={user?.email} onLogout={logout} />

        <main className="flex-1 overflow-y-auto px-6 py-6">
          <div className="mx-auto max-w-lg">
            <div className="mb-4">
              <h1 className="text-lg font-semibold text-slate-900 dark:text-slate-100">Create an invite</h1>
              <p className="text-sm text-slate-500 dark:text-slate-400">
                Generates a single-use invite link. The token is shown once — copy it now, it isn't recoverable
                afterward.
              </p>
            </div>

            <div className="animate-fade-in rounded-lg border border-slate-200 bg-white p-5 transition-colors duration-200 dark:border-slate-700 dark:bg-slate-800">
              <form onSubmit={handleSubmit} className="space-y-3">
                <div>
                  <label className="mb-1 block text-sm text-slate-600 dark:text-slate-300">
                    Email (optional — restricts the invite to this address)
                  </label>
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="someone@example.com"
                    className="w-full rounded border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 transition-colors duration-150 focus:border-indigo-500 focus:outline-none dark:border-slate-600 dark:bg-slate-700 dark:text-slate-100 dark:focus:border-indigo-400"
                  />
                </div>
                {error && (
                  <p className="rounded bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-500/10 dark:text-red-400">
                    {error}
                  </p>
                )}
                <button
                  type="submit"
                  disabled={submitting}
                  className="rounded bg-indigo-600 px-4 py-2 text-sm font-medium text-white transition-all duration-150 hover:bg-indigo-700 active:scale-[0.98] disabled:opacity-50 dark:bg-indigo-500 dark:hover:bg-indigo-600"
                >
                  {submitting ? 'Creating…' : 'Create invite'}
                </button>
              </form>

              {link && (
                <div className="mt-5 animate-fade-in rounded border border-emerald-200 bg-emerald-50 p-3 dark:border-emerald-500/30 dark:bg-emerald-500/10">
                  <p className="mb-2 text-sm font-medium text-emerald-800 dark:text-emerald-300">Invite created</p>
                  <div className="flex items-center gap-2">
                    <input
                      readOnly
                      value={link}
                      className="w-full rounded border border-emerald-200 bg-white px-2 py-1.5 text-xs text-slate-800 dark:border-emerald-500/30 dark:bg-slate-800 dark:text-slate-100"
                    />
                    <button
                      onClick={copyLink}
                      className="shrink-0 rounded bg-emerald-600 p-2 text-white transition-colors duration-150 hover:bg-emerald-700 dark:bg-emerald-500 dark:hover:bg-emerald-600"
                    >
                      <span key={copied ? 'copied' : 'copy'} className="inline-block animate-scale-in">
                        {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                      </span>
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </main>
      </div>

      <UploadPanel />
    </div>
  );
}
