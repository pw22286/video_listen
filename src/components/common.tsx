import { AlertCircle, CheckCircle2 } from "lucide-react";

export function PanelHeader({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <div className="panel-header-dark">
      <div>
        <h2>{title}</h2>
        <p>{subtitle}</p>
      </div>
    </div>
  );
}

export function ErrorBanner({
  message,
  onDismiss,
}: {
  message: string;
  onDismiss: () => void;
}) {
  return (
    <div className="error-banner">
      <AlertCircle size={18} />
      <span>{message}</span>
      <button onClick={onDismiss}>关闭</button>
    </div>
  );
}

export function ExportToast({ path }: { path: string }) {
  return (
    <div className="export-toast">
      <CheckCircle2 size={18} />
      <div>
        <strong>导出完成</strong>
        <span>{path}</span>
      </div>
    </div>
  );
}
