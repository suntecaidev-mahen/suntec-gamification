/** Public Suntec City information (source: https://sunteccity.com.sg/). */
export const SUNTEC = {
  mallName: 'Suntec City',
  address: '3 Temasek Boulevard, Singapore 038983',
  openingHours: 'Daily 10am – 10pm',
  links: {
    website: 'https://sunteccity.com.sg/',
    gettingHere: 'https://sunteccity.com.sg/getting_here',
    faq: 'https://sunteccity.com.sg/faq',
    chat: 'https://quickchat.sunteccity.com.sg/',
    aboutSuntecPlus: 'https://sunteccity.com.sg/about_suntec_plus',
    terms: 'https://sunteccity.com.sg/terms-and-conditions',
    privacy: 'https://sunteccity.com.sg/privacy-policy',
    appStore: 'https://apps.apple.com/us/app/suntec/id6477148620',
    googlePlay: 'https://play.google.com/store/apps/details?id=com.apm.suntec&hl=en-SG',
  },
  /** Android package of the Suntec+ app (from its Play Store listing). */
  androidPackage: 'com.apm.suntec',
} as const;

/**
 * Deep link into the Suntec+ app's sign-up screen, e.g. "suntecplus://signup?claim={code}".
 * Provided by the Suntec+ app team (NEXT_PUBLIC_SUNTEC_APP_SIGNUP_LINK). Until it is set,
 * "Join Suntec+" goes straight to the App Store / Google Play.
 */
export function appSignupLink(claimCode: string | null): string | null {
  const template = process.env.NEXT_PUBLIC_SUNTEC_APP_SIGNUP_LINK;
  if (!template) return null;
  const code = encodeURIComponent(claimCode ?? '');
  return template.includes('{code}') ? template.replace('{code}', code) : template;
}
