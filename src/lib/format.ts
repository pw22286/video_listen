import type React from "react";

export function formatTime(ms: number) {
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  const millis = ms % 1000;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(
    2,
    "0",
  )}.${String(millis).padStart(3, "0")}`;
}

export function formatDate(value: string) {
  if (!value) return "";
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

export function rangeStyle(value: number, min: number, max: number) {
  const fill = ((value - min) / (max - min)) * 100;
  return { "--range-fill": `${fill}%` } as React.CSSProperties;
}
