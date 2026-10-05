import { query, withTransaction } from '../db.js';
import { ERR } from '../api-error-codes.js';
import { ORG_UNIT, orgUnitOptions } from '../org-unit-constants.js';
import { EMPLOYMENT_STATUS } from '../domain-status.js';

const fail = (errorCode) => ({ ok: false, errorCode });

export async function listOrgUnits(companyId) {
  // Primary: immediate consistency after edits/assignment.
  const result = await query(
    `SELECT u.id, u.name, u.parent_id AS "parentId",
       COUNT(c.id)::int AS "peopleCount"
     FROM org_units u
     LEFT JOIN candidates c ON c.company_id=u.company_id AND c.org_unit_id=u.id
       AND c.employment_status=$2
     WHERE u.company_id=$1 AND u.active=TRUE
     GROUP BY u.id ORDER BY lower(u.name),u.id LIMIT $3`,
    [companyId, EMPLOYMENT_STATUS.EMPLOYEE, ORG_UNIT.MAX_ACTIVE]
  );
  return { ok: true, units: result.rows };
}

/** Resolver id → "Parent / Child" label for the company's active units (one bounded query). */
export async function loadOrgUnitPaths(db, companyId) {
  const r = await (db || { query }).query(
    `SELECT id, name, parent_id AS "parentId"
     FROM org_units WHERE company_id = $1 AND active = TRUE
     LIMIT $2`,
    [companyId, ORG_UNIT.MAX_ACTIVE]
  );
  const labels = new Map(orgUnitOptions(r.rows || []).map((u) => [Number(u.id), u.label]));
  return (id) => (id == null ? null : labels.get(Number(id)) || null);
}

/** Resolver id → [id, parent, grandparent, …] for every company unit (one bounded query). */
export async function loadOrgUnitAncestors(db, companyId) {
  const r = await (db || { query }).query(
    `SELECT id, parent_id AS "parentId" FROM org_units WHERE company_id = $1 LIMIT $2`,
    [companyId, ORG_UNIT.MAX_ACTIVE * 4]
  );
  const parentOf = new Map((r.rows || []).map((u) => [Number(u.id), u.parentId != null ? Number(u.parentId) : null]));
  const cache = new Map();
  return (id) => {
    if (id == null) return [];
    const key = Number(id);
    if (cache.has(key)) return cache.get(key);
    const chain = [];
    for (let cur = key; cur != null && chain.length < 20 && !chain.includes(cur); cur = parentOf.get(cur) ?? null) {
      chain.push(cur);
    }
    cache.set(key, chain);
    return chain;
  };
}

export async function getCandidateOrgUnit(companyId, candidateId) {
  const result = await query(
    `SELECT org_unit_id AS "orgUnitId" FROM candidates WHERE company_id=$1 AND id=$2`,
    [companyId, candidateId]
  );
  return result.rowCount ? { ok: true, ...result.rows[0] } : fail(ERR.NOT_FOUND);
}

/** All unit/assignment writers serialize on the same tenant row, including archiving. */
async function mutate(companyId, work) {
  try {
    return await withTransaction(async (db) => {
      const company = await db.query('SELECT id FROM companies WHERE id=$1 AND deleted=FALSE FOR UPDATE', [companyId]);
      if (!company.rowCount) return fail(ERR.NOT_FOUND);
      return work(db);
    });
  } catch (error) {
    if (error.code === '23505') return fail(ERR.ORG_UNIT_DUPLICATE);
    throw error;
  }
}

export async function saveOrgUnit({ companyId, id = null, name, parentId = null, active = true }) {
  return mutate(companyId, async (db) => {
    const { rows } = await db.query(
      'SELECT id,parent_id AS "parentId" FROM org_units WHERE company_id=$1 AND active=TRUE LIMIT $2',
      [companyId, ORG_UNIT.MAX_ACTIVE]
    );
    const byId = new Map(rows.map((row) => [Number(row.id), row]));
    if (id && !byId.has(id)) return fail(ERR.NOT_FOUND);
    if (!id && rows.length >= ORG_UNIT.MAX_ACTIVE) return fail(ERR.ORG_UNIT_LIMIT);
    if (!active) {
      const used = await db.query(
        `SELECT 1 WHERE EXISTS(SELECT 1 FROM candidates WHERE company_id=$1 AND org_unit_id=$2)
          OR EXISTS(SELECT 1 FROM org_units WHERE company_id=$1 AND parent_id=$2 AND active=TRUE)`,
        [companyId, id]
      );
      if (used.rowCount) return fail(ERR.ORG_UNIT_IN_USE);
      await db.query('UPDATE org_units SET active=FALSE,updated_at=now() WHERE company_id=$1 AND id=$2', [companyId, id]);
      return { ok: true, id };
    }
    const cleanName = String(name || '').trim();
    if (!cleanName || cleanName.length > ORG_UNIT.MAX_NAME) return fail(ERR.INVALID_DATA);
    if (parentId && !byId.has(parentId)) return fail(ERR.NOT_FOUND);
    // Validate the entire resulting forest, including descendants moved by reparenting.
    const self = id || -1;
    byId.set(self, { id: self, parentId });
    for (const unit of byId.values()) {
      const seen = new Set();
      let cursor = unit.id;
      while (cursor != null) {
        if (seen.has(cursor)) return fail(ERR.ORG_UNIT_CYCLE);
        seen.add(cursor);
        if (seen.size > ORG_UNIT.MAX_DEPTH) return fail(ERR.ORG_UNIT_DEPTH);
        cursor = byId.get(cursor)?.parentId ?? null;
      }
    }
    const result = id
      ? await db.query('UPDATE org_units SET name=$3,parent_id=$4,updated_at=now() WHERE company_id=$1 AND id=$2 RETURNING id', [companyId, id, cleanName, parentId])
      : await db.query('INSERT INTO org_units(company_id,name,parent_id) VALUES($1,$2,$3) RETURNING id', [companyId, cleanName, parentId]);
    return { ok: true, id: result.rows[0].id };
  });
}

export async function assignOrgUnit({ companyId, candidateId, orgUnitId }) {
  return mutate(companyId, async (db) => {
    if (orgUnitId != null) {
      const unit = await db.query('SELECT id FROM org_units WHERE company_id=$1 AND id=$2 AND active=TRUE', [companyId, orgUnitId]);
      if (!unit.rowCount) return fail(ERR.NOT_FOUND);
    }
    const result = await db.query(
      `UPDATE candidates SET org_unit_id=$3 WHERE company_id=$1 AND id=$2 AND employment_status=ANY($4::text[]) RETURNING id`,
      [companyId, candidateId, orgUnitId, [EMPLOYMENT_STATUS.EMPLOYEE, EMPLOYMENT_STATUS.ALUMNI]]
    );
    return result.rowCount ? { ok: true, candidateId, orgUnitId } : fail(ERR.NOT_FOUND);
  });
}
