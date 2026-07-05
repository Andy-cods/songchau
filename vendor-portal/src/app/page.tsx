import { redirect } from 'next/navigation';
import { BP } from '@/lib/base-path';

export default function Home() {
  redirect(`${BP}/login`);
}
