# Company module entitlements

Commercial packs above per-user CAP. Early-adopter onboarding can pick modules; legacy tenants keep all.

## Defaults

| Stored value | Meaning |
|---|---|
| `companies.enabled_modules` **NULL** | All modules (legacy / skip wizard / all checkboxes) |
| Non-null text[] | Allow-list; `core` always implied in app |

## Who edits

| Who | Where |
|---|---|
| Any company-bound manager (`hr`, `direction`, tenant `admin`) | **Meu perfil** (`GET/PUT /api/me/company-modules`) |
| Any new company-bound manager | Also chooses the initial set in the onboarding wizard |
| Super-admin | Empresas → editar/criar → Módulos comerciais (`GET/PUT /api/admin/company-modules`) and Usuários → módulos individuais |

## Rules

- Manager CAP ∩ company modules (session + `can` / tab gate).
- Platform super-admin (admin without `company_id`) is unrestricted by company modules and per-user overrides.
- Module off → hide UI surfaces; employee home/nav hide sections. No upsell chips in menus. Dedicated employee APIs stay reachable by URL if known.
- Public assessment tokens stay valid regardless of module.
- Admin-only tabs (`users`, `companies`, …) stay available.
- Compensation uses its own sensitive module/capabilities.
- The onboarding objective suggests a narrow starting set; the manager reviews checkboxes grouped visually (core / people / hire / ops). Storage keys stay flat.

## Keys

See `COMPANY_MODULE` in `lib/company/company-modules.js`.

Schema: `migrations/109_company_module_entitlements.sql`.
