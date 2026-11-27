import { redirect } from 'next/navigation';

/** The public link opens Play & Win directly. (Staff use /admin.) */
export default function Home() {
  redirect('/play');
}
