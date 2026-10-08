import { runtimeAppUrl } from '../../../../../lib/app-url.js';
import { NextResponse } from 'next/server';
import { query } from '../../../../../lib/db';
import { apiError, ERR } from '../../../../../lib/api-error';
import { audit } from '../../../../../lib/audit';
import { CAP, getManagerScope, getSessionPayload, requireCapability } from '../../../../../lib/ae/require-admin';
import {
  addClimateSurveyQuestion,
  archiveClimateSurvey,
  createClimateSurveyInvite,
  createClimateSurveyInviteBatch,
  emailClimateSurveyInvites,
  getClimateSurvey,
  getClimateSurveyAggregate,
  updateClimateSurvey,
  updateClimateSurveyQuestion,
  versionClimateSurvey,
} from '../../../../../lib/people/climate-surveys';

async function loadScopedSurvey(surveyId, scope) {
  const res = await query(
    `SELECT id, company_id AS "companyId" FROM climate_surveys
     WHERE id = $1 AND deleted = FALSE LIMIT 1`,
    [surveyId]
  );
  if (res.rowCount === 0) return { error: 'NOT_FOUND' };
  if (!scope.isAdmin && String(res.rows[0].companyId) !== String(scope.companyId)) {
    return { error: 'UNAUTHORIZED' };
  }
  return { survey: res.rows[0] };
}

/** GET /api/admin/climate-surveys/[id] */
export async function GET(request, props) {
  const params = await props.params;
  try {
    const payload = await getSessionPayload();
    if (!requireCapability(payload, CAP.CLIMATE_VIEW)) return apiError(request, ERR.UNAUTHORIZED, 401);
    const scope = getManagerScope(payload);
    if (!scope.authorized) return apiError(request, ERR.UNAUTHORIZED, 401);

    const surveyId = params?.id;
    if (!surveyId) return apiError(request, ERR.INVALID_ID, 400);

    const loaded = await loadScopedSurvey(surveyId, scope);
    if (loaded.error) return apiError(request, loaded.error, loaded.error === 'NOT_FOUND' ? 404 : 401);

    const url = new URL(request.url);
    if (url.searchParams.get('aggregate') === '1') {
      const agg = await getClimateSurveyAggregate(query, {
        companyId: loaded.survey.companyId,
        surveyId,
      });
      if (!agg.ok) return apiError(request, agg.errorCode || 'NOT_FOUND', 404);
      return NextResponse.json(agg);
    }

    const survey = await getClimateSurvey(query, {
      companyId: loaded.survey.companyId,
      surveyId,
    });
    if (!survey) return apiError(request, ERR.NOT_FOUND, 404);
    return NextResponse.json({ survey });
  } catch (err) {
    if (err?.code === '42P01') return apiError(request, ERR.SCHEMA_NOT_INITIALIZED, 503);
    console.error('GET climate-survey', err);
    return apiError(request, ERR.INTERNAL, 500);
  }
}

/** PATCH /api/admin/climate-surveys/[id] */
export async function PATCH(request, props) {
  const params = await props.params;
  try {
    const payload = await getSessionPayload();
    if (!requireCapability(payload, CAP.CLIMATE_VIEW)) return apiError(request, ERR.UNAUTHORIZED, 401);
    const scope = getManagerScope(payload);
    if (!scope.authorized) return apiError(request, ERR.UNAUTHORIZED, 401);

    const surveyId = params?.id;
    if (!surveyId) return apiError(request, ERR.INVALID_ID, 400);

    const loaded = await loadScopedSurvey(surveyId, scope);
    if (loaded.error) return apiError(request, loaded.error, loaded.error === 'NOT_FOUND' ? 404 : 401);
    const companyId = loaded.survey.companyId;

    const body = await request.json().catch(() => ({}));

    if (body.archive) {
      const archived = await archiveClimateSurvey(query, { companyId, surveyId });
      if (!archived.ok) return apiError(request, archived.errorCode || 'INVALID_DATA', 400);
      await audit({
        actorUserId: payload.userId || null,
        action: 'climate_survey.archive',
        targetType: 'climate_survey',
        targetId: surveyId,
      });
      return NextResponse.json({ ok: true, survey: archived.survey });
    }

    if (body.version) {
      const versioned = await versionClimateSurvey(query, {
        companyId,
        surveyId,
        createdByUserId: payload.userId || null,
        title: body.version?.title || body.title || null,
      });
      if (!versioned.ok) return apiError(request, versioned.errorCode || 'INVALID_DATA', 400);
      await audit({
        actorUserId: payload.userId || null,
        action: 'climate_survey.version',
        targetType: 'climate_survey',
        targetId: surveyId,
        metadata: { newSurveyId: versioned.survey?.id },
      });
      return NextResponse.json({ ok: true, survey: versioned.survey, sourceSurveyId: versioned.sourceSurveyId });
    }

    if (body.createInvite) {
      const inv = await createClimateSurveyInvite(query, {
        companyId,
        surveyId,
        ttlDays: body.ttlDays,
      });
      if (!inv.ok) return apiError(request, inv.errorCode || 'INVALID_DATA', 400);
      await audit({
        actorUserId: payload.userId || null,
        action: 'climate_survey.invite',
        targetType: 'climate_survey',
        targetId: surveyId,
        metadata: { inviteId: inv.invite.id },
      });
      return NextResponse.json({ ok: true, invite: inv.invite });
    }

    if (body.createInviteBatch) {
      const batch = await createClimateSurveyInviteBatch(query, {
        companyId,
        surveyId,
        count: body.count,
        ttlDays: body.ttlDays,
      });
      if (!batch.ok) return apiError(request, batch.errorCode || 'INVALID_DATA', 400);
      await audit({
        actorUserId: payload.userId || null,
        action: 'climate_survey.invite_batch',
        targetType: 'climate_survey',
        targetId: surveyId,
        metadata: { n: batch.invites.length },
      });
      return NextResponse.json({ ok: true, invites: batch.invites });
    }

    if (body.emailInvites) {
      const origin =
        body.appOrigin ||
        runtimeAppUrl() ||
        new URL(request.url).origin;
      const mailed = await emailClimateSurveyInvites(query, {
        companyId,
        surveyId,
        emails: body.emails,
        appOrigin: origin,
        locale: body.locale || payload.locale || 'pt-BR',
        ttlDays: body.ttlDays,
      });
      if (!mailed.ok) {
        const status = mailed.errorCode === 'MAIL_NOT_CONFIGURED' ? 503 : 400;
        return apiError(request, mailed.errorCode || 'INVALID_DATA', status);
      }
      await audit({
        actorUserId: payload.userId || null,
        action: 'climate_survey.invite_email',
        targetType: 'climate_survey',
        targetId: surveyId,
        metadata: { sent: mailed.sent },
      });
      return NextResponse.json({
        ok: true,
        sent: mailed.sent,
        skipped: mailed.skipped,
        invites: mailed.invites,
      });
    }

    if (body.addQuestion) {
      const added = await addClimateSurveyQuestion(query, {
        companyId,
        surveyId,
        prompt: body.addQuestion.prompt,
        sortOrder: body.addQuestion.sortOrder,
        questionKind: body.addQuestion.questionKind || body.addQuestion.kind,
        psychosocialFactor: body.addQuestion.psychosocialFactor,
      });
      if (!added.ok) return apiError(request, added.errorCode || 'INVALID_DATA', 400);
      const survey = await getClimateSurvey(query, { companyId, surveyId });
      return NextResponse.json({ ok: true, question: added.question, survey });
    }

    if (body.updateQuestion && body.updateQuestion.id) {
      const upd = await updateClimateSurveyQuestion(query, {
        companyId,
        surveyId,
        questionId: body.updateQuestion.id,
        prompt: body.updateQuestion.prompt,
        sortOrder: body.updateQuestion.sortOrder,
        active: body.updateQuestion.active,
      });
      if (!upd.ok) return apiError(request, upd.errorCode || 'INVALID_DATA', 400);
      const survey = await getClimateSurvey(query, { companyId, surveyId });
      return NextResponse.json({ ok: true, question: upd.question, survey });
    }

    const updated = await updateClimateSurvey(query, {
      companyId,
      surveyId,
      title: body.title,
      description: body.description,
      status: body.status,
      opensAt: body.opensAt,
      closesAt: body.closesAt,
    });
    if (!updated.ok) return apiError(request, updated.errorCode || 'INVALID_DATA', 400);

    await audit({
      actorUserId: payload.userId || null,
      action: 'climate_survey.update',
      targetType: 'climate_survey',
      targetId: surveyId,
      metadata: { status: updated.survey.status },
    });

    return NextResponse.json({ ok: true, survey: updated.survey });
  } catch (err) {
    if (err?.code === '42P01') return apiError(request, ERR.SCHEMA_NOT_INITIALIZED, 503);
    console.error('PATCH climate-survey', err);
    return apiError(request, ERR.INTERNAL, 500);
  }
}

/** DELETE /api/admin/climate-surveys/[id] — soft delete */
export async function DELETE(request, props) {
  const params = await props.params;
  try {
    const payload = await getSessionPayload();
    if (!requireCapability(payload, CAP.CLIMATE_VIEW)) return apiError(request, ERR.UNAUTHORIZED, 401);
    const scope = getManagerScope(payload);
    if (!scope.authorized) return apiError(request, ERR.UNAUTHORIZED, 401);

    const surveyId = params?.id;
    if (!surveyId) return apiError(request, ERR.INVALID_ID, 400);

    const loaded = await loadScopedSurvey(surveyId, scope);
    if (loaded.error) return apiError(request, loaded.error, loaded.error === 'NOT_FOUND' ? 404 : 401);

    const archived = await archiveClimateSurvey(query, {
      companyId: loaded.survey.companyId,
      surveyId,
    });
    if (!archived.ok) return apiError(request, archived.errorCode || 'NOT_FOUND', 404);

    await audit({
      actorUserId: payload.userId || null,
      action: 'climate_survey.archive',
      targetType: 'climate_survey',
      targetId: surveyId,
    });

    return NextResponse.json({ ok: true, survey: archived.survey });
  } catch (err) {
    if (err?.code === '42P01') return apiError(request, ERR.SCHEMA_NOT_INITIALIZED, 503);
    console.error('DELETE climate-survey', err);
    return apiError(request, ERR.INTERNAL, 500);
  }
}
