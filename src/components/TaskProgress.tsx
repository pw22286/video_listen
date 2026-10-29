import { CheckCircle2, Loader2 } from "lucide-react";
import type { AppStage, TaskStep } from "../lib/tasks";

export function TaskProgress({
  steps,
  stage,
  taskText,
}: {
  steps: TaskStep[];
  stage: AppStage;
  taskText: string;
}) {
  const completed = steps.filter((step) => step.status === "done").length;
  const progress = Math.round((completed / steps.length) * 100);

  return (
    <div className="task-compact">
      <div className="task-heading">
        <span>{taskText}</span>
        {stage === "analyzing" || stage === "voicing" || stage === "exporting" ? (
          <Loader2 className="spin" size={16} />
        ) : (
          <CheckCircle2 size={16} />
        )}
      </div>
      <div className="progress-track">
        <div className="progress-fill" style={{ width: `${progress}%` }} />
      </div>
      <details className="step-list-details">
        <summary>任务步骤</summary>
        <div className="step-list">
          {steps.map((step) => (
            <div key={step.label} className={`step ${step.status}`}>
              <span />
              {step.label}
            </div>
          ))}
        </div>
      </details>
    </div>
  );
}
