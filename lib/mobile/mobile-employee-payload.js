import { KUDO_QUICK_REACTION_EMOJIS } from '../kudo-reaction-options.js';
/**
 * Mobile app contracts expect JSON numbers and ISO strings.
 * node-pg returns bigint as string and timestamptz as Date.
 */

import { toDateOnlyIso } from '../format-display-date.js';
import { htmlToPlainText } from '../sanitize-html.js';

function id(value) {
  const n = Number(value);
  return Number.isSafeInteger(n) && n > 0 ? n : 0;
}

function iso(value) {
  if (value == null || value === '') return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.toISOString();
  const s = String(value).trim();
  if (!s) return null;
  if (/^\d{4}-\d{2}-\d{2}T/.test(s)) return s;
  const parsed = new Date(s);
  return Number.isNaN(parsed.getTime()) ? s : parsed.toISOString();
}

export function mobileCommunityBody({ posts, postTotal, kudos, kudosTotal, colleagues, expandedReactions = false }) {
  return {
    posts: (posts || []).map((post) => ({
      id: id(post.id),
      title: String(post.title || ''),
      bodyHtml: String(post.bodyHtml || ''),
      attachments: (post.attachments || []).map(file => ({ id: id(file.id), fileName: String(file.fileName), contentType: String(file.contentType), byteSize: Number(file.byteSize), url: `/api/mobile/v1/employee/feed/${id(post.id)}/attachments/${id(file.id)}` })),
      authorName: post.authorName ? String(post.authorName) : null,
      createdAt: iso(post.createdAt) || '',
    })),
    postTotal: Number(postTotal) || 0,
    reactionCatalogVersion: expandedReactions ? 2 : 1,
    kudos: (kudos || []).map((kudo) => ({
      id: id(kudo.id),
      message: String(kudo.message || ''),
      fromCandidateId: id(kudo.fromCandidateId),
      toCandidateId: id(kudo.toCandidateId),
      fromName: String(kudo.fromName || ''),
      toName: String(kudo.toName || ''),
      reactions: (kudo.reactions || []).filter(reaction => expandedReactions || KUDO_QUICK_REACTION_EMOJIS.includes(reaction.emoji)).map(reaction => ({ emoji: reaction.emoji, count: Number(reaction.count), mine: Boolean(reaction.mine) })),
      createdAt: iso(kudo.createdAt) || '',
    })),
    kudosTotal: Number(kudosTotal) || 0,
    colleagues: (colleagues || []).map((person) => ({
      id: id(person.id),
      fullName: String(person.fullName || ''),
    })),
  };
}

export function mobileOneOnOneBody(result) {
  const prep = result?.preparation || {};
  return {
    agreements: (result?.agreements || []).map((item) => ({
      id: id(item.id),
      meetingDate: toDateOnlyIso(item.meetingDate),
      nextSteps: htmlToPlainText(item.nextSteps || ''),
    })),
    prompts: (result?.prompts || []).map((prompt) => String(prompt || '')).filter(Boolean),
    preparation: {
      preparedAt: prep.preparedAt ? iso(prep.preparedAt) : null,
      noteToManager: String(prep.noteToManager || ''),
    },
  };
}

export function mobileReviewList(reviews) {
  return (reviews || []).map((review) => ({
    id: id(review.id),
    cycleTitle: String(review.cycleTitle || ''),
    model: String(review.model || ''),
    sentAt: review.sentAt ? iso(review.sentAt) : null,
  }));
}

export function mobileReviewDetail(review) {
  return {
    id: id(review.id),
    cycleTitle: String(review.cycleTitle || ''),
    model: String(review.model || ''),
    sentAt: review.sentAt ? iso(review.sentAt) : null,
    items: (review.items || []).map((item) => ({
      id: id(item.id),
      label: String(item.label || ''),
    })),
    raters: (review.raters || []).map((rater) => ({
      id: id(rater.id),
      role: String(rater.role || ''),
      overallNotes: String(rater.overallNotes || ''),
    })),
    scores: (review.scores || []).map((score) => ({
      raterId: id(score.raterId),
      itemId: id(score.itemId),
      score: Number(score.score),
      notes: score.notes == null ? null : String(score.notes),
    })),
  };
}

export function mobileLmsBody(courses) {
  return {
    courses: (courses || []).map((course) => ({
      enrollmentId: id(course.enrollmentId),
      courseId: id(course.courseId),
      title: String(course.title || ''),
      description: course.description == null ? null : String(course.description),
      dueDate: toDateOnlyIso(course.dueDate),
      mandatory: Boolean(course.mandatory),
      overdue: Boolean(course.overdue),
      progressPct: Math.max(0, Math.min(100, Math.round(Number(course.progressPct) || 0))),
      isComplete: Boolean(course.isComplete),
      certificateAvailable: Boolean(course.certificateAvailable),
      lessons: (course.lessons || []).map((lesson) => ({
        id: id(lesson.id),
        title: String(lesson.title || ''),
        description: lesson.description == null ? null : String(lesson.description),
        contentUrl: String(lesson.contentUrl || ''),
        contentKind: lesson.contentKind,
        embedUrl: lesson.embedUrl || null,
        videoId: lesson.videoId || null,
        completed: Boolean(lesson.completed),
        quizRequired: Boolean(lesson.quizRequired),
        quizPassed: Boolean(lesson.quizPassed),
        watchPositionSec: Number(lesson.watchPositionSec) || 0,
        watchDurationSec: Number(lesson.watchDurationSec) || 0,
      })),
    })),
  };
}

function mobileSurvey(item) {
  return {
    kind: item.kind,
    title: String(item.title || ''),
    token: String(item.token || ''),
    ...(item.description != null ? { description: String(item.description) } : {}),
    questions: (item.questions || []).map((question) => ({
      id: id(question.id),
      prompt: String(question.prompt || ''),
      scaleMin: Number(question.scaleMin),
      scaleMax: Number(question.scaleMax),
      ...(question.questionKind ? { questionKind: String(question.questionKind) } : {}),
    })),
  };
}

export function mobileSurveyInbox(inbox) {
  return {
    openClimate: (inbox?.openClimate || []).map(mobileSurvey),
    openPulse: (inbox?.openPulse || []).map(mobileSurvey),
    history: (inbox?.history || []).map((item) => ({
      kind: item.kind,
      title: String(item.title || ''),
      submittedAt: iso(item.submittedAt) || '',
    })),
  };
}
