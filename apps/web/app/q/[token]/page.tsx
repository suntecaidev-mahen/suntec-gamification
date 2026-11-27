import { redirect } from 'next/navigation';

/**
 * Printed QR codes encode https://<host>/q/<token>. Opening one with the phone camera
 * lands here and continues in the Play & Win scanner.
 */
export default async function QrLanding({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  redirect(`/play/scan?token=${encodeURIComponent(token)}`);
}
