import { redirect } from 'next/navigation';

export default function LegacyAddressRoute() {
  redirect('/compose');
}
