export type AppStage = "idle" | "analyzing" | "voicing" | "exporting" | "done" | "error";
export type TaskStatus = "pending" | "running" | "done" | "error";

export type TaskStep = {
  label: string;
  status: TaskStatus;
};

export const initialSteps: TaskStep[] = [
  { label: "读取视频元数据", status: "pending" },
  { label: "检测静音区间（参考）", status: "pending" },
  { label: "生成整段全局理解", status: "pending" },
  { label: "切分 3 秒片段并生成描述", status: "pending" },
];
