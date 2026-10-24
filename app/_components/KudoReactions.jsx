'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { KUDO_REACTION_EMOJIS, KUDO_REACTORS_PAGE_SIZE } from '../../lib/kudo-reaction-options';
import { t } from '../../lib/i18n';
import { cn } from '../../lib/cn';
import { S } from '../dashboard/dashboard-shared';
import { useAppFeedback } from './AppFeedback';

const EMPTY_REACTIONS = Object.freeze([]);

export function KudoReactions({ kudoId, initialReactions = EMPTY_REACTIONS, locale = 'pt-BR' }) {
  const { toast } = useAppFeedback();
  const [reactions, setReactions] = useState(initialReactions);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [peopleOpen, setPeopleOpen] = useState(false);
  const [people, setPeople] = useState([]);
  const [hasMore, setHasMore] = useState(false);
  const [busy, setBusy] = useState(false);
  const [loadingPeople, setLoadingPeople] = useState(false);
  const mutationInFlight = useRef(false);
  const reactButtonRef = useRef(null);
  const pickerRef = useRef(null);
  const restoreFocus = useRef(false);
  const [announcement, setAnnouncement] = useState('');
  const pickerId = useId();
  const peopleId = useId();
  const endpoint = `/api/employee/kudos/${kudoId}/reactions`;
  const label = key => t(locale, `employeeHome.${key}`);

  useEffect(() => { setReactions(initialReactions); }, [initialReactions]);
  useEffect(() => {
    if (pickerOpen) pickerRef.current?.querySelector('button')?.focus();
  }, [pickerOpen]);
  useEffect(() => {
    if (!busy && restoreFocus.current) {
      restoreFocus.current = false;
      reactButtonRef.current?.focus();
    }
  }, [busy]);

  async function react(emoji) {
    if (mutationInFlight.current) return;
    mutationInFlight.current = true;
    setAnnouncement('');
    setBusy(true);
    try {
      const remove = reactions.some(reaction => reaction.emoji === emoji && reaction.mine);
      const response = await fetch(endpoint, {
        method: remove ? 'DELETE' : 'PUT',
        headers: { 'Content-Type': 'application/json' },
        ...(remove ? {} : { body: JSON.stringify({ emoji }) }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.ok) throw Error('reaction_failed');
      setReactions(data.reactions || []);
      setPickerOpen(false);
      setPeopleOpen(false);
      setPeople([]);
      setAnnouncement(label(remove ? 'kudosReactionRemoved' : 'kudosReactionUpdated'));
    } catch {
      toast(label('kudosReactionError'), 'error');
    } finally {
      mutationInFlight.current = false;
      restoreFocus.current = true;
      setBusy(false);
    }
  }

  async function loadPeople(append = false) {
    if (loadingPeople) return;
    setLoadingPeople(true);
    try {
      const response = await fetch(`${endpoint}?offset=${append ? people.length : 0}`, { cache: 'no-store' });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.ok) throw Error('reactors_failed');
      setPeople(previous => append ? [...previous, ...data.people] : data.people);
      setHasMore(data.hasMore);
      setPeopleOpen(true);
    } catch {
      toast(label('kudosReactorsLoadError'), 'error');
    } finally {
      setLoadingPeople(false);
    }
  }

  return (
    <div className="mt-3" aria-busy={busy || loadingPeople}>
      <span className="sr-only" role="status">{announcement}</span>
      <div className="flex flex-wrap items-center gap-2">
        {KUDO_REACTION_EMOJIS.map((emoji, index) => {
          const reaction = reactions.find(item => item.emoji === emoji);
          if (!reaction?.count) return null;
          return (
            <button key={emoji} type="button" disabled={busy || loadingPeople} aria-pressed={reaction.mine}
              aria-label={`${label(`kudosReaction${index}`)} · ${reaction.count}`}
              className={cn(reaction.mine ? S.btnBrandSoft : S.btnGhost, 'min-h-touch gap-1 rounded-full px-3')}
              onClick={() => react(emoji)}>
              <span aria-hidden="true">{emoji}</span><span>{reaction.count}</span>
            </button>
          );
        })}
        <button ref={reactButtonRef} type="button" className={cn(S.btnGhost, 'min-h-touch')} disabled={busy || loadingPeople}
          aria-expanded={pickerOpen} aria-controls={pickerId} onClick={() => setPickerOpen(open => !open)}>
          <span aria-hidden="true">😊 </span>{busy ? t(locale, 'panel.common.loading') : label('kudosReact')}
        </button>
        {reactions.length > 0 ? (
          <button type="button" className={cn(S.btnGhost, 'min-h-touch')} disabled={busy || loadingPeople}
            aria-expanded={peopleOpen} aria-controls={peopleId}
            onClick={() => peopleOpen ? setPeopleOpen(false) : loadPeople()}>
            {loadingPeople ? t(locale, 'panel.common.loading') : label('kudosSeeReactions')}
          </button>
        ) : null}
      </div>
      {pickerOpen ? (
        <div ref={pickerRef} id={pickerId} role="group" aria-label={label('kudosChooseReaction')}
          onKeyDown={event => {
            if (event.key === 'Escape' && !busy) {
              event.preventDefault();
              event.stopPropagation();
              setPickerOpen(false);
              reactButtonRef.current?.focus();
            }
          }} className="mt-2 flex flex-wrap gap-1 rounded-xl border border-line bg-surface p-2">
          {KUDO_REACTION_EMOJIS.map((emoji, index) => (
            <button key={emoji} type="button" className={cn(S.btnGhost, 'min-h-touch min-w-touch text-xl')}
              disabled={busy || loadingPeople} aria-label={label(`kudosReaction${index}`)}
              aria-pressed={reactions.some(reaction => reaction.emoji === emoji && reaction.mine)}
              onClick={() => react(emoji)}>{emoji}</button>
          ))}
          <p className="w-full text-xs text-ink-muted">{label('kudosReactionHint')}</p>
        </div>
      ) : null}
      {peopleOpen ? (
        <div id={peopleId} className="mt-2 rounded-xl border border-line p-3">
          <p className="text-sm font-semibold text-ink">{label('kudosSeeReactions')}</p>
          {people.length ? <ul className="mt-2 space-y-1 text-sm text-ink-muted">
            {people.map((person, index) => <li key={`${person.fullName}-${index}`}>{person.emoji} {person.fullName}</li>)}
          </ul> : <p className="text-sm text-ink-muted">{label('kudosNoReactions')}</p>}
          {hasMore ? <button type="button" className={cn(S.btnGhost, 'mt-2 min-h-touch')} disabled={loadingPeople}
            onClick={() => loadPeople(true)}>{loadingPeople ? t(locale, 'panel.common.loading') : t(locale, 'employeeHome.kudosMoreReactors', { n: KUDO_REACTORS_PAGE_SIZE })}</button> : null}
        </div>
      ) : null}
    </div>
  );
}
