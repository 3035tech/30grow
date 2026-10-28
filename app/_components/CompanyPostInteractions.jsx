'use client';

import { useState } from 'react';
import { KUDO_QUICK_REACTION_EMOJIS } from '../../lib/kudo-reaction-options';
import { t } from '../../lib/i18n';
import { cn } from '../../lib/cn';
import { formatDisplayDateTime } from '../../lib/format-display-date';
import { S } from '../dashboard/dashboard-shared';
import { useAppFeedback } from './AppFeedback';

export function CompanyPostInteractions({ postId, initialReactions = [], initialCommentCount = 0, locale = 'pt-BR' }) {
  const { toast } = useAppFeedback();
  const [reactions, setReactions] = useState(initialReactions);
  const [commentCount, setCommentCount] = useState(initialCommentCount);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [commentsOpen, setCommentsOpen] = useState(false);
  const [comments, setComments] = useState([]);
  const [hasMore, setHasMore] = useState(false);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [loadingComments, setLoadingComments] = useState(false);
  const endpoint = `/api/employee/feed/${postId}`;
  const copy = (key, values) => t(locale, `employeeHome.${key}`, values);

  async function react(emoji) {
    if (busy) return;
    setBusy(true);
    try {
      const remove = reactions.some(item => item.emoji === emoji && item.mine);
      const response = await fetch(`${endpoint}/reactions`, {
        method: remove ? 'DELETE' : 'PUT',
        headers: { 'Content-Type': 'application/json' },
        ...(remove ? {} : { body: JSON.stringify({ emoji }) }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.ok) throw new Error('reaction_failed');
      setReactions(data.reactions || []);
      setPickerOpen(false);
    } catch {
      toast(copy('feedReactionError'), 'error');
    } finally {
      setBusy(false);
    }
  }

  async function loadComments(append = false) {
    if (loadingComments) return;
    setLoadingComments(true);
    try {
      const response = await fetch(`${endpoint}/comments?offset=${append ? comments.length : 0}`, { cache: 'no-store' });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.ok) throw new Error('comments_failed');
      setComments(previous => append ? [...previous, ...data.comments] : data.comments);
      setHasMore(Boolean(data.hasMore));
    } catch {
      toast(copy('feedCommentsError'), 'error');
    } finally {
      setLoadingComments(false);
    }
  }

  async function submitComment(event) {
    event.preventDefault();
    if (busy || !draft.trim()) return;
    setBusy(true);
    try {
      const response = await fetch(`${endpoint}/comments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ body: draft.trim() }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.ok) throw new Error('comment_failed');
      setDraft('');
      setCommentCount(count => count + 1);
      await loadComments();
    } catch {
      toast(copy('feedCommentSaveError'), 'error');
    } finally {
      setBusy(false);
    }
  }

  async function removeComment(commentId) {
    if (busy) return;
    setBusy(true);
    try {
      const response = await fetch(`${endpoint}/comments/${commentId}`, { method: 'DELETE' });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.ok) throw new Error('delete_failed');
      setCommentCount(count => Math.max(0, count - 1));
      await loadComments();
    } catch {
      toast(copy('feedCommentDeleteError'), 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-4 border-t border-ink/10 pt-3" aria-busy={busy || loadingComments}>
      <div className="flex flex-wrap items-center gap-2">
        {reactions.map(reaction => (
          <button key={reaction.emoji} type="button" disabled={busy} aria-pressed={reaction.mine}
            aria-label={`${reaction.emoji} · ${reaction.count}`}
            className={cn(reaction.mine ? S.btnBrandSoft : S.btnGhost, 'min-h-touch rounded-full px-3')}
            onClick={() => react(reaction.emoji)}>
            {reaction.emoji} {reaction.count}
          </button>
        ))}
        <button type="button" className={S.btnGhost} disabled={busy} aria-expanded={pickerOpen}
          onClick={() => setPickerOpen(open => !open)}>{copy('feedReact')}</button>
        <button type="button" className={S.btnGhost} disabled={busy} aria-expanded={commentsOpen}
          onClick={() => {
            if (!commentsOpen && !comments.length) loadComments();
            setCommentsOpen(open => !open);
          }}>
          {copy('feedComments', { n: commentCount })}
        </button>
      </div>
      {pickerOpen ? (
        <div className="mt-2 flex flex-wrap gap-1 rounded-control border border-line bg-surface p-2" role="group" aria-label={copy('feedChooseReaction')}>
          {KUDO_QUICK_REACTION_EMOJIS.map(emoji => (
            <button key={emoji} type="button" className={cn(S.btnGhost, 'min-h-touch min-w-touch text-xl')}
              disabled={busy} aria-label={emoji} aria-pressed={reactions.some(item => item.emoji === emoji && item.mine)}
              onClick={() => react(emoji)}>{emoji}</button>
          ))}
        </div>
      ) : null}
      {commentsOpen ? (
        <div className="mt-3 space-y-3">
          <form onSubmit={submitComment} className="flex flex-col gap-2">
            <label htmlFor={`post-comment-${postId}`} className="text-sm font-medium text-ink">{copy('feedWriteComment')}</label>
            <textarea id={`post-comment-${postId}`} value={draft} onChange={event => setDraft(event.target.value)}
              maxLength={1000} rows={2} disabled={busy} className={S.input} />
            <button type="submit" className={cn(S.btnBrandSoft, 'self-start')} disabled={busy || !draft.trim()}>{copy('feedSendComment')}</button>
          </form>
          {loadingComments && !comments.length ? <p className="text-sm text-ink-muted">{t(locale, 'panel.common.loading')}</p> : null}
          {!loadingComments && !comments.length ? <p className="text-sm text-ink-muted">{copy('feedNoComments')}</p> : null}
          {comments.length ? (
            <ul className="m-0 list-none divide-y divide-ink/10 p-0">
              {comments.map(comment => (
                <li key={comment.id} className="py-3 first:pt-0">
                  <div className="flex flex-wrap items-center gap-x-2 text-xs text-ink-muted">
                    <strong className="text-sm text-ink">{comment.authorName}</strong>
                    <span>{formatDisplayDateTime(comment.createdAt, locale)}</span>
                    {comment.mine ? <button type="button" disabled={busy} className="ml-auto text-brand-700 underline underline-offset-2" onClick={() => removeComment(comment.id)}>{copy('feedDeleteComment')}</button> : null}
                  </div>
                  <p className="mb-0 mt-1 whitespace-pre-wrap break-words text-sm text-ink">{comment.body}</p>
                </li>
              ))}
            </ul>
          ) : null}
          {hasMore ? <button type="button" className={S.btnGhost} disabled={loadingComments} onClick={() => loadComments(true)}>{copy('feedMoreComments')}</button> : null}
        </div>
      ) : null}
    </div>
  );
}
