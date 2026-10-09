import './brand-tokens.css';
import './globals.css';
import './mobile-fixes.css';
import './dark-mode.css';
import { cookies, headers } from 'next/headers';
import { DEFAULT_LOCALE, LOCALE_COOKIE, localeHtmlLang, normalizeLocale, t } from '../lib/i18n';
import { I18nBoot } from './_components/I18nBoot';
import { DarkModeProvider } from './_components/DarkModeProvider';
import { versionedIcon } from '../lib/brand';
import { themeInitScript } from '../lib/theme-mode';

export async function generateMetadata() {
  const cookieStore = await cookies();
  const locale = normalizeLocale((await headers()).get('x-public-locale') || cookieStore.get(LOCALE_COOKIE)?.value);
  return {
    title: '30Grow',
    verification: process.env.GOOGLE_SITE_VERIFICATION ? { google: process.env.GOOGLE_SITE_VERIFICATION } : undefined,
    description: t(locale, 'home.metaDescription'),
    icons: {
      icon: [
        { url: versionedIcon('/favicon.ico'), sizes: 'any' },
        { url: versionedIcon('/brand/favicon.svg'), type: 'image/svg+xml' },
        { url: versionedIcon('/brand/logo-32.png'), sizes: '32x32', type: 'image/png' },
        { url: versionedIcon('/brand/logo-16.png'), sizes: '16x16', type: 'image/png' },
      ],
      apple: [{ url: versionedIcon('/apple-icon.png'), sizes: '180x180', type: 'image/png' }],
      shortcut: versionedIcon('/favicon.ico'),
    },
    manifest: versionedIcon('/site.webmanifest'),
  };
}

export const viewport = { themeColor: '#111827' };

export default async function RootLayout({ children }) {
  const nonce = (await headers()).get('x-nonce') || undefined;
  const cookieStore = await cookies();
  const locale = normalizeLocale((await headers()).get('x-public-locale') || cookieStore.get(LOCALE_COOKIE)?.value);
  return (
    <html lang={localeHtmlLang(locale)} suppressHydrationWarning>
      <head>
        <meta charSet="utf-8"/>
        {/* Apply theme before paint (see lib/theme-mode.js) */}
        <script nonce={nonce} dangerouslySetInnerHTML={{ __html: themeInitScript() }} />
      </head>
      <body className="m-0 bg-canvas p-0 font-ui text-prose text-ink antialiased">
        <DarkModeProvider>
          <I18nBoot locales={[locale, DEFAULT_LOCALE]}>
            {children}
          </I18nBoot>
        </DarkModeProvider>
      </body>
    </html>
  );
}
