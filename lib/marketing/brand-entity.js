export const GROW_ORGANIZATION_ID = 'https://30grow.com/#organization';
export const PARENT_ORGANIZATION_ID = 'https://3035tech.com/#organization';
export const GROW_WEBSITE_ID = 'https://30grow.com/#website';
export const GROW_SOFTWARE_ID = 'https://30grow.com/#software';
export const PRODUCT_LANDING_CONTACT_EMAIL = 'contact@3035tech.com';

export function brandOrganizations() {
  return [
    {
      '@type': 'Organization',
      '@id': GROW_ORGANIZATION_ID,
      name: '30Grow',
      alternateName: ['30 Grow', '30grow'],
      url: 'https://30grow.com',
      logo: {
        '@type': 'ImageObject',
        url: 'https://30grow.com/brand/logo-512.png',
        width: 512,
        height: 512,
      },
      sameAs: ['https://www.linkedin.com/company/30grow/', 'https://www.instagram.com/30grow/'],
      parentOrganization: { '@id': PARENT_ORGANIZATION_ID },
      email: PRODUCT_LANDING_CONTACT_EMAIL,
      contactPoint: {
        '@type': 'ContactPoint',
        contactType: 'sales',
        email: PRODUCT_LANDING_CONTACT_EMAIL,
      },
    },
    {
      '@type': 'Organization',
      '@id': PARENT_ORGANIZATION_ID,
      name: '3035Tech',
      url: 'https://3035tech.com',
    },
  ];
}

export function brandWebSite(inLanguage) {
  return {
    '@type': 'WebSite',
    '@id': GROW_WEBSITE_ID,
    name: '30Grow',
    alternateName: '30 Grow',
    url: 'https://30grow.com/',
    ...(inLanguage ? { inLanguage } : {}),
    publisher: { '@id': GROW_ORGANIZATION_ID },
  };
}
