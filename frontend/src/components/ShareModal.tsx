import { useEffect, useState, type FormEvent } from 'react';
import { X, Link as LinkIcon, Copy, Check, Code } from 'lucide-react';
import { Modal } from './Modal';
import { api, ApiError } from '../api/client';
import { buildEmbedCode } from '../lib/embedCode';
import type { ListSharesResponse } from '../api/types';

interface ShareModalProps {
  resourceType: 'folder' | 'file';
  resourceId: string;
  resourceName: string;
  onClose: () => void;
}

type CopyTarget = 'link' | 'embed' | null;

export function ShareModal({ resourceType, resourceId, resourceName, onClose }: ShareModalProps) {
  const [shares, setShares] = useState<ListSharesResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [email, setEmail] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // The raw token/url only ever exist right after creation — the server
  // never stores or returns the plaintext token again after that.
  const [freshLink, setFreshLink] = useState<{ token: string; url: string } | null>(null);
  const [linkBusy, setLinkBusy] = useState(false);
  const [copied, setCopied] = useState<CopyTarget>(null);

  const load = () => {
    setLoading(true);
    api
      .listShares(resourceType, resourceId)
      .then(setShares)
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Failed to load'))
      .finally(() => setLoading(false));
  };

  useEffect(load, [resourceType, resourceId]);

  const handleAddShare = async (e: FormEvent) => {
    e.preventDefault();
    if (!email.trim()) return;
    setSubmitting(true);
    setError(null);
    try {
      await api.createShare(resourceType, resourceId, email.trim());
      setEmail('');
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to share');
    } finally {
      setSubmitting(false);
    }
  };

  const handleRevoke = async (shareId: string) => {
    setError(null);
    try {
      await api.deleteShare(shareId);
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to revoke');
    }
  };

  const handleCreateLink = async () => {
    setLinkBusy(true);
    setError(null);
    try {
      const res = await api.createPublicLink(resourceId);
      if (res.created && res.token && res.url) {
        setFreshLink({ token: res.token, url: res.url });
      }
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to create link');
    } finally {
      setLinkBusy(false);
    }
  };

  const handleRevokeLink = async () => {
    setLinkBusy(true);
    setError(null);
    try {
      await api.deletePublicLink(resourceId);
      setFreshLink(null);
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to revoke link');
    } finally {
      setLinkBusy(false);
    }
  };

  const copy = async (text: string, target: CopyTarget) => {
    await navigator.clipboard.writeText(text);
    setCopied(target);
    setTimeout(() => setCopied(null), 1500);
  };

  const embed = freshLink ? buildEmbedCode(freshLink.url, resourceName) : null;

  return (
    <Modal title={`Share "${resourceName}"`} onClose={onClose}>
      {error && (
        <p className="mb-3 rounded bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-500/10 dark:text-red-400">
          {error}
        </p>
      )}

      <div className="mb-5">
        <h3 className="mb-2 text-sm font-medium text-slate-700 dark:text-slate-200">People with access</h3>
        {loading ? (
          <p className="text-sm text-slate-400 dark:text-slate-500">Loading…</p>
        ) : (
          <div className="mb-3 space-y-1">
            {shares?.userShares.length === 0 && (
              <p className="text-sm text-slate-400 dark:text-slate-500">Only you.</p>
            )}
            {shares?.userShares.map((s) => (
              <div key={s.id} className="flex items-center justify-between gap-2 rounded px-2 py-1.5 text-sm hover:bg-slate-50 dark:hover:bg-slate-700/50">
                <span className="truncate text-slate-700 dark:text-slate-200">{s.email}</span>
                <button
                  onClick={() => handleRevoke(s.id)}
                  className="shrink-0 text-slate-400 hover:text-red-500 dark:text-slate-500 dark:hover:text-red-400"
                  title="Remove access"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            ))}
          </div>
        )}
        <form onSubmit={handleAddShare} className="flex gap-2">
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="someone@example.com"
            className="w-full rounded border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-900 focus:border-indigo-500 focus:outline-none dark:border-slate-600 dark:bg-slate-700 dark:text-slate-100"
          />
          <button
            type="submit"
            disabled={submitting || !email.trim()}
            className="shrink-0 rounded bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
          >
            Share
          </button>
        </form>
      </div>

      {resourceType === 'file' && (
        <div className="border-t border-slate-100 pt-4 dark:border-slate-700">
          <h3 className="mb-2 flex items-center gap-1.5 text-sm font-medium text-slate-700 dark:text-slate-200">
            <LinkIcon className="h-4 w-4" /> Public link
          </h3>

          {freshLink && embed ? (
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <input readOnly value={freshLink.url} className="w-full rounded border border-slate-300 bg-white px-2 py-1.5 text-xs dark:border-slate-600 dark:bg-slate-700 dark:text-slate-100" />
                <button
                  onClick={() => copy(freshLink.url, 'link')}
                  className="shrink-0 rounded bg-slate-100 p-2 text-slate-600 hover:bg-slate-200 dark:bg-slate-700 dark:text-slate-300 dark:hover:bg-slate-600"
                  title="Copy link"
                >
                  {copied === 'link' ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                </button>
              </div>
              <button
                onClick={() => copy(embed.code, 'embed')}
                className="flex w-full items-center justify-center gap-1.5 rounded border border-indigo-200 bg-indigo-50 px-3 py-1.5 text-sm font-medium text-indigo-700 hover:bg-indigo-100 dark:border-indigo-500/30 dark:bg-indigo-500/10 dark:text-indigo-300 dark:hover:bg-indigo-500/20"
              >
                {copied === 'embed' ? <Check className="h-4 w-4" /> : <Code className="h-4 w-4" />}
                {copied === 'embed' ? 'Copied embed code' : 'Copy embed code'}
              </button>
              {!embed.embeddable && (
                <p className="text-xs text-amber-600 dark:text-amber-400">
                  This file type doesn't render inline in a browser — the copied snippet is a plain link, not an
                  embed.
                </p>
              )}
              <p className="text-xs text-slate-400 dark:text-slate-500">
                Save this now — it won't be shown again. Revoke and create a new one if you lose it.
              </p>
              <button
                onClick={handleRevokeLink}
                disabled={linkBusy}
                className="text-xs text-red-500 hover:underline dark:text-red-400"
              >
                Revoke link
              </button>
            </div>
          ) : shares?.hasPublicLink ? (
            <div className="space-y-2">
              <p className="text-sm text-slate-500 dark:text-slate-400">
                A public link is active, but it was only shown once, when created — this app never stores it in a
                way it can show you again.
              </p>
              <button
                onClick={handleRevokeLink}
                disabled={linkBusy}
                className="rounded border border-red-200 px-3 py-1.5 text-sm text-red-600 hover:bg-red-50 disabled:opacity-50 dark:border-red-500/30 dark:text-red-400 dark:hover:bg-red-500/10"
              >
                Revoke &amp; create a new one
              </button>
            </div>
          ) : (
            <button
              onClick={handleCreateLink}
              disabled={linkBusy}
              className="rounded border border-slate-300 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-100 disabled:opacity-50 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-700"
            >
              {linkBusy ? 'Creating…' : 'Create public link'}
            </button>
          )}
        </div>
      )}
    </Modal>
  );
}
