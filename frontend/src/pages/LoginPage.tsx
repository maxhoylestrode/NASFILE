import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { HardDrive } from 'lucide-react';
import { useAuth } from '../auth/AuthContext';
import { ThemeToggle } from '../components/ThemeToggle';

export function LoginPage() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await login(email, password);
      navigate('/');
    } catch {
      setError('Invalid email or password');
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
          <h1 className="text-lg font-semibold text-slate-900 dark:text-slate-100">Silo</h1>
        </div>
        <form onSubmit={handleSubmit} className="space-y-3">
          <div>
            <label className="mb-1 block text-sm text-slate-600 dark:text-slate-300">Email</label>
            <input
              type="email"
              required
              autoFocus
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full rounded border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 transition-colors duration-150 focus:border-indigo-500 focus:outline-none dark:border-slate-600 dark:bg-slate-700 dark:text-slate-100 dark:focus:border-indigo-400"
            />
          </div>
          <div>
            <label className="mb-1 block text-sm text-slate-600 dark:text-slate-300">Password</label>
            <input
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full rounded border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 transition-colors duration-150 focus:border-indigo-500 focus:outline-none dark:border-slate-600 dark:bg-slate-700 dark:text-slate-100 dark:focus:border-indigo-400"
            />
          </div>
          {error && (
            <p className="rounded bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-500/10 dark:text-red-400">{error}</p>
          )}
          <button
            type="submit"
            disabled={submitting}
            className="w-full rounded bg-indigo-600 py-2 text-sm font-medium text-white transition-all duration-150 hover:bg-indigo-700 active:scale-[0.98] disabled:opacity-50 dark:bg-indigo-500 dark:hover:bg-indigo-600"
          >
            {submitting ? 'Signing in…' : 'Sign in'}
          </button>
        </form>
      </div>
    </div>
  );
}
