"use client";

import { AgentPanel } from "@/components/AgentPanel";
import { ApplicationForm } from "@/components/ApplicationForm";
import { TopBar } from "@/components/TopBar";
import { useScreenmate } from "@/hooks/useScreenmate";

export default function Page() {
  const sm = useScreenmate();

  return (
    <div className="flex h-screen flex-col overflow-hidden">
      <TopBar
        roleId={sm.state.roleId}
        jobTitle={sm.state.jobTitle}
        company={sm.state.company}
        online={sm.status !== "error"}
        onReset={() => sm.reset()}
        onStartDemo={sm.startDemo}
        onChangeRole={sm.changeRole}
      />

      <div className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[68fr_32fr]">
        <main className="min-h-0 overflow-y-auto">
          <ApplicationForm
            state={sm.state}
            approval={sm.approval}
            approvalCount={sm.approvalCount}
            changes={sm.changes}
            report={sm.report}
            stats={sm.stats}
            showReview={sm.status === "reviewing"}
            showSuccess={sm.status === "complete"}
            busy={sm.isRunning}
            lastWrite={sm.lastWrite}
            onChange={sm.updateField}
            onApprovalAnswer={sm.resolveApproval}
            onAcceptAll={sm.acceptAllChanges}
            onAccept={sm.acceptChange}
            onReject={sm.rejectChange}
            onEdit={sm.editChange}
            onRegenerate={sm.regenerate}
            onFinishReview={sm.completeReview}
          />
        </main>

        <AgentPanel
          state={sm.state}
          status={sm.status}
          goal={sm.goal}
          steps={sm.steps}
          activity={sm.activity}
          research={sm.research}
          contextAlert={sm.contextAlert}
          banner={sm.banner}
          isRunning={sm.isRunning}
          onRun={sm.run}
          onStartDemo={sm.startDemo}
          onRestore={sm.restoreField}
          onDismissAlert={sm.dismissContextAlert}
        />
      </div>
    </div>
  );
}
