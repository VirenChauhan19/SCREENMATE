"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { AgentPanel } from "@/components/AgentPanel";
import { ApplicationForm } from "@/components/ApplicationForm";
import { TopBar } from "@/components/TopBar";
import { useScreenmate } from "@/hooks/useScreenmate";

export default function Page() {
  const sm = useScreenmate();
  const [online, setOnline] = useState(false);
  useEffect(() => {
    void Promise.all([fetch('/api/health'), fetch('/api/session')])
      .then(async ([health, session]) => setOnline(Boolean((await health.json()).configured?.openrouter && (await session.json()).authenticated)))
      .catch(() => setOnline(false));
  }, []);

  return (
    <div className="flex min-h-screen flex-col lg:h-screen lg:overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-ink-700 bg-accent-dim px-6 py-2 text-sm text-mist-200">
        <span>Demo application · Sample profile and fictional employer{!online ? " · Unlock website access in your workspace to run the demo" : ""}</span>
        <Link href="/" className="text-accent-300 underline">Back to your workspace</Link>
      </div>
      <TopBar
        roleId={sm.state.roleId}
        jobTitle={sm.state.jobTitle}
        company={sm.state.company}
        online={online && sm.status !== "error"}
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
            onReopenReview={sm.reopenReview}
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
