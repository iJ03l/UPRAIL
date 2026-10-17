'use client';

import { AgentsPage } from '@/views/AgentsPage';
import { FeatureGate } from '@/components/FeatureGate';

export default function Page() {
  return (
    <FeatureGate
      storageKey="uprail_gate_agents"
      title="The Agent Rail is coming soon"
      subtitle="Give AI agents a scoped key to pay any X handle. Enter the access code to preview."
      docsHref="https://docs.uprail.world/agents"
    >
      <AgentsPage />
    </FeatureGate>
  );
}
