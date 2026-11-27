import { redirect } from 'next/navigation';

/**
 * Printed QR codes encode https://<host>/q/<token>. Opening one with the phone camera
 * lands here and continues in the portal scanner (sign-in first if needed).
 */
export default async function QrLanding({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  redirect(`/portal/scan?token=${encodeURIComponent(token)}`);
}
