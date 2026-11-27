import { Suspense } from 'react';
import { RewardsScreen } from '@/components/play/screens';

export const metadata = { title: 'Rewards' };

export default function Page() {
  return <Suspense>
      <RewardsScreen />
    </Suspense>;
}
