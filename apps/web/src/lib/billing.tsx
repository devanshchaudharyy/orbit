import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router';
import { entitlementSchema } from '@orbit/contracts';
import { useAuth } from './auth';
import { useOrganization, orgPath } from './tenants';
import { StatusNotice } from '../components/AuthLayout';
export function useBillingEntitlements(org: string) {
  const auth = useAuth();
  return useQuery({
    queryKey: ['billing-entitlements', auth.user?.id, org],
    queryFn: () =>
      auth.request(
        `/${org}/billing/entitlements`,
        entitlementSchema,
        'GET',
        undefined,
        'organizations',
      ),
    retry: 1,
    refetchOnWindowFocus: true,
  });
}
export function BillingFeatureNote({
  org,
  feature,
}: {
  org: string;
  feature: 'csvExport' | 'scheduledWorkflows';
}) {
  const info = useBillingEntitlements(org),
    organization = useOrganization(org);
  if (info.data?.limits[feature]) return null;
  if (info.isPending) return <p role="status">Checking plan access…</p>;
  if (info.isError)
    return (
      <StatusNotice>
        Plan information is unavailable.{' '}
        <button onClick={() => void info.refetch()}>Retry plan access</button>
      </StatusNotice>
    );
  return (
    <StatusNotice tone="info">
      {feature === 'csvExport' ? 'CSV exports' : 'Scheduled AI workflows'} require Pro or Business.{' '}
      {organization.data && ['owner', 'admin'].includes(organization.data.role) ? (
        <Link to={`${orgPath(org)}/billing`}>View organization Billing</Link>
      ) : (
        'Ask your organization owner about billing.'
      )}{' '}
      Core work and manual AI remain available.
    </StatusNotice>
  );
}
