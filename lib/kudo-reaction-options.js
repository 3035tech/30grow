/** Fixed domain: one current reaction per person; extra choices require catalog v2. */
export const KUDO_QUICK_REACTION_EMOJIS = Object.freeze(['👍', '❤️', '👏', '🎉', '🙌']);
export const KUDO_REACTION_EMOJIS = Object.freeze([...KUDO_QUICK_REACTION_EMOJIS, '😊', '💪', '🚀', '⭐', '🔥', '💯', '🤝', '🏆', '🙏', '🤩', '💡', '🥳']);
export const KUDO_REACTION_CATALOG_HEADER = 'X-Kudo-Reaction-Catalog';
export const KUDO_REACTION_CATALOG_VERSION = '2';
export const KUDO_REACTORS_PAGE_SIZE = 40;

/** Old installed apps opt in only after their schemas support the wider catalog. */
export function supportsExpandedKudoReactions(request) {
  return request.headers.get(KUDO_REACTION_CATALOG_HEADER) === KUDO_REACTION_CATALOG_VERSION;
}
