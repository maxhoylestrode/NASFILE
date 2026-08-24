import { useState, type FormEvent } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { HardDrive } from 'lucide-react';
import { api, ApiError } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { ThemeToggle } from '../components/ThemeToggle';

export function AcceptInvitePage() {
  const [params] = useSearchParams();
  const tokenFromUrl = params.get('token') ?? '';
  const emailFromUrl = params.get('email') ?? '';
  const { loginWithSession } = useAuth();
  const navigate = useNavigate();

  const [token, setToken] = useState(tokenFromUrl);
  const [email, setEmail] = useState(emailFromUrl);
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const res = await api.acceptInvite(token, email, password);
      loginWithSession(res);
      navigate('/');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not accept invite');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4 transition-colors duration-200 dark:bg-slate-900">
      <div className="fixed right-4 top-4">
        <ThemeToggle />
      </div>
      <div className="w-full max-w-sm animate-fade-in rounded-xl border border-slate-200 bg-white p-6 shadow-sm transition-colors duration-200 dark:border-slate-700 dark:bg-slate-800">
        <div className="mb-6 flex flex-col items-center gap-2">
          <HardDrive className="h-8 w-8 text-indigo-600 dark:text-indigo-400" />
          <h1 className="text-lg font-semibold text-slate-900 dark:text-slate-100">Accept your invite</h1>
        </div>
        <form onSubmit={handleSubmit} className="space-y-3">
          <div>
            <label className="mb-1 block text-sm text-slate-600 dark:text-slate-300">Invite token</label>
            <input
              required
              value={token}
              onChange={(e) => setToken(e.target.value)}
              className="w-full rounded border border-slate-300 bg-white px-3 py-2 font-mono text-xs text-slate-900 transition-colors duration-150 focus:border-indigo-500 focus:outline-none dark:border-slate-600 dark:bg-slate-700 dark:text-slate-100 dark:focus:border-indigo-400"
            />
          </div>
          <div>
            <label className="mb-1 block text-sm text-slate-600 dark:text-slate-300">Email</label>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full rounded border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 transition-colors duration-150 focus:border-indigo-500 focus:outline-none dark:border-slate-600 dark:bg-slate-700 dark:text-slate-100 dark:focus:border-indigo-400"
            />
          </div>
          <div>
            <label className="mb-1 block text-sm text-slate-600 dark:text-slate-300">Choose a password</label>
            <input
              type="password"
              required
              minLength={10}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full rounded border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 transition-colors duration-150 focus:border-indigo-500 focus:outline-none dark:border-slate-600 dark:bg-slate-700 dark:text-slate-100 dark:focus:border-indigo-400"
            />
            <p className="mt-1 text-xs text-slate-400 dark:text-slate-500">At least 10 characters.</p>
          </div>
          {error && (
            <p className="rounded bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-500/10 dark:text-red-400">{error}</p>
          )}
          <button
            type="submit"
            disabled={submitting}
            className="w-full rounded bg-indigo-600 py-2 text-sm font-medium text-white transition-all duration-150 hover:bg-indigo-700 active:scale-[0.98] disabled:opacity-50 dark:bg-indigo-500 dark:hover:bg-indigo-600"
          >
            {submitting ? 'Creating account…' : 'Create account'}
          </button>
        </form>
      </div>
    </div>
  );
}
