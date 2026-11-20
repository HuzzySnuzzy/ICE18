import { DatabaseExplorer } from '../components/DatabaseExplorer';
import { PageHeader } from '../components/ui';
import { useAuth } from '../lib/auth';

export function DatabasesPage() {
  const { user } = useAuth();
  return (
    <>
      <PageHeader
        title="Databases"
        subtitle={
          <>
            <span className="sm:hidden">Every database across your servers.</span>
            <span className="hidden sm:inline">
              Every database across your servers: where it lives, which servers use it, and its data. Read-only while any server
              using it is online.
            </span>
          </>
        }
      />
      <DatabaseExplorer isAdmin={Boolean(user?.isAdmin)} />
    </>
  );
}
